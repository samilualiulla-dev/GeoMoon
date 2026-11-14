"""3-DOF point-mass descent simulation around a spherical, rotating Moon.

State y = [x, y, z, vx, vy, vz, m]   (MCI frame; m, kg)

    dr/dt = v
    dv/dt = -mu r/|r|^3  +  (F_thrust / m) * u_thrust
    dm/dt = -F_thrust / (Isp g0)

Modelled:  central-body gravity, thrust (throttle, cut-off, fuel limit), mass depletion, Moon rotation,
           surface contact on a DEM-derived surface height (or the target elevation if no DEM).
NOT modelled: attitude dynamics/slew limits, gravity harmonics (mascons), solar-radiation pressure,
           third-body gravity, propellant slosh, engine transients, terrain-relative sensing, guidance.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from ..core.constants import G0, MOON_MU, MOON_RADIUS_M, MOON_ROTATION_RATE
from ..core.coords import cartesian_to_geo, enu_basis, geo_to_cartesian, great_circle_distance_m, offset_point, wrap_lon
from ..spacecraft.schemas import InitialConditions, SimSettings, SpacecraftConfig, check_initial_state
from .frames import mci_to_bf, omega_vec, surface_relative_velocity
from .gravity import gravity_acceleration
from .integrator import integrate_phase
from .propulsion import thrust_and_flow

SurfaceFn = Callable[[float, float], float]  # (lat_deg, lon_deg) -> surface height above reference sphere [m] (NaN if unknown)

ASSUMPTIONS = [
    "Point-mass 3-DOF model: attitude is not simulated; thrust points along the commanded direction instantly.",
    "Central-body gravity mu/r^2 only (no gravity harmonics/mascons, no third-body forces).",
    "Spherical Moon of radius 1737.4 km; DEM heights are measured from this reference sphere.",
    "Open-loop burn scenario supplied by the user; no guidance, navigation or control law is simulated.",
    "No atmosphere (lunar exosphere drag neglected).",
    "Constant-Isp engine; no start-up/shut-down transients or throttle rate limits.",
]


@dataclass
class SimulationOutput:
    time_series: dict[str, list]
    final_state: dict
    summary: dict
    warnings: list[str] = field(default_factory=list)


def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def simulate(cfg: SpacecraftConfig, ic: InitialConditions, settings: SimSettings | None = None, *,
             surface_fn: SurfaceFn | None = None, target_elevation_m: float = 0.0,
             reference_radius_m: float = MOON_RADIUS_M, mu: float = MOON_MU) -> SimulationOutput:
    settings = settings or SimSettings()
    warnings = check_initial_state(cfg, ic)
    omega = MOON_ROTATION_RATE if settings.moon_rotation else 0.0
    wvec = omega_vec(omega)
    eng, burn = cfg.engine, ic.burn
    dry = cfg.dry_mass_kg
    tlat, tlon = ic.target_latitude_deg, wrap_lon(ic.target_longitude_deg)

    def surf_h(lat: float, lon: float) -> float:
        if surface_fn is not None:
            h = surface_fn(lat, lon)
            if np.isfinite(h):
                return float(h)
        return target_elevation_m

    def surface_radius(y: np.ndarray, t: float) -> float:
        lat, lon, _ = cartesian_to_geo(mci_to_bf(y[:3], t, omega))
        return reference_radius_m + surf_h(lat, lon)

    # ---- initial state ----------------------------------------------------------------
    if ic.initial_downrange_m > 0:
        slat, slon = offset_point(tlat, tlon, ic.azimuth_deg + 180.0, ic.initial_downrange_m, reference_radius_m)
    else:
        slat, slon = tlat, tlon
    r0 = reference_radius_m + surf_h(slat, slon) + ic.initial_altitude_m
    pos0 = geo_to_cartesian(slat, slon, r0)
    e, n, u = enu_basis(slat, slon)
    az, gam = np.radians(ic.azimuth_deg), np.radians(ic.flight_path_angle_deg)
    v_rel0 = ic.initial_speed_m_s * (np.cos(gam) * (np.cos(az) * n + np.sin(az) * e) + np.sin(gam) * u)
    v0 = v_rel0 + np.cross(wvec, pos0)
    y0 = np.concatenate([pos0, v0, [cfg.total_mass_kg]])
    fixed_dir = None
    if burn.direction == "fixed_enu":
        a = np.array(burn.fixed_enu, float)
        fixed_dir = _unit(a[0] * e + a[1] * n + a[2] * u)

    # ---- dynamics ----------------------------------------------------------------------
    def thrust_dir(t, y):
        r, v = y[:3], y[3:6]
        if burn.direction == "radial_up":
            return _unit(r)
        if burn.direction == "fixed_enu":
            return fixed_dir
        vr = surface_relative_velocity(r, v, omega)
        sp = np.linalg.norm(vr)
        return -vr / sp if sp > 1e-3 else _unit(r)

    def make_rhs(throttle: float):
        def f(t, y):
            m = y[6]
            F, mdot = thrust_and_flow(eng, throttle, m - dry)
            a = gravity_acceleration(y[:3], mu)
            if F > 0:
                a = a + (F / m) * thrust_dir(t, y)
            return np.concatenate([y[3:6], a, [-mdot]])
        return f

    ev_touch = lambda t, y: np.linalg.norm(y[:3]) - surface_radius(y, t)
    ev_fuel = lambda t, y: y[6] - dry - 1e-9
    ev_ign = lambda t, y: np.linalg.norm(y[:3]) - surface_radius(y, t) - (burn.ignition_altitude_m or 0.0)
    ev_cut = lambda t, y: np.linalg.norm(surface_relative_velocity(y[:3], y[3:6], omega)) - (burn.cutoff_speed_m_s or 0.0)

    segs: list[tuple[np.ndarray, np.ndarray, float]] = []   # (t, y, throttle)
    log: list[dict] = []
    t, y = 0.0, y0
    tmax = settings.max_time_s
    kw = dict(method=settings.integrator, dt_out=settings.output_dt_s, rk4_step_s=settings.rk4_step_s,
              rtol=settings.rtol, atol=settings.atol)
    state = {"touched": False}

    def run(throttle: float, t_stop: float, extra: list[tuple[str, Callable]]):
        nonlocal t, y
        names = ["touchdown"] + [n_ for n_, _ in extra]
        res = integrate_phase(make_rhs(throttle), t, y, min(t_stop, tmax), [ev_touch] + [f_ for _, f_ in extra], **kw)
        segs.append((res.t, res.y, throttle))
        t, y = res.t_end, res.y[-1].copy()
        hit = names[res.event_index] if res.event_index is not None else None
        if hit == "touchdown":
            state["touched"] = True
        return hit

    def burn_phase(throttle: float, t_stop: float, with_cutoff: bool):
        extra = [("fuel_exhausted", ev_fuel)] + ([("cutoff_speed", ev_cut)] if with_cutoff and burn.cutoff_speed_m_s else [])
        hit = run(throttle, t_stop, extra)
        if hit:
            log.append({"t_s": t, "event": hit})
        return hit

    if burn.mode == "none" or eng.total_thrust_n <= 0:
        run(0.0, tmax, [])
    elif burn.mode == "altitude":
        hit = run(0.0, tmax, [("ignition", ev_ign)])
        if hit == "ignition":
            log.append({"t_s": t, "event": "ignition", "altitude_m": float(np.linalg.norm(y[:3]) - surface_radius(y, t))})
            hit = burn_phase(burn.throttle, tmax, True)
            if hit in ("fuel_exhausted", "cutoff_speed") and not state["touched"] and t < tmax:
                run(0.0, tmax, [])
    elif burn.mode == "time":
        hit = run(0.0, burn.ignition_time_s, [])
        if not state["touched"] and t < tmax:
            log.append({"t_s": t, "event": "ignition"})
            hit = burn_phase(burn.throttle, tmax, True)
            if hit in ("fuel_exhausted", "cutoff_speed") and not state["touched"] and t < tmax:
                run(0.0, tmax, [])
    else:  # schedule
        sched = list(burn.throttle_schedule)
        times = [s[0] for s in sched] + [tmax]
        if times[0] > 0:
            run(0.0, times[0], [])
        fuel_out = False
        for i, (ts_, th) in enumerate(sched):
            if state["touched"] or t >= tmax:
                break
            if fuel_out or th <= 0:
                run(0.0, times[i + 1], [])
                continue
            log.append({"t_s": t, "event": "throttle_set", "throttle": th})
            hit = burn_phase(th, times[i + 1], False)
            fuel_out = hit == "fuel_exhausted"
        if not state["touched"] and t < tmax:
            run(0.0, tmax, [])

    reason = "touchdown" if state["touched"] else "max_time_reached"
    return _package(segs, log, reason, cfg, ic, settings, omega, mu, reference_radius_m, surface_radius, surf_h,
                    make_rhs, thrust_dir, (tlat, tlon), y0, warnings, (e, n, u))


def _package(segs, log, reason, cfg, ic, settings, omega, mu, Rref, surface_radius, surf_h, make_rhs, thrust_dir,
             target, y0, warnings, enu0) -> SimulationOutput:
    eng, dry = cfg.engine, cfg.dry_mass_kg
    T, Y, TH = [], [], []
    for ts, ys, th in segs:
        for i in range(len(ts)):
            if T and abs(ts[i] - T[-1]) < 1e-12:   # drop duplicated phase boundary sample
                Y[-1] = ys[i]; TH[-1] = th if i > 0 or True else TH[-1]
                continue
            T.append(float(ts[i])); Y.append(ys[i]); TH.append(th)
    T = np.array(T); Y = np.array(Y)
    cols: dict[str, list] = {k: [] for k in (
        "time_s", "position_x_m", "position_y_m", "position_z_m", "velocity_x_m_s", "velocity_y_m_s", "velocity_z_m_s",
        "inertial_position_x_m", "inertial_position_y_m", "inertial_position_z_m",
        "inertial_velocity_x_m_s", "inertial_velocity_y_m_s", "inertial_velocity_z_m_s",
        "latitude_deg", "longitude_deg", "altitude_m", "distance_to_surface_m", "speed_surface_m_s",
        "vertical_speed_m_s", "horizontal_speed_m_s", "acceleration_m_s2", "proper_acceleration_m_s2", "thrust_n",
        "throttle", "mass_kg", "fuel_remaining_kg", "distance_to_target_m",
        "thrust_dir_x", "thrust_dir_y", "thrust_dir_z")}
    e0, n0, u0 = enu0
    peak_proper = 0.0
    for k, (t, y, th) in enumerate(zip(T, Y, TH)):
        r, v, m = y[:3], y[3:6], y[6]
        # throttle in effect at the final (event) sample belongs to the phase that ended there
        F, mdot = thrust_and_flow(eng, th, m - dry)
        a = gravity_acceleration(r, mu)
        if F > 0:
            a = a + (F / m) * thrust_dir(t, y)
        vrel = surface_relative_velocity(r, v, omega)
        rbf, vbf = mci_to_bf(r, t, omega), mci_to_bf(vrel, t, omega)
        lat, lon, rn = cartesian_to_geo(rbf)
        up = rbf / rn
        vv = float(vbf @ up); vh = float(np.linalg.norm(vbf - vv * up))
        proper = F / m
        peak_proper = max(peak_proper, proper)
        tdir = mci_to_bf(thrust_dir(t, y), t, omega) if F > 0 else np.zeros(3)
        row = [t, *rbf, *vbf, *r, *v, lat, lon, rn - Rref, rn - surface_radius(y, t), float(np.linalg.norm(vrel)), vv, vh,
               float(np.linalg.norm(a)), proper, F, th if F > 0 else 0.0, m, max(m - dry, 0.0),
               great_circle_distance_m(lat, lon, *target, Rref), *tdir]
        for key, val in zip(cols, row):
            cols[key].append(float(val))
    last = {k: v[-1] for k, v in cols.items()}
    touched = reason == "touchdown"
    final_state = {**last, "terminated_by": reason}
    fuel_used = cfg.fuel_mass_kg - last["fuel_remaining_kg"]
    summary = {
        "termination_reason": reason,
        "duration_s": last["time_s"],
        "touchdown": None,
        "fuel_used_kg": fuel_used,
        "fuel_remaining_kg": last["fuel_remaining_kg"],
        "peak_proper_acceleration_m_s2": peak_proper,
        "max_speed_surface_m_s": max(cols["speed_surface_m_s"]),
        "events": log,
        "integrator": settings.integrator,
        "frames": {"dynamics": "MCI (Moon-centred inertial, aligned with body-fixed at t=0)",
                   "reported_position_velocity": "BF (body-fixed, rotating); velocity is surface-relative",
                   "moon_rotation_modelled": settings.moon_rotation, "reference_radius_m": Rref, "mu_m3_s2": mu},
        "units": "SI: m, s, kg, N, deg",
        "assumptions": ASSUMPTIONS,
        "limitations": ["Result is a simplified-model estimate; it is not operational flight software and not a proof of landing safety.",
                        "Surface contact uses DEM height at the ground track where DEM coverage exists, otherwise the target elevation."],
    }
    if touched:
        summary["touchdown"] = {
            "latitude_deg": last["latitude_deg"], "longitude_deg": last["longitude_deg"],
            "time_s": last["time_s"], "vertical_speed_m_s": last["vertical_speed_m_s"],
            "horizontal_speed_m_s": last["horizontal_speed_m_s"], "speed_m_s": last["speed_surface_m_s"],
            "flight_path_angle_deg": float(np.degrees(np.arctan2(last["vertical_speed_m_s"], last["horizontal_speed_m_s"]))),
            "miss_distance_m": last["distance_to_target_m"],
            "surface_height_m": surf_h(last["latitude_deg"], last["longitude_deg"]),
            "mass_kg": last["mass_kg"],
        }
    else:
        warnings.append("Vehicle did not reach the surface before max_time_s.")
    return SimulationOutput(cols, final_state, summary, warnings)

"""Mission planner: Lambert initial guess + numerical shooting with the full n-body propagator.

Honest scope (also returned in every plan under ``limitations``):
* manoeuvres are IMPULSIVE (instant delta-v) - finite-burn / gravity losses are not optimised;
* the planner searches burn time (first ~1.3 orbits) and trip time on a grid, refines the delta-v vector with
  least-squares shooting on the periselene radius; no optimality proof, local solution only;
* the Moon ephemeris is the low-precision analytical model; all numbers are educational, not operational.
"""
from __future__ import annotations

import copy
import math
import time

import numpy as np
from scipy.optimize import least_squares

from .constants import G0, MOON_SOI_M, MU_EARTH, MU_MOON, R_EARTH, R_MOON
from .model import Command, SimConfig
from .simulation import Simulation, lunar_fixed_state, moon_angular_velocity


# --------------------------------------------------------------------------------------------------- Lambert
def _stumpff(z):
    if z > 1e-8:
        s = math.sqrt(z); return (1 - math.cos(s)) / z, (s - math.sin(s)) / s**3
    if z < -1e-8:
        s = math.sqrt(-z); return (math.cosh(s) - 1) / -z, (math.sinh(s) - s) / s**3
    return 0.5 - z / 24, 1 / 6 - z / 120


def lambert(r1, r2, tof, mu=MU_EARTH, prograde=True):
    """Universal-variable Lambert solver (Bate, Mueller & White). Returns (v1, v2). Single revolution."""
    r1, r2 = np.asarray(r1, float), np.asarray(r2, float)
    n1, n2 = np.linalg.norm(r1), np.linalg.norm(r2)
    cosd = float(np.dot(r1, r2)) / (n1 * n2)
    dnu = math.acos(max(-1, min(1, cosd)))
    cz = np.cross(r1, r2)[2]
    if (prograde and cz < 0) or (not prograde and cz >= 0):
        dnu = 2 * math.pi - dnu
    A = math.sin(dnu) * math.sqrt(n1 * n2 / (1 - math.cos(dnu)))
    if abs(A) < 1e-9:
        raise ValueError("Lambert: degenerate geometry (collinear)")

    def y(z):
        c2, c3 = _stumpff(z)
        return n1 + n2 + A * (z * c3 - 1) / math.sqrt(c2)

    def F(z):
        c2, c3 = _stumpff(z); yy = y(z)
        if yy < 0: return 1e30
        return (yy / c2) ** 1.5 * c3 + A * math.sqrt(yy) - math.sqrt(mu) * tof
    lo, hi = -4 * math.pi**2, 4 * math.pi**2 - 1e-6
    while y(lo) < 0 and lo < hi:
        lo += 0.5
    flo, fhi = F(lo), F(hi)
    if flo * fhi > 0:
        raise ValueError("Lambert: no solution bracketed")
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        fm = F(mid)
        if flo * fm <= 0: hi, fhi = mid, fm
        else: lo, flo = mid, fm
        if abs(hi - lo) < 1e-12: break
    z = 0.5 * (lo + hi); yy = y(z)
    f = 1 - yy / n1; g = A * math.sqrt(yy / mu); gd = 1 - yy / n2
    return (r2 - f * r1) / g, (gd * r2 - r1) / g


# --------------------------------------------------------------------------------------------------- helpers
def _coarse_cfg(cfg: SimConfig, commands: list[Command], duration: float, dt_max=1200.0, ideal=True) -> SimConfig:
    """``ideal``: unlimited-propellant probe vehicle so the planner finds the required delta-v first; the real
    vehicle capacity is compared afterwards and reported."""
    c = copy.deepcopy(cfg)
    if ideal:
        from .model import Engine
        c.vehicle.fuel_mass_kg = max(c.vehicle.fuel_mass_kg, 1.0e6)
        c.vehicle.engines = [Engine('ideal probe engine', 1.0e6, 450.0)]
    c.commands = commands
    c.mission.duration_s = duration
    c.options.stop_on_collision = False
    c.options.rtol, c.options.max_step_s, c.options.sample_dt_max_s = 1e-9, 1800.0, dt_max
    return c


def _closest_moon(sim: Simulation):
    a = sim.arrays()
    d = np.linalg.norm(a["r"] - sim.eph.moon_pos(a["t"]), axis=1)
    i = int(np.argmin(d))
    dmin = float(d[i])
    tmin = float(a["t"][i])
    if 0 < i < len(d) - 1:   # parabolic refinement
        y0, y1, y2 = d[i - 1], d[i], d[i + 1]
        den = y0 - 2 * y1 + y2
        if den > 0:
            off = 0.5 * (y0 - y2) / den
            h = 0.5 * (a["t"][i + 1] - a["t"][i - 1])
            tmin, dmin = tmin + off * h, y1 - 0.25 * (y0 - y2) * off
    return dmin, tmin, i


def _fine_closest(sim: Simulation, i: int):
    """Re-integrate around the coarse minimum with 4 s sampling; returns (d_min, t_min) accurate to metres."""
    t = sim.t
    ta, tb_ = t[max(i - 2, 0)], t[min(i + 2, len(t) - 1)]
    sim.truncate(ta)
    sim.cfg.options.sample_dt_s = 4.0
    sim.advance(tb_)
    a = sim.arrays()
    sel = a["t"] >= ta
    d = np.linalg.norm(a["r"][sel] - sim.eph.moon_pos(a["t"][sel]), axis=1)
    j = int(np.argmin(d))
    tt = a["t"][sel]
    if 0 < j < len(d) - 1:
        y0, y1, y2 = d[j - 1], d[j], d[j + 1]
        den = y0 - 2 * y1 + y2
        if den > 0:
            return float(y1 - 0.125 * (y0 - y2) ** 2 / den), float(tt[j] + 0.5 * (y0 - y2) / den * 4.0)
    return float(d[j]), float(tt[j])


def _impulse(t, dv_vec, label="TLI") -> Command:
    n = float(np.linalg.norm(dv_vec))
    return Command(t_start_s=float(t), delta_v_mps=n, direction="inertial", vector=(np.asarray(dv_vec) / n).tolist(),
                   source="planner", label=label)


def rocket_dv(vehicle, fuel_kg=None) -> float:
    f = vehicle.fuel_mass_kg if fuel_kg is None else fuel_kg
    isp = vehicle.isp_eff()
    return isp * G0 * math.log((vehicle.dry_mass_kg + f) / vehicle.dry_mass_kg) if isp > 0 else 0.0


# --------------------------------------------------------------------------------------------------- planning
def plan(cfg: SimConfig, *, max_seconds: float = 90.0) -> dict:
    """Return {feasible, commands, summary, limitations, ...}. ``cfg.mission.kind`` selects the goal."""
    t_wall = time.time()
    m = cfg.mission
    lim = ["Impulsive delta-v approximation (no finite-burn losses).",
           "Local numerical solution; optimality is not proven.",
           "Low-precision analytical Moon ephemeris (~0.3 deg): realistic accuracy of a few hundred km at the Moon.",
           "Point-mass Moon (no mascons); Earth J2 and Sun included as in the simulation options."]
    if m.kind == "free_flight":
        return {"feasible": True, "commands": [], "summary": "Free flight: no planning performed.", "limitations": lim}
    if cfg.initial.kind not in ("earth_orbit", "cartesian") and m.kind in ("to_moon", "lunar_flyby", "lunar_orbit"):
        return _infeasible(f"Transfer planning needs an Earth-orbit start (got '{cfg.initial.kind}')", lim)
    if m.kind == "landing" and cfg.initial.kind == "earth_orbit":
        return _plan_full_landing(cfg, lim, t_wall)
    if m.kind in ("descent", "landing", "approach"):
        return _plan_descent(cfg, lim, t_wall)

    cap = rocket_dv(cfg.vehicle)
    target_alt = m.target_altitude_m if m.kind != "to_moon" else 100_000.0
    rp_t = R_MOON + target_alt
    # 1. coast reference
    coast = Simulation(_coarse_cfg(cfg, [], 2.5 * 86400, 300.0)); coast.advance(2.2 * 3600 * 1.3 + 7200)
    ca = coast.arrays()
    period = 2 * math.pi * math.sqrt(np.linalg.norm(ca["r"][0]) ** 3 / MU_EARTH)
    # 2. grid search with Lambert
    best = None
    n_candidates = 0
    for tb in np.arange(60.0, 1.3 * period, period / 48):
        i = int(np.searchsorted(ca["t"], tb)); tb = float(ca["t"][min(i, len(ca["t"]) - 1)])
        r1, v1c = ca["r"][min(i, len(ca["t"]) - 1)], ca["v"][min(i, len(ca["t"]) - 1)]
        for tof in np.arange(2.5, 6.0, 0.25) * 86400:
            t_arr = tb + tof
            rm, vm = coast.eph.moon_pos(t_arr), coast.eph.moon_vel(t_arr)
            # aim at a point displaced from the Moon centre (leading side) so the pass is near the target radius
            ahead = vm / np.linalg.norm(vm)
            aim = rm - ahead * rp_t * 2.0 if m.kind != "lunar_orbit" else rm - ahead * rp_t * 2.0
            for pro in (True,):
                try:
                    v1, _ = lambert(r1, aim, tof, MU_EARTH, pro)
                except ValueError:
                    continue
                dv = v1 - v1c
                n_candidates += 1
                if best is None or np.linalg.norm(dv) < best[0]:
                    best = (float(np.linalg.norm(dv)), tb, tof, dv, r1, v1c)
    if best is None:
        return _infeasible("Lambert search found no candidate transfer.", lim)
    dv0, tb, tof0, dvv, r1, v1c = best
    horizon = tb + tof0 + 1.0 * 86400

    def run(x, with_loi=False):
        cmds = [_impulse(tb, x)]
        c = _coarse_cfg(cfg, cmds, horizon)
        c.options.include_earth_j2 = cfg.options.include_earth_j2
        s = Simulation(c)
        s.advance(horizon)
        return s

    # 3. shooting on periselene radius (3 unknowns), with Tikhonov regularisation towards the Lambert guess
    evals = {"n": 0}

    def resid(x):
        evals["n"] += 1
        s = run(x)
        _, _, ii = _closest_moon(s)
        dmin, _ = _fine_closest(s, ii)
        return np.concatenate([[(dmin - rp_t) / 10e3], 0.002 * (x - dvv) / 100.0])
    x0 = dvv.copy()
    sol = least_squares(resid, x0, diff_step=1e-4, xtol=1e-9, ftol=1e-9, max_nfev=25)
    x = sol.x
    s = run(x)
    _, _, idx = _closest_moon(s)
    dmin, tmin = _fine_closest(s, idx)
    err_km = (dmin - rp_t) / 1e3
    tca = tmin
    cmds = [_impulse(tb, x, "TLI (impulsive)")]
    notes = []
    dv_tli = float(np.linalg.norm(x))
    feasible_peri = abs(err_km) < max(50.0, 0.05 * rp_t / 1e3)
    if not feasible_peri:
        notes.append(f"Periselene radius error {err_km:+.1f} km after {evals['n']} propagations (target {rp_t/1e3:.0f} km).")
    # flyby near the Moon only counts if we actually enter the Moon's sphere of influence
    if dmin > MOON_SOI_M:
        return _infeasible("Optimised trajectory does not reach the Moon's sphere of influence.", lim,
                           extra={"closest_approach_km": dmin / 1e3, "propagations": evals["n"]})
    total_dv = dv_tli
    summary = {"tli_dv_mps": dv_tli, "burn_time_s": tb, "closest_approach_s": tca, "closest_approach_alt_km": (dmin - R_MOON) / 1e3,
               "periselene_error_km": err_km, "transfer_time_days": (tca - tb) / 86400, "candidates_evaluated": n_candidates,
               "propagations": evals["n"]}
    if m.kind == "lunar_orbit":
        # circularise at periselene: retrograde burn of (v_peri - v_circ), applied at closest approach
        k = idx
        a = s.arrays()
        # use the state at refined tca by integrating to tca
        s2 = Simulation(_coarse_cfg(cfg, [_impulse(tb, x)], horizon)); s2.advance(tca)
        yv = s2.y[-1]
        rel = yv[:3] - s2.eph.moon_pos(s2.t_now); vrel = yv[3:6] - s2.eph.moon_vel(s2.t_now)
        rn = np.linalg.norm(rel); vp = float(np.linalg.norm(vrel))
        vc = math.sqrt(MU_MOON / rn)
        dv_loi = vp - vc
        loi = Command(t_start_s=float(s2.t_now), delta_v_mps=dv_loi, direction="retrograde", reference="moon",
                      source="planner", label="LOI (impulsive, circularise at periselene)")
        cmds.append(loi)
        total_dv += dv_loi
        summary.update({"loi_dv_mps": dv_loi, "loi_time_s": float(s2.t_now), "target_orbit_alt_km": (rn - R_MOON) / 1e3})
        # verify the circularised orbit with the full model
        vc_cfg = _coarse_cfg(cfg, [copy.deepcopy(c) for c in cmds], horizon + 3 * 86400)
        vs = Simulation(vc_cfg); vs.advance(tca + 6 * 3600)
        yf = vs.y[-1]
        from .dynamics import state_to_elements
        el = state_to_elements(MU_MOON, yf[:3] - vs.eph.moon_pos(vs.t_now), yf[3:6] - vs.eph.moon_vel(vs.t_now))
        summary["achieved_orbit"] = {"periapsis_alt_km": (el["periapsis_radius_m"] - R_MOON) / 1e3,
                                     "apoapsis_alt_km": (el["apoapsis_radius_m"] - R_MOON) / 1e3, "e": el["e"]}
        if vs.status in ("impact", "landed"):
            notes.append("Verification run hit the surface after capture; raise target altitude.")
    fuel_ok = total_dv <= cap
    if not fuel_ok:
        notes.append(f"Required delta-v {total_dv:.0f} m/s exceeds vehicle capacity {cap:.0f} m/s (rocket equation).")
    summary.update({"total_dv_mps": total_dv, "vehicle_dv_capacity_mps": cap, "wall_seconds": time.time() - t_wall})
    return {"feasible": bool(feasible_peri and fuel_ok), "commands": [asdict_cmd(c) for c in cmds], "summary": summary,
            "notes": notes, "limitations": lim,
            "suggested_duration_s": float(tca + (8 * 3600 if m.kind == "lunar_orbit" else 2 * 86400))}


def asdict_cmd(c: Command) -> dict:
    from dataclasses import asdict
    return asdict(c)


def _infeasible(msg, lim, extra=None):
    return {"feasible": False, "commands": [], "summary": {"reason": msg, **(extra or {})}, "notes": [msg], "limitations": lim}


def _plan_descent(cfg: SimConfig, lim, t_wall) -> dict:
    """Deorbit + automatic braking from a circular lunar orbit (best effort, verified by simulation)."""
    m = cfg.mission
    lim = lim + ["Descent uses an automatic retrograde braking controller (no terrain-relative guidance, no attitude dynamics).",
                 "Landing-site selection and hazard assessment belong to the Landing Simulation module."]
    if cfg.initial.kind not in ("moon_orbit", "cartesian"):
        return _infeasible("Descent planning needs a Moon-orbit start (initial.kind = moon_orbit or a Cartesian state near the Moon).", lim)
    if cfg.vehicle.thrust_max() <= 0:
        return _infeasible("The vehicle has no engine thrust.", lim)
    if cfg.initial.kind == "moon_orbit":
        r0 = R_MOON + cfg.initial.periapsis_alt_m
    else:   # assume a near-circular orbit: use the current distance to the Moon centre
        from .ephemeris import Ephemeris
        e0 = Ephemeris(cfg.options.epoch_iso)
        r0 = float(np.linalg.norm(np.asarray(cfg.initial.r_m) - e0.moon_pos(0.0)))
    r_peri = R_MOON + 15_000.0
    a_t = 0.5 * (r0 + r_peri)
    v_c = math.sqrt(MU_MOON / r0)
    v_t = math.sqrt(MU_MOON * (2 / r0 - 1 / a_t))
    dv_deorbit = v_c - v_t
    cap = rocket_dv(cfg.vehicle)
    period = 2 * math.pi * math.sqrt(r0**3 / MU_MOON)
    a_max = cfg.vehicle.thrust_max() / (cfg.vehicle.dry_mass_kg + cfg.vehicle.fuel_mass_kg)
    t_half = math.pi * math.sqrt(a_t**3 / MU_MOON)
    t_brake_len = v_c / max(a_max, 1e-6)       # time to remove orbital speed at constant acceleration

    def trial(t_burn, lead):
        cmds = [Command(t_start_s=t_burn, delta_v_mps=dv_deorbit, direction="retrograde", reference="moon", source="planner",
                        label="De-orbit burn (impulsive)"),
                Command(t_start_s=max(t_burn + 1.0, t_burn + t_half - lead), duration_s=None, throttle=1.0, direction="surface_retro",
                        reference="moon", auto_throttle=True, source="planner", label="Automatic braking")]
        c = _coarse_cfg(cfg, cmds, t_burn + t_half + 2500, 60.0, ideal=False)
        c.options.stop_on_collision = True
        c.options.rtol = 1e-7
        c.options.sample_dt_s = 10.0
        sim = Simulation(c); sim.advance(t_burn + t_half + 2500)
        ev = [e for e in sim.events if e["type"] == "moon_contact"]
        return cmds, (ev[0]["details"] if ev else None), sim

    best = None
    nb = 12 if m.target_lat_deg is not None else 1
    for k in range(nb):
        t_burn = k * period / nb
        cmds, d, sim = trial(t_burn, 0.6 * t_brake_len)
        if d is None:
            continue
        if m.target_lat_deg is None:
            best = (0.0, cmds, d, sim, t_burn); break
        dlat = math.radians(d["lat_deg"] - m.target_lat_deg)
        dlon = math.radians(((d["lon_deg"] - (m.target_lon_deg or 0)) + 180) % 360 - 180)
        dist = R_MOON * math.hypot(dlat, dlon * math.cos(math.radians(m.target_lat_deg)))
        if best is None or dist < best[0]:
            best = (dist, cmds, d, sim, t_burn)
    if best is None:
        return _infeasible("No descent trajectory reached the surface within one orbit.", lim)
    # refine the braking lead time for the lowest contact speed
    t_burn = best[4]
    cand = [(best[2]["speed_mps"], best[1], best[2], best[3])]
    for f in (0.4, 0.8, 1.0, 1.3):
        cmds, d, sim = trial(t_burn, f * t_brake_len)
        if d:
            cand.append((d["speed_mps"], cmds, d, sim))
    cand.sort(key=lambda z: z[0])
    _, cmds, d, s = cand[0]
    dlat = math.radians(d["lat_deg"] - (m.target_lat_deg or d["lat_deg"]))
    dlon = math.radians(((d["lon_deg"] - (m.target_lon_deg or d["lon_deg"])) + 180) % 360 - 180)
    dist = R_MOON * math.hypot(dlat, dlon * math.cos(math.radians(d["lat_deg"])))
    best = (dist, cmds, d, s)
    dist, cmds, d, s = best
    notes = []
    if m.target_lat_deg is not None:
        notes.append(f"Closest candidate lands {dist/1e3:.1f} km from the requested point (deorbit timing grid {period/12:.0f} s; "
                     "ground track of an inclined orbit may not cross the target within one revolution).")
    if d["classification"] != "contact_speed_below_threshold":
        notes.append(f"Contact speed {d['speed_mps']:.1f} m/s exceeds {d['threshold_mps']} m/s: braking controller/thrust insufficient.")
    total = dv_deorbit + 1700.0
    summary = {"deorbit_dv_mps": dv_deorbit, "contact_lat_deg": d["lat_deg"], "contact_lon_deg": d["lon_deg"],
               "contact_speed_mps": d["speed_mps"], "miss_distance_km": dist / 1e3, "vehicle_dv_capacity_mps": cap,
               "deorbit_time_s": cmds[0].t_start_s, "wall_seconds": time.time() - t_wall}
    if cap < total * 0.9:
        notes.append(f"Vehicle delta-v capacity {cap:.0f} m/s is lower than a typical deorbit+landing budget (~{total:.0f} m/s).")
    return {"feasible": bool(d["classification"] == "contact_speed_below_threshold"), "commands": [asdict_cmd(c) for c in cmds],
            "summary": summary, "notes": notes, "limitations": lim, "suggested_duration_s": float(s.t_now + 600)}


def _plan_full_landing(cfg: SimConfig, lim, t_wall) -> dict:
    """Earth orbit -> TLI -> LOI (circular lunar orbit) -> de-orbit + guided descent. Three chained plans, each verified by simulation."""
    from datetime import datetime, timedelta, timezone
    m = cfg.mission
    stage1 = copy.deepcopy(cfg)
    stage1.mission.kind = "lunar_orbit"
    stage1.mission.target_altitude_m = m.target_altitude_m if m.target_altitude_m >= 20_000 else 100_000.0
    p1 = plan(stage1)
    if not p1["commands"]:
        return {**p1, "notes": ["Stage 1 (transfer to lunar orbit) failed: " + "; ".join(p1.get("notes", []))], "limitations": lim + p1.get("limitations", [])}
    cmds1 = [_build_cmd(c) for c in p1["commands"]]
    c1 = copy.deepcopy(cfg)
    c1.commands = copy.deepcopy(cmds1)
    c1.mission.duration_s = p1["suggested_duration_s"] + 3600
    c1.options.rtol = 1e-9
    c1.options.sample_dt_max_s = 300.0
    s1 = Simulation(c1)
    t_cap = float(p1["summary"].get("loi_time_s", p1["suggested_duration_s"]))
    t1 = t_cap + 1800.0                                  # half an hour after capture: settled in lunar orbit
    s1.advance(t1)
    y = s1.y[-1]
    t_actual = s1.t_now
    if s1.status not in ("ready", "completed"):
        return _infeasible(f"Stage 1 verification ended with status '{s1.status}'", lim)
    # stage 2: descent from the verified state; epoch shifted so that simulation time restarts at 0
    epoch = datetime.fromisoformat(cfg.options.epoch_iso.replace("Z", "+00:00"))
    if epoch.tzinfo is None:
        epoch = epoch.replace(tzinfo=timezone.utc)
    c2 = copy.deepcopy(cfg)
    c2.options.epoch_iso = (epoch + timedelta(seconds=t_actual)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    c2.initial.kind, c2.initial.r_m, c2.initial.v_mps = "cartesian", y[:3].tolist(), y[3:6].tolist()
    c2.vehicle.fuel_mass_kg = float(y[6])
    c2.commands = []
    p2 = _plan_descent(c2, lim, t_wall)
    cmds2 = []
    for c in p2.get("commands", []):
        c = dict(c); c["t_start_s"] = c["t_start_s"] + t_actual; c["id"] = ""
        cmds2.append(c)
    summary = {**{f"transfer_{k}": v for k, v in p1["summary"].items() if isinstance(v, (int, float))},
               **{f"descent_{k}": v for k, v in p2.get("summary", {}).items() if isinstance(v, (int, float))},
               "descent_start_s": t_actual, "fuel_at_descent_start_kg": float(y[6])}
    notes = list(p1.get("notes", [])) + list(p2.get("notes", []))
    if y[6] <= 0:
        notes.append("Propellant is exhausted after the transfer: a landing is impossible with this vehicle.")
    return {"feasible": bool(p1["feasible"] and p2.get("feasible")), "commands": p1["commands"] + cmds2, "summary": summary, "notes": notes,
            "limitations": lim + ["Full landing = three chained plans (TLI, LOI, de-orbit+descent), each impulsive/guided as described above."],
            "suggested_duration_s": float(t_actual + p2.get("suggested_duration_s", 3600) + 600)}


def _build_cmd(d: dict) -> Command:
    from .model import _build
    return _build(Command, d)

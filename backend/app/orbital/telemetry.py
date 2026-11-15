"""Derived telemetry (vectorised) and event extraction from the sample arrays of a Simulation."""
from __future__ import annotations

import math

import numpy as np

from .constants import G0, MOON_SOI_M, MU_EARTH, MU_MOON, OMEGA_EARTH, R_EARTH, R_MOON
from .ephemeris import Ephemeris


def _norm(a):
    return np.linalg.norm(a, axis=-1)


def compute(sim) -> dict[str, np.ndarray]:
    """Return named series (SI units unless the name says otherwise)."""
    a = sim.arrays()
    t, r, v = a["t"], a["r"], a["v"]
    eph: Ephemeris = sim.eph
    rm, vm = eph.moon_pos(t), eph.moon_vel(t)
    rel_m, vel_m = r - rm, v - vm
    d_e, d_m = _norm(r), _norm(rel_m)
    m = sim.cfg.vehicle.dry_mass_kg + a["fuel"]
    dominant_moon = d_m < MOON_SOI_M
    mu = np.where(dominant_moon, MU_MOON, MU_EARTH)
    rr = np.where(dominant_moon[:, None], rel_m, r)
    vv = np.where(dominant_moon[:, None], vel_m, v)
    rn, vn = _norm(rr), _norm(vv)
    h = np.cross(rr, vv)
    hn = _norm(h)
    energy = vn**2 / 2 - mu / rn
    evec = np.cross(vv, h) / mu[:, None] - rr / rn[:, None]
    ecc = _norm(evec)
    with np.errstate(divide="ignore", invalid="ignore"):
        sma = np.where(energy < 0, -mu / (2 * energy), np.inf)
    rp = hn**2 / mu / (1 + ecc)
    ra = np.where(energy < 0, sma * (1 + ecc), np.nan)
    inc = np.degrees(np.arccos(np.clip(h[:, 2] / np.maximum(hn, 1e-9), -1, 1)))
    # velocities relative to rotating surfaces
    v_e_rel = v - np.cross([0, 0, OMEGA_EARTH], r)
    w_m = np.cross(rm, vm) / np.sum(rm * rm, axis=1)[:, None]
    v_m_surf = vel_m - np.cross(w_m, rel_m)
    # gravity pieces (Earth + Moon point masses) and thrust acceleration
    g_e = MU_EARTH / d_e**2
    g_m = MU_MOON / d_m**2
    thrust_acc = a["thrust"] / m
    vr_m = np.sum(rel_m * v_m_surf, axis=1) / d_m
    vr_e = np.sum(r * v_e_rel, axis=1) / d_e
    dv_cap = sim.isp * G0 * np.log(m / sim.cfg.vehicle.dry_mass_kg) if sim.isp > 0 else np.zeros_like(m)
    out = {
        "t_s": t, "mass_kg": m, "fuel_kg": a["fuel"], "thrust_n": a["thrust"], "throttle": a["throttle"],
        "dist_earth_m": d_e, "alt_earth_m": d_e - R_EARTH, "dist_moon_m": d_m, "alt_moon_m": d_m - R_MOON,
        "dist_earth_moon_m": _norm(rm),
        "speed_inertial_mps": _norm(v), "speed_moon_rel_mps": _norm(vel_m),
        "speed_earth_surface_mps": _norm(v_e_rel), "speed_moon_surface_mps": _norm(v_m_surf),
        "vertical_speed_earth_mps": vr_e, "vertical_speed_moon_mps": vr_m,
        "dominant_body_is_moon": dominant_moon.astype(float),
        "energy_j_per_kg": energy, "sma_m": sma, "ecc": ecc, "periapsis_radius_m": rp, "apoapsis_radius_m": ra,
        "periapsis_alt_m": rp - np.where(dominant_moon, R_MOON, R_EARTH),
        "apoapsis_alt_m": ra - np.where(dominant_moon, R_MOON, R_EARTH), "inclination_deg": inc,
        "angular_momentum_m2ps": hn, "grav_accel_earth_mps2": g_e, "grav_accel_moon_mps2": g_m,
        "thrust_accel_mps2": thrust_acc, "g_load": thrust_acc / G0,
        "delta_v_remaining_mps": dv_cap,
    }
    return out


GRAPHS = {   # graph id -> (title, series names)
    "altitude": ("Altitude over Earth / Moon", ["alt_earth_m", "alt_moon_m"]),
    "speed": ("Speed", ["speed_inertial_mps", "speed_moon_rel_mps"]),
    "mass_fuel": ("Mass and fuel", ["mass_kg", "fuel_kg"]),
    "thrust": ("Thrust and throttle", ["thrust_n", "throttle"]),
    "energy": ("Specific orbital energy", ["energy_j_per_kg"]),
    "gravity": ("Gravitational acceleration", ["grav_accel_earth_mps2", "grav_accel_moon_mps2"]),
    "apsides": ("Periapsis / apoapsis altitude", ["periapsis_alt_m", "apoapsis_alt_m"]),
    "moon_dist": ("Distance to Moon", ["dist_moon_m"]),
    "dv": ("Remaining delta-v", ["delta_v_remaining_mps"]),
}


def derived_events(sim, max_events: int = 200) -> list[dict]:
    """Closest approach / periselene / perigee-apogee detected from sign changes of radial speed."""
    tel = compute(sim)
    t = tel["t_s"]
    if len(t) < 3:
        return []
    out: list[dict] = []
    a = sim.arrays()
    rm = sim.eph.moon_pos(t)
    for body, d, thr in (("moon", tel["dist_moon_m"], MOON_SOI_M), ("earth", tel["dist_earth_m"], np.inf)):
        dd = np.diff(d)
        for i in range(1, len(dd)):
            if dd[i - 1] < 0 <= dd[i] and d[i] < thr and (body == "moon" or tel["dominant_body_is_moon"][i] == 0):
                out.append({"t_s": float(t[i]), "type": "periselene" if body == "moon" else "perigee",
                            "details": {"distance_m": float(d[i]), "altitude_m": float(d[i] - (R_MOON if body == "moon" else R_EARTH)),
                                        "speed_mps": float(tel["speed_moon_rel_mps"][i] if body == "moon" else tel["speed_inertial_mps"][i])}})
            elif dd[i - 1] > 0 >= dd[i] and d[i] < thr and (body == "earth" or True) and (body == "moon" or tel["dominant_body_is_moon"][i] == 0):
                out.append({"t_s": float(t[i]), "type": "aposelene" if body == "moon" else "apogee",
                            "details": {"distance_m": float(d[i]), "altitude_m": float(d[i] - (R_MOON if body == "moon" else R_EARTH))}})
    out.sort(key=lambda e: e["t_s"])
    return out[:max_events]

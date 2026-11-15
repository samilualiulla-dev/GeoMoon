"""Equations of motion in the Earth-centred inertial (ECI, J2000 equatorial) frame.

State y = [x, y, z, vx, vy, vz, fuel_kg].
    dr/dt = v
    dv/dt = a_earth + a_moon(direct+indirect) + a_sun(direct+indirect) [+ J2] [+ drag] + a_thrust
    a_body(r) = -mu r_rel/|r_rel|^3   (point mass),   third-body: mu_b [ (rb - r)/|rb - r|^3 - rb/|rb|^3 ]
The indirect term accounts for the Earth-centred frame being non-inertial (Earth is accelerated by the Moon/Sun).
"""
from __future__ import annotations

import math

import numpy as np

from .constants import J2_EARTH, MU_EARTH, MU_MOON, MU_SUN, OMEGA_EARTH, R_EARTH
from .ephemeris import Ephemeris


def point_gravity(r, mu):
    d = float(np.linalg.norm(r))
    return -mu * r / d**3


def third_body(r, rb, mu_b):
    d = rb - r
    return mu_b * (d / float(np.linalg.norm(d)) ** 3 - rb / float(np.linalg.norm(rb)) ** 3)


def j2_accel(r):
    x, y, z = r
    rn = float(np.linalg.norm(r))
    k = 1.5 * J2_EARTH * MU_EARTH * R_EARTH**2 / rn**5
    f = 5 * z * z / rn**2
    return k * np.array([x * (f - 1), y * (f - 1), z * (f - 3)])


def atm_density(alt_m):
    """Very rough exponential atmosphere (piecewise scale heights), kg/m^3. Educational approximation only."""
    alt_m = max(alt_m, 0.0)
    if alt_m > 1_000_000: return 0.0
    table = [(0, 1.225, 8500.0), (25_000, 0.0395, 6490.0), (50_000, 1.03e-3, 7700.0),
             (100_000, 5.6e-7, 6000.0), (200_000, 2.5e-10, 45000.0), (500_000, 6.2e-13, 70000.0)]
    for h0, rho0, H in reversed(table):
        if alt_m >= h0:
            return rho0 * math.exp(-(alt_m - h0) / H)
    return 1.225


class Dynamics:
    def __init__(self, eph: Ephemeris, *, include_moon=True, include_sun=True, include_j2=True, include_drag=False, cd=2.2, area=10.0):
        self.moon = include_moon
        self.eph, self.sun, self.j2, self.drag, self.cd, self.area = eph, include_sun, include_j2, include_drag, cd, area

    def gravity(self, t, r):
        rm = self.eph.moon_pos(t)
        a = point_gravity(r, MU_EARTH)
        if self.moon:
            a = a + third_body(r, rm, MU_MOON)
        if self.j2:
            a = a + j2_accel(r)
        if self.sun:
            a = a + third_body(r, self.eph.sun_pos(t), MU_SUN)
        return a

    def accel(self, t, r, v, thrust_vec_n=None, mass=1.0):
        a = self.gravity(t, r)
        if self.drag:
            alt = float(np.linalg.norm(r)) - R_EARTH
            if alt < 1_000_000:
                vrel = v - np.cross([0, 0, OMEGA_EARTH], r)
                a = a - 0.5 * atm_density(alt) * self.cd * self.area / mass * float(np.linalg.norm(vrel)) * vrel
        if thrust_vec_n is not None:
            a = a + thrust_vec_n / mass
        return a


def thrust_direction(direction: str, reference: str, vector, t, r, v, eph: Ephemeris):
    """Unit thrust direction (inertial). Reference 'auto' = Moon inside its sphere of influence, else Earth."""
    rm = eph.moon_pos(t)
    ref = reference
    if ref == "auto":
        ref = "moon" if np.linalg.norm(r - rm) < 66.1e6 else "earth"
    if direction == "inertial":
        u = np.asarray(vector, float)
        return u / np.linalg.norm(u)
    if direction == "surface_retro":  # against velocity relative to the nearest rotating body surface
        if np.linalg.norm(r - rm) < 66.1e6:
            from .ephemeris import Ephemeris as _E  # noqa
            w = np.cross(rm, eph.moon_vel(t)) / float(np.dot(rm, rm))
            vrel = v - eph.moon_vel(t) - np.cross(w, r - rm)
        else:
            vrel = v - np.cross([0, 0, 7.2921150e-5], r)
        n = np.linalg.norm(vrel)
        return -vrel / n if n > 1e-9 else -(r - rm) / np.linalg.norm(r - rm)
    if direction == "to_moon":
        u = rm - r
        return u / np.linalg.norm(u)
    if direction == "to_earth":
        return -r / np.linalg.norm(r)
    rr, vv = (r - rm, v - eph.moon_vel(t)) if ref == "moon" else (r, v)
    rn, vn = np.linalg.norm(rr), np.linalg.norm(vv)
    rhat = rr / rn
    vhat = vv / vn if vn > 1e-9 else rhat
    h = np.cross(rr, vv)
    nhat = h / np.linalg.norm(h) if np.linalg.norm(h) > 1e-9 else np.array([0, 0, 1.0])
    return {"prograde": vhat, "retrograde": -vhat, "radial_out": rhat, "radial_in": -rhat, "normal": nhat,
            "antinormal": -nhat}[direction]


def elements_to_state(mu, rp, ra, inc_deg, raan_deg, argp_deg, nu_deg):
    """Keplerian elements -> (r, v) in the parent inertial frame. ra None -> circular."""
    ra = rp if ra is None else ra
    a = 0.5 * (rp + ra)
    e = (ra - rp) / (ra + rp)
    p = a * (1 - e * e)
    nu, inc, om, w = (math.radians(x) for x in (nu_deg, inc_deg, raan_deg, argp_deg))
    r = p / (1 + e * math.cos(nu))
    rp_pf = np.array([r * math.cos(nu), r * math.sin(nu), 0.0])
    vp_pf = math.sqrt(mu / p) * np.array([-math.sin(nu), e + math.cos(nu), 0.0])
    co, so, cw, sw, ci, si = math.cos(om), math.sin(om), math.cos(w), math.sin(w), math.cos(inc), math.sin(inc)
    Rm = np.array([[co * cw - so * sw * ci, -co * sw - so * cw * ci, so * si],
                   [so * cw + co * sw * ci, -so * sw + co * cw * ci, -co * si],
                   [sw * si, cw * si, ci]])
    return Rm @ rp_pf, Rm @ vp_pf


def state_to_elements(mu, r, v):
    """(r, v) -> osculating elements (SI, degrees)."""
    r, v = np.asarray(r, float), np.asarray(v, float)
    rn, vn = np.linalg.norm(r), np.linalg.norm(v)
    h = np.cross(r, v)
    hn = np.linalg.norm(h)
    evec = np.cross(v, h) / mu - r / rn
    e = float(np.linalg.norm(evec))
    energy = vn**2 / 2 - mu / rn
    a = -mu / (2 * energy) if abs(energy) > 1e-12 else math.inf
    inc = math.degrees(math.acos(max(-1, min(1, h[2] / hn)))) if hn > 0 else 0.0
    return {"a_m": a, "e": e, "inc_deg": inc, "periapsis_radius_m": (hn**2 / mu) / (1 + e),
            "apoapsis_radius_m": a * (1 + e) if energy < 0 else math.inf,
            "energy_j_per_kg": energy, "h_m2ps": hn,
            "period_s": 2 * math.pi * math.sqrt(a**3 / mu) if energy < 0 else None}

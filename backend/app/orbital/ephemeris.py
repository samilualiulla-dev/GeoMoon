"""Analytical, time-dependent ephemeris of the Moon and Sun (geocentric, J2000 mean equator/equinox).

MODEL (documented limitation): low-precision series from the Astronomical Almanac ("Low-precision formulae for the
Moon", ~0.3 deg in longitude, ~0.3 deg latitude, ~0.5 % distance; Sun ~0.01 deg).  Longitudes are referred to the mean
equinox of date, so general precession (1.3969713 deg/century) is removed to express them in the J2000 frame.
NOT a JPL DE ephemeris (no astropy/jplephem available offline).  Adequate for educational trajectory design and
visualisation; NOT for mission operations.  Time argument ``t`` is seconds since the simulation epoch (UTC ~ TT here).
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from .constants import AU, JD_J2000, OBLIQUITY_J2000, OMEGA_EARTH, R_EARTH

DEFAULT_EPOCH_ISO = "2026-01-01T00:00:00Z"
_D2R = math.pi / 180.0
_PREC = 1.3969713  # deg / Julian century


def iso_to_jd(iso: str) -> float:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    y, m = dt.year, dt.month
    d = dt.day + (dt.hour + (dt.minute + (dt.second + dt.microsecond / 1e6) / 60.0) / 60.0) / 24.0
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + b - 1524.5


def _ecl_to_eq(lam_deg, bet_deg, dist):
    lam, bet = np.asarray(lam_deg) * _D2R, np.asarray(bet_deg) * _D2R
    xe, ye, ze = dist * np.cos(bet) * np.cos(lam), dist * np.cos(bet) * np.sin(lam), dist * np.sin(bet)
    ce, se = math.cos(OBLIQUITY_J2000), math.sin(OBLIQUITY_J2000)
    return np.stack([xe, ye * ce - ze * se, ye * se + ze * ce], axis=-1)


def moon_position_jd(jd):
    """Geocentric Moon position, metres, J2000 equatorial frame. ``jd`` scalar or array."""
    T = (np.asarray(jd, dtype=float) - JD_J2000) / 36525.0
    s = lambda a, b: np.sin((a + b * T) * _D2R)
    lam = (218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36)
           + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05)
           - 0.11 * s(186.5, 966404.03))
    bet = (5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15)
           - 0.17 * s(217.6, -407332.21))
    c = lambda a, b: np.cos((a + b * T) * _D2R)
    par = (0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22)
           + 0.0028 * c(269.9, 954397.74))
    dist = R_EARTH / np.sin(par * _D2R)  # Almanac uses equatorial radius 6378.14 km
    return _ecl_to_eq(lam - _PREC * T, bet, dist)


def sun_position_jd(jd):
    """Geocentric Sun position, metres, J2000 equatorial frame."""
    n = np.asarray(jd, dtype=float) - JD_J2000
    T = n / 36525.0
    L = 280.460 + 0.9856474 * n
    g = (357.528 + 0.9856003 * n) * _D2R
    lam = L + 1.915 * np.sin(g) + 0.020 * np.sin(2 * g)
    R = (1.00014 - 0.01671 * np.cos(g) - 0.00014 * np.cos(2 * g)) * AU
    return _ecl_to_eq(lam - _PREC * T, 0.0 * lam, R)


class Ephemeris:
    """Epoch-anchored accessor: positions/velocities as functions of seconds since epoch."""

    def __init__(self, epoch_iso: str = DEFAULT_EPOCH_ISO):
        self.epoch_iso = epoch_iso
        self.jd0 = iso_to_jd(epoch_iso)

    def jd(self, t):
        return self.jd0 + np.asarray(t, dtype=float) / 86400.0

    def moon_pos(self, t):
        return moon_position_jd(self.jd(t))

    def moon_vel(self, t, h=30.0):
        t = np.asarray(t, dtype=float)
        return (self.moon_pos(t + h) - self.moon_pos(t - h)) / (2 * h)

    def sun_pos(self, t):
        return sun_position_jd(self.jd(t))

    def earth_rotation_angle(self, t):
        """IERS Earth Rotation Angle (UT1 ~ UTC), radians."""
        d = self.jd(t) - JD_J2000
        return 2 * math.pi * ((0.7790572732640 + 1.00273781191135448 * d) % 1.0)

    # --- frames -------------------------------------------------------------------------------------------------
    def moon_axes(self, t):
        """Rows of the rotation matrix inertial -> Moon-fixed (synchronous rotation, libration neglected):
        x toward the mean Earth (prime meridian), z ~ lunar spin axis (ecliptic pole orthogonalised), y = z x x."""
        rm = self.moon_pos(t)
        x = -rm / np.linalg.norm(rm)
        ce, se = math.cos(OBLIQUITY_J2000), math.sin(OBLIQUITY_J2000)
        npole = np.array([0.0, -se, ce])
        z = npole - np.dot(npole, x) * x
        z /= np.linalg.norm(z)
        y = np.cross(z, x)
        return np.stack([x, y, z])

    def eci_to_ecef(self, t):
        th = self.earth_rotation_angle(t)
        c, s = math.cos(th), math.sin(th)
        return np.array([[c, s, 0], [-s, c, 0], [0, 0, 1.0]])

    def body_state(self, t):
        return {"moon": {"r": self.moon_pos(t), "v": self.moon_vel(t)}, "sun": {"r": self.sun_pos(t)}}

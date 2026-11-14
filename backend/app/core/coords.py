"""Coordinate conventions and conversions.

Conventions (used everywhere in GeoMoon):
  * Selenographic coordinates are *planetocentric* on a spherical Moon of radius
    ``MOON_RADIUS_M``: latitude in [-90, 90] deg (north positive), longitude in
    [-180, 180) deg (east positive).  Angles are degrees at API boundaries and radians internally.
  * MCI ("Moon-centred, inertial-aligned") Cartesian frame: origin at the Moon's centre,
    +Z toward the north pole, +X toward (lat 0, lon 0), +Y toward (lat 0, lon +90 E).
    The frame is treated as NON-rotating in trajectory propagation (see docs).
  * Local ENU frame at a surface point: East, North, Up (Up = radial).
"""
from __future__ import annotations

import numpy as np

from .constants import MOON_RADIUS_M


def wrap_lon(lon_deg: float) -> float:
    """Wrap longitude to [-180, 180)."""
    return (float(lon_deg) + 180.0) % 360.0 - 180.0


def latlon_to_unit(lat_deg: float, lon_deg: float) -> np.ndarray:
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    return np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def geo_to_cartesian(lat_deg: float, lon_deg: float, radius_m: float) -> np.ndarray:
    """Selenographic (lat, lon, distance from Moon centre) -> MCI Cartesian [m]."""
    return radius_m * latlon_to_unit(lat_deg, lon_deg)


def cartesian_to_geo(xyz) -> tuple[float, float, float]:
    """MCI Cartesian [m] -> (lat_deg, lon_deg, radius_m)."""
    x, y, z = (float(v) for v in xyz)
    r = float(np.sqrt(x * x + y * y + z * z))
    if r == 0.0:
        raise ValueError("Position at Moon centre has no geographic coordinates")
    lat = float(np.degrees(np.arcsin(np.clip(z / r, -1.0, 1.0))))
    lon = float(np.degrees(np.arctan2(y, x)))
    return lat, lon, r


def enu_basis(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit vectors (east, north, up) expressed in the MCI frame at a surface point."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    return east, north, up


def great_circle_distance_m(lat1, lon1, lat2, lon2, radius_m: float = MOON_RADIUS_M) -> float:
    """Haversine distance on a sphere [m]."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi, dlam = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlam / 2) ** 2
    return float(2.0 * radius_m * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0))))


def offset_point(lat_deg: float, lon_deg: float, azimuth_deg: float, distance_m: float,
                 radius_m: float = MOON_RADIUS_M) -> tuple[float, float]:
    """Point reached by travelling ``distance_m`` along a great circle with the given azimuth
    (clockwise from north)."""
    e, n, u = enu_basis(lat_deg, lon_deg)
    az = np.radians(azimuth_deg)
    heading = np.cos(az) * n + np.sin(az) * e
    th = distance_m / radius_m
    p = np.cos(th) * u + np.sin(th) * heading
    lat, lon, _ = cartesian_to_geo(p)
    return lat, lon

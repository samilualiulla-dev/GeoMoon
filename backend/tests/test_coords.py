import numpy as np
import pytest

from app.core.constants import MOON_MU, MOON_RADIUS_M, MOON_SURFACE_GRAVITY
from app.core.coords import (cartesian_to_geo, enu_basis, geo_to_cartesian, great_circle_distance_m, offset_point, wrap_lon)


@pytest.mark.parametrize("lat,lon", [(0, 0), (45, 90), (-30, -120), (89.9, 10), (0, 179.5)])
def test_geo_cartesian_roundtrip(lat, lon):
    xyz = geo_to_cartesian(lat, lon, MOON_RADIUS_M)
    la, lo, r = cartesian_to_geo(xyz)
    assert la == pytest.approx(lat, abs=1e-9) and lo == pytest.approx(lon, abs=1e-9) and r == pytest.approx(MOON_RADIUS_M)


def test_axes_convention():
    assert np.allclose(geo_to_cartesian(0, 0, 1), [1, 0, 0])
    assert np.allclose(geo_to_cartesian(0, 90, 1), [0, 1, 0])
    assert np.allclose(geo_to_cartesian(90, 0, 1), [0, 0, 1])


def test_enu_orthonormal_and_oriented():
    e, n, u = enu_basis(30, 40)
    assert np.allclose([e @ n, e @ u, n @ u], 0, atol=1e-12)
    assert np.allclose(np.cross(e, n), u)
    assert n[2] > 0  # north has +z component


def test_great_circle_known_values():
    assert great_circle_distance_m(0, 0, 0, 90) == pytest.approx(np.pi / 2 * MOON_RADIUS_M)
    assert great_circle_distance_m(0, 0, 0, 1) == pytest.approx(np.radians(1) * MOON_RADIUS_M, rel=1e-9)


def test_offset_point_matches_distance():
    la, lo = offset_point(10, 20, 90, 5000)
    assert great_circle_distance_m(10, 20, la, lo) == pytest.approx(5000, rel=1e-9)
    assert la == pytest.approx(10, abs=1e-3) and lo > 20  # east


def test_wrap_lon():
    assert wrap_lon(190) == -170 and wrap_lon(-180) == -180 and wrap_lon(360) == 0


def test_surface_gravity_value():
    assert MOON_SURFACE_GRAVITY == pytest.approx(1.625, abs=0.005)
    assert MOON_MU == pytest.approx(4.9028e12, rel=1e-4)

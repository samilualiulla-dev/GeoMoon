"""Near-pole reads of geographic (lon/lat) rasters via the local azimuthal metric grid.
Fixtures are synthetic rasters whose value is an exact analytic function of position, so the mapping can be verified."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from app.core.errors import ValidationFailure
from app.lunar_data.engine import LunarDataEngine, azimuthal_forward, azimuthal_inverse
from app.lunar_data.registry import DatasetRegistry
from conftest import LUNAR_GEO, R, write_dem

D2R = np.pi / 180
A = np.array([300.0, -200.0, 500.0])


def f(lat, lon):
    """elevation = A . unit(lat, lon): smooth, so bilinear sampling is accurate to ~1e-2 m at 0.1 deg."""
    la, lo = np.asarray(lat) * D2R, np.asarray(lon) * D2R
    return A[0] * np.cos(la) * np.cos(lo) + A[1] * np.cos(la) * np.sin(lo) + A[2] * np.sin(la)


@pytest.fixture(scope="module")
def global_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("g")
    lat = 90 - (np.arange(1800) + 0.5) * 0.1
    lon = (np.arange(3600) + 0.5) * 0.1                          # 0..360 like LOLA products
    z = f(lat[:, None], lon[None, :]).astype("float32")
    write_dem(d / "glob.tif", z, lat0=90.0, lon0=0.0, res_m=R * 0.1 * D2R, extra_meta={"quantity": "elevation"})
    # fix transform: write_dem derives degrees from res_m, which equals 0.25 deg here
    return d


@pytest.fixture
def eng(global_dir):
    return LunarDataEngine(DatasetRegistry(global_dir))


@pytest.mark.parametrize("la0,lo0", [(0, 0), (45, 100), (-89.9, 30), (-90, 0), (-90, 45), (90, 0), (89.99, -170), (-60, 179.9)])
def test_azimuthal_roundtrip_everywhere(la0, lo0):
    e = np.array([0, 1000, -2500, 3000.0, 40000.0]); n = np.array([0, -700, 1500, -4000.0, -25000.0])
    la, lo = azimuthal_inverse(la0, lo0, e, n, R)
    e2, n2 = azimuthal_forward(la0, lo0, la, lo, R)
    assert np.allclose(e2, e, atol=1e-4) and np.allclose(n2, n, atol=1e-4)


def test_azimuthal_distances_are_metric():
    la, lo = azimuthal_inverse(10, 20, np.array([0.0]), np.array([5000.0]), R)           # 5 km due north
    assert la[0] == pytest.approx(10 + np.degrees(5000 / R), abs=1e-9) and lo[0] == pytest.approx(20, abs=1e-9)


@pytest.mark.parametrize("lat,lon", [(-89.95, 30.0), (-90.0, 0.0), (-89.9, 180.0), (-89.97, -179.99), (89.9, 10.0), (-85.0, 0.1)])
def test_polar_patch_matches_analytic_field(eng, lat, lon):
    p = eng.read_patch("glob", lat, lon, 30_000.0)
    assert p.projection == "azimuthal" and p.dx_m == p.dy_m and p.shape[0] == p.shape[1] >= 3
    assert p.valid_fraction == 1.0
    rr, cc = np.meshgrid(np.arange(p.shape[0]), np.arange(p.shape[1]), indexing="ij")
    la, lo = zip(*[p.rowcol_to_latlon(r, c) for r, c in zip(rr.ravel()[::37], cc.ravel()[::37])])
    expect = f(np.array(la), np.array(lo))
    got = p.elevation.ravel()[::37]
    assert np.abs(got - expect).max() < 0.1                                    # m, bilinear error of a smooth field
    assert p.sample_one(lat, lon) == pytest.approx(float(f(lat, lon)), abs=0.1)


def test_polar_patch_row_col_mapping_consistent(eng):
    p = eng.read_patch("glob", -89.95, 30.0, 30_000.0)
    for r, c in [(0, 0), (5, 7), (p.shape[0] - 1, p.shape[1] - 1)]:
        la, lo = p.rowcol_to_latlon(r, c)
        r2, c2 = p.latlon_to_rowcol(la, lo)
        assert (r2, c2) == pytest.approx((r, c), abs=1e-6)
    # north is up: row 0 is the northern edge (towards the equator when centred on the south pole)
    la_top, _ = p.rowcol_to_latlon(0, p.shape[1] // 2)
    la_bot, _ = p.rowcol_to_latlon(p.shape[0] - 1, p.shape[1] // 2)
    assert la_top != la_bot


def test_cell_size_never_finer_than_data(eng):
    p = eng.read_patch("glob", -89.9, 0.0, 200_000.0)                           # 0.1 deg data = 3.03 km cells
    assert p.dx_m >= 0.99 * R * 0.1 * D2R                       # ceil() rounding may make the step <0.1 % finer


def test_max_cells_respected_near_pole(eng):
    p = eng.read_patch("glob", -89.0, 0.0, 400_000.0, max_cells=2500)
    assert p.elevation.size <= 2600


def test_non_global_dataset_is_not_wrapped(tmp_path):
    """A raster covering only lon 0..90, lat -90..-80: cells beyond its edge must be NaN, never wrapped data."""
    d = tmp_path / "d"; d.mkdir()
    lat = -80 - (np.arange(40) + 0.5) * 0.25
    lon = (np.arange(360) + 0.5) * 0.25
    z = f(lat[:, None], lon[None, :]).astype("float32")
    deg = 0.25
    with rasterio.open(d / "part.tif", "w", driver="GTiff", height=40, width=360, count=1, dtype="float32", crs=LUNAR_GEO,
                       transform=from_origin(0.0, -80.0, deg, deg), nodata=-9999.0) as dst:
        dst.write(z, 1)
    import json
    (d / "part.meta.json").write_text(json.dumps({"name": "t", "provider": "p", "product": "q", "synthetic": True}))
    e = LunarDataEngine(DatasetRegistry(d))
    p = e.read_patch("part", -85.0, 88.0, 100_000.0)
    assert 0.2 < p.valid_fraction < 0.95
    rr, cc = np.meshgrid(np.arange(p.shape[0]), np.arange(p.shape[1]), indexing="ij")
    for r, c in zip(rr.ravel()[::53], cc.ravel()[::53]):
        la, lo = p.rowcol_to_latlon(r, c)
        v = p.elevation[r, c]
        if 0 <= (lo % 360) <= 90 and -90 <= la <= -80:
            assert np.isfinite(v)
        elif (lo % 360) > 90.5:
            assert np.isnan(v)


def test_tiny_polar_region_rejected(eng):
    with pytest.raises(ValidationFailure):
        eng.read_patch("glob", -89.9, 0.0, 10.0)


@pytest.mark.parametrize("lat,lon", [(-89.9, 10.0), (89.9, 359.99), (-45.0, 0.01), (30.0, 359.995), (-89.75, 180.0)])
def test_point_elevation_is_exact_bilinear_at_any_latitude(eng, lat, lon):
    assert eng.elevation_at("glob", lat, lon) == pytest.approx(float(f(lat, lon)), abs=0.05)       # includes the 0/360 seam


def test_point_elevation_within_half_a_pixel_of_the_pole_uses_the_edge_row(eng):
    # documented limitation: no row beyond the last pixel centre (|lat| = 89.95) -> nearest edge row, error << 1 m for this field
    assert eng.elevation_at("glob", -90.0, 0.0) == pytest.approx(float(f(-90.0, 0.0)), abs=1.0)
    assert eng.elevation_at("glob", -89.99, 10.0) == pytest.approx(float(f(-89.99, 10.0)), abs=1.0)


def test_point_elevation_at_missing_pixel_is_an_error_not_a_number(tmp_path):
    from app.core.errors import OutOfCoverageError
    d = tmp_path / "d"; d.mkdir()
    z = np.full((180, 360), 100.0, "float32"); z[40, 100] = -9999.0
    write_dem(d / "h.tif", z, lat0=90.0, lon0=0.0, res_m=R * 1.0 * D2R)
    e = LunarDataEngine(DatasetRegistry(d))
    with pytest.raises(OutOfCoverageError):
        e.elevation_at("h", 90 - 40.5, 100.5)                      # exactly on the hole centre
    assert e.elevation_at("h", 90 - 42.5, 100.5) == pytest.approx(100.0)

import json

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

from app.core.errors import DataUnavailableError, OutOfCoverageError, ValidationFailure
from app.lunar_data.engine import LunarDataEngine
from app.lunar_data.registry import DatasetRegistry
from conftest import R, plane, write_dem


def engine(d):
    return LunarDataEngine(DatasetRegistry(d))


def test_registry_reads_metadata_and_coverage(dem_dir):
    reg = DatasetRegistry(dem_dir)
    info = reg.get("plane_test")
    assert info.synthetic and info.meta["provider"] == "pytest"
    assert info.lat_range[1] == pytest.approx(1.0, abs=1e-6)
    assert info.resolution_m_per_px == 20.0
    assert "SYNTHETIC" in " ".join(info.warnings)


def test_missing_sidecar_rejected(tmp_path):
    d = tmp_path / "d"; d.mkdir()
    write_dem(d / "a.tif", plane(20)); (d / "a.meta.json").unlink()
    reg = DatasetRegistry(d)
    assert not reg.datasets and "a.tif" in reg.errors


def test_missing_required_metadata_rejected(tmp_path):
    d = tmp_path / "d"; d.mkdir()
    write_dem(d / "a.tif", plane(20)); (d / "a.meta.json").write_text(json.dumps({"name": "x"}))
    assert "a.tif" in DatasetRegistry(d).errors


def test_no_crs_rejected(tmp_path):
    d = tmp_path / "d"; d.mkdir()
    with rasterio.open(d / "n.tif", "w", driver="GTiff", height=5, width=5, count=1, dtype="float32") as dst:
        dst.write(np.zeros((5, 5), "float32"), 1)
    (d / "n.meta.json").write_text(json.dumps({"name": "n", "provider": "p", "product": "q"}))
    assert "n.tif" in DatasetRegistry(d).errors


def test_find_covering_refuses_synthetic_by_default(dem_dir):
    reg = DatasetRegistry(dem_dir)
    with pytest.raises(DataUnavailableError):
        reg.find_covering(0.95, 23.05)
    assert reg.find_covering(0.95, 23.05, allow_synthetic=True).id == "plane_test"


def test_out_of_coverage_is_error_not_fake_data(dem_dir):
    e = engine(dem_dir)
    with pytest.raises(OutOfCoverageError):
        e.read_patch("plane_test", -85.0, 10.0, 1000)
    with pytest.raises(DataUnavailableError):
        e.registry.get("sldem2015")


def test_elevation_retrieval_known_plane(dem_dir):
    e = engine(dem_dir)
    p = e.read_patch("plane_test", 0.95, 23.05, 2000)
    # plane: pixel i holds 100 + tan(2deg)*20m*i, located at the pixel CENTRE (i+0.5)*20 m from the west edge (lon 23.0)
    lon = 23.05
    expected = 100 + np.tan(np.radians(2)) * (np.radians(lon - 23.0) * R - 10.0)
    assert p.sample_one(0.95, lon) == pytest.approx(expected, abs=0.05)
    assert e.elevation_at("plane_test", 0.95, lon) == pytest.approx(expected, abs=0.05)


def test_cell_size_and_geometry(dem_dir):
    p = engine(dem_dir).read_patch("plane_test", 0.95, 23.05, 1000)
    assert p.dy_m == pytest.approx(20.0, rel=1e-6)
    assert p.dx_m == pytest.approx(20.0 * np.cos(np.radians(0.95)), rel=1e-6)
    assert p.shape[0] >= 99


def test_nodata_becomes_nan_and_sampling_propagates(dem_dir):
    e = engine(dem_dir)
    # hole at rows 40:50, cols 250:260 -> lat = 1 - 45*20/R, lon = 23 + 255*20/R
    lat = 1.0 - np.degrees(45 * 20 / R); lon = 23.0 + np.degrees(255 * 20 / R)
    p = e.read_patch("plane_test", lat, lon, 400)
    assert np.isnan(p.sample_one(lat, lon))
    assert np.isnan(p.elevation).any() and np.isfinite(p.elevation).any()
    with pytest.raises(OutOfCoverageError):
        e.elevation_at("plane_test", lat, lon)


def test_partial_coverage_pads_with_nan(dem_dir):
    p = engine(dem_dir).read_patch("plane_test", 0.995, 23.003, 1000)  # near NW corner
    assert 0.1 < p.valid_fraction < 0.9


def test_downsampling_respects_max_cells(dem_dir):
    p = engine(dem_dir).read_patch("plane_test", 0.95, 23.05, 2500, max_cells=2500)
    assert p.elevation.size <= 2700
    assert p.dx_m > 20


def test_too_small_region_rejected(dem_dir):
    with pytest.raises(ValidationFailure):
        engine(dem_dir).read_patch("plane_test", 0.95, 23.05, 10)


def test_polar_stereographic_dataset(tmp_path):
    """Projected CRS path (polar stereographic like LOLA polar DEMs)."""
    d = tmp_path / "p"; d.mkdir()
    crs = CRS.from_proj4(f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R} +units=m +no_defs")
    n, res = 400, 100.0
    z = np.tile(np.arange(n) * 0.1, (n, 1)).astype("float32")  # elevation depends on column (x)
    write_dem(d / "pole.tif", z, crs=crs, transform=from_origin(-n * res / 2, n * res / 2, res, res), res_m=res)
    e = engine(d)
    info = e.registry.get("pole")
    assert info.includes_pole and not info.is_geographic
    # point 5 km from the pole, longitude 0 => x = 0, y = +/- ~5 km
    p = e.read_patch("pole", -89.8, 0.0, 3000)
    assert p.dx_m == pytest.approx(100.0) and p.dy_m == pytest.approx(100.0)
    v = p.sample_one(-89.8, 0.0)
    assert np.isfinite(v)
    # round trip through patch pixel mapping
    r, c = p.latlon_to_rowcol(-89.8, 0.0)
    la, lo = p.rowcol_to_latlon(r, c)
    assert la == pytest.approx(-89.8, abs=1e-6)


def test_geographic_dataset_near_pole_rejected(tmp_path):
    d = tmp_path / "g"; d.mkdir()
    write_dem(d / "g.tif", plane(100), lat0=90.0, lon0=0.0)
    with pytest.raises(ValidationFailure):
        engine(d).read_patch("g", 89.99, 0.05, 500)


def test_scale_offset_applied(tmp_path):
    d = tmp_path / "s"; d.mkdir()
    write_dem(d / "s.tif", np.full((60, 60), 10.0), extra_meta={"elevation_scale": 0.5, "elevation_offset": 3.0})
    p = engine(d).read_patch("s", 0.99, 23.005, 300)
    assert np.nanmean(p.elevation) == pytest.approx(8.0)

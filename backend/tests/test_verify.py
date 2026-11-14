import numpy as np

from app.lunar_data.registry import DatasetRegistry
from app.lunar_data.verify import verify
from conftest import R, write_dem

D2R = np.pi / 180


def _global(tmp_path, value, synthetic):
    d = tmp_path / "d"; d.mkdir()
    write_dem(d / "g.tif", np.full((180, 360), value, "float32"), lat0=90.0, lon0=0.0, res_m=R * D2R, synthetic=synthetic,
              extra_meta={"quantity": "elevation"})
    return DatasetRegistry(d)


def test_synthetic_datasets_are_never_checked_against_real_facts(tmp_path):
    out = verify(_global(tmp_path, 0.0, True), "g")
    assert [c.status for c in out] == ["SKIP"] and "synthetic" in out[0].detail


def test_wrong_scale_or_flat_map_fails_the_fact_checks(tmp_path):
    out = verify(_global(tmp_path, 0.0, False), "g")          # a "real" dataset that is flat zero: cannot be the Moon
    st = {c.name: c.status for c in out}
    assert st["Apollo 11 site, Mare Tranquillitatis"] == "FAIL" and st["far side is higher than near side"] == "FAIL"
    assert any(c.status == "FAIL" for c in out)


def test_moon_like_field_passes(tmp_path):
    """Raster built to satisfy the same facts (maria low, basin deep, highs on the far side): proves the checks can PASS."""
    d = tmp_path / "m"; d.mkdir()
    lat = 90 - (np.arange(180) + 0.5); lon = (np.arange(360) + 0.5)
    z = np.where(((lon <= 90) | (lon >= 270))[None, :], -1000.0, 0.0) * np.ones((180, 1))
    def put(la, lo, v, w=3):
        z[(np.abs(lat - la) < w)[:, None] & (np.abs(((lon - lo + 180) % 360) - 180) < w)[None, :]] = v
    put(0.674, 23.473, -1900); put(20.19, 30.77, -2600); put(35, -15 % 360, -2400); put(-70.34, 187.53, -9000); put(5.41, 201.34, 10700)
    write_dem(d / "m.tif", z.astype("float32"), lat0=90.0, lon0=0.0, res_m=R * D2R, synthetic=False, extra_meta={"quantity": "elevation"})
    out = verify(DatasetRegistry(d), "m")
    assert all(c.status in ("PASS", "SKIP") for c in out), [(c.name, c.status, c.detail) for c in out if c.status == "FAIL"]
    assert sum(c.status == "PASS" for c in out) >= 6


def test_non_elevation_is_skipped(tmp_path):
    d = tmp_path / "r"; d.mkdir()
    write_dem(d / "r.tif", np.ones((20, 40), "float32"), lat0=90.0, lon0=0.0, res_m=R * 4 * D2R, synthetic=False, extra_meta={"quantity": "roughness"})
    assert verify(DatasetRegistry(d), "r")[0].status == "SKIP"

"""Shared fixtures.

All DEMs created here are TEST FIXTURES (flagged synthetic) - never presented as lunar data.
"""
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

from app.core.config import Settings
from app.main import create_app

R = 1_737_400.0
LUNAR_GEO = CRS.from_proj4(f"+proj=longlat +R={R} +no_defs")


def write_dem(path: Path, z: np.ndarray, *, lat0=1.0, lon0=23.0, res_m=20.0, crs=LUNAR_GEO, transform=None,
              synthetic=True, nodata=-9999.0, extra_meta=None):
    deg = np.degrees(res_m / R)
    transform = transform or from_origin(lon0, lat0, deg, deg)
    with rasterio.open(path, "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1, dtype="float32",
                       crs=crs, transform=transform, nodata=nodata) as dst:
        dst.write(z.astype("float32"), 1)
    meta = {"name": f"TEST {path.stem}", "provider": "pytest", "product": "test_fixture", "version": "0",
            "synthetic": synthetic, "resolution_m_per_px": res_m, "citation": "test fixture, not lunar data", "url": "x"}
    meta.update(extra_meta or {})
    path.with_suffix(".meta.json").write_text(json.dumps(meta))


def plane(n=300, slope_deg=0.0, res_m=20.0, base=100.0):
    x = np.arange(n) * res_m
    return base + np.tile(np.tan(np.radians(slope_deg)) * x, (n, 1))


@pytest.fixture
def dem_dir(tmp_path):
    d = tmp_path / "dem"; d.mkdir()
    # 300x300 @20 m: left half 2-deg plane (rises east), flat otherwise, one crater-like pit, one nodata hole
    z = plane(300, 2.0)
    yy, xx = np.mgrid[0:300, 0:300]
    z[np.hypot(yy - 200, xx - 80) < 12] -= 40.0           # deep pit (steep walls)
    z[40:50, 250:260] = -9999.0                            # nodata hole
    write_dem(d / "plane_test.tif", z)
    return d


@pytest.fixture
def client(tmp_path, dem_dir):
    from fastapi.testclient import TestClient
    s = Settings()
    s.dem_dir = dem_dir
    s.storage_dir = tmp_path / "storage"
    s.database_url = f"sqlite:///{tmp_path / 'test.db'}"
    app = create_app(s)
    with TestClient(app) as c:
        c.app_state = app.state
        yield c


@pytest.fixture
def client_pds(tmp_path):
    """Core with: a roughness product, a (synthetic-flagged) global LDEM-like elevation product, and the plane test DEM."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from test_pds import make_ldem, small_label, write_img   # noqa: WPS433
    from app.lunar_data.pds import import_pds
    from fastapi.testclient import TestClient
    d = tmp_path / "dem"; d.mkdir()
    write_dem(d / "plane_test.tif", plane(300, 2.0))
    lbl = tmp_path / "in"; lbl.mkdir()
    (lbl / "LDRM_16.LBL").write_text(small_label("LDRM_16", 90, 180, scale=0.001, offset=0))
    write_img(lbl / "LDRM_16.IMG", np.full((90, 180), 3000))
    import_pds(lbl / "LDRM_16.LBL", d)
    import_pds(make_ldem(tmp_path), d, mark_synthetic=True)
    s = Settings(); s.dem_dir = d; s.storage_dir = tmp_path / "storage"; s.database_url = f"sqlite:///{tmp_path / 't.db'}"
    with TestClient(create_app(s)) as c:
        yield c

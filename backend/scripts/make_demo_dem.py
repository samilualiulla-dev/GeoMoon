"""Write a SYNTHETIC demo/test DEM into datasets/dem/ (clearly flagged synthetic=true).

This is NOT NASA data. It exists only so the pipeline can be exercised offline. API responses
carry `synthetic: true` and callers must pass `allow_synthetic=true` to use it.

usage: python scripts/make_demo_dem.py [out_dir]
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin

R = 1_737_400.0


def synthetic_dem(n=600, seed=7):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    z = 40.0 * np.sin(xx / 90.0) * np.cos(yy / 120.0) + 0.05 * (xx - n / 2)
    for _ in range(14):  # bowl craters with raised rims
        cx, cy, rad = rng.uniform(0, n), rng.uniform(0, n), rng.uniform(15, 55)
        d = np.hypot(xx - cx, yy - cy) / rad
        depth = rad * 0.2
        z += np.where(d < 1, -depth * (1 - d ** 2), 0) + np.where((d >= 1) & (d < 1.4), depth * 0.25 * np.cos((d - 1) / 0.4 * np.pi / 2), 0)
    z[250:330, 250:340] = z[250:330, 250:340].mean() + rng.normal(0, 0.15, (80, 90))  # flat smooth patch
    z += rng.normal(0, 0.3, z.shape)
    return z.astype("float32")


def main(out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    z = synthetic_dem()
    res_m = 20.0
    deg = np.degrees(res_m / R)
    lat0, lon0 = 1.0, 23.0  # top-left corner (roughly Mare Tranquillitatis area; terrain itself is fake)
    transform = from_origin(lon0, lat0, deg, deg)
    crs = CRS.from_proj4(f"+proj=longlat +R={R} +no_defs")
    tif = out_dir / "synthetic_demo_dem.tif"
    with rasterio.open(tif, "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1, dtype="float32",
                       crs=crs, transform=transform, nodata=-9999.0) as dst:
        dst.write(z, 1)
    meta = {"name": "SYNTHETIC demo DEM (not real)", "provider": "GeoMoon test generator",
            "product": "synthetic_demo", "version": "1", "synthetic": True, "resolution_m_per_px": res_m,
            "citation": "None - procedurally generated for software testing; NOT lunar data",
            "url": "", "vertical_reference_radius_m": R}
    (out_dir / "synthetic_demo_dem.meta.json").write_text(json.dumps(meta, indent=2))
    print("wrote", tif)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "datasets" / "dem")

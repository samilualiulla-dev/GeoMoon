"""Dataset registry: discovers real DEM rasters on disk and their provenance metadata.

A dataset is ``<name>.tif|.tiff|.img|.lbl|.jp2`` plus a sidecar ``<name>.meta.json`` (see docs).
Required sidecar keys: ``name``, ``provider``, ``product``.  Optional: ``version``, ``citation``,
``url``, ``resolution_m_per_px``, ``vertical_reference_radius_m`` (default 1737400),
``elevation_scale`` / ``elevation_offset`` (physical = raw*scale+offset), ``nominal_coverage``,
``synthetic`` (bool; true => NOT NASA data, only for tests/demo).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer

from ..core.constants import MOON_RADIUS_M
from ..core.errors import DataUnavailableError

RASTER_EXT = {".tif", ".tiff", ".img", ".lbl", ".jp2"}
REQUIRED_META = ("name", "provider", "product")


@dataclass
class DatasetInfo:
    id: str
    path: Path
    meta: dict
    crs_wkt: str | None
    is_geographic: bool
    bounds_native: tuple[float, float, float, float]  # left, bottom, right, top (native CRS units)
    shape: tuple[int, int]
    pixel_size_native: tuple[float, float]
    resolution_m_per_px: float | None
    lat_range: tuple[float, float] | None
    lon_range: tuple[float, float] | None
    includes_pole: bool
    synthetic: bool
    nodata: float | None
    warnings: list[str] = field(default_factory=list)
    status: str = "available"

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.meta.get("name"), "provider": self.meta.get("provider"),
            "product": self.meta.get("product"), "version": self.meta.get("version"),
            "citation": self.meta.get("citation"), "url": self.meta.get("url"),
            "resolution_m_per_px": self.resolution_m_per_px,
            "coverage": {"lat_range_deg": self.lat_range, "lon_range_deg": self.lon_range,
                         "includes_pole": self.includes_pole,
                         "nominal": self.meta.get("nominal_coverage")},
            "crs": self.crs_wkt, "is_geographic_crs": self.is_geographic,
            "shape_rows_cols": list(self.shape), "elevation_unit": "m",
            "vertical_reference_radius_m": self.meta.get("vertical_reference_radius_m", MOON_RADIUS_M),
            "synthetic": self.synthetic, "status": self.status, "warnings": self.warnings,
            "file": self.path.name,
        }


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def _meta_path(raster: Path) -> Path:
    return raster.with_suffix(".meta.json") if raster.suffix else raster.parent / (raster.name + ".meta.json")


def _lonlat_transformer(crs: CRS) -> Transformer:
    return Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)


def _inspect(path: Path) -> DatasetInfo:
    meta_file = _meta_path(path)
    if not meta_file.exists():
        raise DataUnavailableError(f"{path.name}: missing provenance sidecar {meta_file.name}")
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    missing = [k for k in REQUIRED_META if not meta.get(k)]
    if missing:
        raise DataUnavailableError(f"{meta_file.name}: missing required metadata keys {missing}")
    warnings: list[str] = []
    with rasterio.open(path) as ds:
        if ds.crs is None:
            raise DataUnavailableError(f"{path.name}: raster has no CRS; cannot georeference safely")
        crs = CRS.from_user_input(ds.crs.to_wkt())
        b = ds.bounds
        geographic = bool(crs.is_geographic)
        px = (abs(ds.transform.a), abs(ds.transform.e))
        # Coverage by sampling the raster edge in lon/lat.
        lat_range = lon_range = None
        includes_pole = False
        try:
            t = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
            xs = np.concatenate([np.linspace(b.left, b.right, 60), np.full(60, b.right), np.linspace(b.right, b.left, 60), np.full(60, b.left)])
            ys = np.concatenate([np.full(60, b.bottom), np.linspace(b.bottom, b.top, 60), np.full(60, b.top), np.linspace(b.top, b.bottom, 60)])
            lon, lat = t.transform(xs, ys)
            lat_range = (float(np.nanmin(lat)), float(np.nanmax(lat)))
            lon_range = (float(np.nanmin(lon)), float(np.nanmax(lon)))
            if not geographic:
                cx, cy = (b.left + b.right) / 2, (b.bottom + b.top) / 2
                _, clat = t.transform(cx, cy)
                # Projected raster centred near a pole (polar stereographic): it contains the pole.
                includes_pole = abs(clat) > 89.0
                if includes_pole:
                    lat_range = (-90.0, lat_range[1]) if clat < 0 else (lat_range[0], 90.0)
            else:
                includes_pole = lat_range[1] >= 89.99 or lat_range[0] <= -89.99
        except Exception as e:  # pragma: no cover - exotic CRS
            warnings.append(f"coverage could not be computed: {e}")
        if geographic:
            res = meta.get("resolution_m_per_px") or float(np.radians(px[1]) * MOON_RADIUS_M)
        else:
            res = meta.get("resolution_m_per_px") or float(px[0])
        shape = (ds.height, ds.width)
        nodata = ds.nodata
    for k in ("version", "citation", "url", "resolution_m_per_px"):
        if not meta.get(k):
            warnings.append(f"metadata key '{k}' not provided")
    synthetic = bool(meta.get("synthetic", False))
    if synthetic:
        warnings.append("SYNTHETIC TEST/DEMO TERRAIN - NOT NASA OR ANY REAL LUNAR DATA")
    return DatasetInfo(
        id=_slug(path.stem), path=path, meta=meta, crs_wkt=crs.to_wkt(), is_geographic=geographic,
        bounds_native=(b.left, b.bottom, b.right, b.top), shape=shape, pixel_size_native=px,
        resolution_m_per_px=res, lat_range=lat_range, lon_range=lon_range, includes_pole=includes_pole,
        synthetic=synthetic, nodata=nodata, warnings=warnings,
    )


class DatasetRegistry:
    def __init__(self, dem_dir: Path):
        self.dem_dir = Path(dem_dir)
        self.datasets: dict[str, DatasetInfo] = {}
        self.errors: dict[str, str] = {}
        self.refresh()

    def refresh(self) -> None:
        self.datasets, self.errors = {}, {}
        if not self.dem_dir.exists():
            return
        for p in sorted(self.dem_dir.iterdir()):
            if p.suffix.lower() in RASTER_EXT and p.is_file():
                try:
                    info = _inspect(p)
                    self.datasets[info.id] = info
                except Exception as e:  # keep going, report problem
                    self.errors[p.name] = str(e)

    def get(self, dataset_id: str) -> DatasetInfo:
        if dataset_id not in self.datasets:
            raise DataUnavailableError(f"Dataset '{dataset_id}' is not installed",
                                       details={"installed": list(self.datasets)})
        return self.datasets[dataset_id]

    def find_covering(self, lat: float, lon: float, *, allow_synthetic: bool = False) -> DatasetInfo:
        """Best installed dataset whose raster actually contains (lat, lon) (finest resolution first)."""
        from .engine import point_in_dataset
        cands = sorted(self.datasets.values(), key=lambda d: d.resolution_m_per_px or 1e12)
        for d in cands:
            if d.synthetic and not allow_synthetic:
                continue
            if point_in_dataset(d, lat, lon):
                return d
        raise DataUnavailableError(
            f"No installed real DEM covers lat={lat}, lon={lon}",
            details={"installed": list(self.datasets), "hint": "see documentation/DATA_SETUP.md; "
                     "SLDEM2015 does not cover the poles - use LOLA/LROC polar products"})

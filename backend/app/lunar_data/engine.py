"""Lunar Data Engine: georeferenced DEM windows, elevation sampling, caching.

Elevations are metres relative to the dataset's reference sphere (default radius 1737.4 km).
Missing / nodata cells are NaN - they are never filled with invented values.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.windows import Window, from_bounds
from scipy.ndimage import map_coordinates

from ..core.constants import MOON_RADIUS_M
from ..core.coords import wrap_lon
from ..core.errors import OutOfCoverageError, ValidationFailure
from .registry import DatasetInfo, DatasetRegistry


@lru_cache(maxsize=64)
def _transformers(wkt: str):
    crs = CRS.from_user_input(wkt)
    fwd = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
    inv = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
    unit = 1.0
    try:
        unit = float(crs.axis_info[0].unit_conversion_factor or 1.0) if not crs.is_geographic else 1.0
    except Exception:
        pass
    return fwd, inv, unit


def lonlat_to_native(info: DatasetInfo, lat: float, lon: float) -> tuple[float, float]:
    """Selenographic lat/lon [deg] -> native raster CRS coordinates. Handles 0..360 vs -180..180."""
    fwd, _, _ = _transformers(info.crs_wkt)
    l, b, r, t = info.bounds_native
    lon = wrap_lon(lon)
    if info.is_geographic:
        for cand in (lon, lon + 360.0, lon - 360.0):
            if l - 1e-9 <= cand <= r + 1e-9:
                return cand, lat
        return lon, lat
    x, y = fwd.transform(lon, lat)
    return float(x), float(y)


def point_in_dataset(info: DatasetInfo, lat: float, lon: float) -> bool:
    try:
        x, y = lonlat_to_native(info, lat, lon)
    except Exception:
        return False
    l, b, r, t = info.bounds_native
    return bool(np.isfinite(x) and np.isfinite(y) and l <= x <= r and b <= y <= t)


@dataclass
class TerrainPatch:
    """A regional DEM window on a regular grid (row 0 = north edge)."""
    elevation: np.ndarray            # float64 [rows, cols], metres, NaN = no data
    dx_m: float                      # cell width  [m] (at patch centre latitude)
    dy_m: float                      # cell height [m]
    center_lat: float
    center_lon: float
    radius_m: float
    dataset: DatasetInfo
    left: float                      # native coordinates of the patch's west edge / north edge
    top: float
    px_native: float                 # native cell size
    py_native: float
    reference_radius_m: float = MOON_RADIUS_M

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation.shape

    @property
    def valid_fraction(self) -> float:
        return float(np.isfinite(self.elevation).mean())

    def latlon_to_rowcol(self, lat: float, lon: float) -> tuple[float, float]:
        x, y = lonlat_to_native(self.dataset, lat, lon)
        col = (x - self.left) / self.px_native - 0.5
        row = (self.top - y) / self.py_native - 0.5
        return row, col

    def rowcol_to_latlon(self, row: float, col: float) -> tuple[float, float]:
        x = self.left + (col + 0.5) * self.px_native
        y = self.top - (row + 0.5) * self.py_native
        if self.dataset.is_geographic:
            return float(y), wrap_lon(x)
        _, inv, _ = _transformers(self.dataset.crs_wkt)
        lon, lat = inv.transform(x, y)
        return float(lat), wrap_lon(lon)

    def sample(self, lat, lon) -> np.ndarray:
        """Bilinear elevation [m] at lat/lon (scalars or arrays); NaN outside/at data gaps."""
        lat = np.atleast_1d(np.asarray(lat, dtype=float)); lon = np.atleast_1d(np.asarray(lon, dtype=float))
        rc = np.array([self.latlon_to_rowcol(a, b) for a, b in zip(lat, lon)]).T
        return map_coordinates(self.elevation, rc, order=1, mode="constant", cval=np.nan)

    def sample_one(self, lat: float, lon: float) -> float:
        return float(self.sample(lat, lon)[0])


class LunarDataEngine:
    def __init__(self, registry: DatasetRegistry, max_cells: int = 4_000_000, cache_size: int = 16):
        self.registry = registry
        self.max_cells = max_cells
        self._cache: OrderedDict[tuple, TerrainPatch] = OrderedDict()
        self._cache_size = cache_size

    def read_patch(self, dataset_id: str, lat: float, lon: float, radius_m: float,
                   max_cells: int | None = None) -> TerrainPatch:
        if not (-90 <= lat <= 90):
            raise ValidationFailure("lat must be within [-90, 90]")
        if radius_m <= 0:
            raise ValidationFailure("radius_m must be positive")
        info = self.registry.get(dataset_id)
        max_cells = min(max_cells or self.max_cells, self.max_cells)
        key = (dataset_id, round(lat, 6), round(wrap_lon(lon), 6), round(radius_m, 2), max_cells)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        patch = self._read(info, lat, lon, radius_m, max_cells)
        self._cache[key] = patch
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return patch

    def _read(self, info: DatasetInfo, lat: float, lon: float, radius_m: float, max_cells: int) -> TerrainPatch:
        if not point_in_dataset(info, lat, lon):
            raise OutOfCoverageError(
                f"Point lat={lat}, lon={lon} lies outside dataset '{info.id}' ({info.meta.get('product')}) coverage",
                details={"dataset": info.id, "coverage": info.to_dict()["coverage"]})
        cx, cy = lonlat_to_native(info, lat, lon)
        _, _, unit = _transformers(info.crs_wkt)
        if info.is_geographic:
            if abs(lat) > 85.0:
                raise ValidationFailure("Geographic-CRS datasets are unreliable above |lat|=85 deg; "
                                        "use a polar-stereographic product (e.g. LOLA LDEM polar).")
            hy = np.degrees(radius_m / MOON_RADIUS_M)
            hx = np.degrees(radius_m / (MOON_RADIUS_M * np.cos(np.radians(lat))))
        else:
            hx = hy = radius_m / unit
        with rasterio.open(info.path) as ds:
            win = from_bounds(cx - hx, cy - hy, cx + hx, cy + hy, ds.transform)
            win = Window(np.floor(win.col_off), np.floor(win.row_off), np.ceil(win.width) , np.ceil(win.height))
            w, h = int(win.width), int(win.height)
            if w < 3 or h < 3:
                raise ValidationFailure("Requested region is smaller than 3x3 DEM cells; increase radius_m",
                                        details={"cells": [h, w], "resolution_m_per_px": info.resolution_m_per_px})
            factor = max(1.0, np.sqrt(w * h / max_cells))
            oh, ow = max(3, int(np.ceil(h / factor))), max(3, int(np.ceil(w / factor)))
            resampling = Resampling.average if (oh, ow) != (h, w) else Resampling.nearest
            arr = ds.read(1, window=win, out_shape=(oh, ow), boundless=True, masked=True,
                          resampling=resampling, out_dtype="float64")
            nodata = ds.nodata
            win_transform = ds.window_transform(win)
        z = np.ma.filled(arr, np.nan).astype("float64")
        if nodata is not None and np.isfinite(nodata):
            z[np.isclose(z, nodata)] = np.nan
        z[z < -1.0e30] = np.nan  # PDS-style nodata sentinels
        scale = float(info.meta.get("elevation_scale", 1.0)); off = float(info.meta.get("elevation_offset", 0.0))
        z = z * scale + off
        px = abs(win_transform.a) * (w / ow)
        py = abs(win_transform.e) * (h / oh)
        if info.is_geographic:
            dy_m = np.radians(py) * MOON_RADIUS_M
            dx_m = np.radians(px) * MOON_RADIUS_M * np.cos(np.radians(lat))
        else:
            dx_m, dy_m = px * unit, py * unit
        return TerrainPatch(elevation=z, dx_m=float(dx_m), dy_m=float(dy_m), center_lat=lat, center_lon=wrap_lon(lon),
                            radius_m=radius_m, dataset=info, left=win_transform.c, top=win_transform.f,
                            px_native=float(px), py_native=float(py),
                            reference_radius_m=float(info.meta.get("vertical_reference_radius_m", MOON_RADIUS_M)))

    def elevation_at(self, dataset_id: str, lat: float, lon: float) -> float:
        """Elevation [m] at a point (bilinear on a small native-resolution window). Raises if no data."""
        info = self.registry.get(dataset_id)
        res = info.resolution_m_per_px or 100.0
        patch = self._read(info, lat, lon, max(res * 4, 1.0), 10_000)
        v = patch.sample_one(lat, lon)
        if not np.isfinite(v):
            raise OutOfCoverageError("No valid elevation data at this point", details={"dataset": dataset_id})
        return v

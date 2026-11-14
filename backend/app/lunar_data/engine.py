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
    ex, ey = 1e-6 * abs(info.pixel_size_native[0]), 1e-6 * abs(info.pixel_size_native[1])   # absorb float noise in raster bounds (e.g. -90.00000000000001)
    return bool(np.isfinite(x) and np.isfinite(y) and l - ex <= x <= r + ex and b - ey <= y <= t + ey)


D2R = np.pi / 180.0


def azimuthal_forward(lat0: float, lon0: float, lat, lon, R: float):
    """Azimuthal-equidistant projection about (lat0, lon0): selenographic -> local (east, north) metres. Exact on a sphere,
    valid everywhere including the poles."""
    la0, lo0 = lat0 * D2R, lon0 * D2R
    la, lo = np.asarray(lat, float) * D2R, np.asarray(lon, float) * D2R
    dlo = lo - lo0
    cos_c = np.sin(la0) * np.sin(la) + np.cos(la0) * np.cos(la) * np.cos(dlo)
    c = np.arccos(np.clip(cos_c, -1.0, 1.0))
    y = np.cos(la0) * np.sin(la) - np.sin(la0) * np.cos(la) * np.cos(dlo)
    x = np.cos(la) * np.sin(dlo)
    az = np.arctan2(x, y)
    return R * c * np.sin(az), R * c * np.cos(az)


def azimuthal_inverse(lat0: float, lon0: float, east, north, R: float):
    """Local (east, north) metres -> (lat, lon) degrees; longitude wrapped to [-180, 180)."""
    la0, lo0 = lat0 * D2R, lon0 * D2R
    e, n = np.asarray(east, float), np.asarray(north, float)
    rho = np.hypot(e, n) / R
    az = np.arctan2(e, n)
    lat = np.arcsin(np.clip(np.sin(la0) * np.cos(rho) + np.cos(la0) * np.sin(rho) * np.cos(az), -1.0, 1.0))
    if abs(np.cos(la0)) < 1e-9:   # projection centre ON a pole: azimuth measured from lon0 (south: toward lon0, north: away)
        lon = lo0 + np.arctan2(e, n if la0 < 0 else -n)
    else:
        lon = lo0 + np.arctan2(np.sin(az) * np.sin(rho) * np.cos(la0), np.cos(rho) - np.sin(la0) * np.sin(lat))
    return lat / D2R, ((lon / D2R + 180.0) % 360.0) - 180.0


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
    projection: str = "native"       # 'native' = raster grid as stored; 'azimuthal' = resampled onto a local metric grid (poles, wide areas)
    half_extent_m: float = 0.0       # azimuthal: half-width of the square window

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation.shape

    @property
    def valid_fraction(self) -> float:
        return float(np.isfinite(self.elevation).mean())

    def latlon_to_rowcol(self, lat: float, lon: float) -> tuple[float, float]:
        if self.projection == "azimuthal":
            e, n = azimuthal_forward(self.center_lat, self.center_lon, lat, lon, self.reference_radius_m)
            ny, nx = self.elevation.shape
            return float((self.half_extent_m - n) / self.dy_m - 0.5), float((e + self.half_extent_m) / self.dx_m - 0.5)
        x, y = lonlat_to_native(self.dataset, lat, lon)
        col = (x - self.left) / self.px_native - 0.5
        row = (self.top - y) / self.py_native - 0.5
        return row, col

    def rowcol_to_latlon(self, row: float, col: float) -> tuple[float, float]:
        if self.projection == "azimuthal":
            e = (col + 0.5) * self.dx_m - self.half_extent_m
            n = self.half_extent_m - (row + 0.5) * self.dy_m
            la, lo = azimuthal_inverse(self.center_lat, self.center_lon, e, n, self.reference_radius_m)
            return float(la), float(lo)
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


def _too_small(info: DatasetInfo, radius_m: float, cells: tuple[int, int]) -> ValidationFailure:
    mn, rec = info.min_radius_m(), info.recommended_radius_m()
    hint = f" Use radius_m >= {mn:,.0f} m (recommended ~{rec:,.0f} m)." if mn and rec else " Increase radius_m."
    return ValidationFailure(
        f"The region (radius {radius_m:,.0f} m) is smaller than 3x3 cells of dataset '{info.id}' (one cell is about "
        f"{info.resolution_m_per_px:,.0f} m).{hint}",
        details={"cells": list(cells), "resolution_m_per_px": info.resolution_m_per_px, "min_radius_m": mn, "recommended_radius_m": rec,
                 "dataset": info.id})


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
        if info.quantity != "elevation":
            raise ValidationFailure(f"Dataset '{dataset_id}' is a {info.quantity} product, not elevation; it cannot be used as a DEM")
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
        if info.quantity != "elevation":
            raise ValidationFailure(f"Dataset '{info.id}' is a {info.quantity} product, not elevation; it cannot be used as a DEM")
        if not point_in_dataset(info, lat, lon):
            raise OutOfCoverageError(
                f"Point lat={lat}, lon={lon} lies outside dataset '{info.id}' ({info.meta.get('product')}) coverage",
                details={"dataset": info.id, "coverage": info.to_dict()["coverage"]})
        cx, cy = lonlat_to_native(info, lat, lon)
        _, _, unit = _transformers(info.crs_wkt)
        if info.is_geographic and abs(lat) + np.degrees(radius_m / MOON_RADIUS_M) >= 80.0:
            return self._read_azimuthal(info, lat, lon, radius_m, max_cells)   # near a pole: lon/lat cells are not square
        if info.is_geographic:
            hy = np.degrees(radius_m / MOON_RADIUS_M)
            hx = np.degrees(radius_m / (MOON_RADIUS_M * np.cos(np.radians(lat))))
        else:
            hx = hy = radius_m / unit
        with rasterio.open(info.path) as ds:
            win = from_bounds(cx - hx, cy - hy, cx + hx, cy + hy, ds.transform)
            win = Window(np.floor(win.col_off), np.floor(win.row_off), np.ceil(win.width) , np.ceil(win.height))
            w, h = int(win.width), int(win.height)
            if w < 3 or h < 3:
                raise _too_small(info, radius_m, (h, w))
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

    def _read_azimuthal(self, info: DatasetInfo, lat0: float, lon0: float, radius_m: float, max_cells: int) -> TerrainPatch:
        """Resample a geographic (lon/lat) raster onto a regular metric grid centred on the target (azimuthal equidistant).
        Needed within ~10 deg of the poles, where one longitude pixel is only metres wide. Bilinear; NaN stays NaN."""
        R = float(info.meta.get("vertical_reference_radius_m", MOON_RADIUS_M))
        l, b, r, t = info.bounds_native
        px_deg, py_deg = info.pixel_size_native
        full_lon = (r - l) >= 359.99
        cell = max(R * D2R * py_deg, 2.0 * radius_m / np.sqrt(max_cells))       # never finer than the data, never more than max_cells
        n = int(np.ceil(2.0 * radius_m / cell))
        if n < 3:
            raise _too_small(info, radius_m, (n, n))
        step = 2.0 * radius_m / n
        east = -radius_m + (np.arange(n) + 0.5) * step
        north = radius_m - (np.arange(n) + 0.5) * step
        E, N = np.meshgrid(east, north)
        lat, lon = azimuthal_inverse(lat0, lon0, E, N, R)
        # source band (all longitudes: robust for the pole and the date line), decimated so it stays small
        lat_lo, lat_hi = max(float(lat.min()), b), min(float(lat.max()), t)
        if lat_lo >= lat_hi:
            raise OutOfCoverageError("Region lies outside the dataset latitude range", details={"dataset": info.id})
        with rasterio.open(info.path) as ds:
            r0 = max(int(np.floor((t - lat_hi) / py_deg)) - 2, 0)
            r1 = min(int(np.ceil((t - lat_lo) / py_deg)) + 2, ds.height)
            h, w = r1 - r0, ds.width
            f = max(1.0, np.sqrt(h * w / (4 * max_cells)))
            oh, ow = max(2, int(np.ceil(h / f))), max(2, int(np.ceil(w / f)))
            arr = ds.read(1, window=Window(0, r0, w, h), out_shape=(oh, ow), masked=True,
                          resampling=Resampling.average if (oh, ow) != (h, w) else Resampling.nearest, out_dtype="float64")
            nodata = ds.nodata
        z = np.ma.filled(arr, np.nan).astype("float64")
        if nodata is not None and np.isfinite(nodata):
            z[np.isclose(z, nodata)] = np.nan
        z[z < -1.0e30] = np.nan
        z = z * float(info.meta.get("elevation_scale", 1.0)) + float(info.meta.get("elevation_offset", 0.0))
        fy, fx = h / oh, w / ow
        if full_lon:
            lonn = l + np.mod(lon - l, 360.0)
            z = np.concatenate([z[:, -1:], z, z[:, :1]], axis=1)       # wrap column on both sides
            colshift = 1.0
        else:
            lonn = np.where((lon >= l) & (lon <= r), lon, np.where((lon + 360 >= l) & (lon + 360 <= r), lon + 360, lon - 360))
            colshift = 0.0
        rowf = ((t - lat) / py_deg - r0) / fy - 0.5
        colf = (lonn - l) / px_deg / fx - 0.5 + colshift
        out = map_coordinates(z, [rowf, colf], order=1, mode="nearest")
        outside = (lat < b) | (lat > t)
        if not full_lon:
            outside |= (lonn < l) | (lonn > r)
        out = np.where(outside, np.nan, out)
        return TerrainPatch(elevation=out, dx_m=float(step), dy_m=float(step), center_lat=lat0, center_lon=wrap_lon(lon0), radius_m=radius_m,
                            dataset=info, left=0.0, top=0.0, px_native=float(step), py_native=float(step), reference_radius_m=R,
                            projection="azimuthal", half_extent_m=float(radius_m))

    def _point_geographic(self, info: DatasetInfo, lat: float, lon: float) -> float:
        """Exact bilinear elevation at a point of a geographic raster, straight from the 2x2 pixel neighbourhood
        (independent of latitude; wraps the 0/360 seam; NaN if any neighbour with non-zero weight is missing).
        Within half a pixel of a pole (or the raster's lat edge) there is no second row to interpolate with: the edge row is used."""
        l, b, r, t = info.bounds_native
        px, py = info.pixel_size_native
        full_lon = (r - l) >= 359.99
        eps = 1e-6 * py
        if not (b - eps <= lat <= t + eps):
            raise OutOfCoverageError("Point outside the dataset latitude range", details={"dataset": info.id})
        if full_lon:
            lonn = l + np.mod(wrap_lon(lon) - l, 360.0)
        else:
            lonn = next((c for c in (lon, lon + 360.0, lon - 360.0) if l <= c <= r), None)
            if lonn is None:
                raise OutOfCoverageError("Point outside the dataset longitude range", details={"dataset": info.id})
        rowf, colf = (t - lat) / py - 0.5, (lonn - l) / px - 0.5
        r0, c0 = int(np.floor(rowf)), int(np.floor(colf))
        fr, fc = rowf - r0, colf - c0
        with rasterio.open(info.path) as ds:
            h, w = ds.height, ds.width
            rows = np.clip([r0, r0 + 1], 0, h - 1)
            cols = [(c0 % w), ((c0 + 1) % w)] if full_lon else list(np.clip([c0, c0 + 1], 0, w - 1))
            lo_r, hi_r = int(min(rows)), int(max(rows))
            band = ds.read(1, window=Window(0, lo_r, w, hi_r - lo_r + 1), masked=True, out_dtype="float64")
            nodata = ds.nodata
        z = np.ma.filled(band, np.nan).astype("float64")
        if nodata is not None and np.isfinite(nodata):
            z[np.isclose(z, nodata)] = np.nan
        z[z < -1.0e30] = np.nan
        acc, wsum = 0.0, 0.0
        for ri, wr in ((rows[0], 1 - fr), (rows[1], fr)):
            for ci, wc in ((cols[0], 1 - fc), (cols[1], fc)):
                wgt = wr * wc
                if wgt <= 1e-12:
                    continue
                v = z[int(ri) - lo_r, int(ci)]
                if not np.isfinite(v):
                    return float("nan")
                acc += wgt * v; wsum += wgt
        if wsum <= 0:
            return float("nan")
        return float(acc / wsum * float(info.meta.get("elevation_scale", 1.0)) + float(info.meta.get("elevation_offset", 0.0)))

    def elevation_at(self, dataset_id: str, lat: float, lon: float) -> float:
        """Elevation [m] at a point (bilinear on a small native-resolution window). Raises if no data."""
        info = self.registry.get(dataset_id)
        if info.quantity != "elevation":
            raise ValidationFailure(f"Dataset '{dataset_id}' is a {info.quantity} product, not elevation; it cannot be used as a DEM")
        if not point_in_dataset(info, lat, lon):
            raise OutOfCoverageError(f"Point lat={lat}, lon={lon} lies outside dataset '{info.id}' coverage", details={"dataset": info.id})
        if info.is_geographic:
            v = self._point_geographic(info, lat, lon)
        else:
            res = info.resolution_m_per_px or 100.0
            v = self._read(info, lat, lon, max(res * 4, 1.0), 10_000).sample_one(lat, lon)
        if not np.isfinite(v):
            raise OutOfCoverageError("No valid elevation data at this point", details={"dataset": dataset_id})
        return v

    def read_global_grid(self, dataset_id: str, rows: int, cols: int) -> dict:
        """Whole-Moon elevation grid (block-averaged) for the globe. Only for global geographic-CRS elevation datasets."""
        info = self.registry.get(dataset_id)
        if info.quantity != "elevation":
            raise ValidationFailure(f"Dataset '{dataset_id}' is a {info.quantity} product, not elevation")
        l, b, r, t = info.bounds_native
        if not info.is_geographic or (t - b) < 170.0 or (r - l) < 350.0:
            raise OutOfCoverageError(f"Dataset '{dataset_id}' is not global (needs a geographic raster spanning >=170 deg lat and ~360 deg lon)",
                                     details={"dataset": dataset_id, "coverage": info.to_dict()["coverage"]})
        with rasterio.open(info.path) as ds:
            arr = ds.read(1, out_shape=(rows, cols), masked=True, resampling=Resampling.average, out_dtype="float64")
            nodata = ds.nodata
        z = np.ma.filled(arr, np.nan).astype("float64")
        if nodata is not None and np.isfinite(nodata):
            z[np.isclose(z, nodata)] = np.nan
        z[z < -1.0e30] = np.nan
        z = z * float(info.meta.get("elevation_scale", 1.0)) + float(info.meta.get("elevation_offset", 0.0))
        return {"rows": rows, "cols": cols, "lat_north_deg": float(t), "lat_south_deg": float(b), "lon_west_deg": float(l), "lon_east_deg": float(r),
                "elevation": z, "reference_radius_m": float(info.meta.get("vertical_reference_radius_m", MOON_RADIUS_M))}

"""Terrain Analysis Engine - pure NumPy/SciPy functions on a regular DEM grid.

All functions take ``z`` (2-D float array, metres, NaN = missing) and cell sizes ``dx, dy`` in
metres, and return arrays of the same shape.  NaN never gets silently filled: a window that
contains any missing cell yields NaN for window statistics.

IMPORTANT physical caveat: every metric depends on the DEM resolution (baseline). Slopes/roughness
at 20 m/px say nothing about 1 m boulders or sub-pixel craters.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage as ndi


def _odd(n: float) -> int:
    n = max(3, int(round(n)))
    return n if n % 2 == 1 else n + 1


def window_cells(window_m: float, dx: float, dy: float) -> tuple[int, int]:
    """Odd window size in cells (rows, cols) covering ~window_m metres."""
    return _odd(window_m / dy), _odd(window_m / dx)


def slope_aspect(z: np.ndarray, dx: float, dy: float) -> tuple[np.ndarray, np.ndarray]:
    """Horn (1981) 3x3 slope [deg] and aspect [deg clockwise from north, downslope direction].

    The outermost ring of cells has no full 3x3 neighbourhood and is returned as NaN (no edge-replication bias);
    NaN anywhere in the 3x3 neighbourhood -> NaN.
    """
    if dx <= 0 or dy <= 0:
        raise ValueError("cell sizes must be positive")
    valid = np.isfinite(z)
    zf = np.where(valid, z, 0.0)
    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], float) / (8.0 * dx)
    ky = np.array([[1, 2, 1], [0, 0, 0], [-1, -2, -1]], float) / (8.0 * dy)  # row 0 = north => +dz/dnorth
    dzdx = ndi.correlate(zf, kx, mode="nearest")   # +east
    dzdy = ndi.correlate(zf, ky, mode="nearest")   # +north
    bad = ndi.minimum_filter(valid.astype(np.uint8), size=3, mode="nearest") == 0
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    aspect = (np.degrees(np.arctan2(-dzdx, -dzdy)) + 360.0) % 360.0  # direction of steepest descent
    bad[0, :] = bad[-1, :] = True; bad[:, 0] = bad[:, -1] = True
    slope[bad] = np.nan; aspect[bad] = np.nan
    return slope, aspect


def _complete(valid: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """True where the whole window lies inside the grid and contains no missing cells."""
    frac = ndi.uniform_filter(valid.astype(float), size=size, mode="constant", cval=0.0)
    return frac > 1.0 - 1e-9


def _moments(z: np.ndarray, size: tuple[int, int]):
    valid = np.isfinite(z)
    zc = np.where(valid, z - np.nanmean(z) if valid.any() else 0.0, 0.0)
    m1 = ndi.uniform_filter(zc, size=size, mode="nearest")
    m2 = ndi.uniform_filter(zc * zc, size=size, mode="nearest")
    complete = _complete(valid, size)
    return zc, m1, m2, complete


def roughness_std(z: np.ndarray, dx: float, dy: float, window_m: float) -> np.ndarray:
    """Roughness = standard deviation of elevation in a window [m] (includes regional tilt)."""
    size = window_cells(window_m, dx, dy)
    _, m1, m2, complete = _moments(z, size)
    out = np.sqrt(np.maximum(m2 - m1 * m1, 0.0))
    out[~complete] = np.nan
    return out


def roughness_detrended(z: np.ndarray, dx: float, dy: float, window_m: float) -> np.ndarray:
    """RMS residual [m] of elevations about the least-squares plane fitted in each window.

    Unlike plain std, a smooth uniform slope gives ~0 roughness; only departures from the local
    plane count.  Closed form: SSE = Sum(z'^2) - b_x^2 Sum(x^2) - b_y^2 Sum(y^2) with centred z'.
    """
    ry, rx = window_cells(window_m, dx, dy)
    size = (ry, rx)
    zc, m1, m2, complete = _moments(z, size)
    xs = (np.arange(rx) - rx // 2) * dx
    ys = (np.arange(ry) - ry // 2) * dy
    kx = np.tile(xs, (ry, 1)); ky = np.tile(ys[:, None], (1, rx))
    n = rx * ry
    sxx, syy = (kx ** 2).sum(), (ky ** 2).sum()
    sxz = ndi.correlate(zc, kx, mode="nearest"); syz = ndi.correlate(zc, ky, mode="nearest")
    var = m2 - m1 * m1  # per-cell variance of z in window
    sse_per_n = var - (sxz ** 2 / sxx + syz ** 2 / syy) / n
    out = np.sqrt(np.maximum(sse_per_n, 0.0))
    out[~complete] = np.nan
    return out


def local_relief(z: np.ndarray, dx: float, dy: float, window_m: float) -> np.ndarray:
    """Local relief = max - min elevation [m] within the window."""
    size = window_cells(window_m, dx, dy)
    valid = np.isfinite(z)
    hi = ndi.maximum_filter(np.where(valid, z, -np.inf), size=size, mode="nearest")
    lo = ndi.minimum_filter(np.where(valid, z, np.inf), size=size, mode="nearest")
    complete = _complete(valid, size)
    out = hi - lo
    out[~complete] = np.nan
    return out


def topographic_position(z: np.ndarray, dx: float, dy: float, window_m: float) -> np.ndarray:
    """TPI = z - mean(z in window) [m]. Strongly negative = depression (crater floor), positive = rim/mound."""
    size = window_cells(window_m, dx, dy)
    valid = np.isfinite(z)
    zc = np.where(valid, z - (np.nanmean(z) if valid.any() else 0.0), 0.0)
    m = ndi.uniform_filter(zc, size=size, mode="nearest")
    complete = _complete(valid, size)
    out = np.where(valid, zc - m, np.nan)
    out[~complete] = np.nan
    return out


def elevation_stats(z: np.ndarray) -> dict:
    v = z[np.isfinite(z)]
    if v.size == 0:
        return {"min_m": None, "max_m": None, "mean_m": None, "range_m": None, "valid_fraction": 0.0}
    return {"min_m": float(v.min()), "max_m": float(v.max()), "mean_m": float(v.mean()),
            "std_m": float(v.std()), "range_m": float(v.max() - v.min()), "valid_fraction": float(v.size / z.size)}


def elevation_profile(z: np.ndarray, p0: tuple[float, float], p1: tuple[float, float], n: int = 100) -> np.ndarray:
    """Bilinear profile between two (row, col) points; NaN where data are missing."""
    rr = np.linspace(p0[0], p1[0], n); cc = np.linspace(p0[1], p1[1], n)
    return ndi.map_coordinates(z, [rr, cc], order=1, mode="constant", cval=np.nan)


def hazard_masks(z, dx, dy, slope, *, slope_limit_deg, relief, relief_limit_m, roughness, roughness_limit_m,
                 tpi, tpi_limit_m) -> dict[str, np.ndarray]:
    """Boolean hazard masks (True = hazardous, NaN inputs -> False; missing data handled separately)."""
    with np.errstate(invalid="ignore"):
        masks = {
            "steep_slope": slope > slope_limit_deg,
            "elevation_discontinuity": relief > relief_limit_m,
            "rough_surface": roughness > roughness_limit_m,
            "topographic_anomaly": np.abs(tpi) > tpi_limit_m,
        }
    return {k: np.where(np.isfinite(v if v.dtype != bool else 1.0), v, False) for k, v in masks.items()}

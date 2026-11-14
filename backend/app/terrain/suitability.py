"""Landing-suitability scoring, candidate-site extraction and per-site explanations.

Score model (documented, configurable):

    score_i  = clip(1 - value_i / limit_i, 0, 1)          for slope, roughness, local relief
    score_h  = clip(distance_to_hazard / safe_distance, 0, 1)
    suitability = sum_k w_k * score_k / sum_k w_k      (weights are normalised)

The result is an analytical *geometric* estimate on DEM data - NOT a landing-safety probability.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from scipy import ndimage as ndi

from ..lunar_data.engine import TerrainPatch
from . import analysis as A

CLASS_UNSUITABLE, CLASS_SUITABLE, CLASS_INSUFFICIENT = 0, 1, 2
HAZARD_KINDS = ("steep_slope", "elevation_discontinuity", "rough_surface", "topographic_anomaly")
CLASS_NAMES = {0: "geometrically_unsuitable", 1: "geometrically_suitable", 2: "insufficient_data"}


@dataclass
class AnalysisParams:
    window_m: float = 60.0                 # window for roughness / relief / TPI
    roughness_method: str = "detrended"    # 'std' | 'detrended'
    slope_limit_deg: float = 10.0
    roughness_limit_m: float = 0.5
    relief_limit_m: float = 3.0
    tpi_limit_m: float = 5.0
    hazard_safe_distance_m: float = 50.0
    footprint_radius_m: float = 15.0       # spacecraft landing footprint radius
    suitable_threshold: float = 0.7
    weights: dict = field(default_factory=lambda: {"slope": 0.35, "roughness": 0.2, "relief": 0.2, "hazard": 0.25})
    max_candidates: int = 5
    min_candidate_separation_m: float | None = None

    def validate(self) -> None:
        for k in ("window_m", "slope_limit_deg", "roughness_limit_m", "relief_limit_m", "tpi_limit_m",
                  "hazard_safe_distance_m", "footprint_radius_m"):
            if not getattr(self, k) > 0:
                raise ValueError(f"{k} must be > 0")
        if self.roughness_method not in ("std", "detrended"):
            raise ValueError("roughness_method must be 'std' or 'detrended'")
        if not 0 < self.suitable_threshold <= 1:
            raise ValueError("suitable_threshold must be in (0, 1]")
        if set(self.weights) != {"slope", "roughness", "relief", "hazard"}:
            raise ValueError("weights must have exactly keys slope, roughness, relief, hazard")
        if any(w < 0 for w in self.weights.values()) or sum(self.weights.values()) <= 0:
            raise ValueError("weights must be non-negative with positive sum")
        if self.max_candidates < 1:
            raise ValueError("max_candidates must be >= 1")


def _ramp(value: np.ndarray, limit: float) -> np.ndarray:
    return np.clip(1.0 - value / limit, 0.0, 1.0)


def disk(radius_cells_y: float, radius_cells_x: float) -> np.ndarray:
    ry, rx = max(1, int(np.ceil(radius_cells_y))), max(1, int(np.ceil(radius_cells_x)))
    yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]
    return (yy / max(radius_cells_y, 1e-9)) ** 2 + (xx / max(radius_cells_x, 1e-9)) ** 2 <= 1.0


def analyze_grid(z: np.ndarray, dx: float, dy: float, params: AnalysisParams) -> dict:
    """Run the full pipeline on an elevation grid. Returns dict of layers (2-D arrays) + site data."""
    params.validate()
    slope, aspect = A.slope_aspect(z, dx, dy)
    rough = (A.roughness_detrended if params.roughness_method == "detrended" else A.roughness_std)(z, dx, dy, params.window_m)
    relief = A.local_relief(z, dx, dy, params.window_m)
    tpi = A.topographic_position(z, dx, dy, params.window_m)
    haz = A.hazard_masks(z, dx, dy, slope, slope_limit_deg=params.slope_limit_deg, relief=relief,
                         relief_limit_m=params.relief_limit_m, roughness=rough,
                         roughness_limit_m=params.roughness_limit_m, tpi=tpi, tpi_limit_m=params.tpi_limit_m)
    any_hazard = np.zeros(z.shape, bool)
    for m in haz.values():
        any_hazard |= m
    # distance [m] to nearest hazardous cell (anisotropic cell size)
    dist = ndi.distance_transform_edt(~any_hazard, sampling=(dy, dx)) if any_hazard.any() else np.full(z.shape, np.inf)
    if not any_hazard.any():
        dist = np.full(z.shape, params.hazard_safe_distance_m * 10.0)

    s_slope = _ramp(slope, params.slope_limit_deg)
    s_rough = _ramp(rough, params.roughness_limit_m)
    s_relief = _ramp(relief, params.relief_limit_m)
    s_haz = np.clip(dist / params.hazard_safe_distance_m, 0.0, 1.0)
    w = params.weights; wsum = sum(w.values())
    # Missing data: any NaN component => score NaN (never imputed)
    score = (w["slope"] * s_slope + w["roughness"] * s_rough + w["relief"] * s_relief + w["hazard"] * s_haz) / wsum
    nodata = ~np.isfinite(score) | ~np.isfinite(z)

    # Footprint feasibility: every cell inside footprint disk must be valid, below hazard & score limits.
    fp = disk(params.footprint_radius_m / dy, params.footprint_radius_m / dx)
    cell_ok = (score >= params.suitable_threshold) & (slope <= params.slope_limit_deg) & ~any_hazard & ~nodata
    cell_ok = np.where(np.isfinite(score), cell_ok, False)
    fits = ndi.binary_erosion(cell_ok, structure=fp, border_value=0)
    # footprint touching missing data (or the patch edge, where windows are incomplete) => insufficient data
    nodata_near = ndi.binary_dilation(nodata, structure=fp, border_value=0)
    classes = np.full(z.shape, CLASS_UNSUITABLE, np.uint8)
    classes[fits] = CLASS_SUITABLE
    classes[nodata_near & ~fits] = CLASS_INSUFFICIENT
    classes[nodata] = CLASS_INSUFFICIENT

    layers = {"elevation": z, "slope": slope, "aspect": aspect, "roughness": rough, "local_relief": relief,
              "tpi": tpi, "hazard": any_hazard.astype(float), "hazard_distance": dist,
              "score_slope": s_slope, "score_roughness": s_rough, "score_relief": s_relief, "score_hazard": s_haz,
              "suitability": score, "class": classes.astype(float)}
    for k, m in haz.items():
        layers[f"hazard_{k}"] = m.astype(float)
    return {"layers": layers, "footprint": fp, "hazard_masks": haz}


def extract_candidates(layers: dict, dx: float, dy: float, params: AnalysisParams, fp: np.ndarray) -> list[dict]:
    """Greedy top-N sites: footprint-mean suitability over cells where the full footprint fits."""
    score = layers["suitability"]; cls = layers["class"]
    ok = cls == CLASS_SUITABLE
    if not ok.any():
        return []
    fpn = fp.astype(float) / fp.sum()
    smooth = ndi.convolve(np.where(np.isfinite(score), score, 0.0), fpn, mode="nearest")
    cand = np.where(ok, smooth, -np.inf)
    sep = params.min_candidate_separation_m or 3 * params.footprint_radius_m
    out: list[dict] = []
    work = cand.copy()
    while len(out) < params.max_candidates and np.isfinite(work).any() and work.max() > -np.inf:
        r, c = np.unravel_index(np.argmax(work), work.shape)
        out.append({"row": int(r), "col": int(c), "footprint_mean_suitability": float(work[r, c])})
        rr, cc = np.ogrid[:work.shape[0], :work.shape[1]]
        work[((rr - r) * dy) ** 2 + ((cc - c) * dx) ** 2 < sep ** 2] = -np.inf
    return out


def explain_point(layers: dict, row: int, col: int, params: AnalysisParams) -> dict:
    """Per-metric breakdown of why a cell got its score (sample values, scores, weights, limits)."""
    row = int(np.clip(row, 0, layers["slope"].shape[0] - 1)); col = int(np.clip(col, 0, layers["slope"].shape[1] - 1))
    w = params.weights; wsum = sum(w.values())
    items = {
        "slope": (layers["slope"][row, col], params.slope_limit_deg, "deg", layers["score_slope"][row, col]),
        "roughness": (layers["roughness"][row, col], params.roughness_limit_m, "m", layers["score_roughness"][row, col]),
        "relief": (layers["local_relief"][row, col], params.relief_limit_m, "m", layers["score_relief"][row, col]),
        "hazard": (layers["hazard_distance"][row, col], params.hazard_safe_distance_m, "m (distance to hazard)",
                   layers["score_hazard"][row, col]),
    }
    components, notes = {}, []
    for k, (val, lim, unit, sc) in items.items():
        finite = bool(np.isfinite(val)) and bool(np.isfinite(sc))
        components[k] = {"value": float(val) if finite else None, "limit": lim, "unit": unit,
                         "score": float(sc) if finite else None, "weight": w[k] / wsum,
                         "weighted_contribution": float(w[k] / wsum * sc) if finite else None}
        if not finite:
            notes.append(f"{k}: no data (window touches missing cells or patch edge)")
        elif sc < 0.5:
            notes.append(f"{k} is a limiting factor: {val:.3g} {unit} vs limit {lim} (score {sc:.2f})")
    cls = int(layers["class"][row, col])
    haz_hit = [k for k in HAZARD_KINDS if layers.get(f"hazard_{k}") is not None and layers[f"hazard_{k}"][row, col] > 0.5]
    if haz_hit:
        notes.append("cell flagged by hazard detectors: " + ", ".join(haz_hit))
    sc_total = layers["suitability"][row, col]
    return {"row": row, "col": col, "classification": CLASS_NAMES[cls],
            "suitability": float(sc_total) if np.isfinite(sc_total) else None,
            "components": components, "notes": notes,
            "disclaimer": "Geometric suitability estimate from DEM data; not a certified landing-safety probability."}


def downsample_layer(a: np.ndarray, max_dim: int) -> np.ndarray:
    f = int(np.ceil(max(a.shape) / max_dim))
    if f <= 1:
        return a
    h, w = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    with np.errstate(all="ignore"):
        blk = a[:h, :w].reshape(h // f, f, w // f, f)
        out = blk.mean(axis=(1, 3))  # NaN if any NaN (conservative)
    return out


LAYER_META = {
    "elevation": ("m", "DEM elevation relative to the dataset reference sphere"),
    "slope": ("deg", "Horn 3x3 slope; baseline = DEM cell size"),
    "aspect": ("deg", "Downslope azimuth, clockwise from north"),
    "roughness": ("m", "Window RMS plane-residual (or std) of elevation; window_m in parameters"),
    "local_relief": ("m", "max - min elevation in window"),
    "tpi": ("m", "Topographic position: z minus window mean"),
    "hazard": ("0/1", "Union of hazard detectors (steep slope, discontinuity, rough, TPI anomaly)"),
    "hazard_distance": ("m", "Distance to nearest flagged hazard cell"),
    "suitability": ("0..1", "Weighted normalised score (geometric, not a safety probability)"),
    "class": ("0 unsuitable / 1 suitable / 2 insufficient data", "Footprint-based classification"),
}


def analyze_patch(patch: TerrainPatch, params: AnalysisParams) -> dict:
    res = analyze_grid(patch.elevation, patch.dx_m, patch.dy_m, params)
    layers = res["layers"]
    cands = extract_candidates(layers, patch.dx_m, patch.dy_m, params, res["footprint"])
    for c in cands:
        lat, lon = patch.rowcol_to_latlon(c["row"], c["col"])
        c.update(lat=lat, lon=lon, elevation_m=float(layers["elevation"][c["row"], c["col"]]),
                 explanation=explain_point(layers, c["row"], c["col"], params))
    cls = layers["class"]
    n = cls.size
    summary = {
        "elevation": A.elevation_stats(patch.elevation),
        "slope_deg": _stats(layers["slope"]), "roughness_m": _stats(layers["roughness"]),
        "local_relief_m": _stats(layers["local_relief"]), "suitability": _stats(layers["suitability"]),
        "class_fractions": {CLASS_NAMES[i]: float((cls == i).sum() / n) for i in range(3)},
        "hazard_fraction": float(layers["hazard"].mean()),
        "resolution_m": {"dx": patch.dx_m, "dy": patch.dy_m},
        "min_resolvable_feature_m": 2 * max(patch.dx_m, patch.dy_m),
        "warnings": resolution_warnings(patch.dx_m, patch.dy_m, params),
    }
    return {"layers": layers, "candidates": cands, "summary": summary, "params": asdict(params), "footprint": res["footprint"]}


def resolution_warnings(dx: float, dy: float, params: AnalysisParams) -> list[str]:
    """Plain-language warnings when the DEM is too coarse for the requested landing-scale analysis."""
    cell = max(dx, dy)
    w: list[str] = []
    if cell > params.footprint_radius_m:
        w.append(f"DEM cell size ({cell:.0f} m) is larger than the landing footprint radius ({params.footprint_radius_m:g} m): "
                 "slope, roughness and hazard values are regional averages and cannot show whether the footprint fits. Use a finer DEM for site selection.")
    if cell >= 500:
        w.append(f"At {cell:.0f} m/cell craters and slopes smaller than ~{2 * cell:.0f} m are not resolved; results are regional-scale context only.")
    return w


def _stats(a: np.ndarray) -> dict:
    v = a[np.isfinite(a)]
    if v.size == 0:
        return {"min": None, "max": None, "mean": None, "p95": None}
    return {"min": float(v.min()), "max": float(v.max()), "mean": float(v.mean()), "p95": float(np.percentile(v, 95))}

"""Terrain analysis orchestration: data window -> analysis -> JSON-friendly result + file storage."""
from __future__ import annotations

import numpy as np

from ..context import AppContext
from ..core.errors import DataUnavailableError, ValidationFailure
from ..db import models as M
from ..lunar_data.engine import TerrainPatch
from .suitability import LAYER_META, AnalysisParams, analyze_patch, downsample_layer


def choose_dataset(ctx: AppContext, lat: float, lon: float, dataset_id: str | None, allow_synthetic: bool):
    if dataset_id:
        info = ctx.registry.get(dataset_id)
        if info.synthetic and not allow_synthetic:
            raise ValidationFailure(f"Dataset '{dataset_id}' is SYNTHETIC test data; pass allow_synthetic=true to use it knowingly.")
        return info
    return ctx.registry.find_covering(lat, lon, allow_synthetic=allow_synthetic)


def grid_to_json(a: np.ndarray, max_dim: int) -> dict:
    d = downsample_layer(a, max_dim)
    return {"rows": int(d.shape[0]), "cols": int(d.shape[1]),
            "data": [[None if not np.isfinite(v) else round(float(v), 4) for v in row] for row in d]}


def patch_geometry(patch: TerrainPatch) -> dict:
    ny, nx = patch.shape
    corners = {"north_west": patch.rowcol_to_latlon(-0.5, -0.5), "north_east": patch.rowcol_to_latlon(-0.5, nx - 0.5),
               "south_west": patch.rowcol_to_latlon(ny - 0.5, -0.5), "south_east": patch.rowcol_to_latlon(ny - 0.5, nx - 0.5)}
    return {"rows": ny, "cols": nx, "cell_size_m": {"dx": patch.dx_m, "dy": patch.dy_m}, "row0_is_north": True,
            "center": {"latitude_deg": patch.center_lat, "longitude_deg": patch.center_lon},
            "corners": {k: {"latitude_deg": v[0], "longitude_deg": v[1]} for k, v in corners.items()},
            "reference_radius_m": patch.reference_radius_m, "valid_fraction": patch.valid_fraction}


def run_analysis(ctx: AppContext, *, lat: float, lon: float, radius_m: float, dataset_id: str | None,
                 params: AnalysisParams, allow_synthetic: bool = False, max_cells: int | None = None):
    info = choose_dataset(ctx, lat, lon, dataset_id, allow_synthetic)
    patch = ctx.data.read_patch(info.id, lat, lon, radius_m, max_cells)
    if patch.valid_fraction == 0:
        raise DataUnavailableError("Dataset has no valid elevation cells in the requested region", details={"dataset": info.id})
    return patch, analyze_patch(patch, params)


def result_payload(patch: TerrainPatch, res: dict, *, layers: list[str] | None, max_grid: int) -> dict:
    out_layers = {}
    for name in (layers or ["elevation", "slope", "roughness", "local_relief", "hazard", "suitability", "class"]):
        if name not in res["layers"]:
            raise ValidationFailure(f"Unknown layer '{name}'", details={"available": list(res["layers"])})
        arr = res["layers"][name]
        unit, desc = LAYER_META.get(name, ("", ""))
        out_layers[name] = {"unit": unit, "description": desc, **grid_to_json(arr, max_grid),
                            "min": _nm(np.nanmin(arr)) if np.isfinite(arr).any() else None,
                            "max": _nm(np.nanmax(arr)) if np.isfinite(arr).any() else None}
    cands = [{k: v for k, v in c.items()} for c in res["candidates"]]
    return {"geometry": patch_geometry(patch), "summary": res["summary"], "parameters": res["params"],
            "candidates": cands, "layers": out_layers,
            "provenance": provenance(patch),
            "disclaimer": "Suitability is a geometric DEM-based estimate, not a landing-safety probability."}


def _nm(v):
    return float(v)


def provenance(patch: TerrainPatch) -> dict:
    d = patch.dataset.to_dict()
    return {"dataset_id": d["id"], "name": d["name"], "provider": d["provider"], "product": d["product"],
            "version": d["version"], "resolution_m_per_px": d["resolution_m_per_px"], "crs": d["crs"],
            "citation": d["citation"], "url": d["url"], "synthetic": d["synthetic"],
            "warnings": d["warnings"],
            "data_notice": "SYNTHETIC TEST TERRAIN - NOT REAL LUNAR DATA" if d["synthetic"] else "Real dataset; see citation"}


def persist_analysis(ctx: AppContext, db, patch: TerrainPatch, res: dict, *, region_id: int | None = None) -> M.TerrainAnalysis:
    s = res["summary"]
    src = db.query(M.DataSource).filter_by(key=patch.dataset.id).one_or_none()
    row = M.TerrainAnalysis(
        region_id=region_id, data_source_id=src.id if src else None, center_latitude=patch.center_lat,
        center_longitude=patch.center_lon, radius=patch.radius_m,
        slope_results=s["slope_deg"], roughness_results=s["roughness_m"], relief_results=s["local_relief_m"],
        hazard_results={"hazard_fraction": s["hazard_fraction"], "min_resolvable_feature_m": s["min_resolvable_feature_m"]},
        suitability_results={"stats": s["suitability"], "class_fractions": s["class_fractions"], "candidates": res["candidates"],
                             "elevation": s["elevation"]},
        analysis_parameters=res["params"], synthetic=patch.dataset.synthetic)
    db.add(row); db.flush()
    path = ctx.storage_path("analyses", f"analysis_{row.id}.npz")
    np.savez_compressed(path, **{k: v.astype("float32") for k, v in res["layers"].items()})
    row.raster_path = str(path)
    db.commit()
    return row

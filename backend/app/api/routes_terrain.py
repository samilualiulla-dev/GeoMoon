from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..context import AppContext
from ..core.errors import NotFoundError, ValidationFailure
from ..db import models as M
from ..landing.evaluate import evaluate_surface
from ..spacecraft.schemas import SpacecraftConfig
from ..simulation.manager import spacecraft_from_row
from ..terrain.service import grid_to_json, persist_analysis, result_payload, run_analysis
from ..terrain.suitability import LAYER_META, AnalysisParams
from .deps import get_ctx, get_db
from .schemas import LandingEvaluateRequest, TerrainAnalyzeRequest

router = APIRouter()


def _params(p) -> AnalysisParams:
    ap = AnalysisParams(**p.model_dump())
    try:
        ap.validate()
    except ValueError as e:
        raise ValidationFailure(str(e))
    return ap


@router.post("/terrain/analyze", tags=["terrain"])
def analyze(body: TerrainAnalyzeRequest, ctx: AppContext = Depends(get_ctx), db: Session = Depends(get_db)):
    """Slope / roughness / relief / hazards / suitability for a circular region of real DEM data."""
    params = _params(body.params)
    if body.region_id is not None and db.get(M.LunarRegion, body.region_id) is None:
        raise NotFoundError(f"region {body.region_id} not found")
    patch, res = run_analysis(ctx, lat=body.latitude_deg, lon=body.longitude_deg, radius_m=body.radius_m,
                              dataset_id=body.dataset_id, params=params, allow_synthetic=body.allow_synthetic,
                              max_cells=body.max_cells)
    payload = result_payload(patch, res, layers=body.layers, max_grid=body.max_grid)
    if body.save:
        row = persist_analysis(ctx, db, patch, res, region_id=body.region_id)
        payload["analysis_id"] = row.id
    return payload


def _analysis_row(db, aid: int) -> M.TerrainAnalysis:
    row = db.get(M.TerrainAnalysis, aid)
    if row is None:
        raise NotFoundError(f"analysis {aid} not found")
    return row


@router.get("/terrain/analysis/{analysis_id}", tags=["terrain"])
def get_analysis(analysis_id: int, db: Session = Depends(get_db)):
    r = _analysis_row(db, analysis_id)
    return {"id": r.id, "created_at": r.created_at.isoformat(), "region_id": r.region_id, "center": {"latitude_deg": r.center_latitude, "longitude_deg": r.center_longitude},
            "radius_m": r.radius, "slope": r.slope_results, "roughness": r.roughness_results, "local_relief": r.relief_results,
            "hazard": r.hazard_results, "suitability": r.suitability_results, "parameters": r.analysis_parameters,
            "synthetic": r.synthetic, "layers_available": list(LAYER_META)}


@router.get("/terrain/analysis/{analysis_id}/layers/{layer}", tags=["terrain"])
def get_layer(analysis_id: int, layer: str, max_grid: int = Query(128, ge=8, le=1024), db: Session = Depends(get_db)):
    r = _analysis_row(db, analysis_id)
    with np.load(r.raster_path) as z:
        if layer not in z.files:
            raise NotFoundError(f"layer '{layer}' not found", details={"available": z.files})
        arr = z[layer].astype(float)
    unit, desc = LAYER_META.get(layer, ("", ""))
    return {"analysis_id": r.id, "layer": layer, "unit": unit, "description": desc, **grid_to_json(arr, max_grid)}


@router.post("/landing/evaluate", tags=["landing"])
def landing_evaluate(body: LandingEvaluateRequest, ctx: AppContext = Depends(get_ctx), db: Session = Depends(get_db)):
    """(a) simulation_id -> stored combined surface+trajectory+vehicle assessment.
    (b) spacecraft_id + lat/lon -> surface-only assessment of a candidate site."""
    if body.simulation_id is not None:
        sim = db.get(M.Simulation, body.simulation_id)
        if sim is None:
            raise NotFoundError(f"simulation {body.simulation_id} not found")
        if sim.result is None:
            raise ValidationFailure(f"simulation is {sim.status}; no result yet")
        return {"simulation_id": sim.id, "assessment": sim.result.landing_assessment}
    if body.spacecraft_id is None or body.latitude_deg is None or body.longitude_deg is None:
        raise ValidationFailure("Provide simulation_id, or spacecraft_id with latitude_deg and longitude_deg")
    sc = db.get(M.SpacecraftConfiguration, body.spacecraft_id)
    if sc is None:
        raise NotFoundError(f"spacecraft {body.spacecraft_id} not found")
    cfg = spacecraft_from_row(sc)
    from .schemas import AnalysisParamsIn
    pin = body.params or AnalysisParamsIn(footprint_radius_m=cfg.footprint_radius_m, slope_limit_deg=cfg.max_tilt_deg)
    params = _params(pin)
    patch, res = run_analysis(ctx, lat=body.latitude_deg, lon=body.longitude_deg, radius_m=body.radius_m,
                              dataset_id=body.dataset_id, params=params, allow_synthetic=body.allow_synthetic)
    surface = evaluate_surface(cfg, body.latitude_deg, body.longitude_deg, res, patch, params)
    return {"surface_assessment": surface, "provenance": __import__("app.terrain.service", fromlist=["provenance"]).provenance(patch),
            "disclaimer": "Surface-only geometric check; no trajectory evaluated. Not a safety guarantee."}

from __future__ import annotations

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from ..context import AppContext
from ..core.errors import ConflictError, NotFoundError, ValidationFailure
from ..db import models as M
from ..simulation import manager as mgr
from ..trajectory.planning import suggest_vertical_ignition_altitude
from .deps import get_ctx, get_db
from .schemas import IgnitionSuggestRequest, MissionIn, SimulationCreate, SpacecraftIn

router = APIRouter()


def _sc_json(r: M.SpacecraftConfiguration):
    cfg = mgr.spacecraft_from_row(r)
    return {"id": r.id, "user_id": r.user_id, "name": r.name, "dry_mass_kg": r.dry_mass, "fuel_mass_kg": r.fuel_mass,
            "dimensions": r.dimensions, "landing_gear": r.landing_gear, "engine": r.engine_parameters,
            "constraints": r.landing_constraints, "derived": cfg.derived(), "warnings": cfg.warnings(),
            "is_demo": bool(r.is_demo), "created_at": r.created_at.isoformat()}


@router.post("/spacecraft", status_code=201, tags=["spacecraft"])
def create_spacecraft(body: SpacecraftIn, db: Session = Depends(get_db)):
    uid = body.user_id
    if uid is not None and db.get(M.User, uid) is None:
        raise NotFoundError(f"user {uid} not found")
    cfg = body.model_copy(); data = cfg.model_dump(exclude={"user_id"})
    from ..spacecraft.schemas import SpacecraftConfig
    data.pop("is_demo", None)
    row = mgr.save_spacecraft(db, SpacecraftConfig(**data), uid, is_demo=body.is_demo)
    return _sc_json(row)


@router.get("/spacecraft", tags=["spacecraft"])
def list_spacecraft(db: Session = Depends(get_db)):
    return [_sc_json(r) for r in db.query(M.SpacecraftConfiguration).order_by(M.SpacecraftConfiguration.id)]


@router.get("/spacecraft/{sid}", tags=["spacecraft"])
def get_spacecraft(sid: int, db: Session = Depends(get_db)):
    r = db.get(M.SpacecraftConfiguration, sid)
    if r is None:
        raise NotFoundError(f"spacecraft {sid} not found")
    return _sc_json(r)


@router.put("/spacecraft/{sid}", tags=["spacecraft"])
def update_spacecraft(sid: int, body: SpacecraftIn, db: Session = Depends(get_db)):
    """Edit a configuration in place. Refused (409) once simulations or missions use it, so stored results stay reproducible:
    save a new configuration instead."""
    r = db.get(M.SpacecraftConfiguration, sid)
    if r is None:
        raise NotFoundError(f"spacecraft {sid} not found")
    use = mgr.spacecraft_usage(db, sid)
    if use["simulations"] or use["missions"]:
        raise ConflictError(f"spacecraft {sid} is used by {use['simulations']} simulation(s) and {use['missions']} mission(s) and cannot be edited; save a copy instead",
                            details=use)
    from ..spacecraft.schemas import SpacecraftConfig
    cfg = SpacecraftConfig(**body.model_dump(exclude={"user_id", "is_demo"}))
    r.name, r.dry_mass, r.fuel_mass = cfg.name, cfg.dry_mass_kg, cfg.fuel_mass_kg
    r.dimensions, r.engine_parameters = cfg.dimensions.model_dump(), cfg.engine.model_dump()
    r.landing_constraints, r.landing_gear, r.is_demo = cfg.constraints.model_dump(), cfg.landing_gear.model_dump(), body.is_demo
    db.commit()
    return _sc_json(r)


@router.delete("/spacecraft/{sid}", tags=["spacecraft"])
def delete_spacecraft(sid: int, db: Session = Depends(get_db)):
    """Delete an unused configuration (409 if simulations or missions reference it)."""
    r = db.get(M.SpacecraftConfiguration, sid)
    if r is None:
        raise NotFoundError(f"spacecraft {sid} not found")
    use = mgr.spacecraft_usage(db, sid)
    if use["simulations"] or use["missions"]:
        raise ConflictError(f"spacecraft {sid} is used by {use['simulations']} simulation(s) and {use['missions']} mission(s) and cannot be deleted", details=use)
    db.delete(r); db.commit()
    return {"deleted": sid}


@router.post("/trajectory/suggest-ignition", tags=["trajectory"])
def suggest(body: IgnitionSuggestRequest, db: Session = Depends(get_db)):
    """Advisory vertical-descent ignition altitude (constant deceleration estimate)."""
    if body.spacecraft is not None:
        cfg = body.spacecraft
    elif body.spacecraft_id is not None:
        r = db.get(M.SpacecraftConfiguration, body.spacecraft_id)
        if r is None:
            raise NotFoundError(f"spacecraft {body.spacecraft_id} not found")
        cfg = mgr.spacecraft_from_row(r)
    else:
        raise ValidationFailure("Provide spacecraft_id or spacecraft")
    return suggest_vertical_ignition_altitude(cfg, body.initial_speed_m_s, initial_altitude_m=body.initial_altitude_m,
                                              throttle=body.throttle, margin=body.margin)


def _sim_json(s: M.Simulation, brief=True):
    d = {"id": s.id, "status": s.status, "spacecraft_id": s.spacecraft_id, "region_id": s.region_id,
         "initial_conditions": s.initial_conditions, "settings": s.settings, "terrain_options": s.terrain_options,
         "error": s.error, "created_at": s.created_at.isoformat(),
         "started_at": s.started_at.isoformat() if s.started_at else None,
         "completed_at": s.completed_at.isoformat() if s.completed_at else None, "has_result": s.result is not None}
    if s.result is not None:
        d["summary"] = s.result.summary
    return d


@router.post("/simulation/create", status_code=201, tags=["simulation"])
def create_simulation(body: SimulationCreate, db: Session = Depends(get_db)):
    s = mgr.create_simulation(db, spacecraft_id=body.spacecraft_id, region_id=body.region_id, ic=body.initial_conditions,
                              settings=body.settings, terrain_options=body.terrain.model_dump())
    return _sim_json(s)


@router.post("/simulation/{sim_id}/run", status_code=202, tags=["simulation"])
def run_simulation(sim_id: int, bg: BackgroundTasks, wait: bool = False, ctx: AppContext = Depends(get_ctx),
                   db: Session = Depends(get_db)):
    """Queue the run (202). ``wait=true`` runs synchronously and returns the final state."""
    s = mgr.queue_simulation(db, sim_id)
    if wait:
        mgr.execute_simulation(ctx, sim_id)
        db.expire_all()
        return _sim_json(db.get(M.Simulation, sim_id))
    bg.add_task(mgr.execute_simulation, ctx, sim_id)
    return _sim_json(s)


@router.get("/simulation/{sim_id}", tags=["simulation"])
def get_simulation(sim_id: int, db: Session = Depends(get_db)):
    s = db.get(M.Simulation, sim_id)
    if s is None:
        raise NotFoundError(f"simulation {sim_id} not found")
    return _sim_json(s)


@router.get("/simulation/{sim_id}/results", tags=["simulation"])
def get_results(sim_id: int, t: float | None = Query(None, ge=0, description="Return interpolated state at this time only"),
                fields: str | None = Query(None, description="Comma-separated subset of time-series columns"),
                stride: int = Query(1, ge=1, le=100000), db: Session = Depends(get_db)):
    s = db.get(M.Simulation, sim_id)
    if s is None:
        raise NotFoundError(f"simulation {sim_id} not found")
    if s.result is None:
        raise ValidationFailure(f"simulation {sim_id} is {s.status}; results not available", details={"status": s.status, "error": s.error})
    r = s.result
    if t is not None:
        return {"simulation_id": sim_id, "t_s": t, "state": mgr.state_at(r, t)}
    ts = r.time_series
    if fields:
        want = [f.strip() for f in fields.split(",")]
        bad = [f for f in want if f not in ts]
        if bad:
            raise ValidationFailure("Unknown fields", details={"unknown": bad, "available": list(ts)})
        ts = {k: ts[k] for k in want}
    ts = {k: v[::stride] for k, v in ts.items()}
    return {"simulation_id": sim_id, "status": s.status, "time_series": ts, "final_state": r.final_state,
            "trajectory": r.trajectory_data, "summary": r.summary, "landing_assessment": r.landing_assessment,
            "terrain_analysis_id": r.terrain_analysis_id,
            "units": {"position": "m (body-fixed)", "velocity": "m/s (surface-relative, body-fixed axes)", "time": "s", "mass": "kg"}}


# ------------------------------- missions -------------------------------
def _mission_json(m: M.Mission):
    return {"id": m.id, "name": m.name, "description": m.description, "region_id": m.region_id, "spacecraft_id": m.spacecraft_id,
            "simulation_id": m.simulation_id, "user_id": m.user_id, "created_at": m.created_at.isoformat()}


@router.post("/missions", status_code=201, tags=["missions"])
def create_mission(body: MissionIn, db: Session = Depends(get_db)):
    for model, key in ((M.LunarRegion, body.region_id), (M.SpacecraftConfiguration, body.spacecraft_id),
                       (M.Simulation, body.simulation_id), (M.User, body.user_id)):
        if key is not None and db.get(model, key) is None:
            raise NotFoundError(f"{model.__tablename__} {key} not found")
    if db.query(M.Mission).filter_by(name=body.name).first():
        from ..core.errors import ConflictError
        raise ConflictError(f"mission '{body.name}' exists")
    m = M.Mission(**body.model_dump()); db.add(m); db.commit()
    return _mission_json(m)


@router.get("/missions", tags=["missions"])
def list_missions(db: Session = Depends(get_db)):
    return [_mission_json(m) for m in db.query(M.Mission).order_by(M.Mission.id)]


@router.get("/missions/{mid}", tags=["missions"])
def get_mission(mid: int, db: Session = Depends(get_db)):
    m = db.get(M.Mission, mid)
    if m is None:
        raise NotFoundError(f"mission {mid} not found")
    d = _mission_json(m)
    if m.simulation_id:
        s = db.get(M.Simulation, m.simulation_id)
        d["simulation"] = _sim_json(s)
        d["landing_assessment"] = s.result.landing_assessment if s.result else None
    return d


@router.get("/missions/{mid}/report", tags=["missions"])
def mission_report(mid: int, db: Session = Depends(get_db)):
    """JSON mission report assembled only from stored calculations."""
    m = db.get(M.Mission, mid)
    if m is None:
        raise NotFoundError(f"mission {mid} not found")
    rep = {"mission": _mission_json(m)}
    if m.spacecraft_id:
        rep["spacecraft"] = _sc_json(db.get(M.SpacecraftConfiguration, m.spacecraft_id))
    if m.region_id:
        r = db.get(M.LunarRegion, m.region_id)
        rep["region"] = {"name": r.name, "latitude_deg": r.latitude, "longitude_deg": r.longitude, "radius_m": r.radius}
    if m.simulation_id:
        s = db.get(M.Simulation, m.simulation_id)
        rep["simulation"] = _sim_json(s)
        if s.result:
            rep["final_state"] = s.result.final_state; rep["landing_assessment"] = s.result.landing_assessment
            if s.result.terrain_analysis_id:
                a = db.get(M.TerrainAnalysis, s.result.terrain_analysis_id)
                rep["terrain_analysis"] = {"id": a.id, "slope": a.slope_results, "roughness": a.roughness_results,
                                           "relief": a.relief_results, "suitability": a.suitability_results,
                                           "parameters": a.analysis_parameters, "synthetic": a.synthetic}
    rep["disclaimer"] = "Research prototype output; not operational landing guidance."
    return rep

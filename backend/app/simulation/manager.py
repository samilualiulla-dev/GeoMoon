"""Simulation Engine: lifecycle (created -> queued -> running -> completed | failed), terrain coupling and persistence."""
from __future__ import annotations

import traceback
from datetime import datetime, timezone

import numpy as np

from ..context import AppContext
from ..core.errors import ConflictError, DataUnavailableError, GeoMoonError, NotFoundError, ValidationFailure
from ..db import models as M
from ..landing.evaluate import evaluate_landing
from ..spacecraft.schemas import InitialConditions, SimSettings, SpacecraftConfig
from ..terrain.service import choose_dataset, persist_analysis, run_analysis
from ..terrain.suitability import AnalysisParams
from ..trajectory.dynamics import simulate

STATUSES = ("created", "queued", "running", "completed", "failed")


def spacecraft_from_row(r: M.SpacecraftConfiguration) -> SpacecraftConfig:
    return SpacecraftConfig(name=r.name, dry_mass_kg=r.dry_mass, fuel_mass_kg=r.fuel_mass, dimensions=r.dimensions,
                            landing_gear=r.landing_gear, engine=r.engine_parameters, constraints=r.landing_constraints)


def save_spacecraft(db, cfg: SpacecraftConfig, user_id: int | None = None, is_demo: bool = False) -> M.SpacecraftConfiguration:
    row = M.SpacecraftConfiguration(
        user_id=user_id, name=cfg.name, dry_mass=cfg.dry_mass_kg, fuel_mass=cfg.fuel_mass_kg,
        dimensions=cfg.dimensions.model_dump(), engine_parameters=cfg.engine.model_dump(),
        landing_constraints=cfg.constraints.model_dump(), landing_gear=cfg.landing_gear.model_dump(), is_demo=is_demo)
    db.add(row); db.commit()
    return row


def spacecraft_usage(db, spacecraft_id: int) -> dict:
    return {"simulations": db.query(M.Simulation).filter_by(spacecraft_id=spacecraft_id).count(),
            "missions": db.query(M.Mission).filter_by(spacecraft_id=spacecraft_id).count()}


def create_simulation(db, *, spacecraft_id: int, region_id: int | None, ic: InitialConditions, settings: SimSettings,
                      terrain_options: dict | None) -> M.Simulation:
    sc = db.get(M.SpacecraftConfiguration, spacecraft_id)
    if sc is None:
        raise NotFoundError(f"spacecraft {spacecraft_id} not found")
    if region_id is not None and db.get(M.LunarRegion, region_id) is None:
        raise NotFoundError(f"region {region_id} not found")
    try:  # cross-validate config vs initial conditions now, not at run time
        from ..spacecraft.schemas import check_initial_state
        check_initial_state(spacecraft_from_row(sc), ic)
    except ValueError as e:
        raise ValidationFailure(str(e))
    sim = M.Simulation(spacecraft_id=spacecraft_id, region_id=region_id, status="created",
                       initial_conditions=ic.model_dump(), settings=settings.model_dump(), terrain_options=terrain_options or {})
    db.add(sim); db.commit()
    return sim


def queue_simulation(db, sim_id: int) -> M.Simulation:
    sim = db.get(M.Simulation, sim_id)
    if sim is None:
        raise NotFoundError(f"simulation {sim_id} not found")
    if sim.status in ("queued", "running"):
        raise ConflictError(f"simulation {sim_id} is already {sim.status}")
    if sim.status in ("completed", "failed") and sim.result is not None:
        db.delete(sim.result); db.flush()
    sim.status, sim.error, sim.started_at, sim.completed_at = "queued", None, None, None
    db.commit()
    return sim


def execute_simulation(ctx: AppContext, sim_id: int) -> None:
    """Run a queued simulation (called synchronously or from a background task). Never raises."""
    with ctx.SessionLocal() as db:
        sim = db.get(M.Simulation, sim_id)
        if sim is None:
            return
        try:
            sim.status, sim.started_at = "running", datetime.now(timezone.utc)
            db.commit()
            _run(ctx, db, sim)
            sim.status = "completed"
        except Exception as e:  # keep the failure visible, never fake results
            db.rollback()
            sim = db.get(M.Simulation, sim_id)
            sim.status = "failed"
            if isinstance(e, GeoMoonError):
                sim.error = e.message
            else:
                sim.error = f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}"
        sim.completed_at = datetime.now(timezone.utc)
        db.commit()


def _run(ctx: AppContext, db, sim: M.Simulation) -> None:
    cfg = spacecraft_from_row(sim.spacecraft)
    ic = InitialConditions(**sim.initial_conditions)
    settings = SimSettings(**sim.settings)
    opt = sim.terrain_options or {}
    warnings: list[str] = []
    patch = analysis = params = None
    terrain_row = None
    if opt.get("enabled", True):
        radius = float(opt.get("radius_m", 1500.0))
        p = dict(opt.get("params") or {})
        p.setdefault("footprint_radius_m", cfg.footprint_radius_m)
        p.setdefault("slope_limit_deg", cfg.max_tilt_deg)
        params = AnalysisParams(**p)
        try:
            info = choose_dataset(ctx, ic.target_latitude_deg, ic.target_longitude_deg, opt.get("dataset_id"), bool(opt.get("allow_synthetic", False)))
            need = 10.0 * (info.resolution_m_per_px or 0.0)          # >= 20 cells across the terrain window
            if radius < need:
                warnings.append(f"Terrain window enlarged from {radius:,.0f} m to {need:,.0f} m radius: dataset '{info.id}' has ~{info.resolution_m_per_px:,.0f} m cells, "
                                "so the requested window held too few cells. At this resolution the touchdown-site assessment is regional-scale only.")
                radius = need
            patch, analysis = run_analysis(ctx, lat=ic.target_latitude_deg, lon=ic.target_longitude_deg, radius_m=radius,
                                           dataset_id=opt.get("dataset_id"), params=params,
                                           allow_synthetic=bool(opt.get("allow_synthetic", False)),
                                           max_cells=opt.get("max_cells"))
            terrain_row = persist_analysis(ctx, db, patch, analysis, region_id=sim.region_id)
        except DataUnavailableError as e:
            warnings.append(f"Terrain not available - trajectory computed without DEM, surface not assessed: {e.message}")
        except ValidationFailure:
            raise
    surface_fn = target_elev = None
    if patch is not None:
        surface_fn = lambda la, lo: patch.sample_one(la, lo)
        v = patch.sample_one(ic.target_latitude_deg, ic.target_longitude_deg)
        target_elev = float(v) if np.isfinite(v) else 0.0
    out = simulate(cfg, ic, settings, surface_fn=surface_fn, target_elevation_m=target_elev or 0.0,
                   reference_radius_m=patch.reference_radius_m if patch else 1_737_400.0)
    assessment = evaluate_landing(cfg, out, analysis, patch, params)
    ts = out.time_series
    step = max(1, len(ts["time_s"]) // 2000)
    traj = {"frame": "body_fixed", "units": "m",
            "points_xyz": [[ts["position_x_m"][i], ts["position_y_m"][i], ts["position_z_m"][i]] for i in range(0, len(ts["time_s"]), step)],
            "time_s": ts["time_s"][::step],
            "target": {"latitude_deg": ic.target_latitude_deg, "longitude_deg": ic.target_longitude_deg},
            "terrain_dataset": patch.dataset.id if patch else None, "terrain_synthetic": bool(patch and patch.dataset.synthetic)}
    summary = {**out.summary, "warnings": warnings + out.warnings, "spacecraft_derived": cfg.derived(),
               "terrain_used": bool(patch), "terrain_synthetic": bool(patch and patch.dataset.synthetic),
               "terrain_radius_m": radius if patch else None, "terrain_dataset": patch.dataset.id if patch else None}
    db.add(M.SimulationResult(simulation_id=sim.id, time_series=ts, final_state=out.final_state, trajectory_data=traj,
                              summary=summary, landing_assessment=assessment,
                              terrain_analysis_id=terrain_row.id if terrain_row else None))
    db.commit()


def state_at(result: M.SimulationResult, t: float) -> dict:
    """Linearly interpolated state at time ``t`` (intermediate-state query)."""
    ts = result.time_series
    times = np.array(ts["time_s"])
    t = float(np.clip(t, times[0], times[-1]))
    return {k: float(np.interp(t, times, np.array(v))) for k, v in ts.items()}

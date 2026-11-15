"""/api/orbital/* - Earth-Moon orbital flight simulator."""
from __future__ import annotations

import asyncio
import copy
import math
import threading
import uuid
from dataclasses import asdict

import numpy as np
from fastapi import APIRouter, Body, Depends, Query, WebSocket, WebSocketDisconnect

from ..context import AppContext
from ..core.errors import NotFoundError, ValidationFailure
from ..orbital import planner, telemetry
from ..orbital.constants import MOON_SOI_M, R_EARTH, R_MOON
from ..orbital.ephemeris import DEFAULT_EPOCH_ISO, Ephemeris
from ..orbital.manager import OrbitalManager
from ..orbital.model import Command, _build, config_from_dict
from ..orbital.scenarios import SCENARIOS
from ..orbital.simulation import Simulation, lunar_fixed_state
from .deps import get_ctx

router = APIRouter(prefix="/orbital", tags=["orbital"])
_JOBS: dict[str, dict] = {}


def mgr(ctx: AppContext) -> OrbitalManager:
    if not hasattr(ctx, "orbital"):
        ctx.orbital = OrbitalManager(ctx)
    return ctx.orbital


def _arr(a, nd=None):
    return np.asarray(a).tolist()


def _stride(n: int, max_points: int) -> np.ndarray:
    if n <= max_points:
        return np.arange(n)
    idx = np.unique(np.linspace(0, n - 1, max_points).astype(int))
    return idx


def hermite(t, r, v, tq):
    """Cubic Hermite interpolation of position and its derivative at tq (arrays sorted by t)."""
    tq = float(np.clip(tq, t[0], t[-1]))
    i = int(np.clip(np.searchsorted(t, tq, side="right") - 1, 0, len(t) - 2)) if len(t) > 1 else 0
    if len(t) == 1:
        return r[0], v[0]
    h = t[i + 1] - t[i]
    s = (tq - t[i]) / h
    h00, h10, h01, h11 = 2 * s**3 - 3 * s**2 + 1, s**3 - 2 * s**2 + s, -2 * s**3 + 3 * s**2, s**3 - s**2
    pos = h00 * r[i] + h10 * h * v[i] + h01 * r[i + 1] + h11 * h * v[i + 1]
    d00, d10, d01, d11 = (6 * s**2 - 6 * s) / h, 3 * s**2 - 4 * s + 1, (-6 * s**2 + 6 * s) / h, 3 * s**2 - 2 * s
    vel = d00 * r[i] + d10 * v[i] + d01 * r[i + 1] + d11 * v[i + 1]
    return pos, vel


def _summary(sim: Simulation) -> dict:
    return {"id": sim.id, "name": sim.cfg.name, "status": sim.status, "t_now_s": sim.t_now, "samples": len(sim.t),
            "final_state": sim.final_state(), "config": sim.cfg.to_dict(), "epoch_iso": sim.cfg.options.epoch_iso,
            "mission_duration_s": sim.cfg.mission.duration_s}


def state_at(sim: Simulation, tq: float) -> dict:
    a = sim.arrays()
    tq = float(np.clip(tq, a["t"][0], a["t"][-1]))
    r, v = hermite(a["t"], a["r"], a["v"], tq)
    eph = sim.eph
    rm, vm = eph.moon_pos(tq), eph.moon_vel(tq)
    tel = telemetry.compute(sim)
    row = {k: float(np.interp(tq, tel["t_s"], val)) for k, val in tel.items() if k != "t_s" and np.all(np.isfinite(val[:2]))}
    rel, lat, lon, rad = lunar_fixed_state(eph, tq, r)
    ecef = eph.eci_to_ecef(tq) @ r
    return {"t_s": tq, "r_m": r.tolist(), "v_mps": v.tolist(), "moon": {"r_m": rm.tolist(), "v_mps": vm.tolist()},
            "sun_r_m": eph.sun_pos(tq).tolist(), "earth_rotation_rad": float(eph.earth_rotation_angle(tq)),
            "moon_axes": eph.moon_axes(tq).tolist(),
            "moon_fixed": {"lat_deg": lat, "lon_deg": lon, "radius_m": rad, "alt_m": rad - R_MOON},
            "earth_fixed": {"lat_deg": math.degrees(math.asin(ecef[2] / np.linalg.norm(ecef))),
                            "lon_deg": math.degrees(math.atan2(ecef[1], ecef[0])), "alt_m": float(np.linalg.norm(ecef)) - R_EARTH},
            "telemetry": row, "status": sim.status}


# ------------------------------------------------------------------------------------------------ catalogue
@router.get("/scenarios")
def scenarios():
    return {"scenarios": SCENARIOS, "directions": ["prograde", "retrograde", "radial_out", "radial_in", "normal", "antinormal",
                                                 "to_moon", "to_earth", "inertial", "surface_retro"],
            "mission_kinds": ["free_flight", "to_moon", "lunar_flyby", "lunar_orbit", "approach", "descent", "landing"],
            "graphs": {k: {"title": v[0], "series": v[1]} for k, v in telemetry.GRAPHS.items()}}


@router.get("/bodies/positions")
def bodies_positions(t_s: float = 0.0, epoch_iso: str = DEFAULT_EPOCH_ISO):
    e = Ephemeris(epoch_iso)
    return {"epoch_iso": epoch_iso, "t_s": t_s, "frame": "ECI J2000 equatorial, Earth-centred, metres",
            "earth": {"r_m": [0, 0, 0], "radius_m": R_EARTH, "rotation_rad": float(e.earth_rotation_angle(t_s))},
            "moon": {"r_m": e.moon_pos(t_s).tolist(), "v_mps": e.moon_vel(t_s).tolist(), "radius_m": R_MOON, "soi_radius_m": MOON_SOI_M,
                     "axes_inertial_to_moon_fixed": e.moon_axes(t_s).tolist()},
            "sun": {"r_m": e.sun_pos(t_s).tolist()},
            "model": "Analytical low-precision ephemeris (Astronomical Almanac); see documentation/ORBITAL_SIMULATOR.md"}


@router.get("/bodies/ephemerides")
def bodies_ephemerides(t0_s: float = 0.0, t1_s: float = 30 * 86400.0, n: int = Query(200, ge=2, le=5000), epoch_iso: str = DEFAULT_EPOCH_ISO):
    if t1_s <= t0_s:
        raise ValidationFailure("t1_s must be greater than t0_s")
    e = Ephemeris(epoch_iso)
    t = np.linspace(t0_s, t1_s, n)
    return {"epoch_iso": epoch_iso, "t_s": t.tolist(), "moon_r_m": e.moon_pos(t).tolist(), "sun_r_m": e.sun_pos(t).tolist(),
            "moon_axes": [e.moon_axes(x).tolist() for x in t], "earth_rotation_rad": [float(e.earth_rotation_angle(x)) for x in t],
            "frame": "ECI J2000 equatorial, Earth-centred, metres",
            "moon_axes_note": "rows = Moon-fixed x,y,z axes expressed in ECI (matrix: inertial -> Moon-fixed)"}


# ------------------------------------------------------------------------------------------------ planning
@router.post("/plan")
def plan_endpoint(body: dict = Body(...), background: bool = False, ctx: AppContext = Depends(get_ctx)):
    cfg = config_from_dict(body)
    if not background:
        return planner.plan(cfg)
    jid = uuid.uuid4().hex[:10]
    _JOBS[jid] = {"id": jid, "status": "running", "result": None, "error": None}

    def work():
        try:
            _JOBS[jid]["result"] = planner.plan(cfg); _JOBS[jid]["status"] = "done"
        except Exception as e:  # noqa: BLE001
            _JOBS[jid]["error"] = str(e); _JOBS[jid]["status"] = "failed"
    threading.Thread(target=work, daemon=True).start()
    return {"job_id": jid, "status": "running"}


@router.get("/plan/{job_id}")
def plan_job(job_id: str):
    if job_id not in _JOBS:
        raise NotFoundError("plan job not found")
    return _JOBS[job_id]


# ------------------------------------------------------------------------------------------------ simulations
@router.post("/simulations", status_code=201)
def create_sim(body: dict = Body(...), apply_plan: bool = False, ctx: AppContext = Depends(get_ctx)):
    cfg = config_from_dict(body)
    plan_info = None
    if apply_plan and cfg.mission.kind != "free_flight":
        plan_info = planner.plan(cfg)
        if plan_info["commands"]:
            cfg.commands = cfg.commands + [_build(Command, c) for c in plan_info["commands"]]
            cfg.mission.duration_s = max(cfg.mission.duration_s, plan_info.get("suggested_duration_s", cfg.mission.duration_s))
    sim = mgr(ctx).create(cfg)
    out = _summary(sim)
    out["plan"] = plan_info
    return out


@router.get("/simulations")
def list_sims(ctx: AppContext = Depends(get_ctx)):
    return {"simulations": mgr(ctx).list()}


@router.get("/simulations/{sim_id}")
def get_sim(sim_id: str, ctx: AppContext = Depends(get_ctx)):
    return _summary(mgr(ctx).get(sim_id))


@router.delete("/simulations/{sim_id}", status_code=204)
def delete_sim(sim_id: str, ctx: AppContext = Depends(get_ctx)):
    mgr(ctx).delete(sim_id)


@router.post("/simulations/{sim_id}/run")
def run_sim(sim_id: str, body: dict = Body(default={}), ctx: AppContext = Depends(get_ctx)):
    m = mgr(ctx)
    sim = m.get(sim_id)
    with m.lock(sim_id):
        if "until_s" in body:
            until = float(body["until_s"])
        elif "duration_s" in body:
            until = sim.t_now + float(body["duration_s"])
        else:
            until = sim.cfg.mission.duration_s
        until = min(until, sim.cfg.mission.duration_s) if not body.get("extend") else until
        if body.get("extend"):
            sim.cfg.mission.duration_s = max(sim.cfg.mission.duration_s, until)
            if sim.status == "completed":
                sim.status = "ready"
        sim.advance(until)
        m.save(sim)
        return _summary(sim)


@router.post("/simulations/{sim_id}/reset")
def reset_sim(sim_id: str, body: dict = Body(default={}), ctx: AppContext = Depends(get_ctx)):
    m = mgr(ctx)
    sim = m.get(sim_id)
    with m.lock(sim_id):
        if not body.get("keep_manual", False):
            sim.cfg.commands = [c for c in sim.cfg.commands if c.source != "manual"]
        sim.reset()
        m.save(sim)
        return _summary(sim)


@router.put("/simulations/{sim_id}/config")
def replace_config(sim_id: str, body: dict = Body(...), ctx: AppContext = Depends(get_ctx)):
    """Edit start conditions / vehicle / program and restart the simulation from t=0."""
    m = mgr(ctx)
    old = m.get(sim_id)
    cfg = config_from_dict(body)
    with m.lock(sim_id):
        sim = Simulation(cfg, m.surface_height, sim_id=sim_id)
        m.sims[sim_id] = sim
        m.save(sim)
        return _summary(sim)


@router.post("/simulations/{sim_id}/control")
def control(sim_id: str, body: dict = Body(...), ctx: AppContext = Depends(get_ctx)):
    """Manual control at simulation time ``t_s`` (default: current). History before t_s is preserved; the future is
    re-integrated to ``horizon_s`` (default: previous end of the computed run)."""
    m = mgr(ctx)
    sim = m.get(sim_id)
    body = dict(body)
    horizon = body.pop("horizon_s", None)
    t_s = float(body.pop("t_s", sim.t_now))
    cmd = _build(Command, {"t_start_s": t_s, "source": "manual", **{k: v for k, v in body.items() if k != "t_start_s"}})
    from ..orbital.model import SimConfig, validate
    probe = copy.copy(sim.cfg); probe = SimConfig(vehicle=sim.cfg.vehicle, initial=sim.cfg.initial, mission=sim.cfg.mission,
                                                  options=sim.cfg.options, commands=[cmd]); validate(probe)
    with m.lock(sim_id):
        prev_end = sim.t_now
        if sim.status in ("landed", "impact") and t_s >= sim.t_now:
            raise ValidationFailure(f"Simulation ended ({sim.status}); reset or seek earlier to change controls")
        sim.control(cmd, horizon if horizon is not None else prev_end)
        m.save(sim)
        return {"command": asdict(cmd), **_summary(sim)}


@router.get("/simulations/{sim_id}/state")
def state(sim_id: str, t_s: float | None = None, ctx: AppContext = Depends(get_ctx)):
    sim = mgr(ctx).get(sim_id)
    return state_at(sim, sim.t_now if t_s is None else t_s)


@router.get("/simulations/{sim_id}/trajectory")
def trajectory(sim_id: str, t0_s: float | None = None, t1_s: float | None = None, max_points: int = Query(1500, ge=2, le=20000),
               frame: str = Query("inertial", pattern="^(inertial|earth_fixed|moon_centered|moon_fixed)$"),
               ctx: AppContext = Depends(get_ctx)):
    sim = mgr(ctx).get(sim_id)
    a = sim.arrays()
    sel = np.ones(len(a["t"]), bool)
    if t0_s is not None: sel &= a["t"] >= t0_s
    if t1_s is not None: sel &= a["t"] <= t1_s
    idx = np.flatnonzero(sel)
    idx = idx[_stride(len(idx), max_points)] if len(idx) else idx
    t = a["t"][idx]
    r, v = a["r"][idx], a["v"][idx]
    eph = sim.eph
    rm = eph.moon_pos(t)
    if frame == "inertial":
        pos = r
    elif frame == "moon_centered":
        pos = r - rm
    elif frame == "earth_fixed":
        pos = np.array([eph.eci_to_ecef(tt) @ rr for tt, rr in zip(t, r)])
    else:
        pos = np.array([eph.moon_axes(tt) @ (rr - m) for tt, rr, m in zip(t, r, rm)])
    return {"frame": frame, "t_s": t.tolist(), "r_m": pos.tolist(), "moon_r_m": rm.tolist(), "speed_mps": np.linalg.norm(v, axis=1).tolist(),
            "thrust_n": a["thrust"][idx].tolist(), "total_samples": len(a["t"]), "status": sim.status,
            "units": "SI (m, s, m/s)"}


@router.get("/simulations/{sim_id}/telemetry")
def telemetry_ep(sim_id: str, series: str | None = None, max_points: int = Query(1500, ge=2, le=20000), t0_s: float | None = None,
                 t1_s: float | None = None, ctx: AppContext = Depends(get_ctx)):
    sim = mgr(ctx).get(sim_id)
    tel = telemetry.compute(sim)
    names = [s for s in (series.split(",") if series else tel.keys()) if s]
    unknown = [n for n in names if n not in tel]
    if unknown:
        raise ValidationFailure("Unknown telemetry series", details={"unknown": unknown, "available": sorted(tel)})
    t = tel["t_s"]
    sel = np.ones(len(t), bool)
    if t0_s is not None: sel &= t >= t0_s
    if t1_s is not None: sel &= t <= t1_s
    idx = np.flatnonzero(sel)
    idx = idx[_stride(len(idx), max_points)] if len(idx) else idx
    clean = lambda x: [None if not math.isfinite(z) else z for z in x.tolist()]
    return {"t_s": t[idx].tolist(), "series": {n: clean(tel[n][idx]) for n in names},
            "units": {n: _unit(n) for n in names}, "graphs": {k: {"title": v[0], "series": v[1]} for k, v in telemetry.GRAPHS.items()}}


def _unit(name: str) -> str:
    for suf, u in (("_m", "m"), ("_mps2", "m/s^2"), ("_mps", "m/s"), ("_kg", "kg"), ("_n", "N"), ("_deg", "deg"), ("_s", "s"),
                   ("_j_per_kg", "J/kg"), ("_m2ps", "m^2/s")):
        if name.endswith(suf):
            return u
    return "-"


@router.get("/simulations/{sim_id}/events")
def events(sim_id: str, ctx: AppContext = Depends(get_ctx)):
    sim = mgr(ctx).get(sim_id)
    ev = sorted(sim.events + telemetry.derived_events(sim), key=lambda e: e["t_s"])
    return {"events": ev}


@router.websocket("/simulations/{sim_id}/stream")
async def stream(ws: WebSocket, sim_id: str):
    """Real-time playback: client sends {"action": "play"|"pause"|"seek"|"speed", ...}; server pushes state messages."""
    await ws.accept()
    ctx: AppContext = ws.app.state.ctx
    try:
        sim = mgr(ctx).get(sim_id)
    except NotFoundError:
        await ws.send_json({"error": "not_found"}); await ws.close(); return
    playing, speed, t = False, 1.0, 0.0
    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=0.1)
                act = msg.get("action")
                if act == "play": playing = True
                elif act == "pause": playing = False
                elif act == "speed": speed = float(msg.get("speed", 1.0))
                elif act == "seek": t = float(msg.get("t_s", 0.0))
            except asyncio.TimeoutError:
                pass
            if playing:
                t = min(t + 0.1 * speed, sim.t_now)
                if t >= sim.t_now: playing = False
            await ws.send_json({"type": "state", "playing": playing, "speed": speed, **state_at(sim, t)})
    except WebSocketDisconnect:
        return

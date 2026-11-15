"""Registry/persistence of orbital simulations (memory cache + SQLite + npz sample files)."""
from __future__ import annotations

import threading
from dataclasses import asdict

import numpy as np

from ..core.errors import NotFoundError
from ..db import models as M
from .model import SimConfig, config_from_dict
from .simulation import Simulation


class OrbitalManager:
    def __init__(self, ctx):
        self.ctx = ctx
        self.sims: dict[str, Simulation] = {}
        self.locks: dict[str, threading.RLock] = {}
        self._glock = threading.Lock()

    # surface height callback bound to the installed real DEMs (never synthetic unless it is the only one? -> never)
    def surface_height(self, lat: float, lon: float):
        from ..core.errors import GeoMoonError
        try:
            info = self.ctx.registry.find_covering(lat, lon)
            v = self.ctx.data.elevation_at(info.id, lat, lon)
            return float(v) if np.isfinite(v) else None
        except GeoMoonError:
            return None

    def lock(self, sim_id: str) -> threading.RLock:
        with self._glock:
            return self.locks.setdefault(sim_id, threading.RLock())

    def _npz(self, sim_id: str):
        return self.ctx.storage_path("orbital", f"{sim_id}.npz")

    def create(self, cfg: SimConfig) -> Simulation:
        sim = Simulation(cfg, self.surface_height)
        self.sims[sim.id] = sim
        self.save(sim)
        return sim

    def save(self, sim: Simulation) -> None:
        a = sim.arrays()
        np.savez_compressed(self._npz(sim.id), t=a["t"], y=np.asarray(sim.y), thrust=a["thrust"], throttle=a["throttle"])
        with self.ctx.SessionLocal() as db:
            row = db.get(M.OrbitalSimulation, sim.id) or M.OrbitalSimulation(id=sim.id, name=sim.cfg.name, config={})
            row.name, row.config, row.status, row.t_now_s, row.events = sim.cfg.name, sim.cfg.to_dict(), sim.status, sim.t_now, sim.events
            db.add(row); db.commit()

    def get(self, sim_id: str) -> Simulation:
        if sim_id in self.sims:
            return self.sims[sim_id]
        with self.ctx.SessionLocal() as db:
            row = db.get(M.OrbitalSimulation, sim_id)
            if row is None:
                raise NotFoundError(f"Orbital simulation '{sim_id}' not found")
            cfg = config_from_dict(row.config)
            sim = Simulation(cfg, self.surface_height, sim_id=row.id)
            p = self._npz(sim_id)
            if p.exists():
                z = np.load(p)
                sim.t, sim.y = z["t"].tolist(), [r.copy() for r in z["y"]]
                sim.thrust, sim.throttle = z["thrust"].tolist(), z["throttle"].tolist()
            sim.events, sim.status = list(row.events or []), row.status
            sim._active_ids = {e["command"] for e in sim.events if e["type"] == "burn_start"} - {e["command"] for e in sim.events if e["type"] == "burn_end"}
            self.sims[sim_id] = sim
            return sim

    def list(self) -> list[dict]:
        with self.ctx.SessionLocal() as db:
            rows = db.query(M.OrbitalSimulation).order_by(M.OrbitalSimulation.updated_at.desc()).all()
            return [{"id": r.id, "name": r.name, "status": r.status, "t_now_s": r.t_now_s,
                     "mission": (r.config or {}).get("mission", {}).get("kind"), "updated_at": r.updated_at.isoformat() if r.updated_at else None} for r in rows]

    def delete(self, sim_id: str) -> None:
        self.sims.pop(sim_id, None)
        with self.ctx.SessionLocal() as db:
            row = db.get(M.OrbitalSimulation, sim_id)
            if row is None:
                raise NotFoundError(f"Orbital simulation '{sim_id}' not found")
            db.delete(row); db.commit()
        p = self._npz(sim_id)
        if p.exists():
            p.unlink()

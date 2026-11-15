"""Orbital simulation engine: incremental propagation of one vehicle in the Earth-Moon(-Sun) system.

The sample arrays are the single source of truth read by the 2D map, the 3D scene, telemetry and graphs.
Control during a run: ``control()`` truncates the history after the requested time (events before it are kept),
integrates exactly to that time, appends the command and the caller re-runs to the horizon.
"""
from __future__ import annotations

import math
import uuid
from typing import Callable

import numpy as np
from scipy.integrate import solve_ivp

from ..core.errors import ValidationFailure
from .constants import G0, MOON_SOI_M, MU_EARTH, MU_MOON, OMEGA_EARTH, R_EARTH, R_MOON
from .dynamics import Dynamics, elements_to_state, thrust_direction
from .ephemeris import Ephemeris
from .model import Command, SimConfig

MAX_SAMPLES = 600_000
SurfaceFn = Callable[[float, float], "float | None"]


def lunar_fixed_state(eph: Ephemeris, t: float, r):
    """Inertial position -> (Moon-fixed relative vector, lat_deg, lon_deg, radius_m)."""
    rel = eph.moon_axes(t) @ (np.asarray(r) - eph.moon_pos(t))
    rad = float(np.linalg.norm(rel))
    return rel, math.degrees(math.asin(max(-1, min(1, rel[2] / rad)))), math.degrees(math.atan2(rel[1], rel[0])), rad


def moon_angular_velocity(eph: Ephemeris, t: float):
    rm, vm = eph.moon_pos(t), eph.moon_vel(t)
    return np.cross(rm, vm) / float(np.dot(rm, rm))


class Simulation:
    def __init__(self, cfg: SimConfig, surface_height: SurfaceFn | None = None, sim_id: str | None = None):
        self.id = sim_id or uuid.uuid4().hex[:12]
        self.cfg = cfg
        self.eph = Ephemeris(cfg.options.epoch_iso)
        o = cfg.options
        self.dyn = Dynamics(self.eph, include_moon=o.include_moon, include_sun=o.include_sun, include_j2=o.include_earth_j2,
                            include_drag=o.include_drag, cd=cfg.vehicle.drag_cd, area=cfg.vehicle.drag_area_m2)
        self.surface_height = surface_height
        self.fmax = cfg.vehicle.thrust_max()
        self.isp = cfg.vehicle.isp_eff()
        self.status = "ready"      # ready | completed | landed | impact | failed
        self.events: list[dict] = []
        self.t: list[float] = []
        self.y: list[np.ndarray] = []
        self.thrust: list[float] = []
        self.throttle: list[float] = []
        self._ncmd = 0
        for c in cfg.commands:
            self._ensure_id(c)
        self.reset()

    # ----------------------------------------------------------------------------------------------- state setup
    def _ensure_id(self, c: Command) -> None:
        if not c.id:
            self._ncmd += 1
            c.id = f"cmd{self._ncmd}"

    def initial_vector(self) -> np.ndarray:
        i, eph = self.cfg.initial, self.eph
        if i.kind == "cartesian":
            r, v = np.array(i.r_m, float), np.array(i.v_mps, float)
        elif i.kind == "earth_orbit":
            ra = None if i.apoapsis_alt_m is None else R_EARTH + i.apoapsis_alt_m
            r, v = elements_to_state(MU_EARTH, R_EARTH + i.periapsis_alt_m, ra, i.inclination_deg, i.raan_deg,
                                     i.arg_periapsis_deg, i.true_anomaly_deg)
        elif i.kind == "moon_orbit":
            ra = None if i.apoapsis_alt_m is None else R_MOON + i.apoapsis_alt_m
            r, v = elements_to_state(MU_MOON, R_MOON + i.periapsis_alt_m, ra, i.inclination_deg, i.raan_deg,
                                     i.arg_periapsis_deg, i.true_anomaly_deg)
            r, v = r + eph.moon_pos(0.0), v + eph.moon_vel(0.0)
        else:  # lat_lon_surface
            la, lo = math.radians(i.lat_deg), math.radians(i.lon_deg)
            if i.body == "earth":
                rad = R_EARTH + i.altitude_m
                ecef = rad * np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
                r = eph.eci_to_ecef(0.0).T @ ecef
                v = np.cross([0, 0, OMEGA_EARTH], r)
            else:
                h0 = self.surface_height(i.lat_deg, i.lon_deg) if self.surface_height else None
                rad = R_MOON + (h0 or 0.0) + i.altitude_m
                rel_f = rad * np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
                rel = eph.moon_axes(0.0).T @ rel_f
                r = eph.moon_pos(0.0) + rel
                v = eph.moon_vel(0.0) + np.cross(moon_angular_velocity(eph, 0.0), rel)
        return np.concatenate([r, v, [self.cfg.vehicle.fuel_mass_kg]])

    def reset(self) -> None:
        self.events = []
        self.status = "ready"
        y0 = self.initial_vector()
        self.t, self.y, self.thrust, self.throttle = [0.0], [y0], [0.0], [0.0]
        r = y0[:3]
        if np.linalg.norm(r) < R_EARTH - 1.0:
            raise ValidationFailure("Initial position is inside the Earth")
        if np.linalg.norm(r - self.eph.moon_pos(0.0)) < R_MOON - 1.0:
            raise ValidationFailure("Initial position is inside the Moon")
        self._active_ids: set[str] = set()

    # ----------------------------------------------------------------------------------------------- commands
    def active_command(self, t: float, eps: float = 1e-9) -> Command | None:
        best = None
        for c in self.cfg.commands:
            if c.delta_v_mps is not None:
                continue
            end = math.inf if c.duration_s is None else c.t_start_s + c.duration_s
            if c.t_start_s - eps <= t < end - eps and (best is None or c.t_start_s >= best.t_start_s):
                best = c
        return best

    def next_boundary(self, t: float) -> float:
        b = math.inf
        for c in self.cfg.commands:
            for x in (c.t_start_s, math.inf if (c.duration_s is None or c.delta_v_mps is not None) else c.t_start_s + c.duration_s):
                if x > t + 1e-9:
                    b = min(b, x)
        return b

    @property
    def t_now(self) -> float:
        return self.t[-1]

    def _mass(self, fuel: float) -> float:
        return self.cfg.vehicle.dry_mass_kg + max(fuel, 0.0)

    # ----------------------------------------------------------------------------------------------- propagation
    def _make_rhs(self, cmd: Command | None):
        throttle = cmd.throttle if cmd and self.fmax > 0 else 0.0
        eph, dyn, dry = self.eph, self.dyn, self.cfg.vehicle.dry_mass_kg

        def rhs(t, y):
            r, v, fuel = y[:3], y[3:6], y[6]
            m = dry + max(fuel, 0.0)
            if throttle > 0 and fuel > 0:
                if cmd.auto_throttle and cmd.direction == "surface_retro":
                    u, thr = self._surface_guidance(t, r, v, m)
                else:
                    thr = throttle
                    u = thrust_direction(cmd.direction, cmd.reference, cmd.vector, t, r, v, eph)
                F = thr * self.fmax
                a = dyn.accel(t, r, v, F * u, m)
                return np.concatenate([v, a, [-F / (self.isp * G0)]])
            return np.concatenate([v, dyn.accel(t, r, v, None, m), [0.0]])
        return rhs, throttle

    def _surface_guidance(self, t, r, v, m):
        """Educational powered-descent guidance (no terrain, no attitude dynamics): brake the surface-relative
        horizontal speed at max available deceleration while holding a commanded vertical-rate profile
        (vr_des = -clip(0.04 h, 1, 40) m/s) and supporting gravity minus centrifugal acceleration.
        Returns (unit thrust vector, throttle)."""
        eph = self.eph
        rm = eph.moon_pos(t)
        rel = r - rm
        d = float(np.linalg.norm(rel))
        rhat = rel / d
        h = max(d - R_MOON, 0.0)
        vrel = v - eph.moon_vel(t) - np.cross(moon_angular_velocity(eph, t), rel)
        vr = float(np.dot(vrel, rhat))
        vhv = vrel - vr * rhat
        vh = float(np.linalg.norm(vhv))
        hhat = vhv / vh if vh > 1e-6 else np.zeros(3)
        g = MU_MOON / d**2
        a_max = self.fmax / m
        vr_des = -min(40.0, max(1.0, 0.04 * h))
        a_up = max(0.0, g - vh * vh / d + 0.2 * (vr_des - vr))
        a_h = min(vh / 5.0, a_max)
        if a_up >= a_max:
            a_up, a_h = a_max, 0.0
        else:
            a_h = min(a_h, math.sqrt(a_max**2 - a_up**2))
        vec = a_up * rhat - a_h * hhat
        A = float(np.linalg.norm(vec))
        if A < 1e-9:
            return rhat, 0.0
        return vec / A, float(min(1.0, A / a_max))

    def _event_funcs(self, throttle):
        eph = self.eph
        opts = self.cfg.options

        def earth(t, y):
            return float(np.linalg.norm(y[:3])) - R_EARTH
        earth.terminal, earth.direction = True, -1

        def moon(t, y):
            d = float(np.linalg.norm(y[:3] - eph.moon_pos(t)))
            hs = 0.0
            if opts.use_dem_collision and self.surface_height and d < R_MOON + 30_000.0:
                _, la, lo, _ = lunar_fixed_state(eph, t, y[:3])
                hs = self.surface_height(la, lo) or 0.0
            return d - (R_MOON + hs)
        moon.terminal, moon.direction = True, -1

        def soi(t, y):
            return float(np.linalg.norm(y[:3] - eph.moon_pos(t))) - MOON_SOI_M
        soi.terminal, soi.direction = False, 0
        fl = [earth, moon, soi] if opts.stop_on_collision else [soi]
        if throttle > 0:
            def fuel(t, y):
                return y[6] - 1e-6
            fuel.terminal, fuel.direction = True, -1
            fl.append(fuel)
        return fl

    def _event_names(self, throttle):
        return (["earth", "moon", "soi"] if self.cfg.options.stop_on_collision else ["soi"]) + (["fuel"] if throttle > 0 else [])

    def _dt_out(self, y, t) -> float:
        o = self.cfg.options
        if o.sample_dt_s:
            return o.sample_dt_s
        r = y[:3]
        rm = self.eph.moon_pos(t)
        dm, de = float(np.linalg.norm(r - rm)), float(np.linalg.norm(r))
        rad, mu = (dm, MU_MOON) if dm < MOON_SOI_M else (de, MU_EARTH)
        period = 2 * math.pi * math.sqrt(rad**3 / mu)
        return float(min(o.sample_dt_max_s, max(1.0, period / 240.0)))

    def advance(self, until: float) -> None:
        if self.status in ("landed", "impact", "failed"):
            return
        until = float(until)
        guard = 0
        while self.t_now < until - 1e-9 and self.status == "ready":
            guard += 1
            if guard > 100000:
                raise ValidationFailure("Propagation did not converge (too many segments)")
            if len(self.t) > MAX_SAMPLES:
                raise ValidationFailure("Sample budget exceeded; increase sample_dt_s or shorten the run")
            self._apply_impulses()
            t0, y0 = self.t_now, self.y[-1]
            cmd = self.active_command(t0)
            rhs, throttle = self._make_rhs(cmd)
            if throttle > 0 and y0[6] <= 1e-6:
                throttle = 0.0
                rhs, _ = self._make_rhs(None)
            seg_end = min(until, self.next_boundary(t0))
            dt = self._dt_out(y0, t0)
            chunk_end = min(seg_end, t0 + 400.0 * dt)
            grid = list(np.arange(t0 + dt, chunk_end - 1e-9, dt)) + [chunk_end]
            self._begin_command_events(cmd, t0)
            self._integrate_chunk(rhs, throttle, t0, y0, grid, cmd)
        if self.status == "ready" and self.t_now >= self.cfg.mission.duration_s - 1e-6 and until >= self.cfg.mission.duration_s - 1e-6:
            self.status = "completed"

    def _apply_impulses(self) -> None:
        done = {e["command"] for e in self.events if e["type"] == "impulse"}
        for c in self.cfg.commands:
            if c.delta_v_mps is None or c.id in done or c.t_start_s > self.t_now + 1e-6 or c.t_start_s < self.t_now - 1e-6:
                continue
            y = self.y[-1].copy()
            t = self.t_now
            u = thrust_direction(c.direction, c.reference, c.vector, t, y[:3], y[3:6], self.eph)
            dv = float(c.delta_v_mps)
            m0 = self._mass(float(y[6]))
            if self.isp <= 0:
                self.events.append({"t_s": t, "type": "impulse_rejected", "command": c.id, "details": {"reason": "no engine"}})
                continue
            dfuel = m0 * (1 - math.exp(-abs(dv) / (self.isp * G0)))
            if dfuel > y[6]:   # not enough propellant: scale the manoeuvre down and say so
                dv_eff = self.isp * G0 * math.log(m0 / (m0 - y[6])) * math.copysign(1, dv)
                self.events.append({"t_s": t, "type": "impulse_limited", "command": c.id,
                                    "details": {"requested_mps": dv, "applied_mps": dv_eff, "reason": "insufficient propellant"}})
                dv, dfuel = dv_eff, float(y[6])
            y[3:6] += dv * u
            y[6] -= dfuel
            self.y[-1] = y
            self.events.append({"t_s": t, "type": "impulse", "command": c.id,
                                "details": {"delta_v_mps": dv, "direction": c.direction, "fuel_used_kg": dfuel, "source": c.source}})

    def _begin_command_events(self, cmd: Command | None, t0: float) -> None:
        ids = {cmd.id} if cmd and cmd.throttle > 0 and self.fmax > 0 else set()
        for cid in ids - self._active_ids:
            self.events.append({"t_s": t0, "type": "burn_start", "command": cid, "details": {"direction": cmd.direction, "throttle": cmd.throttle, "source": cmd.source}})
        for cid in self._active_ids - ids:
            self.events.append({"t_s": t0, "type": "burn_end", "command": cid, "details": {}})
        self._active_ids = ids

    def _push(self, t, y, throttle):
        self.t.append(float(t)); self.y.append(np.asarray(y, float).copy())
        thr = throttle if y[6] > 1e-6 else 0.0
        self.throttle.append(thr); self.thrust.append(thr * self.fmax)

    def _integrate_chunk(self, rhs, throttle, t0, y0, grid, cmd) -> None:
        o = self.cfg.options
        evs = self._event_funcs(throttle)
        if o.integrator == "RK4":
            self._rk4_chunk(rhs, throttle, t0, y0, grid, evs)
            return
        sol = solve_ivp(rhs, (t0, grid[-1]), y0, method=o.integrator, t_eval=grid, events=evs, rtol=o.rtol,
                        atol=np.array([1e-3] * 3 + [1e-6] * 3 + [1e-6]), max_step=o.max_step_s)
        if not sol.success:
            self.status = "failed"
            self.events.append({"t_s": t0, "type": "integration_failed", "details": {"message": sol.message}})
            return
        for k in range(len(sol.t)):
            self._push(sol.t[k], sol.y[:, k], throttle)
        names = self._event_names(throttle)
        hit = None
        for n, te, ye in zip(names, sol.t_events, sol.y_events):
            for tt, yy in zip(te, ye):
                if n == "soi":
                    self.events.append({"t_s": float(tt), "type": "moon_soi_entry" if np.linalg.norm(yy[:3] - self.eph.moon_pos(tt)) < MOON_SOI_M + 1e3 and self._soi_inward(tt, yy) else "moon_soi_exit", "details": {}})
                elif hit is None or tt < hit[1]:
                    hit = (n, float(tt), yy)
        if hit:
            self._handle_terminal(*hit, throttle)

    def _soi_inward(self, t, y) -> bool:
        rel_v = y[3:6] - self.eph.moon_vel(t)
        return float(np.dot(y[:3] - self.eph.moon_pos(t), rel_v)) < 0

    def _rk4_chunk(self, rhs, throttle, t0, y0, grid, evs) -> None:
        t, y = t0, y0.copy()
        hmax = self.cfg.options.max_step_s
        for tg in grid:
            n = max(1, int(math.ceil((tg - t) / hmax)))
            h = (tg - t) / n
            for _ in range(n):
                k1 = rhs(t, y); k2 = rhs(t + h / 2, y + h / 2 * k1); k3 = rhs(t + h / 2, y + h / 2 * k2); k4 = rhs(t + h, y + h * k3)
                yn = y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
                for f, nm in zip(evs, self._event_names(throttle)):
                    g0, g1 = f(t, y), f(t + h, yn)
                    if g0 > 0 >= g1 and nm != "soi":
                        s = g0 / (g0 - g1)
                        self._push(t + s * h, y + s * (yn - y), throttle)
                        self._handle_terminal(nm, t + s * h, y + s * (yn - y), throttle)
                        return
                    if nm == "soi" and g0 * g1 < 0:
                        self.events.append({"t_s": t + h / 2, "type": "moon_soi_entry" if g1 < 0 else "moon_soi_exit", "details": {}})
                t, y = t + h, yn
            self._push(t, y, throttle)

    def _handle_terminal(self, name: str, t: float, y: np.ndarray, throttle: float) -> None:
        if not self.t or abs(self.t[-1] - t) > 1e-9:
            self._push(t, y, throttle)
        if name == "fuel":
            y2 = self.y[-1].copy(); y2[6] = 0.0
            self.y[-1] = y2; self.thrust[-1] = 0.0; self.throttle[-1] = 0.0
            self.events.append({"t_s": t, "type": "fuel_exhausted", "details": {"mass_kg": self._mass(0.0)}})
            self._active_ids = set()
            return
        eph = self.eph
        r, v = y[:3], y[3:6]
        if name == "earth":
            vrel = v - np.cross([0, 0, OMEGA_EARTH], r)
            lat = math.degrees(math.asin(r[2] / np.linalg.norm(r)))
            lon = math.degrees(math.atan2(*(eph.eci_to_ecef(t) @ r)[1::-1]))
            sp = float(np.linalg.norm(vrel))
            kind, body = "earth_impact", "earth"
        else:
            rel, lat, lon, _ = lunar_fixed_state(eph, t, r)
            vrel = v - eph.moon_vel(t) - np.cross(moon_angular_velocity(eph, t), r - eph.moon_pos(t))
            sp = float(np.linalg.norm(vrel))
            kind, body = "moon_contact", "moon"
        soft = sp <= self.cfg.options.max_landing_speed_mps
        self.events.append({"t_s": t, "type": kind, "details": {
            "body": body, "lat_deg": lat, "lon_deg": lon, "speed_mps": sp,
            "classification": "contact_speed_below_threshold" if soft else "high_speed_impact",
            "threshold_mps": self.cfg.options.max_landing_speed_mps,
            "note": "Point-mass contact detection against a spherical/DEM surface; not a landing-safety assessment."}})
        self.status = "landed" if soft else "impact"

    # ----------------------------------------------------------------------------------------------- control / seek
    def truncate(self, t_cut: float) -> float:
        """Drop everything after the last sample with t <= t_cut; returns the new current time."""
        ts = np.asarray(self.t)
        idx = int(np.searchsorted(ts, t_cut + 1e-9, side="right")) - 1
        idx = max(idx, 0)
        keep = self.t[idx]
        del self.t[idx + 1:], self.y[idx + 1:], self.thrust[idx + 1:], self.throttle[idx + 1:]
        self.events = [e for e in self.events if e["t_s"] <= keep + 1e-9]
        self.status = "ready"
        self._active_ids = set(e["command"] for e in self.events if e["type"] == "burn_start") - set(e["command"] for e in self.events if e["type"] == "burn_end")
        return keep

    def control(self, command: Command, horizon_s: float | None = None) -> Command:
        """Insert a command at ``command.t_start_s``; history before that time is kept, the future re-integrated."""
        t_req = command.t_start_s
        horizon = horizon_s if horizon_s is not None else max(self.t_now, t_req)
        if t_req < self.t_now:
            self.truncate(t_req)
        self.advance(t_req)  # land exactly on the command time with the existing program
        # a command replacing the run: drop later program commands the user overrides? keep them (explicit semantics).
        command.t_start_s = self.t_now if self.status != "ready" else t_req
        self._ensure_id(command)
        if command.source == "manual":
            # a manual command cancels earlier open-ended commands (e.g. "cut engines")
            for c in self.cfg.commands:
                if c.duration_s is None and c.t_start_s < command.t_start_s and c.source == "manual":
                    c.duration_s = command.t_start_s - c.t_start_s
        self.cfg.commands.append(command)
        self.events.append({"t_s": command.t_start_s, "type": "control_change", "command": command.id,
                            "details": {"throttle": command.throttle, "direction": command.direction, "source": command.source}})
        self.advance(horizon)
        return command

    # ----------------------------------------------------------------------------------------------- views
    def arrays(self) -> dict[str, np.ndarray]:
        y = np.asarray(self.y)
        return {"t": np.asarray(self.t), "r": y[:, :3], "v": y[:, 3:6], "fuel": y[:, 6],
                "thrust": np.asarray(self.thrust), "throttle": np.asarray(self.throttle)}

    def final_state(self) -> dict:
        y = self.y[-1]
        return {"t_s": self.t_now, "r": y[:3].tolist(), "v": y[3:6].tolist(), "fuel_kg": float(y[6]),
                "mass_kg": self._mass(float(y[6]))}

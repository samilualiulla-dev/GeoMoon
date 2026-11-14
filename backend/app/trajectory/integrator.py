"""Numerical integration with terminal events.

Two methods share one interface:
  * ``dop853``: SciPy adaptive 8th-order Dormand-Prince (dense output, root-finding events).
  * ``rk4``    : classical fixed-step 4th-order Runge-Kutta; events located by linear interpolation
                 of the event function inside the step.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np
from scipy.integrate import solve_ivp

Rhs = Callable[[float, np.ndarray], np.ndarray]
Event = Callable[[float, np.ndarray], float]  # terminal when crossing zero (decreasing)


def rk4_step(f: Rhs, t: float, y: np.ndarray, h: float) -> np.ndarray:
    k1 = f(t, y)
    k2 = f(t + h / 2, y + h / 2 * k1)
    k3 = f(t + h / 2, y + h / 2 * k2)
    k4 = f(t + h, y + h * k3)
    return y + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4)


@dataclass
class PhaseResult:
    t: np.ndarray
    y: np.ndarray            # shape (n, len(y0))
    event_index: int | None  # index into ``events`` that terminated the phase, or None
    t_end: float


def integrate_phase(f: Rhs, t0: float, y0: np.ndarray, t1: float, events: Sequence[Event], *,
                    method: str, dt_out: float, rk4_step_s: float = 0.05,
                    rtol: float = 1e-9, atol: float = 1e-6) -> PhaseResult:
    """Integrate from t0 to t1 or the first terminal event. Samples are on the ``dt_out`` grid
    (anchored at t=0) plus the end point."""
    if t1 <= t0:
        return PhaseResult(np.array([t0]), y0[None, :], None, t0)
    if method == "rk4":
        return _rk4_phase(f, t0, y0, t1, events, rk4_step_s)
    evs = []
    for e in events:
        def mk(e=e):
            def g(t, y): return e(t, y)
            g.terminal = True; g.direction = -1
            return g
        evs.append(mk())
    sol = solve_ivp(f, (t0, t1), y0, method="DOP853", events=evs or None, dense_output=True, rtol=rtol, atol=atol)
    if not sol.success:
        raise RuntimeError(f"integrator failed: {sol.message}")
    ev_idx = None
    for i, te in enumerate(sol.t_events or []):
        if len(te):
            ev_idx = i
    t_end = float(sol.t[-1])
    grid = np.arange(np.ceil(t0 / dt_out) * dt_out, t_end, dt_out)
    ts = np.unique(np.concatenate([[t0], grid[grid > t0], [t_end]]))
    ys = sol.sol(ts).T
    ys[-1] = sol.y[:, -1]
    return PhaseResult(ts, ys, ev_idx, t_end)


def _rk4_phase(f, t0, y0, t1, events, h) -> PhaseResult:
    ts, ys = [t0], [y0.copy()]
    t, y = t0, y0.copy()
    prev_ev = [e(t, y) for e in events]
    ev_idx = None
    while t < t1 - 1e-12:
        hs = min(h, t1 - t)
        y_new = rk4_step(f, t, y, hs)
        t_new = t + hs
        cur = [e(t_new, y_new) for e in events]
        for i, (a, b) in enumerate(zip(prev_ev, cur)):
            if a > 0 >= b:  # decreasing zero crossing
                frac = a / (a - b) if a != b else 1.0
                y_new = y + frac * (y_new - y)   # linear interpolation inside the step
                t_new = t + frac * hs
                ev_idx = i
                break
        t, y, prev_ev = t_new, y_new, cur
        ts.append(t); ys.append(y.copy())
        if ev_idx is not None:
            break
    return PhaseResult(np.array(ts), np.array(ys), ev_idx, float(t))

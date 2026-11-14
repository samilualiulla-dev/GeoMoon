"""Propulsion model: constant-Isp engine cluster with throttle, fuel limit and cut-off."""
from __future__ import annotations

from ..core.constants import G0
from ..spacecraft.schemas import Engine


def mass_flow_kg_s(thrust_n: float, isp_s: float) -> float:
    """mdot = F / (Isp * g0)  (Tsiolkovsky relation)."""
    if isp_s <= 0:
        raise ValueError("Isp must be positive")
    return thrust_n / (isp_s * G0)


def thrust_and_flow(engine: Engine, throttle: float, fuel_available_kg: float) -> tuple[float, float]:
    """Return (thrust_N, mdot_kg_s) for commanded throttle.

    * throttle 0 -> engine off.
    * Lit throttle is clamped to [throttle_min, throttle_max].
    * No fuel -> zero thrust.
    """
    if throttle <= 0 or fuel_available_kg <= 0:
        return 0.0, 0.0
    th = min(max(throttle, engine.throttle_min), engine.throttle_max)
    f = engine.total_thrust_n * th
    return f, mass_flow_kg_s(f, engine.effective_isp_s)

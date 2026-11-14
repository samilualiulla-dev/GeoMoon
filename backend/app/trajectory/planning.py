"""Advisory helpers (not control laws)."""
from __future__ import annotations

from ..core.constants import MOON_MU, MOON_RADIUS_M
from ..spacecraft.schemas import SpacecraftConfig


def suggest_vertical_ignition_altitude(cfg: SpacecraftConfig, speed_m_s: float, *, initial_altitude_m: float | None = None,
                                       surface_radius_m: float = MOON_RADIUS_M, throttle: float = 1.0,
                                       margin: float = 1.05) -> dict:
    """Ignition altitude for a constant-throttle vertical burn that would reach ~zero speed at the surface.

    ``speed_m_s`` is the downward speed at ``initial_altitude_m`` (if given the speed gained while coasting down to the
    ignition altitude is accounted for: v(h)^2 = v0^2 + 2 g (H - h)); otherwise it is the speed at ignition.
    Uses constant deceleration a = F/m_start - g with m_start = total mass (conservative: mass falls as fuel burns,
    so real deceleration is slightly higher).  ``margin`` > 1 pads the altitude.  Advisory only.
    """
    g = MOON_MU / surface_radius_m ** 2
    m = cfg.total_mass_kg
    F = cfg.engine.total_thrust_n * min(throttle, cfg.engine.throttle_max)
    a = F / m - g
    if a <= 0:
        return {"feasible": False, "reason": "thrust does not exceed lunar weight at this throttle"}
    if initial_altitude_m is None:
        h, v_ign = speed_m_s ** 2 / (2 * a) * margin, speed_m_s
    else:  # h = margin*v(h)^2/(2a) with v(h)^2 = v0^2 + 2 g (H-h)  (g ~ constant) -> linear in h
        k = margin / (2 * a)
        h = k * (speed_m_s ** 2 + 2 * g * initial_altitude_m) / (1 + 2 * g * k)
        h = min(h, initial_altitude_m)
        v_ign = (speed_m_s ** 2 + 2 * g * (initial_altitude_m - h)) ** 0.5
    burn_time = v_ign / a
    from ..core.constants import G0
    fuel = F / (cfg.engine.effective_isp_s * G0) * burn_time
    return {"feasible": fuel <= cfg.fuel_mass_kg, "ignition_altitude_m": h, "constant_decel_m_s2": a,
            "speed_at_ignition_m_s": v_ign, "burn_time_s": burn_time, "fuel_needed_kg": fuel, "fuel_available_kg": cfg.fuel_mass_kg, "margin": margin,
            "note": "Vertical-descent, constant-deceleration estimate; advisory only."}

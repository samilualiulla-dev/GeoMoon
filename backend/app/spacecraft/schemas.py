"""Spacecraft Configuration Engine: validated models (SI units: kg, m, s, N, deg)."""
from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..core.constants import G0, MOON_SURFACE_GRAVITY


class Dimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    length_m: float = Field(gt=0, le=100)
    width_m: float = Field(gt=0, le=100)
    height_m: float = Field(gt=0, le=100)


class LandingGear(BaseModel):
    model_config = ConfigDict(extra="forbid")
    span_m: float = Field(gt=0, le=100, description="Diameter of the circle through the landing pads")
    pad_diameter_m: float = Field(default=0.3, gt=0, le=10)
    gear_height_m: float = Field(default=0.5, ge=0, le=20, description="Hull clearance above ground when landed")
    cg_height_m: float | None = Field(default=None, gt=0, le=50, description="Centre-of-gravity height above pads; default = gear_height + height/2")


class Engine(BaseModel):
    """Propulsion system. Provide ``isp_s`` and/or ``fuel_consumption_kg_s`` (total, all engines, full throttle)."""
    model_config = ConfigDict(extra="forbid")
    thrust_n: float = Field(gt=0, le=1e8, description="Thrust PER ENGINE at full throttle (vacuum)")
    number_of_engines: int = Field(default=1, ge=1, le=64)
    isp_s: float | None = Field(default=None, gt=0, le=1000)
    fuel_consumption_kg_s: float | None = Field(default=None, gt=0, description="Total mass flow, all engines, 100% throttle")
    throttle_min: float = Field(default=0.0, ge=0, le=1, description="Lowest throttle while engine is lit")
    throttle_max: float = Field(default=1.0, gt=0, le=1)

    @model_validator(mode="after")
    def _check(self):
        if self.isp_s is None and self.fuel_consumption_kg_s is None:
            raise ValueError("Provide isp_s or fuel_consumption_kg_s")
        if self.throttle_min > self.throttle_max:
            raise ValueError("throttle_min must be <= throttle_max")
        if self.isp_s and self.fuel_consumption_kg_s:
            implied = self.total_thrust_n / (self.fuel_consumption_kg_s * G0)
            if abs(implied - self.isp_s) / self.isp_s > 0.05:
                raise ValueError(f"isp_s={self.isp_s} inconsistent with thrust/(mdot*g0)={implied:.1f}s (>5%)")
        return self

    @property
    def total_thrust_n(self) -> float:
        return self.thrust_n * self.number_of_engines

    @property
    def effective_isp_s(self) -> float:
        return self.isp_s if self.isp_s else self.total_thrust_n / (self.fuel_consumption_kg_s * G0)


class LandingConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_vertical_touchdown_speed_m_s: float = Field(default=2.0, gt=0, le=100)
    max_horizontal_touchdown_speed_m_s: float = Field(default=1.0, ge=0, le=100)
    max_tilt_deg: float | None = Field(default=None, gt=0, lt=90, description="Max terrain slope at footprint; default = static tipping limit from gear geometry")
    max_acceleration_m_s2: float | None = Field(default=None, gt=0, description="Structural / crew acceleration limit")
    max_distance_to_target_m: float = Field(default=100.0, gt=0, description="Allowed touchdown miss distance")


class SpacecraftConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    dry_mass_kg: float = Field(gt=0, le=1e7)
    fuel_mass_kg: float = Field(ge=0, le=1e7)
    dimensions: Dimensions
    landing_gear: LandingGear
    engine: Engine
    constraints: LandingConstraints = Field(default_factory=LandingConstraints)

    @property
    def total_mass_kg(self) -> float:
        return self.dry_mass_kg + self.fuel_mass_kg

    @model_validator(mode="after")
    def _physics(self):
        if self.landing_gear.span_m < self.dimensions.width_m * 0.5:
            raise ValueError("landing_gear.span_m is implausibly small compared to hull width")
        if self.engine.throttle_max * self.engine.total_thrust_n <= 0:
            raise ValueError("engine produces no thrust")
        return self

    # ---- derived quantities -------------------------------------------------
    @property
    def cg_height_m(self) -> float:
        g = self.landing_gear
        return g.cg_height_m or (g.gear_height_m + self.dimensions.height_m / 2)

    @property
    def tipping_angle_deg(self) -> float:
        """Static tip-over slope: atan(half gear span / CG height)."""
        return math.degrees(math.atan((self.landing_gear.span_m / 2) / self.cg_height_m))

    @property
    def max_tilt_deg(self) -> float:
        return self.constraints.max_tilt_deg or self.tipping_angle_deg

    @property
    def footprint_radius_m(self) -> float:
        return self.landing_gear.span_m / 2 + self.landing_gear.pad_diameter_m / 2

    def derived(self) -> dict:
        e = self.engine
        w_moon = self.total_mass_kg * MOON_SURFACE_GRAVITY
        mdot = e.total_thrust_n / (e.effective_isp_s * G0)
        return {
            "total_mass_kg": self.total_mass_kg,
            "thrust_to_weight_lunar_surface": e.total_thrust_n * e.throttle_max / w_moon,
            "effective_isp_s": e.effective_isp_s,
            "mass_flow_full_throttle_kg_s": mdot,
            "max_burn_time_s": self.fuel_mass_kg / mdot if mdot else None,
            "delta_v_ideal_m_s": e.effective_isp_s * G0 * math.log(self.total_mass_kg / self.dry_mass_kg),
            "footprint_radius_m": self.footprint_radius_m,
            "tipping_angle_deg": self.tipping_angle_deg,
            "max_tilt_deg_used": self.max_tilt_deg,
        }

    def warnings(self) -> list[str]:
        d, w = self.derived(), []
        if d["thrust_to_weight_lunar_surface"] < 1.0:
            w.append(f"Thrust-to-weight at lunar gravity is {d['thrust_to_weight_lunar_surface']:.2f} < 1: the vehicle cannot hover or arrest descent against gravity.")
        if self.fuel_mass_kg == 0:
            w.append("fuel_mass_kg is 0: unpowered ballistic descent.")
        return w


# ---------------------------------------------------------------------------------------------
class BurnPlan(BaseModel):
    """OPEN-LOOP thrust scenario (not a guidance/control law)."""
    model_config = ConfigDict(extra="forbid")
    mode: Literal["none", "altitude", "time", "schedule"] = "none"
    ignition_altitude_m: float | None = Field(default=None, gt=0, description="mode=altitude: light engine when altitude above surface <= value")
    ignition_time_s: float | None = Field(default=None, ge=0, description="mode=time: ignition time since start")
    throttle: float = Field(default=1.0, ge=0, le=1)
    direction: Literal["retrograde", "radial_up", "fixed_enu"] = "retrograde"
    fixed_enu: tuple[float, float, float] | None = Field(default=None, description="direction=fixed_enu: thrust unit vector in start-point ENU")
    cutoff_speed_m_s: float | None = Field(default=None, ge=0, description="Shut engine off when surface-relative speed falls below this")
    throttle_schedule: list[tuple[float, float]] | None = Field(default=None, description="mode=schedule: [(t_s, throttle), ...] piecewise-constant, sorted by t")

    @model_validator(mode="after")
    def _check(self):
        if self.mode == "altitude" and self.ignition_altitude_m is None:
            raise ValueError("ignition_altitude_m required for mode=altitude")
        if self.mode == "time" and self.ignition_time_s is None:
            raise ValueError("ignition_time_s required for mode=time")
        if self.mode == "schedule":
            s = self.throttle_schedule
            if not s:
                raise ValueError("throttle_schedule required for mode=schedule")
            ts = [t for t, _ in s]
            if ts != sorted(ts) or len(set(ts)) != len(ts):
                raise ValueError("throttle_schedule times must be strictly increasing")
            if any(not 0 <= th <= 1 or t < 0 for t, th in s):
                raise ValueError("schedule entries need t>=0 and 0<=throttle<=1")
        if self.direction == "fixed_enu":
            if not self.fixed_enu or math.sqrt(sum(c * c for c in self.fixed_enu)) < 1e-9:
                raise ValueError("fixed_enu needs a non-zero vector")
        return self


class InitialConditions(BaseModel):
    """Initial state, specified relative to the lunar surface at a chosen target point."""
    model_config = ConfigDict(extra="forbid")
    target_latitude_deg: float = Field(ge=-90, le=90)
    target_longitude_deg: float = Field(ge=-180, le=360)
    initial_altitude_m: float = Field(gt=0, le=5e6, description="Height above the local surface at the start point")
    initial_speed_m_s: float = Field(ge=0, le=5000, description="Surface-relative speed")
    azimuth_deg: float = Field(default=0.0, ge=-360, le=360, description="Horizontal direction of motion, clockwise from north")
    flight_path_angle_deg: float = Field(default=-90.0, ge=-90, le=90, description="-90 = straight down, 0 = horizontal, + = climbing")
    initial_downrange_m: float = Field(default=0.0, ge=0, le=1e7, description="Start offset behind the target along -azimuth (ground distance)")
    burn: BurnPlan = Field(default_factory=BurnPlan)


class SimSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    integrator: Literal["dop853", "rk4"] = "dop853"
    output_dt_s: float = Field(default=1.0, gt=0, le=600, description="Time-series sampling step")
    rk4_step_s: float = Field(default=0.05, gt=0, le=10, description="Fixed step for integrator=rk4")
    max_time_s: float = Field(default=3600.0, gt=0, le=86400)
    rtol: float = Field(default=1e-9, gt=0, lt=1e-2)
    atol: float = Field(default=1e-6, gt=0)
    moon_rotation: bool = True

    @model_validator(mode="after")
    def _limit_points(self):
        if self.max_time_s / self.output_dt_s > 200_000:
            raise ValueError("max_time_s/output_dt_s exceeds 200000 samples; increase output_dt_s")
        return self


def check_initial_state(cfg: SpacecraftConfig, ic: InitialConditions) -> list[str]:
    """Cross-validation of configuration vs initial conditions. Raises ValueError on impossible setups."""
    warnings = list(cfg.warnings())
    if ic.burn.mode != "none" and cfg.fuel_mass_kg == 0:
        raise ValueError("Burn plan requested but fuel_mass_kg is 0")
    e = cfg.engine
    if ic.burn.mode != "none" and 0 < ic.burn.throttle < e.throttle_min:
        raise ValueError(f"burn throttle {ic.burn.throttle} below engine throttle_min {e.throttle_min}")
    if ic.burn.throttle > e.throttle_max:
        raise ValueError(f"burn throttle {ic.burn.throttle} above engine throttle_max {e.throttle_max}")
    if ic.initial_speed_m_s == 0 and ic.flight_path_angle_deg != -90:
        warnings.append("initial speed is 0: azimuth/flight_path_angle have no effect")
    return warnings

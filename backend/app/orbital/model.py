"""Data model of an orbital simulation (plain dataclasses <-> JSON)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from ..core.errors import ValidationFailure

DIRECTIONS = ("prograde", "retrograde", "radial_out", "radial_in", "normal", "antinormal", "to_moon", "to_earth",
              "inertial", "surface_retro")
REFERENCES = ("auto", "earth", "moon")


@dataclass
class Engine:
    name: str = "Main engine"
    thrust_n: float = 0.0
    isp_s: float = 300.0


@dataclass
class Vehicle:
    name: str = "Vehicle"
    dry_mass_kg: float = 5000.0
    fuel_mass_kg: float = 20000.0
    engines: list[Engine] = field(default_factory=lambda: [Engine("Main engine", 60000.0, 340.0)])
    drag_cd: float = 2.2
    drag_area_m2: float = 10.0

    def thrust_max(self) -> float:
        return float(sum(e.thrust_n for e in self.engines))

    def isp_eff(self) -> float:
        f = self.thrust_max()
        den = sum(e.thrust_n / e.isp_s for e in self.engines if e.isp_s > 0 and e.thrust_n > 0)
        return f / den if f > 0 and den > 0 else 0.0


@dataclass
class InitialState:
    """kind: earth_orbit | moon_orbit (Keplerian by altitudes) | lat_lon_surface (stationary on a body surface)
    | cartesian (r_m, v_mps inertial, Earth-centred)."""
    kind: str = "earth_orbit"
    body: str = "earth"
    periapsis_alt_m: float = 300_000.0
    apoapsis_alt_m: float | None = None      # None -> circular
    inclination_deg: float = 28.5
    raan_deg: float = 0.0
    arg_periapsis_deg: float = 0.0
    true_anomaly_deg: float = 0.0
    lat_deg: float = 0.0
    lon_deg: float = 0.0
    altitude_m: float = 0.0
    r_m: list[float] | None = None
    v_mps: list[float] | None = None


@dataclass
class Command:
    """Engine/attitude command. Later start wins on overlap; ``duration_s=None`` -> open-ended."""
    id: str = ""
    t_start_s: float = 0.0
    duration_s: float | None = None
    throttle: float = 1.0
    direction: str = "prograde"
    reference: str = "auto"
    vector: list[float] | None = None          # for direction == "inertial"
    delta_v_mps: float | None = None           # impulsive manoeuvre (instant), approximation of a short burn
    auto_throttle: bool = False                # direction == surface_retro: throttle chosen to null surface speed at the ground
    source: str = "program"                    # program | manual | planner
    label: str = ""


@dataclass
class Mission:
    kind: str = "free_flight"   # free_flight | to_moon | lunar_orbit | lunar_flyby | approach | descent | landing
    target_altitude_m: float = 100_000.0
    target_lat_deg: float | None = None
    target_lon_deg: float | None = None
    duration_s: float = 6 * 86400.0


@dataclass
class SimOptions:
    include_moon: bool = True
    include_sun: bool = True
    include_earth_j2: bool = True
    include_drag: bool = False
    integrator: str = "DOP853"   # DOP853 | RK45 | RK4
    rtol: float = 1e-10
    atol: float = 1e-6
    max_step_s: float = 300.0
    sample_dt_s: float | None = None   # None -> adaptive
    sample_dt_max_s: float = 600.0
    use_dem_collision: bool = True
    stop_on_collision: bool = True     # False only for planner probes (trajectory passes through bodies)
    max_landing_speed_mps: float = 5.0
    epoch_iso: str = "2026-01-01T00:00:00Z"


@dataclass
class SimConfig:
    name: str = "Simulation"
    vehicle: Vehicle = field(default_factory=Vehicle)
    initial: InitialState = field(default_factory=InitialState)
    mission: Mission = field(default_factory=Mission)
    options: SimOptions = field(default_factory=SimOptions)
    commands: list[Command] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _build(cls, d: dict | None):
    d = d or {}
    unknown = set(d) - set(cls.__dataclass_fields__)
    if unknown:
        raise ValidationFailure(f"Unknown fields for {cls.__name__}: {sorted(unknown)}")
    return cls(**d)


def config_from_dict(d: dict) -> SimConfig:
    v = dict(d.get("vehicle") or {})
    eng = v.pop("engines", None)
    veh = _build(Vehicle, v)
    veh.engines = [_build(Engine, e) for e in eng] if eng is not None else veh.engines
    cfg = SimConfig(
        name=d.get("name", "Simulation"), vehicle=veh, initial=_build(InitialState, d.get("initial")),
        mission=_build(Mission, d.get("mission")), options=_build(SimOptions, d.get("options")),
        commands=[_build(Command, c) for c in d.get("commands") or []])
    validate(cfg)
    return cfg


def validate(cfg: SimConfig) -> None:
    errs = []
    v, i, o = cfg.vehicle, cfg.initial, cfg.options
    if v.dry_mass_kg <= 0: errs.append("dry_mass_kg must be > 0")
    if v.fuel_mass_kg < 0: errs.append("fuel_mass_kg must be >= 0")
    for e in v.engines:
        if e.thrust_n < 0: errs.append(f"engine '{e.name}': thrust_n must be >= 0")
        if e.isp_s <= 0: errs.append(f"engine '{e.name}': isp_s must be > 0")
    if i.kind not in ("earth_orbit", "moon_orbit", "lat_lon_surface", "cartesian"): errs.append(f"unknown initial.kind '{i.kind}'")
    if i.kind == "cartesian" and (not i.r_m or not i.v_mps or len(i.r_m) != 3 or len(i.v_mps) != 3):
        errs.append("cartesian initial state requires r_m and v_mps (3 numbers each)")
    if i.body not in ("earth", "moon"): errs.append("initial.body must be earth|moon")
    if o.integrator not in ("DOP853", "RK45", "RK4"): errs.append("options.integrator must be DOP853|RK45|RK4")
    if not (0 < o.rtol < 1e-2): errs.append("options.rtol must be in (0, 0.01)")
    if cfg.mission.duration_s <= 0: errs.append("mission.duration_s must be > 0")
    for c in cfg.commands:
        if c.direction not in DIRECTIONS: errs.append(f"command direction '{c.direction}' unknown")
        if c.reference not in REFERENCES: errs.append(f"command reference '{c.reference}' unknown")
        if not (0 <= c.throttle <= 1): errs.append("command throttle must be within [0,1]")
        if c.direction == "inertial" and (not c.vector or len(c.vector) != 3): errs.append("inertial command needs vector")
    if errs:
        raise ValidationFailure("Invalid simulation configuration", details={"errors": errs})

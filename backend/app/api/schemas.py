"""API request models (responses are plain JSON documented in API_CONTRACT.md)."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from ..spacecraft.schemas import InitialConditions, SimSettings, SpacecraftConfig


class AnalysisParamsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    window_m: float = Field(default=60.0, gt=0, le=5000)
    roughness_method: str = Field(default="detrended", pattern="^(std|detrended)$")
    slope_limit_deg: float = Field(default=10.0, gt=0, lt=90)
    roughness_limit_m: float = Field(default=0.5, gt=0)
    relief_limit_m: float = Field(default=3.0, gt=0)
    tpi_limit_m: float = Field(default=5.0, gt=0)
    hazard_safe_distance_m: float = Field(default=50.0, gt=0)
    footprint_radius_m: float = Field(default=15.0, gt=0, le=1000)
    suitable_threshold: float = Field(default=0.7, gt=0, le=1)
    weights: dict[str, float] = Field(default_factory=lambda: {"slope": 0.35, "roughness": 0.2, "relief": 0.2, "hazard": 0.25})
    max_candidates: int = Field(default=5, ge=1, le=50)
    min_candidate_separation_m: Optional[float] = Field(default=None, gt=0)


class TerrainAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude_deg: float = Field(ge=-90, le=90)
    longitude_deg: float = Field(ge=-180, le=360)
    radius_m: float = Field(gt=0, le=200_000)
    dataset_id: Optional[str] = None
    params: AnalysisParamsIn = Field(default_factory=AnalysisParamsIn)
    layers: Optional[list[str]] = None
    max_grid: int = Field(default=128, ge=8, le=512)
    max_cells: Optional[int] = Field(default=None, ge=100, le=16_000_000)
    allow_synthetic: bool = False
    region_id: Optional[int] = None
    save: bool = True


class RegionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=128)
    latitude_deg: float = Field(ge=-90, le=90)
    longitude_deg: float = Field(ge=-180, le=360)
    radius_m: float = Field(gt=0, le=1_000_000)
    dataset_id: Optional[str] = None


class TerrainOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    radius_m: float = Field(default=1500.0, gt=0, le=50_000)
    dataset_id: Optional[str] = None
    allow_synthetic: bool = False
    max_cells: Optional[int] = Field(default=None, ge=100, le=16_000_000)
    params: Optional[AnalysisParamsIn] = None


class SimulationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    spacecraft_id: int
    region_id: Optional[int] = None
    initial_conditions: InitialConditions
    settings: SimSettings = Field(default_factory=SimSettings)
    terrain: TerrainOptions = Field(default_factory=TerrainOptions)


class SpacecraftIn(SpacecraftConfig):
    user_id: Optional[int] = None
    is_demo: bool = False


class LandingEvaluateRequest(BaseModel):
    """Either ``simulation_id`` (return stored combined assessment) or an ad-hoc site check."""
    model_config = ConfigDict(extra="forbid")
    simulation_id: Optional[int] = None
    spacecraft_id: Optional[int] = None
    latitude_deg: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude_deg: Optional[float] = Field(default=None, ge=-180, le=360)
    radius_m: float = Field(default=1500.0, gt=0, le=50_000)
    dataset_id: Optional[str] = None
    allow_synthetic: bool = False
    params: Optional[AnalysisParamsIn] = None


class IgnitionSuggestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    spacecraft_id: Optional[int] = None
    spacecraft: Optional[SpacecraftConfig] = None
    initial_altitude_m: float = Field(gt=0)
    initial_speed_m_s: float = Field(ge=0)
    throttle: float = Field(default=1.0, gt=0, le=1)
    margin: float = Field(default=1.05, ge=1.0, le=3.0)


class MissionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = None
    region_id: Optional[int] = None
    spacecraft_id: Optional[int] = None
    simulation_id: Optional[int] = None
    user_id: Optional[int] = None


class UserIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")

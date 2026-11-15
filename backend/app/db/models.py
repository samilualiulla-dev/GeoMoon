"""SQLAlchemy 2.0 ORM models. JSON columns hold structured results; big rasters live in the file store
(``storage/``) and are referenced by path.  Portable to PostgreSQL (JSON -> JSONB there)."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DataSource(Base):
    __tablename__ = "data_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(128), unique=True, index=True)  # registry id (file stem slug)
    name: Mapped[str] = mapped_column(String(255))
    provider: Mapped[str] = mapped_column(String(255))
    product: Mapped[str] = mapped_column(String(255))
    resolution: Mapped[float | None] = mapped_column(Float, nullable=True)  # metres / pixel
    coverage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="available")  # available | missing | synthetic_demo
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    synthetic: Mapped[bool] = mapped_column(default=False)


class LunarRegion(Base):
    __tablename__ = "lunar_regions"
    __table_args__ = (Index("ix_region_latlon", "latitude", "longitude"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    radius: Mapped[float] = mapped_column(Float)  # metres
    data_source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    data_source: Mapped[DataSource | None] = relationship()


class TerrainAnalysis(Base):
    __tablename__ = "terrain_analyses"
    id: Mapped[int] = mapped_column(primary_key=True)
    region_id: Mapped[int | None] = mapped_column(ForeignKey("lunar_regions.id"), nullable=True, index=True)
    data_source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id"), nullable=True)
    center_latitude: Mapped[float] = mapped_column(Float)
    center_longitude: Mapped[float] = mapped_column(Float)
    radius: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    slope_results: Mapped[dict] = mapped_column(JSON)
    roughness_results: Mapped[dict] = mapped_column(JSON)
    relief_results: Mapped[dict] = mapped_column(JSON)
    hazard_results: Mapped[dict] = mapped_column(JSON)
    suitability_results: Mapped[dict] = mapped_column(JSON)
    analysis_parameters: Mapped[dict] = mapped_column(JSON)
    raster_path: Mapped[str | None] = mapped_column(Text, nullable=True)  # .npz with full-resolution layers
    synthetic: Mapped[bool] = mapped_column(default=False)


class SpacecraftConfiguration(Base):
    __tablename__ = "spacecraft_configurations"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    dry_mass: Mapped[float] = mapped_column(Float)
    fuel_mass: Mapped[float] = mapped_column(Float)
    dimensions: Mapped[dict] = mapped_column(JSON)
    engine_parameters: Mapped[dict] = mapped_column(JSON)
    landing_constraints: Mapped[dict] = mapped_column(JSON)
    landing_gear: Mapped[dict] = mapped_column(JSON)
    is_demo: Mapped[bool] = mapped_column(default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Simulation(Base):
    __tablename__ = "simulations"
    id: Mapped[int] = mapped_column(primary_key=True)
    spacecraft_id: Mapped[int] = mapped_column(ForeignKey("spacecraft_configurations.id"), index=True)
    region_id: Mapped[int | None] = mapped_column(ForeignKey("lunar_regions.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="created", index=True)
    initial_conditions: Mapped[dict] = mapped_column(JSON)
    settings: Mapped[dict] = mapped_column(JSON)
    terrain_options: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    spacecraft: Mapped[SpacecraftConfiguration] = relationship()
    result: Mapped["SimulationResult | None"] = relationship(back_populates="simulation", uselist=False, cascade="all, delete-orphan")


class SimulationResult(Base):
    __tablename__ = "simulation_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    simulation_id: Mapped[int] = mapped_column(ForeignKey("simulations.id", ondelete="CASCADE"), unique=True, index=True)
    time_series: Mapped[dict] = mapped_column(JSON)
    final_state: Mapped[dict] = mapped_column(JSON)
    trajectory_data: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON)
    landing_assessment: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    terrain_analysis_id: Mapped[int | None] = mapped_column(ForeignKey("terrain_analyses.id"), nullable=True)
    simulation: Mapped[Simulation] = relationship(back_populates="result")


class Mission(Base):
    __tablename__ = "missions"
    __table_args__ = (UniqueConstraint("name", name="uq_mission_name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    region_id: Mapped[int | None] = mapped_column(ForeignKey("lunar_regions.id"), nullable=True, index=True)
    spacecraft_id: Mapped[int | None] = mapped_column(ForeignKey("spacecraft_configurations.id"), nullable=True, index=True)
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OrbitalSimulation(Base):
    """Orbital flight simulation: configuration + command history (JSON); sample arrays live in storage/orbital/<id>.npz."""
    __tablename__ = "orbital_simulations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    config: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="ready")
    t_now_s: Mapped[float] = mapped_column(Float, default=0.0)
    events: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

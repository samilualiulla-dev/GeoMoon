"""Application context: settings, dataset registry, data engine, DB session factory."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from .core.config import Settings, get_settings
from .db import models as M
from .db.session import make_engine, make_session_factory
from .lunar_data.engine import LunarDataEngine
from .lunar_data.registry import DatasetRegistry


class AppContext:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.settings.storage_dir.mkdir(parents=True, exist_ok=True)
        self.registry = DatasetRegistry(self.settings.dem_dir)
        self.data = LunarDataEngine(self.registry, max_cells=self.settings.max_patch_cells)
        self.globe_cache: dict = {}
        self.db_engine = make_engine(self.settings.database_url)
        self.SessionLocal = make_session_factory(self.db_engine)
        with self.SessionLocal() as db:
            self.sync_sources(db)

    def sync_sources(self, db: Session) -> None:
        """Mirror installed datasets into the data_sources table (provenance record)."""
        self.globe_cache.clear()
        seen = set()
        for info in self.registry.datasets.values():
            d = info.to_dict()
            row = db.query(M.DataSource).filter_by(key=info.id).one_or_none() or M.DataSource(key=info.id)
            row.name, row.provider, row.product = d["name"], d["provider"], d["product"]
            row.resolution, row.coverage, row.version = d["resolution_m_per_px"], d["coverage"], d["version"]
            row.meta = {k: d[k] for k in ("citation", "url", "crs", "vertical_reference_radius_m", "warnings", "shape_rows_cols")}
            row.status = "synthetic_demo" if info.synthetic else "available"
            row.file_path = str(info.path); row.synthetic = info.synthetic
            db.add(row); seen.add(info.id)
        for row in db.query(M.DataSource).all():
            if row.key not in seen:
                row.status = "missing"
        db.commit()

    def storage_path(self, *parts: str) -> Path:
        p = self.settings.storage_dir.joinpath(*parts)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

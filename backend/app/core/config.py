"""Runtime configuration (environment variables, sensible local defaults)."""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings:
    def __init__(self) -> None:
        self.dem_dir = Path(os.getenv("GEOMOON_DEM_DIR", PROJECT_ROOT / "datasets" / "dem"))
        self.storage_dir = Path(os.getenv("GEOMOON_STORAGE_DIR", PROJECT_ROOT / "storage"))
        self.database_url = os.getenv("GEOMOON_DATABASE_URL", f"sqlite:///{PROJECT_ROOT / 'storage' / 'geomoon.db'}")
        self.max_patch_cells = int(os.getenv("GEOMOON_MAX_PATCH_CELLS", "4000000"))
        self.cors_origins = os.getenv("GEOMOON_CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")


def get_settings() -> Settings:
    return Settings()

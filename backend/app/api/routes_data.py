from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..context import AppContext
from ..core.errors import ConflictError, NotFoundError, ValidationFailure
from ..db import models as M
from ..lunar_data.catalog import KNOWN_PRODUCTS
from ..terrain.service import choose_dataset, grid_to_json, patch_geometry, provenance
from .deps import get_ctx, get_db
from .schemas import RegionIn, UserIn

router = APIRouter()


@router.get("/health", tags=["system"])
def health(ctx: AppContext = Depends(get_ctx)):
    dems = [d for d in ctx.registry.datasets.values() if d.quantity == "elevation"]
    return {"status": "ok", "service": "GeoMoon core", "api_version": "1", "datasets_installed": len(dems),
            "real_datasets_installed": sum(1 for d in dems if not d.synthetic),
            "supplementary_datasets": len(ctx.registry.datasets) - len(dems)}


@router.get("/data/sources", tags=["data"])
def data_sources(refresh: bool = False, ctx: AppContext = Depends(get_ctx), db: Session = Depends(get_db)):
    if refresh:
        ctx.registry.refresh(); ctx.sync_sources(db)
    return {"installed": [d.to_dict() for d in ctx.registry.datasets.values()],
            "rejected_files": ctx.registry.errors,
            "known_products": KNOWN_PRODUCTS,
            "dem_directory": str(ctx.registry.dem_dir),
            "notice": "Only rasters present in the DEM directory with a .meta.json sidecar are used. No data is fabricated."}


@router.get("/lunar/regions", tags=["lunar"])
def list_regions(db: Session = Depends(get_db)):
    rows = db.query(M.LunarRegion).order_by(M.LunarRegion.id).all()
    return [_region(r) for r in rows]


def _region(r: M.LunarRegion):
    return {"id": r.id, "name": r.name, "latitude_deg": r.latitude, "longitude_deg": r.longitude, "radius_m": r.radius,
            "data_source_id": r.data_source_id, "dataset_key": r.data_source.key if r.data_source else None}


@router.post("/lunar/regions", status_code=201, tags=["lunar"])
def create_region(body: RegionIn, ctx: AppContext = Depends(get_ctx), db: Session = Depends(get_db)):
    if db.query(M.LunarRegion).filter_by(name=body.name).first():
        raise ConflictError(f"region '{body.name}' exists")
    src = None
    if body.dataset_id:
        ctx.registry.get(body.dataset_id)
        src = db.query(M.DataSource).filter_by(key=body.dataset_id).one()
    r = M.LunarRegion(name=body.name, latitude=body.latitude_deg, longitude=body.longitude_deg, radius=body.radius_m,
                      data_source_id=src.id if src else None)
    db.add(r); db.commit()
    return _region(r)


@router.get("/lunar/terrain", tags=["lunar"])
def terrain(latitude_deg: float = Query(ge=-90, le=90), longitude_deg: float = Query(ge=-180, le=360),
            radius_m: float = Query(gt=0, le=200_000), dataset_id: str | None = None, max_grid: int = Query(128, ge=8, le=512),
            allow_synthetic: bool = False, ctx: AppContext = Depends(get_ctx)):
    """Raw elevation window (downsampled to max_grid) with geometry + provenance."""
    info = choose_dataset(ctx, latitude_deg, longitude_deg, dataset_id, allow_synthetic)
    patch = ctx.data.read_patch(info.id, latitude_deg, longitude_deg, radius_m)
    from ..terrain.analysis import elevation_stats
    return {"geometry": patch_geometry(patch), "elevation_m": grid_to_json(patch.elevation, max_grid),
            "statistics": elevation_stats(patch.elevation), "provenance": provenance(patch)}


@router.get("/lunar/elevation", tags=["lunar"])
def elevation(latitude_deg: float = Query(ge=-90, le=90), longitude_deg: float = Query(ge=-180, le=360),
              dataset_id: str | None = None, allow_synthetic: bool = False, ctx: AppContext = Depends(get_ctx)):
    info = choose_dataset(ctx, latitude_deg, longitude_deg, dataset_id, allow_synthetic)
    z = ctx.data.elevation_at(info.id, latitude_deg, longitude_deg)
    return {"latitude_deg": latitude_deg, "longitude_deg": longitude_deg, "elevation_m": z, "dataset_id": info.id,
            "reference_radius_m": info.meta.get("vertical_reference_radius_m", 1_737_400.0), "synthetic": info.synthetic}


@router.get("/lunar/globe", tags=["lunar"])
def globe(dataset_id: str | None = None, rows: int = Query(180, ge=18, le=360), cols: int = Query(360, ge=36, le=720),
          allow_synthetic: bool = False, ctx: AppContext = Depends(get_ctx)):
    """Whole-Moon elevation grid for the 3-D globe (global geographic DEM only; block-averaged to rows x cols)."""
    from ..core.errors import DataUnavailableError
    cands = [ctx.registry.get(dataset_id)] if dataset_id else sorted(
        (d for d in ctx.registry.datasets.values() if d.quantity == "elevation" and d.is_geographic
         and d.lat_range and (d.lat_range[1] - d.lat_range[0]) >= 170 and (allow_synthetic or not d.synthetic)),
        key=lambda d: d.resolution_m_per_px or 1e12)
    if not cands:
        raise DataUnavailableError("No global elevation dataset is installed (e.g. LOLA LDEM_16 / LDEM_64)",
                                   details={"hint": "python backend/scripts/import_pds.py LDEM_16.LBL"})
    info = cands[-1] if not dataset_id else cands[0]   # coarsest global dataset by default: light enough for a globe
    if info.synthetic and not allow_synthetic:
        raise ValidationFailure(f"Dataset '{info.id}' is SYNTHETIC test data; pass allow_synthetic=true to use it knowingly.")
    g = ctx.data.read_global_grid(info.id, rows, cols)
    z = g.pop("elevation")
    from ..terrain.analysis import elevation_stats
    return {**g, "elevation_m": grid_to_json(z, max(rows, cols)), "statistics": elevation_stats(z),
            "provenance": {"dataset_id": info.id, "name": info.meta.get("name"), "provider": info.meta.get("provider"),
                           "product": info.meta.get("product"), "version": info.meta.get("version"), "citation": info.meta.get("citation"),
                           "url": info.meta.get("url"), "resolution_m_per_px": info.resolution_m_per_px, "synthetic": info.synthetic,
                           "data_notice": "SYNTHETIC TEST TERRAIN - NOT REAL LUNAR DATA" if info.synthetic else "Real dataset; see citation"}}


@router.post("/users", status_code=201, tags=["users"])
def create_user(body: UserIn, db: Session = Depends(get_db)):
    if db.query(M.User).filter_by(username=body.username).first():
        raise ConflictError("username exists")
    u = M.User(username=body.username); db.add(u); db.commit()
    return {"id": u.id, "username": u.username, "created_at": u.created_at.isoformat()}


@router.get("/users", tags=["users"])
def list_users(db: Session = Depends(get_db)):
    return [{"id": u.id, "username": u.username, "created_at": u.created_at.isoformat()} for u in db.query(M.User).all()]

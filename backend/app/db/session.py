from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .base import Base
from . import models  # noqa: F401  (register tables)


def make_engine(url: str):
    kw = {}
    if url.startswith("sqlite"):
        kw["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url or url == "sqlite://":
            kw["poolclass"] = StaticPool
        else:
            Path(url.replace("sqlite:///", "")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, **kw)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _fk(dbapi_con, _):  # enforce foreign keys in SQLite
            dbapi_con.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    _migrate(engine)
    return engine


def _migrate(engine) -> None:
    """Tiny forward-only migrations for existing local SQLite databases (create_all never alters existing tables)."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    cols = {c["name"] for c in insp.get_columns("spacecraft_configurations")}
    if "is_demo" not in cols:
        with engine.begin() as con:
            con.execute(text("ALTER TABLE spacecraft_configurations ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT 0"))


def make_session_factory(engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)

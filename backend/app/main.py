"""GeoMoon core API (FastAPI)."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import routes_data, routes_orbital, routes_sim, routes_terrain
from .context import AppContext
from .core.config import Settings
from .core.errors import GeoMoonError


def create_app(settings: Settings | None = None) -> FastAPI:
    ctx = AppContext(settings)
    app = FastAPI(title="GeoMoon - Lunar Landing Geometric Map core", version="0.1.0",
                  description="Research/educational computational core. Not operational flight software.")
    app.state.ctx = ctx
    app.add_middleware(CORSMiddleware, allow_origins=ctx.settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

    def err(status, code, message, details=None):
        return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details or {}}})

    @app.exception_handler(GeoMoonError)
    async def _geo(_: Request, e: GeoMoonError):
        return err(e.status_code, e.code, e.message, e.details)

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, e: RequestValidationError):
        items = [{"loc": [str(x) for x in d["loc"]], "message": d["msg"], "type": d["type"]} for d in e.errors()]
        return err(422, "request_validation_failed", "Request validation failed", {"errors": items})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        return err(e.status_code, "http_error", str(e.detail))

    for r in (routes_data.router, routes_terrain.router, routes_sim.router, routes_orbital.router):
        app.include_router(r, prefix="/api")
    return app

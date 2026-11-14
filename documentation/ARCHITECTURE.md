# GeoMoon core — architecture

```
backend/app
├── core/          constants (R, GM, g0), coordinate conversions, structured errors, settings
├── lunar_data/    registry.py (scan DEMs + provenance sidecars) · engine.py (windowed raster reads, CRS transforms, sampling, LRU cache) · catalog.py (known real products)
├── terrain/       analysis.py (slope, roughness, relief, TPI, hazards) · suitability.py (scoring, footprint test, candidates, explanations) · service.py (orchestration/persistence)
├── spacecraft/    schemas.py (validated configuration, burn plan, initial conditions, derived quantities)
├── trajectory/    gravity.py · propulsion.py · integrator.py (RK4 + DOP853, event handling) · dynamics.py (3-DOF simulation) · planning.py (advisory ignition estimate)
├── landing/       evaluate.py (surface + trajectory + vehicle assessments)
├── simulation/    manager.py (lifecycle created→queued→running→completed|failed, terrain coupling, persistence)
├── db/            SQLAlchemy models (SQLite MVP; portable to PostgreSQL)
└── api/           FastAPI routers + request schemas;  main.py (app factory, error handlers);  asgi.py (entry point)
```
Data flow: DEM file → `LunarDataEngine.read_patch` → `TerrainPatch` (regular grid, NaN = no data, cell size in m) → `analyze_patch` →
layers/candidates → (optional) `simulate` uses the patch as surface-height function → `evaluate_landing` → stored in `simulation_results`.
Full-resolution analysis rasters live in `storage/analyses/*.npz`; the DB stores summaries, parameters and file paths.

## Physical model (trajectory)
State `[r(3), v(3), m]` in MCI (Moon-centred inertial, equal to body-fixed at t = 0):
`dv/dt = −μ r/|r|³ + (F/m)·û`, `dm/dt = −F/(Isp·g0)`, μ = 4.902800066×10¹² m³/s², R = 1 737 400 m.
Surface-relative velocity `v − ω×r` (ω = 2π/27.3217 d); reported positions are rotated into the body-fixed frame; contact when
`|r| = R + h_DEM(lat, lon)` (target elevation outside the DEM window). Events: touchdown, ignition altitude, fuel exhaustion, cutoff speed.
Integrators: DOP853 (adaptive, rtol 1e-9) or fixed-step RK4; both verified against analytic energy conservation and orbit tests.

**Not modelled:** attitude/rotational dynamics, gravity harmonics & mascons, third bodies, propellant slosh, engine transients,
sensors/guidance, plume–surface interaction, oblateness. Results are a research estimate, not flight software.

## Terrain metrics
See API_CONTRACT.md (“Terrain analysis”). All metrics are resolution-dependent: nothing smaller than ≈ 2 cells is detectable
(`min_resolvable_feature_m` is reported). Windows touching a data gap or the patch edge yield NaN, never extrapolated values.

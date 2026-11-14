# GeoMoon — Lunar Landing Geometric Map (computational core)

Research / educational platform: real lunar DEM → terrain analysis → landing-site suitability → lander configuration →
numerical descent simulation → landing assessment → persisted studies, all served through a REST API.
**Not certified flight software; a suitability score or simulation result is never a landing-safety guarantee.**

This repository currently contains the **backend core** (`backend/`). The frontend (3-D globe, dashboard) will consume the API described in
[`API_CONTRACT.md`](API_CONTRACT.md).

## Run
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # needs a rasterio wheel (GDAL bundled) — Python 3.10+
uvicorn app.asgi:app --reload --port 8000
```
Open http://localhost:8000/docs. Without installed DEMs the API starts normally and terrain endpoints answer `404 data_unavailable`.

## Tests
```bash
cd backend && python -m pytest -q          # 107 tests: coordinates, DEM reading, slope/roughness/suitability, gravity, RK4/DOP853,
                                           # fuel, touchdown, DB constraints, full API lifecycle
```

## Data
Put a real DEM + `.meta.json` into `datasets/dem/` — see [`documentation/DATA_SETUP.md`](documentation/DATA_SETUP.md).
For a software-only demo: `python backend/scripts/make_demo_dem.py` (**synthetic**, opt-in via `allow_synthetic=true`, always flagged).

## 60-second walkthrough (demo DEM)
```bash
B=http://localhost:8000/api
curl -sX POST $B/spacecraft -H 'content-type: application/json' -d '{"name":"Demo","dry_mass_kg":900,"fuel_mass_kg":300,
 "dimensions":{"length_m":3,"width_m":3,"height_m":4},"landing_gear":{"span_m":5},"engine":{"thrust_n":5000,"isp_s":300}}'
curl -sX POST $B/simulation/create -H 'content-type: application/json' -d '{"spacecraft_id":1,
 "initial_conditions":{"target_latitude_deg":0.95,"target_longitude_deg":23.05,"initial_altitude_m":10000,"initial_speed_m_s":100,
 "burn":{"mode":"altitude","ignition_altitude_m":5250,"cutoff_speed_m_s":1}},"terrain":{"allow_synthetic":true}}'
curl -sX POST "$B/simulation/1/run?wait=true"
curl -s  "$B/simulation/1/results" | python -m json.tool | less
```

## Documentation
[`API_CONTRACT.md`](API_CONTRACT.md) · [`documentation/ARCHITECTURE.md`](documentation/ARCHITECTURE.md) · [`documentation/DATA_SETUP.md`](documentation/DATA_SETUP.md)

## Dataset citations (to be used when real data are installed)
* LOLA: Smith, D. E. et al., *Initial observations from the Lunar Orbiter Laser Altimeter*, GRL 37 (2010); Smith et al., Icarus 283 (2017).
* SLDEM2015: Barker, M. K. et al., *A new lunar digital elevation model from LOLA and SELENE Terrain Camera*, Icarus 273 (2016).
* LROC: Robinson, M. S. et al., *LROC — Lunar Reconnaissance Orbiter Camera*, Space Sci. Rev. 150 (2010).
* GM of the Moon: JPL DE430 (Folkner et al. 2014).

## Known limitations
* No real DEM is bundled (build environment could not reach NASA hosts); the demo DEM is synthetic.
* Point-mass gravity, no attitude dynamics, no guidance; open-loop burn scenarios only; spherical Moon.
* DEM metrics cannot detect boulders / craters below ~2 cells; hazard detection is geometric only (no imported crater catalogues yet).
* Geographic-CRS DEMs refused above |lat| 85° (use polar products). PDS3 `.IMG` ingestion relies on GDAL and the sidecar's scale/offset — untested on real products.
* SQLite only (schema is PostgreSQL-compatible); background tasks are in-process (no queue); no authentication; PDF export not implemented (JSON report only).
* The ignition-altitude helper is an approximate constant-deceleration estimate; open-loop burns will not generally give a soft touchdown without tuning.

## Next steps
Import real LOLA/LROC DEMs and crater catalogues; tiled global LOD for the 3-D globe; guidance-law models and attitude dynamics;
gravity harmonics (GRAIL); Alembic migrations + PostgreSQL; task queue; PDF reports; frontend.

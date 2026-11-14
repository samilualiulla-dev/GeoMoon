# GeoMoon frontend

React 19 · TypeScript · Vite · Tailwind CSS 4 · Three.js / React Three Fiber · Recharts · Zustand.
A working console for the GeoMoon computational core: every number on screen comes from a core API response
(or is a unit conversion of one). Nothing is simulated in the browser.

## Run
```bash
# terminal 1 — core (see ../README.md)
cd ../backend && uvicorn app.asgi:app --port 8000
# terminal 2 — UI (Node 20+)
cd frontend && npm install && npm run dev        # http://localhost:5173
```
The dev server proxies `/api` to `http://127.0.0.1:8000` (override with `GEOMOON_API_PROXY`, or set `VITE_API_URL` for a build that talks to another origin).

| script | purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | type-check + production bundle in `dist/` |
| `npm test` | Vitest unit tests (geometry, validation, payload builders, HTTP layer, series/CSV) |
| `node e2e/smoke.cjs` | Playwright end-to-end walkthrough of all pages against a live core (see below) |

## Pages
| Route | What it does |
|---|---|
| `/` Dashboard | core status, installed DEM counts (real vs synthetic), current target, saved missions/vehicles/regions, recent studies; empty states when nothing exists |
| `/explorer` Lunar Explorer | 3-D sphere (plain reference sphere, or displaced by real global elevation when a global DEM is installed) with lat/lon grid, dataset coverage outlines, saved regions, click-to-select coordinates; probe elevation, load **real regional relief** as a displaced 3-D mesh, save regions |
| `/terrain` Terrain Analysis | region/criteria form → `POST /terrain/analyze`; layers (elevation, slope, roughness, local relief, hazard, suitability, site classes) with toggles, opacity, legend, units, source; hover read-out; 3-D relief coloured by any layer; candidate sites with score explanation; weights re-run the analysis live |
| `/spacecraft` Spacecraft | validated vehicle form (units, bounds and their origin in tooltips) + descent scenario/burn plan (constant, time-varying schedule, cut-off); derived values come from the core; ignition-altitude suggestion from the core |
| `/simulation` Landing Simulation | creates + runs a simulation on the core, polls its status, replays the returned time series in 3-D (terrain from the DEM, trajectory, lander, flame) with Start / Pause / Resume / Reset / Replay, speed, scrubber, live telemetry, 6 charts, full landing assessment, save as mission, CSV/JSON export |
| `/reports` Mission Reports | saved missions, full report view, comparison of 2+ missions, export JSON / CSV / time-series CSV / PDF (browser print → “Save as PDF”), open in simulation |
| `/data` Data Sources | installed datasets with provenance, coverage, resolution, version, warnings; known real products (LOLA, SLDEM2015, LROC, Moon Trek/ODE) with status and usage limits; rejected files |

## Structure
```
src/
  api/          types.ts (core contract), http.ts (timeouts, error mapping, guards), endpoints.ts (single API client)
  lib/          geo (frame mapping), colormap, validation (field specs incl. limit origin), payload (form → API), series, csv, format
  store/        persisted inputs + session results (Zustand)
  hooks/        useFetch, useHealth, usePlayback
  components/   ui/ layout/ globe/ terrain/ simulation/ spacecraft/
  pages/        one file per route (lazy-loaded)
```

## Scientific-integrity rules enforced in the UI
* The globe is a **plain reference sphere**; no global DEM is installed, so no relief is painted onto it. Relief is shown only from core responses (regional window) and is labelled.
* Synthetic test terrain must be opted into (“Allow SYNTHETIC”) and is flagged in the top bar, in panels, in results and in saved reports.
* Missing data render as holes / grey / “—”, never as zero or interpolated values.
* The core's errors are shown verbatim (code, message, per-field validation); an unreachable core shows a connection error, never placeholder results.
* Assessments use the core's wording (“within / outside assessed limits”) and always carry the uncertainty and model-limitation lists. The UI never says “safe”.
* Colour stretches (e.g. slope 0–30°) are visualisation choices, labelled as such — not physical limits.

## End-to-end check
```bash
# core with the synthetic demo DEM, in another terminal:
python ../backend/scripts/make_demo_dem.py /tmp/geomoon-demo/dem --global
GEOMOON_DEM_DIR=/tmp/geomoon-demo/dem GEOMOON_STORAGE_DIR=/tmp/geomoon-demo/storage \
  GEOMOON_DATABASE_URL=sqlite:////tmp/geomoon-demo/e2e.db uvicorn app.asgi:app --port 8000   # from ../backend
npm i -D playwright && npx playwright install chromium     # one time
npm run dev &                                              # then:
node e2e/smoke.cjs        # 39 checks across all pages, exports, WebGL, mobile overflow, console errors
node e2e/offline.cjs      # stop the core first: verifies honest error states
```

## Known limitations
* The globe shows relief only if a global elevation DEM (e.g. LOLA `LDEM_16`) is installed; one 180×360 block-averaged grid, no tiling/LOD yet.
* The lander is drawn upright and enlarged; attitude is not simulated by the core.
* PDF export uses the browser's print dialog (print stylesheet), not a server-side PDF.
* Mission comparison compares stored missions' metrics; it does not re-run analyses.
* Bundle is ~1.3 MB (Three.js); routes are lazy-loaded.

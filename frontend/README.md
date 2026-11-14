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

## Pages (Russian UI)
| Route | What it does |
|---|---|
| `/` Обзор | core status, installed DEM counts (real vs synthetic), current target, selected vehicle, saved missions/vehicles/regions, recent studies; empty states when nothing exists |
| `/explorer` Исследование Луны | 3-D globe: natural lunar grey displaced by REAL global elevation (or a plain sphere when none is installed), 30° grid, DEM-coverage outlines, markers, search by place name / coordinates, click-to-select; DEM availability + provenance card for the point; probe elevation; regional relief mesh; saved regions |
| `/terrain` Анализ рельефа | region/criteria form → `POST /terrain/analyze`; 7 layers (elevation, slope, roughness, local relief, hazard map, suitability, site classes) with toggles/opacity/legend/units/source; 3-D relief in natural colour or by any layer; weights re-run the analysis; candidate sites with score explanation |
| `/spacecraft` Аппараты | catalogue of vehicle configurations: view characteristics (computed by the core), create / edit / copy / delete (with confirmation; the core refuses to edit/delete used vehicles), compare up to 4, DEMO templates clearly labelled |
| `/simulation` Симуляция посадки | 3-column workspace: scenario (vehicle, target, initial state, velocity vector, burn plan, per-run vehicle overrides, settings) · 3-D scene (real DEM relief, lander, trajectory, start/touchdown, altitude line, velocity & thrust vectors, grid, camera presets/follow/FOV, layer toggles) · telemetry; bottom timeline with Start/Pause/Resume/Reset/Replay, speed, scrubbing and event markers; 6 charts; full landing assessment; save as mission |
| `/reports` Отчёты миссий | saved missions, full report with trajectory charts, comparison of 2+ missions, export JSON / CSV / time-series CSV / PDF (browser print), open in simulation |
| `/data` Источники данных | installed datasets with provenance, coverage, resolution, version, import date, status, limits; known real products; rejected files |

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
node e2e/smoke.cjs        # 60 checks across all pages, CRUD, exports, WebGL, mobile overflow, console errors
node e2e/offline.cjs      # stop the core first: verifies honest error states
node e2e/coarse_real_dem.cjs  # real coarse DEM (LDEM_16): radius auto-fix, relief, simulation with enlarged terrain window
node e2e/real_data.cjs    # with a REAL LDEM_16 imported: globe relief, Apollo 11 probe (-1.9 km), south-pole analysis
```

## Known limitations
* The globe shows relief only if a global elevation DEM (e.g. LOLA `LDEM_16`) is installed; one 180×360 block-averaged grid, no tiling/LOD yet.
* The lander is drawn upright and enlarged; attitude is not simulated by the core. The thrust arrow uses the core's `thrust_dir_*` series.
* "Natural colour" is a conventional lunar grey (brighter = higher); it is not measured albedo. The shading itself comes from the real DEM.
* UI language is Russian; messages produced by the core are translated for display (unknown messages are shown as received).
* PDF export uses the browser's print dialog (print stylesheet), not a server-side PDF.
* Mission comparison compares stored missions' metrics; it does not re-run analyses.
* Bundle is ~1.3 MB (Three.js); routes are lazy-loaded.

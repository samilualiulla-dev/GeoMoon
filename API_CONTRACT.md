# GeoMoon core — API contract (v1)

Base URL: `http://localhost:8000/api` · JSON · OpenAPI UI: `/docs` · schema: `/openapi.json`.
**Do not change a response shape without updating this file and the frontend types.**

## Conventions

| Topic | Rule |
|---|---|
| Units | SI everywhere: **m, s, kg, N, m/s, m/s²**. Angles in **degrees** (`*_deg`). Every field name carries its unit suffix. |
| Coordinates | Selenographic, planetocentric, spherical Moon R = 1 737 400 m. `latitude_deg ∈ [-90,90]` (N+), `longitude_deg ∈ [-180,180)` (E+; request values up to 360 are accepted and wrapped). |
| Cartesian frame | Reported positions/velocities (`position_*`, `velocity_*`) are **body-fixed (BF)**: +Z north pole, +X toward (0°,0°), +Y toward (0°,90°E); the frame rotates with the Moon. Velocity is *surface-relative*. `inertial_*` columns are in the non-rotating MCI frame (equal to BF at t = 0). A viewer that draws a fixed Moon mesh should use BF. |
| Elevation | Metres above the dataset's reference sphere (`vertical_reference_radius_m`, 1 737 400 m for LOLA products). |
| Grids | `{rows, cols, data[rows][cols]}`; **row 0 = north**, col 0 = west; `null` = no data (never filled). Cell sizes in `geometry.cell_size_m`. Grids are downsampled (block mean; NaN-conservative) to `max_grid`. Full-resolution layers: `GET /terrain/analysis/{id}/layers/{layer}`. |
| Time series | Columnar: `{"time_s":[...], "altitude_m":[...], ...}`, all arrays equal length. |
| Synthetic data | Datasets flagged `synthetic: true` are **not lunar data**. They are refused unless `allow_synthetic=true`, and every response using them carries `synthetic: true` / a notice. |
| Errors | `{"error":{"code":str,"message":str,"details":{}}}` — codes: `request_validation_failed` (422), `validation_failed` (422), `data_unavailable` (404), `out_of_coverage` (404), `not_found` (404), `conflict` (409), `http_error`. |

## System & data

### `GET /health`
`{"status":"ok","service":"GeoMoon core","api_version":"1","datasets_installed":1,"real_datasets_installed":0,"supplementary_datasets":0}` — counts cover **elevation** products only; roughness/slope rasters are counted in `supplementary_datasets`.

### `GET /data/sources[?refresh=true]`
Installed DEMs with provenance + catalogue of known real products + files rejected (with reason).
```json
{"installed":[{"id":"synthetic_demo_dem","name":"…","provider":"…","product":"…","version":"1","citation":"…","url":"…",
  "resolution_m_per_px":20.0,"coverage":{"lat_range_deg":[0.60,1.0],"lon_range_deg":[23.0,23.39],"includes_pole":false,"nominal":null},
  "crs":"<WKT>","is_geographic_crs":true,"shape_rows_cols":[600,600],"elevation_unit":"m","vertical_reference_radius_m":1737400.0,
  "synthetic":true,"quantity":"elevation","unit":"m","usable_as_dem":true,"status":"available","warnings":["…"],"file":"synthetic_demo_dem.tif"}],
 "rejected_files":{"x.tif":"x.tif: missing provenance sidecar x.meta.json"},
 "known_products":[{"product":"SLDEM2015","coverage":"approx. 60S-60N ONLY - does not cover the lunar poles", "...":"..."}],
 "dem_directory":"…","notice":"…"}
```

### `GET /lunar/regions` · `POST /lunar/regions` (201)
Request: `{"name":"Site A","latitude_deg":0.95,"longitude_deg":23.05,"radius_m":1000,"dataset_id":"plane_test"|null}` →
`{"id":1,"name":…,"latitude_deg":…,"longitude_deg":…,"radius_m":…,"data_source_id":1|null,"dataset_key":"…"|null}`. Errors: 409 duplicate name, 404 unknown dataset.

> **Grids near the poles.** For a geographic-CRS (lon/lat) DEM, if `|lat| + radius ≥ 80°` the core resamples the raster onto a local **azimuthal-equidistant square-metre grid centred on the request point** (bilinear, NaN stays NaN, cell never finer than the source). `geometry.cell_size_m.dx == dy`; `row0_is_north` holds in the *local* frame (when the centre is exactly on a pole, azimuth is measured from the requested longitude). Corners, candidate and hover lat/lon come from the same mapping, so they are exact.

> **Region size vs. DEM resolution.** A region must be ≥ 3 cells across. If not, the core answers `422 validation_failed` with `details.min_radius_m`, `details.recommended_radius_m`, `details.resolution_m_per_px`. `GET /data/sources` lists `min_radius_m` (= 1.5 × cell) and `recommended_radius_m` (≈ 20 × cell, capped at 200 000) per dataset.
> **Simulation terrain window.** If `terrain.radius_m` holds fewer than ~20 cells across (radius < 10 × cell), the core enlarges it and reports it in `summary.warnings`; the radius actually used is `summary.terrain_radius_m` (+ `summary.terrain_dataset`). When the DEM cell is larger than the vehicle footprint radius the surface assessment is `not_assessed` (`surface_assessment.resolution_too_coarse = true`), never `within_limits`.

### `GET /lunar/terrain`
Query: `latitude_deg, longitude_deg, radius_m (≤200000), dataset_id?, max_grid=128 (8–512), allow_synthetic=false`.
Response: `{"geometry":{…},"elevation_m":{rows,cols,data},"statistics":{min_m,max_m,mean_m,std_m,range_m,valid_fraction},"provenance":{…}}`.
`geometry` = `{rows, cols, cell_size_m:{dx,dy}, row0_is_north:true, center:{latitude_deg,longitude_deg}, corners:{north_west,north_east,south_west,south_east}, reference_radius_m, valid_fraction}`.
Errors: 404 `data_unavailable` (no real DEM covers the point), 404 `out_of_coverage`, 422 region < 3×3 cells.

### `GET /lunar/globe`
Whole-Moon elevation grid for the 3-D globe. Query: `dataset_id?, rows=180 (18–360), cols=360 (36–720), allow_synthetic=false`.
Only **global geographic elevation** datasets qualify (≥170° latitude, ~360° longitude); without one → `404 data_unavailable`; a roughness/slope product → 422.
Response: `{rows, cols, lat_north_deg, lat_south_deg, lon_west_deg, lon_east_deg, reference_radius_m, elevation_m:{rows,cols,data}, statistics, provenance}`; row 0 = north, column *c* centre longitude = `lon_west + (c+0.5)/cols·(lon_east−lon_west)` (LOLA products span 0…360 E). Block-averaged; `null` = no data.

### `GET /lunar/elevation`
Query `latitude_deg, longitude_deg, dataset_id?, allow_synthetic?` → `{"elevation_m":…,"dataset_id":…,"reference_radius_m":…,"synthetic":bool}` (404 if the point has no valid data).

## Terrain analysis

### `POST /terrain/analyze`
```json
{"latitude_deg":0.95,"longitude_deg":23.05,"radius_m":1000,"dataset_id":null,"allow_synthetic":true,
 "layers":["slope","suitability","class"],"max_grid":128,"max_cells":null,"region_id":null,"save":true,
 "params":{"window_m":60,"roughness_method":"detrended","slope_limit_deg":10,"roughness_limit_m":0.5,"relief_limit_m":3,
           "tpi_limit_m":5,"hazard_safe_distance_m":50,"footprint_radius_m":15,"suitable_threshold":0.7,
           "weights":{"slope":0.35,"roughness":0.2,"relief":0.2,"hazard":0.25},"max_candidates":5,"min_candidate_separation_m":null}}
```
Response: `geometry`, `summary` (`warnings[]` — e.g. DEM cells larger than the landing footprint or ≥ 500 m/cell, `elevation`, `slope_deg`, `roughness_m`, `local_relief_m`, `suitability` stats `{min,max,mean,p95}`, `class_fractions`, `hazard_fraction`, `resolution_m`, `min_resolvable_feature_m`),
`parameters` (echo), `candidates[]`, `layers{name:{unit,description,rows,cols,data,min,max}}`, `provenance`, `disclaimer`, `analysis_id` (if `save`).
Layers: `elevation, slope, aspect, roughness, local_relief, tpi, hazard, hazard_distance, suitability, class, score_*, hazard_<kind>`. `class`: 0 geometrically_unsuitable, 1 geometrically_suitable, 2 insufficient_data.
Candidate: `{row,col,lat,lon,elevation_m,footprint_mean_suitability,explanation}`; `explanation = {classification, suitability, components{slope|roughness|relief|hazard:{value,limit,unit,score,weight,weighted_contribution}}, notes[], disclaimer}`.
Errors: 422 (bad params, synthetic w/o opt-in, unknown layer), 404 (no data / out of coverage / unknown region).

Method: Horn 3×3 slope; roughness = RMS residual about a least-squares plane in `window_m` (`detrended`) or plain std (`std`);
local relief = max−min in window; TPI = z − window mean; hazards = steep slope, relief discontinuity, rough surface, |TPI| anomaly (union);
score_i = clip(1 − value/limit, 0, 1), score_hazard = clip(dist_to_hazard / hazard_safe_distance_m, 0, 1);
suitability = Σ wₖ·scoreₖ / Σ wₖ. A cell is `suitable` only if the entire landing footprint disk is above threshold, hazard-free and has complete data. Cells within the window half-width of the patch edge or of a data gap are `insufficient_data`.

### `GET /terrain/analysis/{id}` · `GET /terrain/analysis/{id}/layers/{layer}?max_grid=128`
Stored analysis summary (slope/roughness/relief/hazard/suitability results + parameters) and full-resolution layer from the `.npz`.

## Spacecraft

### `POST /spacecraft` (201) / `GET /spacecraft` / `GET /spacecraft/{id}`
```json
{"name":"Demo lander","dry_mass_kg":900,"fuel_mass_kg":300,
 "dimensions":{"length_m":3,"width_m":3,"height_m":4},
 "landing_gear":{"span_m":5,"pad_diameter_m":0.3,"gear_height_m":0.5,"cg_height_m":null},
 "engine":{"thrust_n":5000,"number_of_engines":1,"isp_s":300,"fuel_consumption_kg_s":null,"throttle_min":0,"throttle_max":1},
 "constraints":{"max_vertical_touchdown_speed_m_s":2,"max_horizontal_touchdown_speed_m_s":1,"max_tilt_deg":null,
                "max_acceleration_m_s2":null,"max_distance_to_target_m":100},
 "user_id":null}
```
`thrust_n` is **per engine**; `fuel_consumption_kg_s` is total at full throttle (give `isp_s` and/or it; if both, they must agree within 5 %).
Response adds `id`, `derived` (`total_mass_kg, thrust_to_weight_lunar_surface, effective_isp_s, mass_flow_full_throttle_kg_s, max_burn_time_s, delta_v_ideal_m_s, footprint_radius_m, tipping_angle_deg, max_tilt_deg_used`), `warnings[]`, `created_at`.
Validation: all masses/dimensions > 0, extra fields rejected → 422 with per-field errors.

### `POST /trajectory/suggest-ignition`
`{"spacecraft_id":1 | "spacecraft":{…}, "initial_altitude_m":10000,"initial_speed_m_s":100,"throttle":1,"margin":1.05}` →
`{"feasible":true,"ignition_altitude_m":5250.7,"constant_decel_m_s2":2.54,"speed_at_ignition_m_s":159.5,"burn_time_s":62.7,"fuel_needed_kg":106.6,"fuel_available_kg":300,"margin":1.05,"note":"…advisory only"}`.
Vertical-descent, constant-mass estimate. Advisory — not a guidance law.

## Simulation

### `POST /simulation/create` (201)
```json
{"spacecraft_id":1,"region_id":null,
 "initial_conditions":{"target_latitude_deg":0.95,"target_longitude_deg":23.05,"initial_altitude_m":10000,"initial_speed_m_s":100,
   "azimuth_deg":0,"flight_path_angle_deg":-90,"initial_downrange_m":0,
   "burn":{"mode":"altitude","ignition_altitude_m":5250,"throttle":1,"direction":"retrograde","cutoff_speed_m_s":1.0,
           "ignition_time_s":null,"fixed_enu":null,"throttle_schedule":null}},
 "settings":{"integrator":"dop853","output_dt_s":1,"rk4_step_s":0.05,"max_time_s":3600,"rtol":1e-9,"atol":1e-6,"moon_rotation":true},
 "terrain":{"enabled":true,"radius_m":1500,"dataset_id":null,"allow_synthetic":false,"max_cells":null,"params":null}}
```
* `burn.mode`: `none` | `altitude` (ignite at height above local surface) | `time` | `schedule` (`[[t_s, throttle], …]` piecewise-constant; throttle 0 = engine off).
* `direction`: `retrograde` (against surface-relative velocity) | `radial_up` | `fixed_enu` (vector in start-point East-North-Up).
* The burn is an **open-loop scenario**, not a control law. Fuel exhaustion and `cutoff_speed_m_s` shut the engine off automatically.
* Start point = target displaced `initial_downrange_m` along −azimuth; velocity heading `azimuth_deg` (clockwise from north), `flight_path_angle_deg` (−90 = straight down), surface-relative.
Response (201): simulation object `{id,status:"created",spacecraft_id,region_id,initial_conditions,settings,terrain_options,error,created_at,started_at,completed_at,has_result}`.
Errors: 404 unknown spacecraft/region, 422 invalid or inconsistent (e.g. burn requested with 0 fuel, throttle outside engine limits).

### `POST /simulation/{id}/run[?wait=false]` (202)
Status `created → queued → running → completed | failed`. Default runs as a background task; `wait=true` blocks and returns the final object. Poll `GET /simulation/{id}`. Failure reason in `error` (no result is fabricated). 409 if already queued/running.

### `GET /simulation/{id}`
Simulation object; when completed also `summary`.

### `GET /simulation/{id}/results[?t=…|&fields=a,b&stride=n]`
* default → `{simulation_id,status,time_series,final_state,trajectory,summary,landing_assessment,terrain_analysis_id,units}`
* `t=<seconds>` → `{"simulation_id","t_s","state":{<every time-series column interpolated>}}` (intermediate state)
* 422 until the simulation is completed (`details.status`, `details.error`).

`time_series` columns (arrays): `time_s, position_{x,y,z}_m (BF), velocity_{x,y,z}_m_s (BF, surface-relative), inertial_position_{x,y,z}_m, inertial_velocity_{x,y,z}_m_s, latitude_deg, longitude_deg, altitude_m (above reference sphere), distance_to_surface_m (above local DEM surface), speed_surface_m_s, vertical_speed_m_s (+up), horizontal_speed_m_s, acceleration_m_s2 (total |a|), proper_acceleration_m_s2 (thrust/mass), thrust_n, throttle, mass_kg, fuel_remaining_kg, distance_to_target_m`.
`trajectory = {frame:"body_fixed",units:"m",points_xyz:[[x,y,z],…](≤~2000),time_s:[…],target:{…},terrain_dataset,terrain_synthetic}`.
`summary` = `{termination_reason: "touchdown"|"max_time_reached", duration_s, touchdown:{latitude_deg,longitude_deg,time_s,vertical_speed_m_s,horizontal_speed_m_s,speed_m_s,flight_path_angle_deg,miss_distance_m,surface_height_m,mass_kg}|null, fuel_used_kg, fuel_remaining_kg, peak_proper_acceleration_m_s2, events[], integrator, frames, assumptions[], limitations[], warnings[], spacecraft_derived, terrain_used, terrain_synthetic}`.

## Landing assessment

### `POST /landing/evaluate`
* `{"simulation_id":1}` → `{"simulation_id":1,"assessment":{…}}` (stored combined assessment)
* `{"spacecraft_id":1,"latitude_deg":…,"longitude_deg":…,"radius_m":1500,"dataset_id":null,"allow_synthetic":false,"params":null}` → `{"surface_assessment":{…},"provenance":{…},"disclaimer":"…"}` (site-only; no trajectory).

`assessment = {overall, surface_assessment, trajectory_assessment, vehicle_assessment, issues[], explanation, uncertainty, limitations[]}`
* each sub-assessment: `{status, checks:[{check,status,value,limit,unit,margin}], issues[], …}`; `status ∈ within_limits | outside_limits | not_assessed | no_terrain_data | no_touchdown | touchdown_outside_analysed_region`.
* `overall ∈ limits_exceeded | within_all_assessed_limits | insufficient_data_or_not_fully_assessed`. The word "safe" is intentionally never used; `within_all_assessed_limits` does **not** guarantee a safe landing.
* `surface_assessment` adds `terrain_classification`, `point_values`, `footprint{radius_m,missing_fraction,max_slope_deg,relief_m,best_fit_plane_tilt_deg}`, and `explanation` (same structure as candidate explanations).
* `uncertainty = {level, factors[], dem_resolution_m, min_resolvable_feature_m, dem_vertical_accuracy_m}`.

## Missions & users
* `POST /missions` (201) `{"name","description?","region_id?","spacecraft_id?","simulation_id?","user_id?"}` · `GET /missions` · `GET /missions/{id}` (adds `simulation` + `landing_assessment`) · `GET /missions/{id}/report` (JSON report assembled only from stored results: spacecraft, region, simulation, final_state, landing_assessment, terrain_analysis, disclaimer).
* `POST /users` `{"username"}` (201, 409 duplicate) · `GET /users`.

## Changes vs. the initial endpoint list
Added: `/lunar/elevation`, `/terrain/analysis/{id}[/layers/{layer}]`, `/trajectory/suggest-ignition`, `/missions/{id}/report`, `/users`, `POST /lunar/regions`.
`/api/simulation/create|{id}/run` keep the requested names; `/simulation/{id}/results` gained `t`, `fields`, `stride`.

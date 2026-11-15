# GeoMoon — Orbital Flight Simulator (Earth–Moon)

Scientific/educational simulator of one vehicle moving in the Earth–Moon(–Sun) system. **Not flight software.**
Source of truth for every number on screen is the backend (`backend/app/orbital/`); the 2-D map, 3-D scene, telemetry,
graphs and timeline all read the same stored sample arrays.

## 1. Architecture (stage 1)

```
backend/app/orbital/
  constants.py   GM, radii, J2, g0 … (IERS/IAU/GRAIL values)
  ephemeris.py   time-dependent Moon & Sun positions, Earth rotation angle, Moon-fixed axes, frames
  dynamics.py    equations of motion (Earth + Moon + Sun third-body, J2, optional drag), thrust attitude modes, Kepler<->state
  model.py       dataclasses: Vehicle/Engine, InitialState, Command, Mission, SimOptions (+ validation)
  simulation.py  incremental propagator with events, commands, control, truncate/re-integrate, DEM-coupled Moon contact
  planner.py     Lambert (universal variables) + least-squares shooting on the full n-body model; descent planner
  telemetry.py   vectorised derived telemetry (21+ series), apsis/closest-approach events
  manager.py     in-memory registry + SQLite row + npz sample store (survives restarts)
backend/app/api/routes_orbital.py   /api/orbital/*  (REST + WebSocket)
frontend/src/pages/OrbitalPage.tsx  page "Орбитальный полёт"
frontend/src/components/orbital/    OrbitMap2D (canvas), OrbitScene3D (R3F), SetupPanel, ControlPanel, TimeBar, LiveTelemetry, OrbitGraphs
frontend/src/components/moon/       MoonSurface (global DEM displacement), SpherePatch (curved high-res LOD patch)
```

Data flow: `config → Simulation.advance() → samples (t, r, v, fuel, thrust, throttle) → npz + DB → /trajectory,/telemetry,/state,/events → UI`.
The UI only interpolates between core samples (Catmull-Rom); it never integrates physics.

## 2. Physics model

State `y = [r(3), v(3), fuel_kg]` in the **Earth-centred inertial** frame.

```
dr/dt = v
dv/dt = a_Earth + a_Moon + a_Sun + a_J2 [+ a_drag] + a_thrust
a_Earth = -mu_E r/|r|^3
a_body  = mu_b [ (r_b - r)/|r_b - r|^3  -  r_b/|r_b|^3 ]     (direct + indirect term, Earth-centred non-inertial frame)
a_J2    = standard zonal J2 acceleration of Earth
a_thrust= F u / m,    dfuel/dt = -F/(Isp g0)
```

* Integrators: SciPy `DOP853` (default, 8th order), `RK45`, or fixed-step `RK4`; user-set `rtol`, `max_step_s`; output cadence adaptive
  (period/240, clipped to 1 … 600 s) or fixed `sample_dt_s`.
* Events (terminal): Earth impact, Moon contact (sphere or **real DEM height** when installed, `use_dem_collision`); non-terminal: Moon SOI entry/exit,
  fuel exhausted, burn start/end, impulses, control changes; derived: perigee/apogee/periselene/aposelene.
  Contact speed ≤ `max_landing_speed_mps` is reported as *contact_speed_below_threshold* — never as "safe".
* Engines: constant throttle, timed burn (`duration_s`), manual commands during the run (`/control`), programmed command list, impulsive Δv
  (instant approximation of a short burn, mass via rocket equation; limited by propellant and reported as `impulse_limited`).
  Attitude modes: prograde/retrograde/radial/normal/anti-normal relative to Earth or Moon (`auto` = Moon inside its SOI), to Moon/Earth, fixed inertial vector,
  `surface_retro` (+`auto_throttle`: educational powered-descent guidance holding a vertical-rate profile while braking horizontal speed).
* Not modelled (documented limitations): Moon mascons/non-spherical lunar gravity, libration, relativistic terms, solar radiation pressure, attitude
  dynamics, Earth atmosphere beyond a coarse exponential model (off by default), engine ramp-up/gimbal, structural limits.

## 3. Frames (documented)

| Frame | Definition | Used for |
|---|---|---|
| **ECI** (inertial, Earth-centred) | J2000 mean equator/equinox, +z celestial north, metres | integration state, 2-D/3-D inertial views |
| Moon-centred inertial | ECI − r_Moon(t) | Moon-relative speed/elements, `frame=moon_centered` |
| **Earth-fixed** | rotation about z by the IERS Earth Rotation Angle | Earth surface start / lat-lon, `frame=earth_fixed` |
| **Moon-fixed** | rows = x (toward mean Earth, lon 0), z (spin axis ≈ ecliptic pole), y = z×x; synchronous rotation, libration neglected | lat/lon, DEM lookup, `frame=moon_fixed` |
| Vehicle-local | prograde/radial/normal axes from the state vector | thrust attitude modes |

Three.js mapping: ECI (x,y,z) → scene (x, z, −y) (proper rotation). Moon meshes are modelled in the body-fixed three frame and rotated by the
quaternion derived from the Moon axes returned by the core. Scene unit in the orbital view = 1000 km.

## 4. Ephemeris (time dependent)

Analytical low-precision series (Astronomical Almanac): Moon ≈0.3° longitude / 0.3° latitude / ~0.5 % distance; Sun ≈0.01°. General
precession removed to express positions in J2000. Verified against Meeus examples (tests: lon ≤ 0.5°, lat ≤ 0.3°, distance ≤ 3000 km).
**Not JPL DE.** If `astropy/jplephem` or a DE kernel is installed in the future, only `ephemeris.py` needs replacing.
Epoch (`options.epoch_iso`, default 2026-01-01T00:00Z) sets the Moon/Sun phase.

## 5. Planner (Mission Planning vs Free Flight)

`mission.kind = free_flight` → no planning. `lunar_flyby`, `lunar_orbit`, `to_moon`: grid search of burn time (first ≈1.3 orbits) × trip time with Lambert, then
least-squares shooting of the 3-component Δv vector on the **full n-body propagation** to hit the requested periselene altitude (regularised towards the
Lambert guess); `lunar_orbit` adds an LOI burn at periselene to circularise and **verifies** the achieved orbit with the full model.
`descent/landing`: de-orbit impulse + automatic braking; scans de-orbit phase to approach the requested lat/lon and the braking lead time to minimise contact speed.
Every plan returns `feasible`, `summary` (Δv, times, errors, evaluations), `notes` (e.g. *required Δv exceeds vehicle capacity*) and `limitations`
(impulsive burns, local optimum only, low-precision ephemeris, point-mass Moon). Missing data (e.g. no DEM) is reported, never invented.

## 6. Control during simulation

`POST /simulations/{id}/control` inserts a command at `t_s`: history before `t_s` and its events are kept, the future is re-integrated to `horizon_s`.
Manual open-ended commands are closed by the next manual command ("cut engines" = throttle 0). `/reset` clears manual commands.

## 7. Moon rendering / LOD (also used by the Landing scene)

* `MoonSurface`: sphere displaced by the global DEM grid (`/lunar/globe`); without a global DEM a smooth reference sphere is drawn and the note says so.
* `SpherePatch`: high-resolution terrain window (`/lunar/terrain`) curved onto the sphere, radial vertices `(R + k·h)·unit(lat,lon)`, holes for no-data cells.
  The orbital scene fetches a 30 km patch when the vehicle is < 120 km above the surface and re-fetches when it moves > 12 km.
* **Landing Simulation**: automatic view — sphere (global DEM + curved patch + trajectory in the body-fixed frame) while the vehicle is above
  ≈ max(0.6 × terrain window, 8 km), local terrain view below (hysteresis 0.8). Manual override «Авто / Сфера / Рельеф».

## 8. Tests

`backend/tests/test_orbital.py` (30 tests): Julian date, Moon vs Meeus, Sun vs Meeus, sidereal period, ERA at J2000, orthonormal frames, Moon-fixed round-trip,
surface start global→local, gravity magnitude & independent three-body sum, circular-orbit period/energy/angular momentum, integrator agreement and tolerance
convergence, Kepler round-trip, Lambert, rocket equation (impulse & finite burn, exhaustion), manual-control history preservation, Earth impact, Moon contact
classification, guided soft descent, DEM height coupling, planner flyby / insufficient fuel, API consistency (2-D = 3-D source of truth), persistence across app instances.
Frontend: `src/lib/orbital.test.ts` (9) and `e2e/orbital.cjs` (17 browser checks).

## 9. Stages (as implemented)

1 architecture & docs → 2 physics core (ephemeris, frames, gravity, propagator, events) → 3 planner + 2-D map → 4 synchronized 3-D scene (spheres, DEM, LOD, fullscreen)
→ 5 vehicle/engine control → 6 telemetry + 9 graphs → 7 time control (step ±, ×0.25 … ×100000) → 8 spherical Moon with DEM → 9 integration with Landing Simulation → 10 tests, docs.

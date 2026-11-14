// Declarative field specs: unit, bounds, WHERE THE BOUND COMES FROM, and a validator. The UI shows `origin`
// next to each limit so no constraint is arbitrary. "api" = enforced by the GeoMoon core schema.
export type Origin = 'api' | 'physics' | 'ui'

export interface FieldSpec {
  key: string
  label: string
  unit: string
  min?: number
  max?: number
  minExclusive?: boolean
  integer?: boolean
  optional?: boolean
  origin: Origin
  help: string
}

export function validateNumber(raw: string, spec: FieldSpec): string | null {
  const s = raw.trim()
  if (s === '') return spec.optional ? null : 'Required'
  const v = Number(s.replace(',', '.'))
  if (!Number.isFinite(v)) return 'Must be a number'
  if (spec.integer && !Number.isInteger(v)) return 'Must be an integer'
  if (spec.min !== undefined && (spec.minExclusive ? v <= spec.min : v < spec.min)) return `Must be ${spec.minExclusive ? '>' : '≥'} ${spec.min} ${spec.unit}`.trim()
  if (spec.max !== undefined && v > spec.max) return `Must be ≤ ${spec.max} ${spec.unit}`.trim()
  return null
}

export function parseNum(raw: string): number | null {
  const s = raw.trim()
  if (s === '') return null
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

export const ORIGIN_LABEL: Record<Origin, string> = {
  api: 'limit enforced by the GeoMoon core API schema',
  physics: 'physical requirement (value must be physically meaningful)',
  ui: 'input-format limit only',
}

const A = 'api' as const, P = 'physics' as const

export const SC_FIELDS: Record<string, FieldSpec> = {
  dry_mass_kg: { key: 'dry_mass_kg', label: 'Dry mass', unit: 'kg', min: 0, minExclusive: true, max: 1e7, origin: A, help: 'Vehicle mass without propellant. Must be > 0 (physics); upper bound is the API limit.' },
  fuel_mass_kg: { key: 'fuel_mass_kg', label: 'Propellant mass', unit: 'kg', min: 0, max: 1e7, origin: A, help: 'Available propellant. 0 = unpowered ballistic descent.' },
  length_m: { key: 'length_m', label: 'Length', unit: 'm', min: 0, minExclusive: true, max: 100, origin: A, help: 'Hull length.' },
  width_m: { key: 'width_m', label: 'Width', unit: 'm', min: 0, minExclusive: true, max: 100, origin: A, help: 'Hull width.' },
  height_m: { key: 'height_m', label: 'Height', unit: 'm', min: 0, minExclusive: true, max: 100, origin: A, help: 'Hull height (used for the default centre-of-gravity estimate).' },
  gear_span_m: { key: 'gear_span_m', label: 'Landing-gear span', unit: 'm', min: 0, minExclusive: true, max: 100, origin: A, help: 'Diameter of the circle through the landing pads. Defines the landing footprint radius and the static tipping angle.' },
  pad_diameter_m: { key: 'pad_diameter_m', label: 'Pad diameter', unit: 'm', min: 0, minExclusive: true, max: 10, origin: A, help: 'Footprint pad size (adds to footprint radius).' },
  gear_height_m: { key: 'gear_height_m', label: 'Gear clearance', unit: 'm', min: 0, max: 20, origin: A, help: 'Hull clearance above ground when landed; terrain relief inside the footprint is compared with it.' },
  thrust_n: { key: 'thrust_n', label: 'Thrust per engine', unit: 'N', min: 0, minExclusive: true, max: 1e8, origin: A, help: 'Vacuum thrust of ONE engine at full throttle.' },
  number_of_engines: { key: 'number_of_engines', label: 'Number of engines', unit: '', min: 1, max: 64, integer: true, origin: A, help: 'Identical engines; total thrust = thrust × count.' },
  isp_s: { key: 'isp_s', label: 'Specific impulse', unit: 's', min: 0, minExclusive: true, max: 1000, origin: A, help: 'Isp; mass flow = F / (Isp·g0).' },
  fuel_consumption_kg_s: { key: 'fuel_consumption_kg_s', label: 'Mass flow (all engines, 100 %)', unit: 'kg/s', min: 0, minExclusive: true, origin: P, help: 'Total propellant flow at full throttle; the core derives Isp = F/(ṁ·g0).' },
  throttle_min: { key: 'throttle_min', label: 'Throttle min (when lit)', unit: '0–1', min: 0, max: 1, origin: A, help: 'Lowest throttle fraction while the engine is lit.' },
  throttle_max: { key: 'throttle_max', label: 'Throttle max', unit: '0–1', min: 0, minExclusive: true, max: 1, origin: A, help: 'Highest throttle fraction.' },
  max_vertical_touchdown_speed_m_s: { key: 'max_vertical_touchdown_speed_m_s', label: 'Max vertical touchdown speed', unit: 'm/s', min: 0, minExclusive: true, max: 100, origin: A, help: 'Landing-gear design limit — set from YOUR vehicle. Core default 2 m/s is an illustrative placeholder, not a certified value.' },
  max_horizontal_touchdown_speed_m_s: { key: 'max_horizontal_touchdown_speed_m_s', label: 'Max horizontal touchdown speed', unit: 'm/s', min: 0, max: 100, origin: A, help: 'Core default 1 m/s is an illustrative placeholder.' },
  max_tilt_deg: { key: 'max_tilt_deg', label: 'Max allowed landing slope', unit: '°', min: 0, minExclusive: true, max: 89.99, optional: true, origin: A, help: 'Terrain tilt the vehicle tolerates. Blank = derived static tipping angle atan((span/2)/CG height).' },
  max_acceleration_m_s2: { key: 'max_acceleration_m_s2', label: 'Max acceleration', unit: 'm/s²', min: 0, minExclusive: true, optional: true, origin: P, help: 'Structural / payload limit on thrust acceleration. Blank = not assessed.' },
  max_distance_to_target_m: { key: 'max_distance_to_target_m', label: 'Max miss distance', unit: 'm', min: 0, minExclusive: true, origin: A, help: 'Allowed distance between touchdown and target.' },
}

export const SCENARIO_FIELDS: Record<string, FieldSpec> = {
  initial_altitude_m: { key: 'initial_altitude_m', label: 'Initial altitude above surface', unit: 'm', min: 0, minExclusive: true, max: 5e6, origin: A, help: 'Height above the local surface at the start point.' },
  initial_speed_m_s: { key: 'initial_speed_m_s', label: 'Initial speed (surface-relative)', unit: 'm/s', min: 0, max: 5000, origin: A, help: 'Speed relative to the rotating lunar surface.' },
  azimuth_deg: { key: 'azimuth_deg', label: 'Heading (azimuth)', unit: '° from N, clockwise', min: -360, max: 360, origin: A, help: 'Horizontal direction of motion.' },
  flight_path_angle_deg: { key: 'flight_path_angle_deg', label: 'Flight-path angle', unit: '°', min: -90, max: 90, origin: A, help: '−90 = straight down, 0 = horizontal, + = climbing.' },
  initial_downrange_m: { key: 'initial_downrange_m', label: 'Start offset behind target', unit: 'm', min: 0, max: 1e7, origin: A, help: 'Ground distance from the target backwards along −heading.' },
  ignition_altitude_m: { key: 'ignition_altitude_m', label: 'Ignition altitude', unit: 'm', min: 0, minExclusive: true, origin: A, help: 'Open-loop scenario input: engine lights when height above surface ≤ this value.' },
  ignition_time_s: { key: 'ignition_time_s', label: 'Ignition time', unit: 's', min: 0, origin: A, help: 'Engine lights at this elapsed time.' },
  throttle: { key: 'throttle', label: 'Throttle', unit: '0–1', min: 0, max: 1, origin: A, help: 'Commanded throttle fraction (clamped to the engine throttle limits by the core).' },
  cutoff_speed_m_s: { key: 'cutoff_speed_m_s', label: 'Engine cut-off speed', unit: 'm/s', min: 0, optional: true, origin: A, help: 'Engine shuts down when surface-relative speed falls below this. Blank = burn until fuel runs out.' },
  output_dt_s: { key: 'output_dt_s', label: 'Output step', unit: 's', min: 0, minExclusive: true, max: 600, origin: A, help: 'Time-series sampling step (also the telemetry resolution).' },
  rk4_step_s: { key: 'rk4_step_s', label: 'RK4 step', unit: 's', min: 0, minExclusive: true, max: 10, origin: A, help: 'Fixed integration step when integrator = RK4.' },
  max_time_s: { key: 'max_time_s', label: 'Max simulated time', unit: 's', min: 0, minExclusive: true, max: 86400, origin: A, help: 'Stop if the vehicle has not landed by then.' },
  terrain_radius_m: { key: 'terrain_radius_m', label: 'Terrain window radius', unit: 'm', min: 1, max: 50000, origin: A, help: 'Radius of the real-DEM window used for touchdown and landing assessment.' },
}

export const TERRAIN_FIELDS: Record<string, FieldSpec> = {
  latitude_deg: { key: 'latitude_deg', label: 'Latitude', unit: '°', min: -90, max: 90, origin: P, help: 'Planetocentric latitude, north positive.' },
  longitude_deg: { key: 'longitude_deg', label: 'Longitude', unit: '°', min: -180, max: 360, origin: A, help: 'East-positive; values up to 360 are wrapped by the core.' },
  radius_m: { key: 'radius_m', label: 'Analysis radius', unit: 'm', min: 1, max: 200000, origin: A, help: 'Half-width of the analysed window. Must cover at least 3×3 DEM cells.' },
  slope_limit_deg: { key: 'slope_limit_deg', label: 'Allowed slope', unit: '°', min: 0, minExclusive: true, max: 89.99, origin: A, help: 'Slope at which the slope score reaches 0 and cells are flagged steep.' },
  footprint_radius_m: { key: 'footprint_radius_m', label: 'Minimum site radius', unit: 'm', min: 0, minExclusive: true, max: 1000, origin: A, help: 'The entire disk of this radius must be suitable and hazard-free. Fill from a vehicle with “Use vehicle footprint”.' },
  window_m: { key: 'window_m', label: 'Analysis window', unit: 'm', min: 0, minExclusive: true, max: 5000, origin: A, help: 'Neighbourhood size for roughness, relief and topographic position.' },
  roughness_limit_m: { key: 'roughness_limit_m', label: 'Roughness limit', unit: 'm', min: 0, minExclusive: true, origin: A, help: 'RMS residual at which the roughness score reaches 0.' },
  relief_limit_m: { key: 'relief_limit_m', label: 'Local relief limit', unit: 'm', min: 0, minExclusive: true, origin: A, help: 'max − min within the window at which the relief score reaches 0.' },
  tpi_limit_m: { key: 'tpi_limit_m', label: 'Topographic anomaly limit', unit: 'm', min: 0, minExclusive: true, origin: A, help: '|z − window mean| above which a cell is flagged (crater floors/rims, mounds).' },
  hazard_safe_distance_m: { key: 'hazard_safe_distance_m', label: 'Hazard clearance distance', unit: 'm', min: 0, minExclusive: true, origin: A, help: 'Distance from the nearest hazard at which the hazard score reaches 1.' },
  suitable_threshold: { key: 'suitable_threshold', label: 'Suitability threshold', unit: '0–1', min: 0, minExclusive: true, max: 1, origin: A, help: 'Minimum weighted score for a cell to count as suitable.' },
  max_candidates: { key: 'max_candidates', label: 'Max candidate sites', unit: '', min: 1, max: 50, integer: true, origin: A, help: 'Number of ranked candidate sites returned.' },
}

export function validateAll(values: Record<string, string>, specs: Record<string, FieldSpec>, keys?: string[]): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const k of keys ?? Object.keys(specs)) {
    const spec = specs[k]
    if (!spec) continue
    const e = validateNumber(values[k] ?? '', spec)
    if (e) errs[k] = e
  }
  return errs
}

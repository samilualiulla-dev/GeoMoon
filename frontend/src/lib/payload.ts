// Pure functions turning form state into core API payloads (and back-checks). No physics here.
import type { AnalysisParams, BurnPlan, InitialConditions, SimSettings, SimulationCreate, SpacecraftPayload, TerrainOptions } from '../api/types'
import { parseNum } from './validation'

export interface SpacecraftForm {
  name: string
  dry_mass_kg: string; fuel_mass_kg: string
  length_m: string; width_m: string; height_m: string
  gear_span_m: string; pad_diameter_m: string; gear_height_m: string
  thrust_n: string; number_of_engines: string
  flowMode: 'isp' | 'mass_flow'
  isp_s: string; fuel_consumption_kg_s: string
  throttle_min: string; throttle_max: string
  max_vertical_touchdown_speed_m_s: string; max_horizontal_touchdown_speed_m_s: string
  max_tilt_deg: string; max_acceleration_m_s2: string; max_distance_to_target_m: string
}

// ILLUSTRATIVE defaults (the example from the project brief) — NOT validated spacecraft specifications.
export const DEFAULT_SPACECRAFT_FORM: SpacecraftForm = {
  name: 'Условный посадочный аппарат',
  dry_mass_kg: '900', fuel_mass_kg: '300',
  length_m: '3', width_m: '3', height_m: '4',
  gear_span_m: '5', pad_diameter_m: '0.3', gear_height_m: '0.5',
  thrust_n: '5000', number_of_engines: '1',
  flowMode: 'isp', isp_s: '300', fuel_consumption_kg_s: '',
  throttle_min: '0', throttle_max: '1',
  max_vertical_touchdown_speed_m_s: '2', max_horizontal_touchdown_speed_m_s: '1',
  max_tilt_deg: '', max_acceleration_m_s2: '', max_distance_to_target_m: '100',
}

const n = (s: string): number => Number(s.replace(',', '.'))

export function spacecraftPayload(f: SpacecraftForm): SpacecraftPayload {
  return {
    name: f.name.trim(),
    dry_mass_kg: n(f.dry_mass_kg), fuel_mass_kg: n(f.fuel_mass_kg),
    dimensions: { length_m: n(f.length_m), width_m: n(f.width_m), height_m: n(f.height_m) },
    landing_gear: { span_m: n(f.gear_span_m), pad_diameter_m: n(f.pad_diameter_m), gear_height_m: n(f.gear_height_m), cg_height_m: null },
    engine: {
      thrust_n: n(f.thrust_n), number_of_engines: n(f.number_of_engines),
      isp_s: f.flowMode === 'isp' ? n(f.isp_s) : null,
      fuel_consumption_kg_s: f.flowMode === 'mass_flow' ? n(f.fuel_consumption_kg_s) : null,
      throttle_min: n(f.throttle_min), throttle_max: n(f.throttle_max),
    },
    constraints: {
      max_vertical_touchdown_speed_m_s: n(f.max_vertical_touchdown_speed_m_s),
      max_horizontal_touchdown_speed_m_s: n(f.max_horizontal_touchdown_speed_m_s),
      max_tilt_deg: parseNum(f.max_tilt_deg), max_acceleration_m_s2: parseNum(f.max_acceleration_m_s2),
      max_distance_to_target_m: n(f.max_distance_to_target_m),
    },
  }
}

export function spacecraftFieldKeys(f: SpacecraftForm): string[] {
  const base = ['dry_mass_kg', 'fuel_mass_kg', 'length_m', 'width_m', 'height_m', 'gear_span_m', 'pad_diameter_m', 'gear_height_m',
    'thrust_n', 'number_of_engines', 'throttle_min', 'throttle_max', 'max_vertical_touchdown_speed_m_s',
    'max_horizontal_touchdown_speed_m_s', 'max_tilt_deg', 'max_acceleration_m_s2', 'max_distance_to_target_m']
  return [...base, f.flowMode === 'isp' ? 'isp_s' : 'fuel_consumption_kg_s']
}

/** Cross-field checks mirroring the core's rules, so users get instant feedback. The core remains authoritative. */
export function spacecraftCrossErrors(f: SpacecraftForm): Record<string, string> {
  const e: Record<string, string> = {}
  const tmin = n(f.throttle_min), tmax = n(f.throttle_max)
  if (Number.isFinite(tmin) && Number.isFinite(tmax) && tmin > tmax) e.throttle_min = 'Должно быть ≤ макс. дросселя'
  const w = n(f.width_m), span = n(f.gear_span_m)
  if (Number.isFinite(w) && Number.isFinite(span) && span < 0.5 * w) e.gear_span_m = 'Неправдоподобно мала по сравнению с шириной корпуса (правило ядра: база ≥ 0,5 × ширина)'
  if (!f.name.trim()) e.name = 'Обязательное поле'
  return e
}

export interface ScenarioForm {
  initial_altitude_m: string; initial_speed_m_s: string
  azimuth_deg: string; flight_path_angle_deg: string; initial_downrange_m: string
  burnMode: BurnPlan['mode']
  ignition_altitude_m: string; ignition_time_s: string
  throttle: string
  direction: BurnPlan['direction']
  cutoff_speed_m_s: string
  scheduleText: string  // "t_s, throttle" per line
  integrator: SimSettings['integrator']
  output_dt_s: string; rk4_step_s: string; max_time_s: string
  moon_rotation: boolean
  terrain_enabled: boolean; terrain_radius_m: string
}

export const DEFAULT_SCENARIO_FORM: ScenarioForm = {
  initial_altitude_m: '300', initial_speed_m_s: '0',
  azimuth_deg: '0', flight_path_angle_deg: '-90', initial_downrange_m: '0',
  burnMode: 'none', ignition_altitude_m: '120', ignition_time_s: '0', throttle: '1', direction: 'retrograde',
  cutoff_speed_m_s: '', scheduleText: '0, 0\n10, 1',
  integrator: 'dop853', output_dt_s: '1', rk4_step_s: '0.05', max_time_s: '3600', moon_rotation: true,
  terrain_enabled: true, terrain_radius_m: '1500',
}

export function parseSchedule(text: string): { rows: [number, number][]; error: string | null } {
  const rows: [number, number][] = []
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const [i, line] of lines.entries()) {
    const parts = line.split(/[,;\s]+/).filter(Boolean)
    if (parts.length !== 2) return { rows, error: `Строка ${i + 1}: ожидается «время_с, дроссель»` }
    const t = Number(parts[0]), th = Number(parts[1])
    if (!Number.isFinite(t) || !Number.isFinite(th)) return { rows, error: `Строка ${i + 1}: не число` }
    if (t < 0 || th < 0 || th > 1) return { rows, error: `Строка ${i + 1}: нужны время ≥ 0 и 0 ≤ дроссель ≤ 1` }
    if (rows.length && t <= rows[rows.length - 1][0]) return { rows, error: `Строка ${i + 1}: время должно строго возрастать` }
    rows.push([t, th])
  }
  if (!rows.length) return { rows, error: 'Расписание пустое' }
  return { rows, error: null }
}

export function scenarioFieldKeys(f: ScenarioForm): string[] {
  const k = ['initial_altitude_m', 'initial_speed_m_s', 'azimuth_deg', 'flight_path_angle_deg', 'initial_downrange_m', 'output_dt_s', 'max_time_s']
  if (f.integrator === 'rk4') k.push('rk4_step_s')
  if (f.terrain_enabled) k.push('terrain_radius_m')
  if (f.burnMode !== 'none') k.push('throttle', 'cutoff_speed_m_s')
  if (f.burnMode === 'altitude') k.push('ignition_altitude_m')
  if (f.burnMode === 'time') k.push('ignition_time_s')
  return k
}

export function buildInitialConditions(f: ScenarioForm, target: { lat: number; lon: number }): InitialConditions {
  const burn: BurnPlan = {
    mode: f.burnMode,
    ignition_altitude_m: f.burnMode === 'altitude' ? n(f.ignition_altitude_m) : null,
    ignition_time_s: f.burnMode === 'time' ? n(f.ignition_time_s) : null,
    throttle: f.burnMode === 'schedule' ? 1 : n(f.throttle),
    direction: f.direction, fixed_enu: null,
    cutoff_speed_m_s: f.burnMode === 'schedule' ? null : parseNum(f.cutoff_speed_m_s),
    throttle_schedule: f.burnMode === 'schedule' ? parseSchedule(f.scheduleText).rows : null,
  }
  return {
    target_latitude_deg: target.lat, target_longitude_deg: target.lon,
    initial_altitude_m: n(f.initial_altitude_m), initial_speed_m_s: n(f.initial_speed_m_s),
    azimuth_deg: n(f.azimuth_deg), flight_path_angle_deg: n(f.flight_path_angle_deg),
    initial_downrange_m: n(f.initial_downrange_m), burn,
  }
}

export function buildSettings(f: ScenarioForm): SimSettings {
  return { integrator: f.integrator, output_dt_s: n(f.output_dt_s), rk4_step_s: n(f.rk4_step_s), max_time_s: n(f.max_time_s), rtol: 1e-9, atol: 1e-6, moon_rotation: f.moon_rotation }
}

export function buildSimulationCreate(args: {
  spacecraftId: number; regionId: number | null; scenario: ScenarioForm; target: { lat: number; lon: number }
  allowSynthetic: boolean; datasetId: string | null; terrainParams: AnalysisParams | null
}): SimulationCreate {
  const terrain: TerrainOptions = {
    enabled: args.scenario.terrain_enabled, radius_m: n(args.scenario.terrain_radius_m), dataset_id: args.datasetId,
    allow_synthetic: args.allowSynthetic, max_cells: null, params: args.terrainParams,
  }
  return {
    spacecraft_id: args.spacecraftId, region_id: args.regionId,
    initial_conditions: buildInitialConditions(args.scenario, args.target),
    settings: buildSettings(args.scenario), terrain,
  }
}

export const DEFAULT_ANALYSIS_PARAMS: AnalysisParams = {
  window_m: 60, roughness_method: 'detrended', slope_limit_deg: 10, roughness_limit_m: 0.5, relief_limit_m: 3, tpi_limit_m: 5,
  hazard_safe_distance_m: 50, footprint_radius_m: 15, suitable_threshold: 0.7,
  weights: { slope: 0.35, roughness: 0.2, relief: 0.2, hazard: 0.25 }, max_candidates: 5, min_candidate_separation_m: null,
}

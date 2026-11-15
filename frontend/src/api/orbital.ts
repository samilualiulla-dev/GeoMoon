// Orbital flight simulator API (/api/orbital/*). All numbers are SI (m, s, m/s, kg, N) exactly as returned by the core.
import { request } from './http'

export type V3 = [number, number, number]

export interface OrbEngine { name: string; thrust_n: number; isp_s: number }
export interface OrbVehicle { name: string; dry_mass_kg: number; fuel_mass_kg: number; engines: OrbEngine[]; drag_cd?: number; drag_area_m2?: number }
export interface OrbInitial {
  kind: 'earth_orbit' | 'moon_orbit' | 'lat_lon_surface' | 'cartesian'
  body: 'earth' | 'moon'
  periapsis_alt_m: number; apoapsis_alt_m: number | null
  inclination_deg: number; raan_deg: number; arg_periapsis_deg: number; true_anomaly_deg: number
  lat_deg: number; lon_deg: number; altitude_m: number
  r_m: V3 | null; v_mps: V3 | null
}
export interface OrbCommand {
  id?: string; t_start_s: number; duration_s: number | null; throttle: number; direction: string; reference: string
  vector?: V3 | null; delta_v_mps?: number | null; auto_throttle?: boolean; source?: string; label?: string
}
export interface OrbMission { kind: string; target_altitude_m: number; target_lat_deg: number | null; target_lon_deg: number | null; duration_s: number }
export interface OrbOptions {
  include_moon: boolean; include_sun: boolean; include_earth_j2: boolean; include_drag: boolean
  integrator: 'DOP853' | 'RK45' | 'RK4'; rtol: number; atol: number; max_step_s: number
  sample_dt_s: number | null; sample_dt_max_s: number; use_dem_collision: boolean; stop_on_collision: boolean; max_landing_speed_mps: number; epoch_iso: string
}
export interface OrbConfig { name: string; vehicle: OrbVehicle; initial: OrbInitial; mission: OrbMission; options: OrbOptions; commands: OrbCommand[] }

export interface OrbEvent { t_s: number; type: string; command?: string; details: Record<string, unknown> }
export interface OrbSummary {
  id: string; name: string; status: 'ready' | 'completed' | 'landed' | 'impact' | 'failed'; t_now_s: number; samples: number
  final_state: { t_s: number; r: V3; v: V3; fuel_kg: number; mass_kg: number }; config: OrbConfig; epoch_iso: string; mission_duration_s: number
  plan?: OrbPlan | null
}
export interface OrbPlan { feasible: boolean; commands: OrbCommand[]; summary: Record<string, unknown>; notes: string[]; limitations: string[]; suggested_duration_s?: number }
export interface OrbScenario { id: string; title: string; description: string; needs_plan: boolean; config: Partial<OrbConfig> & Record<string, unknown> }
export interface OrbCatalogue { scenarios: OrbScenario[]; directions: string[]; mission_kinds: string[]; graphs: Record<string, { title: string; series: string[] }> }
export interface OrbTrajectory {
  frame: string; t_s: number[]; r_m: V3[]; moon_r_m: V3[]; speed_mps: number[]; thrust_n: number[]; total_samples: number; status: string
}
export interface OrbTelemetry { t_s: number[]; series: Record<string, (number | null)[]>; units: Record<string, string> }
export interface OrbEphemerides { t_s: number[]; moon_r_m: V3[]; sun_r_m: V3[]; moon_axes: number[][][]; earth_rotation_rad: number[]; epoch_iso: string }
export interface OrbState {
  t_s: number; r_m: V3; v_mps: V3; moon: { r_m: V3; v_mps: V3 }; sun_r_m: V3; earth_rotation_rad: number; moon_axes: number[][]
  moon_fixed: { lat_deg: number; lon_deg: number; radius_m: number; alt_m: number }; earth_fixed: { lat_deg: number; lon_deg: number; alt_m: number }
  telemetry: Record<string, number>; status: string
}

const B = '/orbital'
export const orbApi = {
  catalogue: () => request<OrbCatalogue>('GET', `${B}/scenarios`),
  plan: (cfg: unknown) => request<OrbPlan>('POST', `${B}/plan`, { body: cfg, timeoutMs: 180_000 }),
  create: (cfg: unknown, applyPlan = false) => request<OrbSummary>('POST', `${B}/simulations`, { body: cfg, query: { apply_plan: applyPlan }, timeoutMs: 180_000 }),
  list: () => request<{ simulations: { id: string; name: string; status: string; t_now_s: number; mission: string | null; updated_at: string | null }[] }>('GET', `${B}/simulations`),
  get: (id: string) => request<OrbSummary>('GET', `${B}/simulations/${id}`),
  remove: (id: string) => request<unknown>('DELETE', `${B}/simulations/${id}`),
  run: (id: string, body: Record<string, unknown> = {}) => request<OrbSummary>('POST', `${B}/simulations/${id}/run`, { body, timeoutMs: 300_000 }),
  reset: (id: string, keepManual = false) => request<OrbSummary>('POST', `${B}/simulations/${id}/reset`, { body: { keep_manual: keepManual } }),
  replaceConfig: (id: string, cfg: unknown) => request<OrbSummary>('PUT', `${B}/simulations/${id}/config`, { body: cfg }),
  control: (id: string, cmd: Record<string, unknown>) => request<OrbSummary>('POST', `${B}/simulations/${id}/control`, { body: cmd, timeoutMs: 300_000 }),
  state: (id: string, t: number) => request<OrbState>('GET', `${B}/simulations/${id}/state`, { query: { t_s: t } }),
  trajectory: (id: string, q: { max_points?: number; frame?: string; t0_s?: number; t1_s?: number } = {}) =>
    request<OrbTrajectory>('GET', `${B}/simulations/${id}/trajectory`, { query: { max_points: 2500, ...q } }),
  telemetry: (id: string, series?: string[], max_points = 2500) =>
    request<OrbTelemetry>('GET', `${B}/simulations/${id}/telemetry`, { query: { series: series?.join(','), max_points } }),
  events: (id: string) => request<{ events: OrbEvent[] }>('GET', `${B}/simulations/${id}/events`),
  ephemerides: (epoch_iso: string, t0_s: number, t1_s: number, n = 400) =>
    request<OrbEphemerides>('GET', `${B}/bodies/ephemerides`, { query: { epoch_iso, t0_s, t1_s, n } }),
}

export const DEFAULT_ORB_CONFIG: OrbConfig = {
  name: 'Новая симуляция',
  vehicle: { name: 'Ступень (демо)', dry_mass_kg: 8000, fuel_mass_kg: 60000, engines: [{ name: 'Основной двигатель', thrust_n: 200000, isp_s: 450 }], drag_cd: 2.2, drag_area_m2: 10 },
  initial: { kind: 'earth_orbit', body: 'earth', periapsis_alt_m: 300000, apoapsis_alt_m: null, inclination_deg: 28.5, raan_deg: 0, arg_periapsis_deg: 0, true_anomaly_deg: 0, lat_deg: 0, lon_deg: 0, altitude_m: 0, r_m: null, v_mps: null },
  mission: { kind: 'free_flight', target_altitude_m: 100000, target_lat_deg: null, target_lon_deg: null, duration_s: 6 * 86400 },
  options: { include_moon: true, include_sun: true, include_earth_j2: true, include_drag: false, integrator: 'DOP853', rtol: 1e-10, atol: 1e-6, max_step_s: 300, sample_dt_s: null, sample_dt_max_s: 600, use_dem_collision: true, stop_on_collision: true, max_landing_speed_mps: 5, epoch_iso: '2026-01-01T00:00:00Z' },
  commands: [],
}

import { expectArray, expectEqualLengthColumns, expectKeys, request, isRecord } from './http'
import type {
  AnalysisResult, AnalyzeRequest, DataSources, GlobeData, ElevationPoint, Health, IgnitionSuggestion, LandingSiteResponse,
  Mission, MissionDetail, MissionReport, Region, SimResults, Simulation, SimulationCreate, Spacecraft, SpacecraftPayload,
  TerrainWindow, AnalysisParams,
} from './types'

const SERIES_REQUIRED = ['time_s', 'altitude_m', 'distance_to_surface_m', 'speed_surface_m_s', 'mass_kg', 'fuel_remaining_kg',
  'latitude_deg', 'longitude_deg', 'position_x_m', 'position_y_m', 'position_z_m', 'thrust_n', 'acceleration_m_s2']

export const api = {
  health: (signal?: AbortSignal) => request<Health>('GET', '/health', { timeoutMs: 6000, signal, guard: expectKeys<Health>('status', 'datasets_installed') }),

  dataSources: (refresh = false) =>
    request<DataSources>('GET', '/data/sources', { query: { refresh }, guard: expectKeys<DataSources>('installed', 'known_products') }),

  regions: () => request<Region[]>('GET', '/lunar/regions', { guard: expectArray<Region> }),
  createRegion: (b: { name: string; latitude_deg: number; longitude_deg: number; radius_m: number; dataset_id?: string | null }) =>
    request<Region>('POST', '/lunar/regions', { body: b }),

  terrain: (q: { latitude_deg: number; longitude_deg: number; radius_m: number; dataset_id?: string | null; max_grid?: number; allow_synthetic?: boolean }, signal?: AbortSignal) =>
    request<TerrainWindow>('GET', '/lunar/terrain', { query: q, timeoutMs: 60_000, signal, guard: expectKeys<TerrainWindow>('geometry', 'elevation_m', 'provenance') }),

  globe: (q: { dataset_id?: string | null; rows?: number; cols?: number; allow_synthetic?: boolean }, signal?: AbortSignal) =>
    request<GlobeData>('GET', '/lunar/globe', { query: q, timeoutMs: 120_000, signal, guard: expectKeys<GlobeData>('elevation_m', 'lat_north_deg', 'provenance') }),

  elevation: (q: { latitude_deg: number; longitude_deg: number; dataset_id?: string | null; allow_synthetic?: boolean }) =>
    request<ElevationPoint>('GET', '/lunar/elevation', { query: q, guard: expectKeys<ElevationPoint>('elevation_m') }),

  analyze: (b: AnalyzeRequest, signal?: AbortSignal) =>
    request<AnalysisResult>('POST', '/terrain/analyze', { body: b, timeoutMs: 120_000, signal, guard: expectKeys<AnalysisResult>('layers', 'summary', 'geometry', 'candidates') }),

  landingSite: (b: { spacecraft_id: number; latitude_deg: number; longitude_deg: number; radius_m: number; dataset_id?: string | null; allow_synthetic: boolean; params?: AnalysisParams | null }) =>
    request<LandingSiteResponse>('POST', '/landing/evaluate', { body: b, timeoutMs: 120_000 }),

  createSpacecraft: (b: SpacecraftPayload & { is_demo?: boolean }) => request<Spacecraft>('POST', '/spacecraft', { body: b, guard: expectKeys<Spacecraft>('id', 'derived') }),
  spacecraftList: () => request<Spacecraft[]>('GET', '/spacecraft', { guard: expectArray<Spacecraft> }),
  spacecraft: (id: number) => request<Spacecraft>('GET', `/spacecraft/${id}`),
  updateSpacecraft: (id: number, b: SpacecraftPayload & { is_demo?: boolean }) => request<Spacecraft>('PUT', `/spacecraft/${id}`, { body: b }),
  deleteSpacecraft: (id: number) => request<{ deleted: number }>('DELETE', `/spacecraft/${id}`),
  suggestIgnition: (b: { spacecraft_id: number; initial_altitude_m: number; initial_speed_m_s: number; throttle: number }) =>
    request<IgnitionSuggestion>('POST', '/trajectory/suggest-ignition', { body: b }),

  createSimulation: (b: SimulationCreate) => request<Simulation>('POST', '/simulation/create', { body: b, guard: expectKeys<Simulation>('id', 'status') }),
  runSimulation: (id: number) => request<Simulation>('POST', `/simulation/${id}/run`, { query: { wait: false }, timeoutMs: 30_000 }),
  simulation: (id: number, signal?: AbortSignal) => request<Simulation>('GET', `/simulation/${id}`, { signal, guard: expectKeys<Simulation>('id', 'status') }),
  simulationResults: (id: number) =>
    request<SimResults>('GET', `/simulation/${id}/results`, {
      timeoutMs: 60_000,
      guard: (d) => {
        const r = expectKeys<SimResults>('time_series', 'summary', 'landing_assessment', 'trajectory')(d)
        expectEqualLengthColumns(r.time_series, SERIES_REQUIRED)
        return r
      },
    }),

  createMission: (b: { name: string; description?: string | null; region_id?: number | null; spacecraft_id?: number | null; simulation_id?: number | null }) =>
    request<Mission>('POST', '/missions', { body: b }),
  missions: () => request<Mission[]>('GET', '/missions', { guard: expectArray<Mission> }),
  mission: (id: number) => request<MissionDetail>('GET', `/missions/${id}`),
  missionReport: (id: number) => request<MissionReport>('GET', `/missions/${id}/report`, { guard: (d) => { if (!isRecord(d) || !('mission' in d)) throw new Error('no mission'); return d as unknown as MissionReport } }),
}

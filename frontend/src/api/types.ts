// Types mirror the GeoMoon core API (see /API_CONTRACT.md). Units are in the field names.

export interface ApiErrorBody { error: { code: string; message: string; details?: Record<string, unknown> } }

export interface Health {
  status: string; service: string; api_version: string
  datasets_installed: number; real_datasets_installed: number; supplementary_datasets?: number
}

export interface Coverage {
  lat_range_deg: [number, number] | null
  lon_range_deg: [number, number] | null
  includes_pole: boolean
  nominal: string | null
}

export interface DatasetInfo {
  id: string; name: string; provider: string; product: string
  version: string | null; citation: string | null; url: string | null
  resolution_m_per_px: number | null
  coverage: Coverage
  crs: string | null; is_geographic_crs: boolean
  shape_rows_cols: [number, number]
  elevation_unit: string; vertical_reference_radius_m: number
  synthetic: boolean; quantity: string; unit: string; usable_as_dem: boolean
  min_radius_m: number | null; recommended_radius_m: number | null
  status: string; warnings: string[]; file: string
}

export interface KnownProduct { product: string; provider: string; url: string; format: string; coverage: string; notes: string }

export interface DataSources {
  installed: DatasetInfo[]
  rejected_files: Record<string, string>
  known_products: KnownProduct[]
  dem_directory: string
  notice: string
}

export interface Region {
  id: number; name: string; latitude_deg: number; longitude_deg: number; radius_m: number
  data_source_id: number | null; dataset_key: string | null
}

export interface Grid { rows: number; cols: number; data: (number | null)[][] }
export interface GridLayer extends Grid { unit: string; description: string; min: number | null; max: number | null }

export interface Geometry {
  rows: number; cols: number
  cell_size_m: { dx: number; dy: number }
  row0_is_north: boolean
  center: { latitude_deg: number; longitude_deg: number }
  corners: Record<'north_west' | 'north_east' | 'south_west' | 'south_east', { latitude_deg: number; longitude_deg: number }>
  reference_radius_m: number
  valid_fraction: number
}

export interface Provenance {
  dataset_id: string; name: string; provider: string; product: string; version: string | null
  resolution_m_per_px: number | null; crs: string | null; citation: string | null; url: string | null
  synthetic: boolean; warnings: string[]; data_notice: string
}

export interface ElevationStats {
  min_m: number | null; max_m: number | null; mean_m: number | null; std_m?: number | null
  range_m: number | null; valid_fraction: number
}

export interface TerrainWindow {
  geometry: Geometry
  elevation_m: Grid
  statistics: ElevationStats
  provenance: Provenance
}

export interface ElevationPoint {
  latitude_deg: number; longitude_deg: number; elevation_m: number
  dataset_id: string; reference_radius_m: number; synthetic: boolean
}

export interface AnalysisParams {
  window_m: number
  roughness_method: 'std' | 'detrended'
  slope_limit_deg: number
  roughness_limit_m: number
  relief_limit_m: number
  tpi_limit_m: number
  hazard_safe_distance_m: number
  footprint_radius_m: number
  suitable_threshold: number
  weights: { slope: number; roughness: number; relief: number; hazard: number }
  max_candidates: number
  min_candidate_separation_m: number | null
}

export interface AnalyzeRequest {
  latitude_deg: number; longitude_deg: number; radius_m: number
  dataset_id?: string | null
  params: AnalysisParams
  layers?: string[]
  max_grid?: number
  allow_synthetic: boolean
  region_id?: number | null
  save?: boolean
}

export interface Stat4 { min: number | null; max: number | null; mean: number | null; p95: number | null }

export interface ExplanationComponent {
  value: number | null; limit: number; unit: string; score: number | null; weight: number; weighted_contribution: number | null
}
export interface Explanation {
  row: number; col: number
  classification: 'geometrically_suitable' | 'geometrically_unsuitable' | 'insufficient_data'
  suitability: number | null
  components: Record<'slope' | 'roughness' | 'relief' | 'hazard', ExplanationComponent>
  notes: string[]; disclaimer: string
}
export interface Candidate {
  row: number; col: number; lat: number; lon: number; elevation_m: number
  footprint_mean_suitability: number; explanation: Explanation
}

export interface AnalysisSummary {
  elevation: ElevationStats
  slope_deg: Stat4; roughness_m: Stat4; local_relief_m: Stat4; suitability: Stat4
  class_fractions: Record<'geometrically_unsuitable' | 'geometrically_suitable' | 'insufficient_data', number>
  hazard_fraction: number
  resolution_m: { dx: number; dy: number }
  min_resolvable_feature_m: number
  warnings: string[]
}

export interface AnalysisResult {
  geometry: Geometry
  summary: AnalysisSummary
  parameters: AnalysisParams
  candidates: Candidate[]
  layers: Record<string, GridLayer>
  provenance: Provenance
  disclaimer: string
  analysis_id?: number
}

// ---- spacecraft ----
export interface SpacecraftPayload {
  name: string
  dry_mass_kg: number; fuel_mass_kg: number
  dimensions: { length_m: number; width_m: number; height_m: number }
  landing_gear: { span_m: number; pad_diameter_m: number; gear_height_m: number; cg_height_m: number | null }
  engine: {
    thrust_n: number; number_of_engines: number
    isp_s: number | null; fuel_consumption_kg_s: number | null
    throttle_min: number; throttle_max: number
  }
  constraints: {
    max_vertical_touchdown_speed_m_s: number; max_horizontal_touchdown_speed_m_s: number
    max_tilt_deg: number | null; max_acceleration_m_s2: number | null; max_distance_to_target_m: number
  }
}
export interface SpacecraftDerived {
  total_mass_kg: number; thrust_to_weight_lunar_surface: number; effective_isp_s: number
  mass_flow_full_throttle_kg_s: number; max_burn_time_s: number | null; delta_v_ideal_m_s: number
  footprint_radius_m: number; tipping_angle_deg: number; max_tilt_deg_used: number
}
export interface Spacecraft extends SpacecraftPayload { id: number; user_id: number | null; derived: SpacecraftDerived; warnings: string[]; created_at: string }

export interface IgnitionSuggestion {
  feasible: boolean; reason?: string
  ignition_altitude_m?: number; constant_decel_m_s2?: number; speed_at_ignition_m_s?: number
  burn_time_s?: number; fuel_needed_kg?: number; fuel_available_kg?: number; margin?: number; note?: string
}

// ---- simulation ----
export type BurnMode = 'none' | 'altitude' | 'time' | 'schedule'
export interface BurnPlan {
  mode: BurnMode
  ignition_altitude_m: number | null
  ignition_time_s: number | null
  throttle: number
  direction: 'retrograde' | 'radial_up' | 'fixed_enu'
  fixed_enu: [number, number, number] | null
  cutoff_speed_m_s: number | null
  throttle_schedule: [number, number][] | null
}
export interface InitialConditions {
  target_latitude_deg: number; target_longitude_deg: number
  initial_altitude_m: number; initial_speed_m_s: number
  azimuth_deg: number; flight_path_angle_deg: number; initial_downrange_m: number
  burn: BurnPlan
}
export interface SimSettings {
  integrator: 'dop853' | 'rk4'; output_dt_s: number; rk4_step_s: number; max_time_s: number
  rtol: number; atol: number; moon_rotation: boolean
}
export interface TerrainOptions {
  enabled: boolean; radius_m: number; dataset_id: string | null; allow_synthetic: boolean
  max_cells: number | null; params: AnalysisParams | null
}
export interface SimulationCreate {
  spacecraft_id: number; region_id: number | null
  initial_conditions: InitialConditions; settings: SimSettings; terrain: TerrainOptions
}

export type SimStatus = 'created' | 'queued' | 'running' | 'completed' | 'failed'
export interface TouchdownSummary {
  latitude_deg: number; longitude_deg: number; time_s: number
  vertical_speed_m_s: number; horizontal_speed_m_s: number; speed_m_s: number
  flight_path_angle_deg: number; miss_distance_m: number; surface_height_m: number; mass_kg: number
}
export interface SimSummary {
  termination_reason: 'touchdown' | 'max_time_reached'
  duration_s: number
  touchdown: TouchdownSummary | null
  fuel_used_kg: number; fuel_remaining_kg: number
  peak_proper_acceleration_m_s2: number; max_speed_surface_m_s: number
  events: { t_s: number; event: string; altitude_m?: number; throttle?: number }[]
  integrator: string
  frames: Record<string, unknown>
  assumptions: string[]; limitations: string[]; warnings: string[]
  spacecraft_derived: SpacecraftDerived
  terrain_used: boolean; terrain_synthetic: boolean
  terrain_radius_m?: number | null; terrain_dataset?: string | null
}
export interface Simulation {
  id: number; status: SimStatus; spacecraft_id: number; region_id: number | null
  initial_conditions: InitialConditions; settings: SimSettings; terrain_options: TerrainOptions | null
  error: string | null; created_at: string; started_at: string | null; completed_at: string | null
  has_result: boolean; summary?: SimSummary
}

export type SeriesKey =
  | 'time_s' | 'position_x_m' | 'position_y_m' | 'position_z_m'
  | 'velocity_x_m_s' | 'velocity_y_m_s' | 'velocity_z_m_s'
  | 'latitude_deg' | 'longitude_deg' | 'altitude_m' | 'distance_to_surface_m'
  | 'speed_surface_m_s' | 'vertical_speed_m_s' | 'horizontal_speed_m_s'
  | 'acceleration_m_s2' | 'proper_acceleration_m_s2' | 'thrust_n' | 'throttle'
  | 'mass_kg' | 'fuel_remaining_kg' | 'distance_to_target_m'
export type TimeSeries = Record<SeriesKey, number[]> & Record<string, number[]>

export type CheckStatus = 'within_limits' | 'outside_limits' | 'not_assessed'
export interface Check { check: string; status: CheckStatus; value: number | null; limit: number | null; unit: string; margin?: number }
export interface SubAssessment {
  status: string; checks: Check[]; issues: string[]
  explanation?: Explanation | null
  terrain_classification?: string
  footprint?: { radius_m: number; cells: number; missing_fraction: number; max_slope_deg: number | null; relief_m: number | null; best_fit_plane_tilt_deg: number | null }
  point_values?: Record<string, number | null>
  notes?: string[]
  fuel_remaining_kg?: number; fuel_fraction_remaining?: number | null
}
export interface LandingAssessment {
  overall: 'limits_exceeded' | 'within_all_assessed_limits' | 'insufficient_data_or_not_fully_assessed'
  surface_assessment: SubAssessment; trajectory_assessment: SubAssessment; vehicle_assessment: SubAssessment
  issues: string[]; explanation: string
  uncertainty: { level: string; factors: string[]; dem_resolution_m?: { dx: number; dy: number }; min_resolvable_feature_m?: number; dem_vertical_accuracy_m?: number | string }
  limitations: string[]
}
export interface SimResults {
  simulation_id: number; status: SimStatus
  time_series: TimeSeries
  final_state: Record<string, number | string>
  trajectory: { frame: string; units: string; points_xyz: number[][]; time_s: number[]; target: { latitude_deg: number; longitude_deg: number }; terrain_dataset: string | null; terrain_synthetic: boolean }
  summary: SimSummary
  landing_assessment: LandingAssessment
  terrain_analysis_id: number | null
  units: Record<string, string>
}

export interface LandingSiteResponse { surface_assessment: SubAssessment; provenance: Provenance; disclaimer: string }

export interface Mission {
  id: number; name: string; description: string | null
  region_id: number | null; spacecraft_id: number | null; simulation_id: number | null
  user_id: number | null; created_at: string
}
export interface MissionDetail extends Mission { simulation?: Simulation; landing_assessment?: LandingAssessment | null }
export interface MissionReport {
  mission: Mission
  spacecraft?: Spacecraft
  region?: { name: string; latitude_deg: number; longitude_deg: number; radius_m: number }
  simulation?: Simulation
  final_state?: Record<string, number | string>
  landing_assessment?: LandingAssessment | null
  terrain_analysis?: { id: number; slope: Stat4; roughness: Stat4; relief: Stat4; suitability: { stats: Stat4; class_fractions: Record<string, number>; candidates: Candidate[]; elevation: ElevationStats }; parameters: AnalysisParams; synthetic: boolean }
  disclaimer: string
}

export interface GlobeData {
  rows: number; cols: number
  lat_north_deg: number; lat_south_deg: number; lon_west_deg: number; lon_east_deg: number
  reference_radius_m: number
  elevation_m: Grid
  statistics: ElevationStats
  provenance: { dataset_id: string; name: string; provider: string; product: string; version: string | null; citation: string | null; url: string | null; resolution_m_per_px: number | null; synthetic: boolean; data_notice: string }
}

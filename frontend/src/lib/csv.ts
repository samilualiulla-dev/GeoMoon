import type { MissionReport, SimResults, TimeSeries } from '../api/types'

function esc(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function timeSeriesToCsv(ts: TimeSeries): string {
  const keys = Object.keys(ts)
  const n = ts[keys[0]].length
  const lines = [keys.join(',')]
  for (let i = 0; i < n; i++) lines.push(keys.map((k) => esc(ts[k][i])).join(','))
  return lines.join('\n')
}

/** Flat key/value report (every value comes from stored core results). */
export function reportToRows(r: MissionReport, results?: SimResults | null): [string, string | number | null][] {
  const rows: [string, string | number | null][] = []
  rows.push(['mission_id', r.mission.id], ['mission_name', r.mission.name], ['created_at', r.mission.created_at])
  if (r.region) rows.push(['region_name', r.region.name], ['region_latitude_deg', r.region.latitude_deg], ['region_longitude_deg', r.region.longitude_deg], ['region_radius_m', r.region.radius_m])
  if (r.spacecraft) {
    const s = r.spacecraft
    rows.push(['spacecraft_name', s.name], ['dry_mass_kg', s.dry_mass_kg], ['fuel_mass_kg', s.fuel_mass_kg], ['thrust_total_n', s.engine.thrust_n * s.engine.number_of_engines],
      ['thrust_to_weight_lunar', s.derived.thrust_to_weight_lunar_surface], ['effective_isp_s', s.derived.effective_isp_s], ['footprint_radius_m', s.derived.footprint_radius_m])
  }
  const ic = r.simulation?.initial_conditions
  if (ic) rows.push(['target_latitude_deg', ic.target_latitude_deg], ['target_longitude_deg', ic.target_longitude_deg], ['initial_altitude_m', ic.initial_altitude_m],
    ['initial_speed_m_s', ic.initial_speed_m_s], ['azimuth_deg', ic.azimuth_deg], ['flight_path_angle_deg', ic.flight_path_angle_deg], ['burn_mode', ic.burn.mode])
  const sm = r.simulation?.summary
  if (sm) {
    rows.push(['termination_reason', sm.termination_reason], ['duration_s', sm.duration_s], ['fuel_used_kg', sm.fuel_used_kg], ['fuel_remaining_kg', sm.fuel_remaining_kg],
      ['peak_proper_acceleration_m_s2', sm.peak_proper_acceleration_m_s2], ['terrain_synthetic', String(sm.terrain_synthetic)])
    const t = sm.touchdown
    if (t) rows.push(['touchdown_latitude_deg', t.latitude_deg], ['touchdown_longitude_deg', t.longitude_deg], ['touchdown_vertical_speed_m_s', t.vertical_speed_m_s],
      ['touchdown_horizontal_speed_m_s', t.horizontal_speed_m_s], ['touchdown_miss_distance_m', t.miss_distance_m], ['touchdown_surface_height_m', t.surface_height_m])
  }
  const a = r.landing_assessment
  if (a) {
    rows.push(['assessment_overall', a.overall], ['assessment_surface', a.surface_assessment.status], ['assessment_trajectory', a.trajectory_assessment.status],
      ['assessment_vehicle', a.vehicle_assessment.status], ['assessment_issues', a.issues.join(' | ')], ['uncertainty_level', a.uncertainty.level])
  }
  const t = r.terrain_analysis
  if (t) rows.push(['terrain_slope_mean_deg', t.slope.mean], ['terrain_slope_p95_deg', t.slope.p95], ['terrain_roughness_mean_m', t.roughness.mean],
    ['terrain_relief_mean_m', t.relief.mean], ['terrain_suitability_mean', t.suitability.stats.mean], ['terrain_synthetic', String(t.synthetic)])
  void results
  rows.push(['disclaimer', r.disclaimer])
  return rows
}

export function rowsToCsv(rows: [string, string | number | null][]): string {
  return ['key,value', ...rows.map(([k, v]) => `${esc(k)},${esc(v)}`)].join('\n')
}

export function download(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

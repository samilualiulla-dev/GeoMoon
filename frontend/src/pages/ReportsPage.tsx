import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { MissionReport } from '../api/types'
import { AssessmentPanel } from '../components/simulation/AssessmentPanel'
import { Badge, Button, Empty, ErrorBanner, Panel, Spinner, Stat, SyntheticNotice } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { download, reportToRows, rowsToCsv, timeSeriesToCsv } from '../lib/csv'
import { fmt, fmtDate, humanize } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { useInputs, useSession } from '../store/appStore'

function compareRows(reports: MissionReport[]): { label: string; vals: string[] }[] {
  const f = (fn: (r: MissionReport) => string | number | null | undefined, d = 2) => reports.map((r) => { const v = fn(r); return typeof v === 'number' ? fmt(v, d) : v ?? '—' })
  return [
    { label: 'Target', vals: reports.map((r) => { const ic = r.simulation?.initial_conditions; return ic ? `${formatLat(ic.target_latitude_deg)} ${formatLon(ic.target_longitude_deg)}` : '—' }) },
    { label: 'Vehicle', vals: f((r) => r.spacecraft?.name) },
    { label: 'Total mass [kg]', vals: f((r) => r.spacecraft?.derived.total_mass_kg, 0) },
    { label: 'Start altitude [m]', vals: f((r) => r.simulation?.initial_conditions.initial_altitude_m, 0) },
    { label: 'Touchdown vertical speed [m/s]', vals: f((r) => r.simulation?.summary?.touchdown?.vertical_speed_m_s) },
    { label: 'Touchdown horizontal speed [m/s]', vals: f((r) => r.simulation?.summary?.touchdown?.horizontal_speed_m_s) },
    { label: 'Miss distance [m]', vals: f((r) => r.simulation?.summary?.touchdown?.miss_distance_m, 1) },
    { label: 'Fuel remaining [kg]', vals: f((r) => r.simulation?.summary?.fuel_remaining_kg, 1) },
    { label: 'Mean slope [°]', vals: f((r) => r.terrain_analysis?.slope.mean) },
    { label: 'Mean roughness [m]', vals: f((r) => r.terrain_analysis?.roughness.mean, 3) },
    { label: 'Mean suitability [0–1]', vals: f((r) => r.terrain_analysis?.suitability.stats.mean, 3) },
    { label: 'Surface assessment', vals: f((r) => r.landing_assessment && humanize(r.landing_assessment.surface_assessment.status)) },
    { label: 'Trajectory assessment', vals: f((r) => r.landing_assessment && humanize(r.landing_assessment.trajectory_assessment.status)) },
    { label: 'Overall', vals: f((r) => r.landing_assessment && humanize(r.landing_assessment.overall)) },
    { label: 'Terrain data', vals: f((r) => (r.terrain_analysis ? (r.terrain_analysis.synthetic ? 'SYNTHETIC' : 'real DEM') : 'none')) },
  ]
}

export default function ReportsPage() {
  const missions = useFetch(() => api.missions(), [])
  const nav = useNavigate()
  const inputs = useInputs()
  const { setResults, setSimulation } = useSession()
  const [openId, setOpenId] = useState<number | null>(null)
  const [report, setReport] = useState<MissionReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [compare, setCompare] = useState<MissionReport[] | null>(null)

  useEffect(() => {
    if (openId === null) return
    let alive = true
    setLoading(true); setError(null); setReport(null)
    api.missionReport(openId).then((r) => alive && setReport(r)).catch((e) => alive && setError(asApiError(e))).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [openId])

  const doCompare = async () => {
    setError(null)
    try { setCompare(await Promise.all(picked.map((id) => api.missionReport(id)))) } catch (e) { setError(asApiError(e)) }
  }

  const openInSim = async () => {
    if (!report?.simulation) return
    try {
      const res = await api.simulationResults(report.simulation.id)
      setSimulation(report.simulation); setResults(res)
      inputs.setTarget(res.trajectory.target.latitude_deg, res.trajectory.target.longitude_deg)
      if (report.spacecraft) inputs.setSpacecraftId(report.spacecraft.id)
      nav('/simulation')
    } catch (e) { setError(asApiError(e)) }
  }

  const exportJson = () => report && download(`mission_${report.mission.id}_report.json`, JSON.stringify(report, null, 2), 'application/json')
  const exportCsv = () => report && download(`mission_${report.mission.id}_report.csv`, rowsToCsv(reportToRows(report)), 'text/csv')
  const exportSeries = async () => {
    if (!report?.simulation) return
    try { const r = await api.simulationResults(report.simulation.id); download(`mission_${report.mission.id}_timeseries.csv`, timeSeriesToCsv(r.time_series), 'text/csv') } catch (e) { setError(asApiError(e)) }
  }
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[320px_1fr]">
      <div className="no-print space-y-3">
        <Panel title="Saved missions" actions={<Button variant="ghost" onClick={missions.reload}>Refresh</Button>}>
          {missions.loading && <Spinner label="Loading…" />}
          {missions.error && <ErrorBanner error={missions.error} onRetry={missions.reload} />}
          {missions.data?.length === 0 && <Empty title="No missions saved">Run a simulation and press “Save as mission” on the Landing Simulation page.</Empty>}
          <ul className="space-y-1" data-testid="mission-list">
            {missions.data?.map((m) => (
              <li key={m.id} className={`rounded border p-2 text-xs ${openId === m.id ? 'border-cyan bg-cyan/10' : 'border-line'}`}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" aria-label={`Select mission ${m.id} for comparison`} checked={picked.includes(m.id)} onChange={() => toggle(m.id)} className="mt-0.5 accent-cyan" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => { setOpenId(m.id); setCompare(null) }}>
                    <div className="truncate font-medium">#{m.id} {m.name}</div>
                    <div className="text-[10px] text-dim">{fmtDate(m.created_at)}</div>
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3"><Button onClick={doCompare} disabled={picked.length < 2} data-testid="compare">Compare selected ({picked.length})</Button>{picked.length < 2 && <span className="ml-2 text-[10px] text-dim">pick ≥ 2</span>}</div>
        </Panel>
      </div>
      <div className="min-w-0 space-y-3">
        {error != null && <ErrorBanner error={error} />}
        {compare && (
          <Panel title="Comparison" actions={<Button className="no-print" onClick={() => setCompare(null)}>Close</Button>}>
            <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="compare-table">
              <thead><tr className="text-left text-dim"><th className="py-1 pr-3 font-normal">Metric</th>{compare.map((r) => <th key={r.mission.id} className="px-2 font-medium text-ink">#{r.mission.id} {r.mission.name}</th>)}</tr></thead>
              <tbody>{compareRows(compare).map((row) => <tr key={row.label} className="border-t border-line"><td className="py-1 pr-3 text-muted">{row.label}</td>{row.vals.map((v, i) => <td key={i} className="num px-2">{v}</td>)}</tr>)}</tbody>
            </table></div>
          </Panel>
        )}
        {openId === null && !compare && <Empty title="Open a mission">Select a saved mission to view parameters, results and assessment, or tick two or more to compare landing sites.</Empty>}
        {loading && <Spinner label="Loading report…" />}
        {report && (
          <div className="print-area space-y-3" data-testid="report">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div><h1 className="text-lg font-semibold">Mission #{report.mission.id} — {report.mission.name}</h1>
                <div className="text-xs text-muted">{fmtDate(report.mission.created_at)}{report.mission.description ? ` · ${report.mission.description}` : ''}</div></div>
              <div className="no-print flex flex-wrap gap-2">
                <Button onClick={openInSim} disabled={!report.simulation?.has_result}>Open in simulation</Button>
                <Button onClick={exportJson} data-testid="export-json">JSON</Button>
                <Button onClick={exportCsv} data-testid="export-csv">CSV</Button>
                <Button onClick={exportSeries} disabled={!report.simulation?.has_result}>Time-series CSV</Button>
                <Button variant="primary" onClick={() => window.print()} data-testid="export-pdf" title="Opens the print dialog — choose “Save as PDF”">PDF (print)</Button>
              </div>
            </div>
            {(report.terrain_analysis?.synthetic || report.simulation?.summary?.terrain_synthetic) && <SyntheticNotice />}
            <div className="grid gap-3 md:grid-cols-2">
              {report.region && <Panel title="Region"><div className="grid grid-cols-2 gap-3"><Stat label="Name" value={report.region.name} /><Stat label="Radius" value={fmt(report.region.radius_m, 0)} unit="m" /><Stat label="Latitude" value={formatLat(report.region.latitude_deg)} /><Stat label="Longitude" value={formatLon(report.region.longitude_deg)} /></div></Panel>}
              {report.spacecraft && <Panel title="Vehicle"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Stat label="Name" value={report.spacecraft.name} /><Stat label="Dry mass" value={fmt(report.spacecraft.dry_mass_kg, 0)} unit="kg" /><Stat label="Fuel" value={fmt(report.spacecraft.fuel_mass_kg, 0)} unit="kg" />
                <Stat label="Thrust (total)" value={fmt(report.spacecraft.engine.thrust_n * report.spacecraft.engine.number_of_engines, 0)} unit="N" /><Stat label="Isp" value={fmt(report.spacecraft.derived.effective_isp_s, 0)} unit="s" /><Stat label="T/W (lunar)" value={fmt(report.spacecraft.derived.thrust_to_weight_lunar_surface, 2)} /></div></Panel>}
            </div>
            {report.simulation?.initial_conditions && (
              <Panel title="Initial conditions & result">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  <Stat label="Target" value={<span className="num text-xs">{formatLat(report.simulation.initial_conditions.target_latitude_deg)}<br />{formatLon(report.simulation.initial_conditions.target_longitude_deg)}</span>} />
                  <Stat label="Start altitude" value={fmt(report.simulation.initial_conditions.initial_altitude_m, 0)} unit="m" />
                  <Stat label="Start speed" value={fmt(report.simulation.initial_conditions.initial_speed_m_s, 1)} unit="m/s" />
                  <Stat label="Burn" value={humanize(report.simulation.initial_conditions.burn.mode)} />
                  <Stat label="Duration" value={fmt(report.simulation.summary?.duration_s, 1)} unit="s" />
                  <Stat label="Fuel remaining" value={fmt(report.simulation.summary?.fuel_remaining_kg, 1)} unit="kg" />
                  <Stat label="Touchdown vertical" value={fmt(report.simulation.summary?.touchdown?.vertical_speed_m_s, 2)} unit="m/s" />
                  <Stat label="Touchdown horizontal" value={fmt(report.simulation.summary?.touchdown?.horizontal_speed_m_s, 2)} unit="m/s" />
                  <Stat label="Miss distance" value={fmt(report.simulation.summary?.touchdown?.miss_distance_m, 1)} unit="m" />
                </div>
              </Panel>
            )}
            {report.terrain_analysis && (
              <Panel title="Terrain analysis">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  <Stat label="Elevation min" value={fmt(report.terrain_analysis.suitability.elevation.min_m, 1)} unit="m" /><Stat label="Elevation max" value={fmt(report.terrain_analysis.suitability.elevation.max_m, 1)} unit="m" />
                  <Stat label="Slope mean" value={fmt(report.terrain_analysis.slope.mean, 2)} unit="°" /><Stat label="Slope p95" value={fmt(report.terrain_analysis.slope.p95, 2)} unit="°" />
                  <Stat label="Roughness mean" value={fmt(report.terrain_analysis.roughness.mean, 3)} unit="m" /><Stat label="Suitability mean" value={fmt(report.terrain_analysis.suitability.stats.mean, 3)} />
                </div>
                <div className="mt-2 text-[11px] text-dim">Parameters: window {report.terrain_analysis.parameters.window_m} m · slope limit {report.terrain_analysis.parameters.slope_limit_deg}° · footprint r {report.terrain_analysis.parameters.footprint_radius_m} m · weights {JSON.stringify(report.terrain_analysis.parameters.weights)}</div>
              </Panel>
            )}
            {report.landing_assessment ? <AssessmentPanel a={report.landing_assessment} /> : <Badge tone="warn">no assessment stored</Badge>}
            <p className="text-[11px] text-dim">{report.disclaimer}</p>
          </div>
        )}
      </div>
    </div>
  )
}

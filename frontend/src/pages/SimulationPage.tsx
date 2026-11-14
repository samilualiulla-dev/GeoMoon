import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { SimStatus, TerrainWindow } from '../api/types'
import { AssessmentPanel } from '../components/simulation/AssessmentPanel'
import { Charts } from '../components/simulation/Charts'
import { SimScene } from '../components/simulation/SimScene'
import { Telemetry } from '../components/simulation/Telemetry'
import { useScenarioErrors } from '../components/spacecraft/ScenarioFormView'
import { Badge, Button, Empty, ErrorBanner, Panel, SelectField, Spinner, Stat, SyntheticNotice } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { usePlayback } from '../hooks/usePlayback'
import { fmt, fmtDuration, humanize } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { buildSimulationCreate } from '../lib/payload'
import { download, timeSeriesToCsv } from '../lib/csv'
import { useInputs, useSession } from '../store/appStore'

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 25]

export default function SimulationPage() {
  const inputs = useInputs()
  const { simulation, results, setSimulation, setResults } = useSession()
  const scErr = useScenarioErrors(inputs.scenario)
  const vehicles = useFetch(() => api.spacecraftList(), [])
  const [status, setStatus] = useState<SimStatus | 'idle'>('idle')
  const [error, setError] = useState<unknown>(null)
  const [terrain, setTerrain] = useState<TerrainWindow | null>(null)
  const [terrainNote, setTerrainNote] = useState<string | null>(null)
  const [exag, setExag] = useState(1)
  const [missionName, setMissionName] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const cancel = useRef(false)
  const autoPlay = useRef(false)

  const duration = results ? results.time_series.time_s[results.time_series.time_s.length - 1] : 0
  const pb = usePlayback(duration)
  const vehicle = vehicles.data?.find((v) => v.id === inputs.spacecraftId) ?? null
  const busy = status === 'queued' || status === 'running'

  useEffect(() => () => { cancel.current = true }, [])
  // Start the replay once the freshly loaded results (and therefore the duration) are in effect.
  useEffect(() => {
    if (results && duration > 0 && autoPlay.current) { autoPlay.current = false; pb.start() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, duration])

  const loadTerrain = useCallback(async (res: NonNullable<typeof results>) => {
    setTerrain(null); setTerrainNote(null)
    if (!res.summary.terrain_used) { setTerrainNote(res.summary.warnings.find((w) => w.startsWith('Terrain')) ?? 'The core had no terrain data for this run.'); return }
    try {
      const sc = inputs.scenario
      setTerrain(await api.terrain({ latitude_deg: res.trajectory.target.latitude_deg, longitude_deg: res.trajectory.target.longitude_deg, radius_m: res.summary.terrain_radius_m ?? Number(sc.terrain_radius_m), dataset_id: res.summary.terrain_dataset ?? inputs.datasetId, max_grid: 160, allow_synthetic: inputs.allowSynthetic }))
    } catch (e) { setTerrainNote(`Terrain view unavailable: ${asApiError(e).describe()}`) }
  }, [inputs.scenario, inputs.datasetId, inputs.allowSynthetic])

  const runSimulation = async () => {
    setError(null)
    if (Object.keys(scErr).length) { setError(new Error('Scenario has invalid fields — fix them on the Spacecraft page.')); return }
    if (inputs.spacecraftId === null) { setError(new Error('Select or save a vehicle first.')); return }
    cancel.current = false
    pb.reset(); setResults(null); setTerrain(null); setSaveMsg(null)
    try {
      setStatus('queued')
      const body = buildSimulationCreate({ spacecraftId: inputs.spacecraftId, regionId: inputs.regionId, scenario: inputs.scenario, target: inputs.target,
        allowSynthetic: inputs.allowSynthetic, datasetId: inputs.datasetId, terrainParams: null })
      const sim = await api.createSimulation(body)
      setSimulation(sim)
      await api.runSimulation(sim.id)
      const t0 = Date.now()
      for (;;) {
        if (cancel.current) return
        const s = await api.simulation(sim.id)
        setStatus(s.status); setSimulation(s)
        if (s.status === 'completed') break
        if (s.status === 'failed') throw new Error(`Simulation failed on the core: ${s.error ?? 'no reason given'}`)
        if (Date.now() - t0 > 5 * 60_000) throw new Error('Timed out waiting for the simulation (5 min).')
        await new Promise((r) => setTimeout(r, 600))
      }
      const res = await api.simulationResults(sim.id)
      await loadTerrain(res)
      autoPlay.current = true
      setResults(res)
      setMissionName(`Landing @ ${formatLat(res.trajectory.target.latitude_deg)} ${formatLon(res.trajectory.target.longitude_deg)}`)
    } catch (e) { setError(e); setStatus('failed') }
  }

  const saveMission = async () => {
    if (!simulation) return
    setSaveMsg(null)
    try { const m = await api.createMission({ name: missionName.trim(), simulation_id: simulation.id, spacecraft_id: simulation.spacecraft_id, region_id: inputs.regionId }); setSaveMsg(`Saved as mission #${m.id} — open it in Mission Reports.`) }
    catch (e) { setSaveMsg(asApiError(e).describe()) }
  }

  const td = results?.summary.touchdown
  const syntheticRun = results?.summary.terrain_synthetic
  const overallTone = useMemo(() => (results ? (results.landing_assessment.overall === 'limits_exceeded' ? 'bad' : results.landing_assessment.overall === 'within_all_assessed_limits' ? 'ok' : 'warn') : 'neutral'), [results])

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold">Landing simulation</h1>
          <p className="text-xs text-muted">The trajectory is integrated on the core; this page only requests it and replays the returned time series.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56"><SelectField label="Vehicle" id="vehicle" value={String(inputs.spacecraftId ?? '')} onChange={(v) => inputs.setSpacecraftId(v === '' ? null : Number(v))} disabled={busy}
            options={[{ value: '', label: vehicles.loading ? 'loading…' : '— select saved vehicle —' }, ...(vehicles.data ?? []).map((v) => ({ value: String(v.id), label: `#${v.id} ${v.name}` }))]} /></div>
          <Button variant="primary" onClick={runSimulation} disabled={busy} data-testid="start">{busy ? <Spinner label={status === 'queued' ? 'Queued…' : 'Running on core…'} /> : results ? 'Run again' : 'Start simulation'}</Button>
        </div>
      </div>

      {vehicles.error && <ErrorBanner error={vehicles.error} title="Cannot list vehicles" onRetry={vehicles.reload} />}
      {error != null && <ErrorBanner error={error} title="Simulation error" />}

      <Panel title="Scenario summary">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Target" value={<span className="num text-xs">{formatLat(inputs.target.lat)}<br />{formatLon(inputs.target.lon)}</span>} />
          <Stat label="Vehicle" value={vehicle ? vehicle.name : '—'} />
          <Stat label="Start altitude" value={inputs.scenario.initial_altitude_m} unit="m" />
          <Stat label="Start speed" value={inputs.scenario.initial_speed_m_s} unit="m/s" />
          <Stat label="Burn" value={humanize(inputs.scenario.burnMode)} />
          <Stat label="Integrator" value={inputs.scenario.integrator} />
          <Stat label="Terrain" value={inputs.scenario.terrain_enabled ? 'real DEM' : 'off'} />
          <div className="flex items-end"><Link to="/spacecraft" className="text-xs text-cyan underline">Edit scenario</Link></div>
        </div>
        {Object.keys(scErr).length > 0 && <div className="mt-2 text-[11px] text-bad">Scenario has {Object.keys(scErr).length} invalid field(s) — fix them on the Spacecraft page.</div>}
        {inputs.allowSynthetic && !results && <div className="mt-2"><SyntheticNotice compact /></div>}
      </Panel>

      {!results && status === 'idle' && !error && (
        <Empty title="No simulation yet" action={vehicles.data?.length === 0 ? <Link to="/spacecraft" className="text-cyan underline">Create a vehicle →</Link> : undefined}>
          Pick a vehicle and press Start. The core integrates the descent (point-mass model on a rotating Moon) and returns the time series shown here.</Empty>
      )}

      {results && (
        <>
          {syntheticRun && <SyntheticNotice />}
          {terrainNote && <div className="rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn" data-testid="terrain-note">{terrainNote}</div>}
          <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-2">
              <SimScene results={results} terrain={terrain} t={pb.t} exaggeration={exag} className="h-[520px]" />
              <Panel padded>
                <div className="flex flex-wrap items-center gap-2" data-testid="controls">
                  <Button variant="primary" onClick={pb.start} data-testid="btn-start">Start</Button>
                  <Button onClick={pb.pause} disabled={pb.state !== 'playing'} data-testid="btn-pause">Pause</Button>
                  <Button onClick={pb.resume} disabled={pb.state === 'playing' || pb.state === 'idle'} data-testid="btn-resume">Resume</Button>
                  <Button onClick={pb.reset} data-testid="btn-reset">Reset</Button>
                  <Button onClick={pb.replay} disabled={pb.state !== 'finished'} data-testid="btn-replay">Replay</Button>
                  <div className="w-24"><SelectField label="Speed" value={String(pb.speed)} onChange={(v) => pb.setSpeed(Number(v))} options={SPEEDS.map((s) => ({ value: String(s), label: `×${s}` }))} /></div>
                  <label className="text-[11px] text-muted">Vertical ×{exag}<input type="range" min={1} max={10} step={0.5} value={exag} onChange={(e) => setExag(Number(e.target.value))} className="ml-2 w-24 align-middle accent-cyan" /></label>
                  <Badge tone={pb.state === 'playing' ? 'info' : 'neutral'}>{pb.state}</Badge>
                </div>
                <input type="range" aria-label="Time" min={0} max={duration} step={duration / 1000 || 0.1} value={pb.t} onChange={(e) => pb.seek(Number(e.target.value))} className="mt-3 w-full accent-cyan" />
                <div className="num flex justify-between text-[10px] text-dim"><span>0</span><span>t = {fmtDuration(pb.t)}</span><span>{fmtDuration(duration)}</span></div>
                <p className="mt-1 text-[10px] text-dim">Lander is drawn enlarged and upright (attitude is not simulated). Start/Reset/Replay control the replay of the core's result; “Run again” recomputes on the core.</p>
              </Panel>
            </div>
            <Panel title="Live telemetry"><Telemetry results={results} t={pb.t} /></Panel>
          </div>

          <Panel title="Result summary" actions={<Badge tone={overallTone}>{humanize(results.landing_assessment.overall)}</Badge>}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8" data-testid="result-summary">
              <Stat label="Termination" value={humanize(results.summary.termination_reason)} />
              <Stat label="Duration" value={fmt(results.summary.duration_s, 1)} unit="s" />
              <Stat label="Touchdown vertical" value={td ? fmt(td.vertical_speed_m_s, 2) : '—'} unit="m/s" />
              <Stat label="Touchdown horizontal" value={td ? fmt(td.horizontal_speed_m_s, 2) : '—'} unit="m/s" />
              <Stat label="Miss distance" value={td ? fmt(td.miss_distance_m, 1) : '—'} unit="m" />
              <Stat label="Fuel used" value={fmt(results.summary.fuel_used_kg, 1)} unit="kg" />
              <Stat label="Fuel remaining" value={fmt(results.summary.fuel_remaining_kg, 1)} unit="kg" />
              <Stat label="Peak thrust accel." value={fmt(results.summary.peak_proper_acceleration_m_s2, 2)} unit="m/s²" />
            </div>
            {results.summary.events.length > 0 && <div className="mt-2 text-[11px] text-muted">Events: {results.summary.events.map((e) => `${humanize(e.event)} @ ${e.t_s.toFixed(1)} s`).join(' · ')}</div>}
            {results.summary.warnings.map((w, i) => <div key={i} className="mt-1 text-[11px] text-warn">⚠ {w}</div>)}
            <details className="mt-2 text-[11px] text-muted"><summary className="cursor-pointer text-dim">Model assumptions & limitations</summary>
              <ul className="mt-1 list-inside list-disc">{[...results.summary.assumptions, ...results.summary.limitations].map((a, i) => <li key={i}>{a}</li>)}</ul></details>
          </Panel>

          <Charts results={results} t={pb.t} />
          <AssessmentPanel a={results.landing_assessment} />

          <Panel title="Save & export">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1"><label htmlFor="mname" className="mb-1 block text-[11px] text-muted">Mission name</label>
                <input id="mname" data-testid="mission-name" value={missionName} onChange={(e) => setMissionName(e.target.value)} maxLength={160} className="w-full rounded border border-line-2 bg-space-900 px-2 py-1.5 text-xs outline-none focus:border-cyan" /></div>
              <Button variant="primary" onClick={saveMission} disabled={!missionName.trim() || !simulation} data-testid="save-mission">Save as mission</Button>
              <Button onClick={() => download(`simulation_${results.simulation_id}.csv`, timeSeriesToCsv(results.time_series), 'text/csv')}>Time series CSV</Button>
              <Button onClick={() => download(`simulation_${results.simulation_id}.json`, JSON.stringify(results, null, 2), 'application/json')}>Full result JSON</Button>
              <Link to="/reports" className="text-xs text-cyan underline">Mission Reports →</Link>
            </div>
            {saveMsg && <div className="mt-2 text-xs text-muted" data-testid="save-msg">{saveMsg}</div>}
          </Panel>
        </>
      )}
    </div>
  )
}

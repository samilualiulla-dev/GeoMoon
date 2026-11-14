import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { IgnitionSuggestion, SimStatus, TerrainWindow } from '../api/types'
import { AssessmentPanel } from '../components/simulation/AssessmentPanel'
import { Charts } from '../components/simulation/Charts'
import type { CamCmd, CamPreset } from '../components/simulation/SceneCanvas'
import { SceneToolbar } from '../components/simulation/SceneToolbar'
import { ScenarioPanel, useOverrideErrors, useScenarioErrors, useTargetErrors } from '../components/simulation/ScenarioPanel'
import { DEFAULT_LAYERS, SimScene, type SceneLayers, type TrajMode } from '../components/simulation/SimScene'
import { Telemetry } from '../components/simulation/Telemetry'
import { Timeline } from '../components/simulation/Timeline'
import { Badge, Button, Empty, ErrorBanner, PageHeader, Panel, Spinner, Stat, SyntheticNotice, TextField } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { playback, useBindPlayback } from '../hooks/usePlayback'
import { EVENT_RU, OVERALL_RU, SIM_STATUS_RU, TERMINATION_RU, label, tr } from '../i18n/ru'
import { download, timeSeriesToCsv } from '../lib/csv'
import { pickDataset } from '../lib/datasets'
import { fmt } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { buildSimulationCreate } from '../lib/payload'
import { OVERRIDE_KEYS, applyOverrides, overridesDiffer, overridesFrom, type Overrides } from '../lib/vehicle'
import { useInputs, useSession } from '../store/appStore'
import { centerElevation } from '../components/simulation/SimScene'

export default function SimulationPage() {
  const inputs = useInputs()
  const { simulation, results, setSimulation, setResults } = useSession()
  const vehicles = useFetch(() => api.spacecraftList(), [])
  const sources = useFetch(() => api.dataSources(), [])
  const scErr = useScenarioErrors(inputs.scenario)
  const [showErr, setShowErr] = useState(false)
  const [status, setStatus] = useState<SimStatus | 'idle'>('idle')
  const [error, setError] = useState<unknown>(null)
  const [terrain, setTerrain] = useState<TerrainWindow | null>(null)
  const [terrainNote, setTerrainNote] = useState<string | null>(null)
  const [preview, setPreview] = useState<TerrainWindow | null>(null)
  const [previewErr, setPreviewErr] = useState<string | null>(null)
  const [layers, setLayers] = useState<SceneLayers>(DEFAULT_LAYERS)
  const [trajMode, setTrajMode] = useState<TrajMode>('full')
  const [cam, setCam] = useState<CamCmd>({ preset: 'frame', nonce: 1 })
  const [fov, setFov] = useState(45)
  const [exag, setExag] = useState(2)
  const [follow, setFollow] = useState(false)
  const [missionName, setMissionName] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<IgnitionSuggestion | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const cancel = useRef(false)
  const autoPlay = useRef(false)

  // ---- target text fields (store keeps the validated numbers)
  const [latS, setLatS] = useState(String(inputs.target.lat)), [lonS, setLonS] = useState(String(inputs.target.lon))
  const targetErrors = useTargetErrors(latS, lonS)
  useEffect(() => { if (Number(latS) !== inputs.target.lat) setLatS(String(inputs.target.lat)); if (Number(lonS) !== inputs.target.lon) setLonS(String(inputs.target.lon)) }, [inputs.target]) // eslint-disable-line react-hooks/exhaustive-deps
  const onTarget = (la: string, lo: string) => { setLatS(la); setLonS(lo); const a = Number(la), b = Number(lo); if (la.trim() && lo.trim() && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && b >= -180 && b <= 360) inputs.setTarget(a, b) }

  // ---- vehicle + per-run overrides
  const vehicle = vehicles.data?.find((v) => v.id === inputs.spacecraftId) ?? null
  const [overrides, setOverrides] = useState<Overrides | null>(null)
  useEffect(() => { setOverrides(vehicle ? overridesFrom(vehicle) : null) }, [vehicle?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const overrideErrors = useOverrideErrors(overrides)

  const duration = results ? results.time_series.time_s[results.time_series.time_s.length - 1] : 0
  useBindPlayback(duration)
  const busy = status === 'queued' || status === 'running'
  useEffect(() => () => { cancel.current = true }, [])
  useEffect(() => { if (results && duration > 0 && autoPlay.current) { autoPlay.current = false; playback.start() } }, [results, duration]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- real DEM preview around the target (before any run)
  const datasets = sources.data?.installed ?? []
  const dataset = useMemo(() => pickDataset(datasets, inputs.target.lat, inputs.target.lon, { datasetId: inputs.datasetId, allowSynthetic: inputs.allowSynthetic }), [datasets, inputs.target, inputs.datasetId, inputs.allowSynthetic])
  const previewRadius = dataset ? Math.min(Math.max(Number(inputs.scenario.terrain_radius_m) || 1500, 10 * (dataset.resolution_m_per_px ?? 0)), 50000) : null
  useEffect(() => {
    if (!dataset || !previewRadius || results || !inputs.scenario.terrain_enabled) { setPreview(null); setPreviewErr(null); return }
    const ctrl = new AbortController()
    const id = setTimeout(() => {
      api.terrain({ latitude_deg: inputs.target.lat, longitude_deg: inputs.target.lon, radius_m: previewRadius, dataset_id: inputs.datasetId, max_grid: 140, allow_synthetic: inputs.allowSynthetic }, ctrl.signal)
        .then((w) => { setPreview(w); setPreviewErr(null) }).catch((e) => { if (!ctrl.signal.aborted) { setPreview(null); setPreviewErr(tr(asApiError(e).describe())) } })
    }, 400)
    return () => { clearTimeout(id); ctrl.abort() }
  }, [dataset?.id, inputs.target, previewRadius, inputs.datasetId, inputs.allowSynthetic, !!results, inputs.scenario.terrain_enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTerrain = useCallback(async (res: NonNullable<typeof results>) => {
    setTerrain(null); setTerrainNote(null)
    if (!res.summary.terrain_used) { setTerrainNote(tr(res.summary.warnings.find((w) => w.startsWith('Terrain')) ?? 'Для этого запуска у ядра не было данных рельефа.')); return }
    try {
      setTerrain(await api.terrain({ latitude_deg: res.trajectory.target.latitude_deg, longitude_deg: res.trajectory.target.longitude_deg, radius_m: res.summary.terrain_radius_m ?? Number(inputs.scenario.terrain_radius_m),
        dataset_id: res.summary.terrain_dataset ?? inputs.datasetId, max_grid: 160, allow_synthetic: inputs.allowSynthetic }))
    } catch (e) { setTerrainNote(`Вид рельефа недоступен: ${tr(asApiError(e).describe())}`) }
  }, [inputs.scenario, inputs.datasetId, inputs.allowSynthetic])

  const suggest = async () => {
    if (inputs.spacecraftId === null) return
    setSuggesting(true); setSuggestion(null)
    try { setSuggestion(await api.suggestIgnition({ spacecraft_id: inputs.spacecraftId, initial_altitude_m: Number(inputs.scenario.initial_altitude_m), initial_speed_m_s: Number(inputs.scenario.initial_speed_m_s), throttle: Number(inputs.scenario.throttle) || 1 })) }
    catch (e) { setError(e) } finally { setSuggesting(false) }
  }

  const runSimulation = async () => {
    setError(null); setShowErr(true)
    const bad = Object.keys(scErr).length + Object.keys(overrideErrors).length + (targetErrors.lat || targetErrors.lon ? 1 : 0)
    if (bad) { setError(new Error(`Исправьте ошибки в параметрах (${bad}) — они выделены в левой панели.`)); return }
    if (inputs.spacecraftId === null || !vehicle) { setError(new Error('Выберите аппарат в левой панели.')); return }
    cancel.current = false
    playback.reset(); setResults(null); setTerrain(null); setSaveMsg(null)
    try {
      setStatus('queued')
      let vehicleId = vehicle.id
      if (overrides && overridesDiffer(vehicle, overrides)) {
        const copy = await api.createSpacecraft({ ...applyOverrides(vehicle, overrides), name: `${vehicle.name} (для запуска)`, is_demo: vehicle.is_demo })
        vehicleId = copy.id; inputs.setSpacecraftId(copy.id); vehicles.reload()
      }
      const body = buildSimulationCreate({ spacecraftId: vehicleId, regionId: inputs.regionId, scenario: inputs.scenario, target: inputs.target, allowSynthetic: inputs.allowSynthetic, datasetId: inputs.datasetId, terrainParams: null })
      const sim = await api.createSimulation(body)
      setSimulation(sim)
      await api.runSimulation(sim.id)
      const t0 = Date.now()
      for (;;) {
        if (cancel.current) return
        const s = await api.simulation(sim.id)
        setStatus(s.status); setSimulation(s)
        if (s.status === 'completed') break
        if (s.status === 'failed') throw new Error(`Симуляция завершилась ошибкой на ядре: ${tr(s.error ?? 'причина не указана')}`)
        if (Date.now() - t0 > 5 * 60_000) throw new Error('Превышено время ожидания симуляции (5 мин).')
        await new Promise((r) => setTimeout(r, 600))
      }
      const res = await api.simulationResults(sim.id)
      await loadTerrain(res)
      autoPlay.current = true
      setResults(res)
      setCam((c) => ({ preset: 'frame', nonce: c.nonce + 1 }))
      setMissionName(`Посадка ${formatLat(res.trajectory.target.latitude_deg)} ${formatLon(res.trajectory.target.longitude_deg)}`)
    } catch (e) { setError(e); setStatus('failed') }
  }

  const saveMission = async () => {
    if (!simulation) return
    setSaveMsg(null)
    try { const m = await api.createMission({ name: missionName.trim(), simulation_id: simulation.id, spacecraft_id: simulation.spacecraft_id, region_id: inputs.regionId }); setSaveMsg(`Сохранено как миссия №${m.id} — откройте её в разделе «Отчёты миссий».`) }
    catch (e) { setSaveMsg(tr(asApiError(e).describe())) }
  }

  const td = results?.summary.touchdown
  const terrainWin = results ? terrain : preview
  const syntheticRun = results ? results.summary.terrain_synthetic : preview?.provenance.synthetic
  const overallTone = results ? (results.landing_assessment.overall === 'limits_exceeded' ? 'bad' : results.landing_assessment.overall === 'within_all_assessed_limits' ? 'ok' : 'warn') : 'neutral'
  const setPreset = (p: CamPreset) => setCam((c) => ({ preset: p, nonce: c.nonce + 1 }))
  const centerZ = terrainWin ? centerElevation(terrainWin.elevation_m) : null
  const modified = OVERRIDE_KEYS.length > 0 && vehicle && overrides ? overridesDiffer(vehicle, overrides) : false

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-5">
      <PageHeader icon="target" title="Симуляция посадки"
        subtitle="Траектория считается ядром; эта страница только отправляет сценарий и воспроизводит возвращённый временной ряд. Ничего не вычисляется в браузере."
        actions={<>
          {status !== 'idle' && <Badge tone={status === 'failed' ? 'bad' : status === 'completed' ? 'ok' : 'info'}>{label(SIM_STATUS_RU, status)}</Badge>}
          <Button variant="primary" size="lg" icon="play" onClick={runSimulation} disabled={busy} data-testid="start">{busy ? (status === 'queued' ? 'В очереди…' : 'Расчёт на ядре…') : results ? 'Пересчитать' : 'Запустить симуляцию'}</Button>
        </>} />

      {vehicles.error && <ErrorBanner error={vehicles.error} title="Не удалось получить список аппаратов" onRetry={vehicles.reload} />}
      {error != null && <ErrorBanner error={error} title="Ошибка симуляции" />}

      <div className="grid gap-4 xl:h-[calc(100vh-12.5rem)] xl:min-h-[700px] xl:grid-cols-[390px_minmax(0,1fr)_340px]">
        {/* ---------- left: scenario ---------- */}
        <Panel title="Сценарий" icon="edit" padded={false} className="min-h-0 xl:overflow-y-auto" actions={modified ? <Badge tone="warn">аппарат изменён</Badge> : undefined}>
          <ScenarioPanel scenario={inputs.scenario} onScenario={inputs.setScenario} errors={scErr} vehicles={vehicles.data ?? []} vehicleId={inputs.spacecraftId} onVehicle={(id) => { inputs.setSpacecraftId(id); setSuggestion(null) }}
            overrides={overrides} onOverrides={setOverrides} overrideErrors={overrideErrors} targetLat={latS} targetLon={lonS} onTarget={onTarget} targetErrors={targetErrors}
            showErrors={showErr} disabled={busy} suggestion={suggestion} onSuggest={suggest} suggesting={suggesting} />
        </Panel>

        {/* ---------- centre: 3-D scene + timeline ---------- */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel/95 panel-glow">
          <div className="relative min-h-[460px] flex-1">
            <SceneToolbar layers={layers} onLayers={setLayers} trajMode={trajMode} onTrajMode={setTrajMode} onPreset={setPreset} fov={fov} onFov={setFov} exag={exag} onExag={setExag} follow={follow} onFollow={setFollow} canFollow={!!results} />
            <SimScene results={results} terrain={terrainWin} target={inputs.target} previewAltitude_m={Number(inputs.scenario.initial_altitude_m) || 0} exaggeration={exag}
              layers={layers} trajMode={trajMode} cam={cam} fov={fov} follow={follow && !!results} className="absolute inset-0" />
            {busy && <div className="absolute inset-0 flex items-center justify-center bg-space-950/55 backdrop-blur-[1px]"><div className="rounded-lg border border-line-2 bg-panel px-5 py-4"><Spinner label={status === 'queued' ? 'Задача в очереди…' : 'Ядро интегрирует траекторию…'} /></div></div>}
            {!terrainWin && !busy && (
              <div className="pointer-events-none absolute left-3 top-3 max-w-sm rounded-md border border-warn/40 bg-space-950/85 p-3 text-[12px] text-warn">
                {previewErr ?? (!dataset ? 'Под целью нет реального DEM, поэтому рельеф не показан (синтетика не подставляется). Источники данных — в одноимённом разделе.' : inputs.scenario.terrain_enabled ? 'Загрузка рельефа…' : 'Связь с DEM выключена в настройках расчёта.')}
              </div>
            )}
            {terrainWin && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-line bg-space-950/80 px-3 py-2 text-[11.5px] text-muted" data-testid="scene-source">
                Реальный рельеф: <span className="text-ink/90">{terrainWin.provenance.product}</span> · ячейка ≈ {fmt(terrainWin.geometry.cell_size_m.dx, 0)} м{syntheticRun ? <span className="ml-2 text-warn">СИНТЕТИКА — не реальные данные</span> : null}
                <div className="text-dim">Аппарат показан увеличенным и вертикальным (ориентация не моделируется).</div>
              </div>
            )}
          </div>
          <Timeline duration={duration} events={results?.summary.events ?? []} disabled={!results || busy} />
        </div>

        {/* ---------- right: telemetry ---------- */}
        <div className="flex min-h-0 flex-col gap-4 xl:overflow-y-auto">
          <Panel title="Телеметрия" icon="info" actions={results ? <Badge tone="info">из ядра</Badge> : undefined}>
            {results ? <Telemetry results={results} /> : (
              <Empty title="Данные появятся после запуска" icon="play">Высота, скорость, ускорение, топливо и тяга берутся из временного ряда, который вернёт ядро.</Empty>
            )}
          </Panel>
          {!results && (
            <Panel title="Предпросмотр цели" icon="target">
              <div className="grid grid-cols-2 gap-3 text-[12px]" data-testid="preview-info">
                <Stat label="Цель" value={<span className="text-[12px]">{formatLat(inputs.target.lat)}<br />{formatLon(inputs.target.lon)}</span>} />
                <Stat label="Высота рельефа" value={centerZ !== null ? fmt(centerZ, 0) : '—'} unit={centerZ !== null ? 'м' : undefined} />
                <Stat label="Набор данных" value={dataset ? dataset.product : '—'} />
                <Stat label="Ячейка DEM" value={dataset?.resolution_m_per_px ? fmt(dataset.resolution_m_per_px, 0) : '—'} unit={dataset?.resolution_m_per_px ? 'м' : undefined} />
              </div>
              {syntheticRun && <div className="mt-3"><SyntheticNotice compact /></div>}
            </Panel>
          )}
          {results && (
            <Panel title="Итог" icon="check" actions={<Badge tone={overallTone}>{label(OVERALL_RU, results.landing_assessment.overall)}</Badge>}>
              <div data-testid="result-summary">
                {([
                  ['Завершение', label(TERMINATION_RU, results.summary.termination_reason), ''],
                  ['Длительность', fmt(results.summary.duration_s, 1), 'с'],
                  ['Вертикальная скорость касания', td ? fmt(td.vertical_speed_m_s, 2) : '—', 'м/с'],
                  ['Горизонтальная скорость касания', td ? fmt(td.horizontal_speed_m_s, 2) : '—', 'м/с'],
                  ['Промах от цели', td ? fmt(td.miss_distance_m, 1) : '—', 'м'],
                  ['Израсходовано топлива', fmt(results.summary.fuel_used_kg, 1), 'кг'],
                  ['Остаток топлива', fmt(results.summary.fuel_remaining_kg, 1), 'кг'],
                  ['Пик ускорения F/m', fmt(results.summary.peak_proper_acceleration_m_s2, 2), 'м/с²'],
                ] as [string, string, string][]).map(([l, v, u]) => (
                  <div key={l} className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-0"><span className="text-[12px] text-muted">{l}</span><span className="num text-[13.5px]">{v}{u && <span className="ml-1 text-[11px] text-muted">{u}</span>}</span></div>
                ))}
              </div>
              {results.summary.events.length > 0 && <div className="mt-3 text-[12px] text-muted">События: {results.summary.events.map((e) => `${label(EVENT_RU, e.event)} @ ${e.t_s.toFixed(1)} с`).join(' · ')}</div>}
              {results.summary.warnings.map((w, i) => <div key={i} className="mt-2 text-[12px] text-warn">⚠ {tr(w)}</div>)}
            </Panel>
          )}
        </div>
      </div>

      {terrainNote && <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px] text-warn" data-testid="terrain-note">{terrainNote}</div>}
      {results && syntheticRun && <SyntheticNotice />}

      {!results && status === 'idle' && !error && vehicles.data?.length === 0 && (
        <Empty title="Нет сохранённых аппаратов" icon="rocket" action={<Link to="/spacecraft" className="text-cyan underline">Создать аппарат →</Link>}>Выберите или создайте аппарат, задайте сценарий слева и запустите симуляцию.</Empty>
      )}

      {results && (
        <>
          <details className="rounded-lg border border-line bg-panel/80 p-4 text-[13px] text-muted">
            <summary className="font-medium text-ink/90">Допущения и ограничения модели</summary>
            <ul className="mt-2 list-inside list-disc">{[...results.summary.assumptions, ...results.summary.limitations].map((a, i) => <li key={i}>{tr(a)}</li>)}</ul>
          </details>
          <Charts results={results} />
          <AssessmentPanel a={results.landing_assessment} />
          <Panel title="Сохранение и экспорт" icon="download">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1"><TextField id="mname" testId="mission-name" label="Название миссии" value={missionName} onChange={setMissionName} maxLength={160} /></div>
              <Button variant="primary" onClick={saveMission} disabled={!missionName.trim() || !simulation} data-testid="save-mission" icon="check">Сохранить как миссию</Button>
              <Button icon="download" onClick={() => download(`simulation_${results.simulation_id}.csv`, timeSeriesToCsv(results.time_series), 'text/csv')}>Временной ряд CSV</Button>
              <Button icon="download" onClick={() => download(`simulation_${results.simulation_id}.json`, JSON.stringify(results, null, 2), 'application/json')}>Результат JSON</Button>
              <Link to="/reports" className="text-[13px] text-cyan underline decoration-cyan/40 underline-offset-2">Отчёты миссий →</Link>
            </div>
            {saveMsg && <div className="mt-3 text-[13px] text-muted" data-testid="save-msg">{saveMsg}</div>}
          </Panel>
        </>
      )}
    </div>
  )
}

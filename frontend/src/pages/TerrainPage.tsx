import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import type { Candidate } from '../api/types'
import { ExplanationView } from '../components/simulation/AssessmentPanel'
import { tr } from '../i18n/ru'
import { AnalysisForm, formFromParams, paramsFromForm, terrainFormErrors, type TerrainFormState } from '../components/terrain/AnalysisForm'
import { HeatmapCanvas, type LayerState } from '../components/terrain/HeatmapCanvas'
import { LayerPanel } from '../components/terrain/LayerPanel'
import { RegionalTerrain3D } from '../components/terrain/RegionalTerrain3D'
import { Badge, Button, Empty, ErrorBanner, PageHeader, Panel, Segmented, SelectField, Spinner, Stat, SyntheticNotice, TextField } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { LAYER_STYLES } from '../lib/colormap'
import { fmt, pct } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { parseNum } from '../lib/validation'
import { pickDataset, radiusAdvice } from '../lib/datasets'
import { useInputs, useSession } from '../store/appStore'

const ALL_LAYERS = ['elevation', 'slope', 'roughness', 'local_relief', 'hazard', 'suitability', 'class']

export default function TerrainPage() {
  const inputs = useInputs()
  const { analysis, setAnalysis } = useSession()
  const sources = useFetch((s) => api.dataSources().then((d) => { void s; return d }), [])
  const vehicle = useFetch(() => api.spacecraft(inputs.spacecraftId as number), [inputs.spacecraftId], inputs.spacecraftId !== null)
  const [form, setForm] = useState<TerrainFormState>(() => formFromParams(inputs.params, inputs.target.lat, inputs.target.lon, inputs.analysisRadius_m))
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [layers, setLayers] = useState<Record<string, LayerState>>({ elevation: { visible: true, opacity: 1 }, suitability: { visible: false, opacity: 0.7 }, hazard: { visible: false, opacity: 0.7 } })
  const [view, setView] = useState<'map' | '3d'>('map')
  const [colorBy, setColorBy] = useState('natural')
  const [exag, setExag] = useState(3)
  const [selected, setSelected] = useState<number | null>(null)
  const [auto, setAuto] = useState(true)
  const [saveName, setSaveName] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const run = useCallback(async (f: TerrainFormState) => {
    if (Object.keys(terrainFormErrors(f)).length) return
    abort.current?.abort()
    const ctrl = new AbortController(); abort.current = ctrl
    setRunning(true); setError(null)
    const lat = parseNum(f.latitude_deg) as number, lon = parseNum(f.longitude_deg) as number, radius = parseNum(f.radius_m) as number
    const params = paramsFromForm(f)
    try {
      const res = await api.analyze({ latitude_deg: lat, longitude_deg: lon, radius_m: radius, dataset_id: inputs.datasetId, params, layers: ALL_LAYERS, max_grid: 160,
        allow_synthetic: inputs.allowSynthetic, save: true, region_id: inputs.regionId }, ctrl.signal)
      if (ctrl.signal.aborted) return
      setAnalysis(res, `${lat},${lon},${radius}`)
      inputs.setParams(params); inputs.setTarget(lat, lon); inputs.setAnalysisRadius(radius)
      setSelected(res.candidates.length ? 0 : null)
    } catch (e) {
      if (!ctrl.signal.aborted) { const ae = asApiError(e); if (ae.kind !== 'aborted') setError(ae) }
    } finally { if (!ctrl.signal.aborted) setRunning(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.datasetId, inputs.allowSynthetic, inputs.regionId])

  // Re-run on criteria change (debounced) once a first result exists.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!auto || !analysis) return
    const id = setTimeout(() => run(form), 700)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slope_limit_deg, form.footprint_radius_m, form.window_m, form.roughness_limit_m, form.relief_limit_m, form.tpi_limit_m, form.hazard_safe_distance_m,
    form.suitable_threshold, form.max_candidates, form.roughness_method, form.weights])

  const advice = useMemo(() => radiusAdvice(pickDataset(sources.data?.installed ?? [], parseNum(form.latitude_deg) ?? 0, parseNum(form.longitude_deg) ?? 0, { datasetId: inputs.datasetId, allowSynthetic: inputs.allowSynthetic }), parseNum(form.radius_m) ?? 0), [sources.data, form.latitude_deg, form.longitude_deg, form.radius_m, inputs.datasetId, inputs.allowSynthetic])
  useEffect(() => { if (advice?.tooSmall) setForm((f) => ({ ...f, radius_m: String(Math.round(advice.recommended_m)) })) }, [advice?.dataset.id, advice?.tooSmall]) // eslint-disable-line react-hooks/exhaustive-deps
  const cand: Candidate | null = analysis && selected !== null ? analysis.candidates[selected] ?? null : null
  const toggleLayer = (k: string, s: LayerState) => setLayers((p) => ({ ...p, [k]: s }))
  const lat = parseNum(form.latitude_deg), lon = parseNum(form.longitude_deg)

  const saveRegion = async () => {
    setSaveMsg(null)
    try {
      const r = await api.createRegion({ name: saveName.trim(), latitude_deg: lat as number, longitude_deg: lon as number, radius_m: parseNum(form.radius_m) as number, dataset_id: analysis?.provenance.dataset_id ?? null })
      inputs.setRegionId(r.id); setSaveMsg(`Регион сохранён (№${r.id})`)
    } catch (e) { setSaveMsg(tr(asApiError(e).describe())) }
  }

  const syntheticResult = analysis?.provenance.synthetic
  const layerOptions = useMemo(() => LAYER_STYLES.filter((s) => analysis?.layers[s.key]).map((s) => ({ value: s.key, label: s.label })), [analysis])

  return (
    <div className="p-4 lg:p-5">
      <PageHeader icon="layers" title="Анализ рельефа" subtitle="Уклон, шероховатость, локальный рельеф, опасности и геометрическая пригодность для посадки. Всё считается ядром по реальным данным DEM; веса и критерии можно менять и пересчитывать." />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-3">
          {sources.error && <ErrorBanner error={sources.error} title="Не удалось получить список наборов данных" onRetry={sources.reload} />}
          <AnalysisForm value={form} onChange={setForm} datasets={sources.data?.installed ?? []} datasetId={inputs.datasetId} onDataset={inputs.setDatasetId}
            allowSynthetic={inputs.allowSynthetic} onAllowSynthetic={inputs.setAllowSynthetic} onRun={() => run(form)} running={running}
            vehicleFootprint={vehicle.data?.derived.footprint_radius_m ?? null} vehicleTilt={vehicle.data?.derived.max_tilt_deg_used ?? null}
            onUseVehicle={() => vehicle.data && setForm({ ...form, footprint_radius_m: String(vehicle.data.derived.footprint_radius_m), slope_limit_deg: String(vehicle.data.derived.max_tilt_deg_used) })}
            autoRerun={auto} onAutoRerun={setAuto} hasResult={!!analysis} radiusAdvice={advice} />
        </div>
        <div className="min-w-0 space-y-4">
          {error != null && <ErrorBanner error={error} title="Анализ рельефа не выполнен" onRetry={() => run(form)} />}
          {running && <Spinner label="Чтение окна DEM и расчёт слоёв на ядре…" />}
          {!analysis && !running && !error && (
            <Empty title="Анализа ещё нет" icon="layers">Введите координаты (или выберите точку в «Исследовании Луны») и запустите анализ. Расчёт идёт на ядре по реальным данным DEM; если ни один набор не покрывает точку, вы увидите понятную ошибку — ничего не подставляется и не выдумывается.</Empty>
          )}
          {analysis && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <Badge tone={syntheticResult ? 'warn' : 'info'}>{syntheticResult ? 'синтетические тестовые данные' : 'реальный DEM'}</Badge>
                <span className="text-muted">{analysis.provenance.provider} · {analysis.provenance.product}{analysis.provenance.version ? ` v${analysis.provenance.version}` : ''}</span>
                <span className="num text-dim">{formatLat(analysis.geometry.center.latitude_deg)} {formatLon(analysis.geometry.center.longitude_deg)} · анализ №{analysis.analysis_id}</span>
              </div>
              {syntheticResult && <SyntheticNotice />}
              {analysis.summary.warnings?.map((w, i) => <div key={i} role="note" data-testid="resolution-warning" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px] text-warn">⚠ {tr(w)}</div>)}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
                <Panel title="Карты слоёв" icon="grid" padded={false}
                  actions={<Segmented value={view} onChange={setView} testIdPrefix="view" options={[{ value: 'map', label: '2D-карта' }, { value: '3d', label: '3D-рельеф' }]} />}>
                  <div className="p-4">
                    {view === 'map' ? (
                      <HeatmapCanvas analysis={analysis} layers={layers} candidates={analysis.candidates} selected={selected} onSelectCandidate={setSelected}
                        onPick={(la, lo) => { inputs.setTarget(la, lo, null); setForm((f) => ({ ...f, latitude_deg: la.toFixed(5), longitude_deg: lo.toFixed(5) })) }} />
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-end gap-4">
                          <div className="w-56"><SelectField label="Окраска" value={colorBy} onChange={setColorBy} options={[{ value: 'natural', label: 'Естественный цвет' }, ...layerOptions]} /></div>
                          <label className="flex items-center gap-2 text-[12.5px] text-muted">Рельеф ×{exag}<input type="range" aria-label="Вертикальное преувеличение" min={1} max={10} step={0.5} value={exag} onChange={(e) => setExag(Number(e.target.value))} className="w-32 accent-cyan" /></label>
                        </div>
                        <RegionalTerrain3D elevation={analysis.layers.elevation} geometry={analysis.geometry} analysis={analysis} layerKey={colorBy} exaggeration={exag}
                          markers={analysis.candidates.map((c, i) => ({ lat: c.lat, lon: c.lon, elevation_m: c.elevation_m, label: String(i + 1), color: selected === i ? '#22d3ee' : '#ffffff' }))} className="relative h-[540px] w-full" />
                        <p className="text-[11.5px] text-dim">Высоты меша — значения DEM из ответа ядра (уменьшены до {analysis.layers.elevation.rows}×{analysis.layers.elevation.cols}); ячейки без данных остаются дырами.</p>
                      </div>
                    )}
                  </div>
                </Panel>
                <Panel title="Слои" icon="layers"><LayerPanel analysis={analysis} state={layers} onChange={toggleLayer} /></Panel>
              </div>

              <Panel title="Сводка" icon="info">
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 lg:grid-cols-6" data-testid="summary">
                  <Stat label="Высота, мин." value={fmt(analysis.summary.elevation.min_m, 1)} unit="м" />
                  <Stat label="Высота, макс." value={fmt(analysis.summary.elevation.max_m, 1)} unit="м" />
                  <Stat label="Перепад высот" value={fmt(analysis.summary.elevation.range_m, 1)} unit="м" />
                  <Stat label="Уклон: средний / p95" value={`${fmt(analysis.summary.slope_deg.mean, 2)} / ${fmt(analysis.summary.slope_deg.p95, 2)}`} unit="°" />
                  <Stat label="Шероховатость, средняя" value={fmt(analysis.summary.roughness_m.mean, 3)} unit="м" />
                  <Stat label="Локальный рельеф, средний" value={fmt(analysis.summary.local_relief_m.mean, 2)} unit="м" />
                  <Stat label="Ячейки-опасности" value={pct(analysis.summary.hazard_fraction)} />
                  <Stat label="Пригодная площадь" value={pct(analysis.summary.class_fractions.geometrically_suitable)} tone="ok" />
                  <Stat label="Непригодная площадь" value={pct(analysis.summary.class_fractions.geometrically_unsuitable)} tone="bad" />
                  <Stat label="Недостаточно данных" value={pct(analysis.summary.class_fractions.insufficient_data)} tone="warn" />
                  <Stat label="Размер ячейки" value={`${fmt(analysis.summary.resolution_m.dx, 1)} × ${fmt(analysis.summary.resolution_m.dy, 1)}`} unit="м" />
                  <Stat label="Мин. различимый объект" value={`≈ ${fmt(analysis.summary.min_resolvable_feature_m, 0)}`} unit="м" />
                </div>
                <p className="mt-4 text-[12px] text-dim">{tr(analysis.disclaimer)} Анализ по DEM не показывает камни и кратеры мельче примерно двух ячеек и не гарантирует обнаружения любых физических опасностей.</p>
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title={`Кандидаты в площадки посадки (${analysis.candidates.length})`} icon="target">
                  {analysis.candidates.length === 0 ? (
                    <Empty title="Геометрически пригодных площадок не найдено" icon="alert">При этих критериях ни один круг пятна посадки целиком не помещается на пригодной, свободной от опасностей и полностью покрытой местности. Ослабьте критерии (уклон, радиус пятна) или увеличьте регион.</Empty>
                  ) : (
                    <ol className="space-y-1.5" data-testid="candidates">
                      {analysis.candidates.map((c, i) => (
                        <li key={i}>
                          <button onClick={() => setSelected(i)} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-[13px] ${selected === i ? 'border-cyan bg-cyan/10' : 'border-line hover:bg-panel-2'}`}>
                            <span><span className="mr-2 font-semibold text-cyan">{i + 1}</span><span className="num">{formatLat(c.lat)} · {formatLon(c.lon)}</span></span>
                            <span className="num text-muted">оценка {c.footprint_mean_suitability.toFixed(3)} · {fmt(c.elevation_m, 1)} м</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {cand && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => { inputs.setTarget(cand.lat, cand.lon, `Кандидат ${selected! + 1}`); setForm((f) => ({ ...f, latitude_deg: cand.lat.toFixed(5), longitude_deg: cand.lon.toFixed(5) })) }} data-testid="use-target" icon="target">Сделать целью посадки</Button>
                    </div>
                  )}
                </Panel>
                <Panel title={cand ? `Почему площадка ${selected! + 1} получила такую оценку` : 'Объяснение оценки'} icon="info">
                  {cand ? <ExplanationView ex={cand.explanation} /> : <div className="text-[13px] text-dim">Выберите кандидата.</div>}
                </Panel>
              </div>

              <Panel title="Сохранить регион" icon="database">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-64 flex-1"><TextField id="rname" testId="region-name" label="Название региона" value={saveName} onChange={setSaveName} maxLength={128} /></div>
                  <Button onClick={saveRegion} disabled={!saveName.trim() || lat === null || lon === null} data-testid="save-region" icon="check">Сохранить регион</Button>
                  {saveMsg && <span className="text-[13px] text-muted">{saveMsg}</span>}
                </div>
              </Panel>
              <p className="text-[11.5px] text-dim">Параметры: {analysis.parameters.roughness_method === 'detrended' ? 'СКО от плоскости' : 'простое СКО'}, окно {analysis.parameters.window_m} м, радиус пятна {analysis.parameters.footprint_radius_m} м, допустимый уклон {analysis.parameters.slope_limit_deg}°.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

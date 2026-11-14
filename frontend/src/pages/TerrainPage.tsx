import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import type { Candidate } from '../api/types'
import { ExplanationView } from '../components/simulation/AssessmentPanel'
import { AnalysisForm, formFromParams, paramsFromForm, terrainFormErrors, type TerrainFormState } from '../components/terrain/AnalysisForm'
import { HeatmapCanvas, type LayerState } from '../components/terrain/HeatmapCanvas'
import { LayerPanel } from '../components/terrain/LayerPanel'
import { RegionalTerrain3D } from '../components/terrain/RegionalTerrain3D'
import { Badge, Button, Empty, ErrorBanner, Panel, SelectField, Spinner, Stat, SyntheticNotice } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { LAYER_STYLES } from '../lib/colormap'
import { fmt, humanize, pct } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { parseNum } from '../lib/validation'
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
  const [colorBy, setColorBy] = useState('elevation')
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

  const cand: Candidate | null = analysis && selected !== null ? analysis.candidates[selected] ?? null : null
  const toggleLayer = (k: string, s: LayerState) => setLayers((p) => ({ ...p, [k]: s }))
  const lat = parseNum(form.latitude_deg), lon = parseNum(form.longitude_deg)

  const saveRegion = async () => {
    setSaveMsg(null)
    try {
      const r = await api.createRegion({ name: saveName.trim(), latitude_deg: lat as number, longitude_deg: lon as number, radius_m: parseNum(form.radius_m) as number, dataset_id: analysis?.provenance.dataset_id ?? null })
      inputs.setRegionId(r.id); setSaveMsg(`Saved region #${r.id}`)
    } catch (e) { setSaveMsg(asApiError(e).describe()) }
  }

  const syntheticResult = analysis?.provenance.synthetic
  const layerOptions = useMemo(() => LAYER_STYLES.filter((s) => analysis?.layers[s.key]).map((s) => ({ value: s.key, label: s.label })), [analysis])

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-3">
        {sources.error && <ErrorBanner error={sources.error} title="Cannot list datasets" onRetry={sources.reload} />}
        <AnalysisForm value={form} onChange={setForm} datasets={sources.data?.installed ?? []} datasetId={inputs.datasetId} onDataset={inputs.setDatasetId}
          allowSynthetic={inputs.allowSynthetic} onAllowSynthetic={inputs.setAllowSynthetic} onRun={() => run(form)} running={running}
          vehicleFootprint={vehicle.data?.derived.footprint_radius_m ?? null} vehicleTilt={vehicle.data?.derived.max_tilt_deg_used ?? null}
          onUseVehicle={() => vehicle.data && setForm({ ...form, footprint_radius_m: String(vehicle.data.derived.footprint_radius_m), slope_limit_deg: String(vehicle.data.derived.max_tilt_deg_used) })}
          autoRerun={auto} onAutoRerun={setAuto} hasResult={!!analysis} />
      </div>
      <div className="min-w-0 space-y-3">
        {error != null && <ErrorBanner error={error} title="Terrain analysis failed" onRetry={() => run(form)} />}
        {running && <Spinner label="Reading DEM window and computing layers…" />}
        {!analysis && !running && !error && (
          <Empty title="No analysis yet">Enter coordinates (or pick a point in Lunar Explorer) and run the analysis. Results are computed on the core from real DEM data; if no dataset covers the point you will see a clear error — nothing is simulated or invented.</Empty>
        )}
        {analysis && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={syntheticResult ? 'warn' : 'info'}>{syntheticResult ? 'synthetic test data' : 'real DEM'}</Badge>
              <span className="text-muted">{analysis.provenance.provider} · {analysis.provenance.product}{analysis.provenance.version ? ` v${analysis.provenance.version}` : ''}</span>
              <span className="num text-dim">{formatLat(analysis.geometry.center.latitude_deg)} {formatLon(analysis.geometry.center.longitude_deg)} · analysis #{analysis.analysis_id}</span>
            </div>
            {syntheticResult && <SyntheticNotice />}
            {analysis.summary.warnings?.map((w, i) => <div key={i} role="note" data-testid="resolution-warning" className="rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">⚠ {w}</div>)}
            <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
              <Panel title="Terrain layers" padded={false}
                actions={<div className="flex gap-1">{(['map', '3d'] as const).map((v) => <Button key={v} variant={view === v ? 'primary' : 'secondary'} onClick={() => setView(v)} data-testid={`view-${v}`}>{v === 'map' ? '2-D map' : '3-D relief'}</Button>)}</div>}>
                <div className="p-3">
                  {view === 'map' ? (
                    <HeatmapCanvas analysis={analysis} layers={layers} candidates={analysis.candidates} selected={selected} onSelectCandidate={setSelected}
                      onPick={(la, lo) => { inputs.setTarget(la, lo, null); setForm((f) => ({ ...f, latitude_deg: la.toFixed(5), longitude_deg: lo.toFixed(5) })) }} />
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="w-44"><SelectField label="Colour by" value={colorBy} onChange={setColorBy} options={layerOptions} /></div>
                        <label className="text-[11px] text-muted">Vertical exaggeration ×{exag}<input type="range" min={1} max={10} step={0.5} value={exag} onChange={(e) => setExag(Number(e.target.value))} className="ml-2 w-32 align-middle accent-cyan" /></label>
                      </div>
                      <RegionalTerrain3D elevation={analysis.layers.elevation} geometry={analysis.geometry} analysis={analysis} layerKey={colorBy} exaggeration={exag}
                        markers={analysis.candidates.map((c, i) => ({ lat: c.lat, lon: c.lon, elevation_m: c.elevation_m, label: String(i + 1), color: selected === i ? '#22d3ee' : '#ffffff' }))} className="h-[520px]" />
                      <p className="text-[10px] text-dim">Mesh heights are the DEM values returned by the core (downsampled to {analysis.layers.elevation.rows}×{analysis.layers.elevation.cols}); cells without data are left as holes.</p>
                    </div>
                  )}
                </div>
              </Panel>
              <Panel title="Layers"><LayerPanel analysis={analysis} state={layers} onChange={toggleLayer} /></Panel>
            </div>

            <Panel title="Summary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" data-testid="summary">
                <Stat label="Elevation min" value={fmt(analysis.summary.elevation.min_m, 1)} unit="m" />
                <Stat label="Elevation max" value={fmt(analysis.summary.elevation.max_m, 1)} unit="m" />
                <Stat label="Elevation range" value={fmt(analysis.summary.elevation.range_m, 1)} unit="m" />
                <Stat label="Slope mean / p95" value={`${fmt(analysis.summary.slope_deg.mean, 2)} / ${fmt(analysis.summary.slope_deg.p95, 2)}`} unit="°" />
                <Stat label="Roughness mean" value={fmt(analysis.summary.roughness_m.mean, 3)} unit="m" />
                <Stat label="Local relief mean" value={fmt(analysis.summary.local_relief_m.mean, 2)} unit="m" />
                <Stat label="Hazard cells" value={pct(analysis.summary.hazard_fraction)} />
                <Stat label="Suitable area" value={pct(analysis.summary.class_fractions.geometrically_suitable)} tone="ok" />
                <Stat label="Unsuitable area" value={pct(analysis.summary.class_fractions.geometrically_unsuitable)} tone="bad" />
                <Stat label="Insufficient data" value={pct(analysis.summary.class_fractions.insufficient_data)} tone="warn" />
                <Stat label="Cell size" value={`${fmt(analysis.summary.resolution_m.dx, 1)} × ${fmt(analysis.summary.resolution_m.dy, 1)}`} unit="m" />
                <Stat label="Min. resolvable feature" value={`≈ ${fmt(analysis.summary.min_resolvable_feature_m, 0)}`} unit="m" />
              </div>
              <p className="mt-3 text-[11px] text-dim">{analysis.disclaimer} DEM analysis cannot reveal rocks or craters smaller than about two cells and does not guarantee detection of every physical hazard.</p>
            </Panel>

            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title={`Candidate landing sites (${analysis.candidates.length})`}>
                {analysis.candidates.length === 0 ? (
                  <Empty title="No geometrically suitable site found">Within these criteria no footprint disk fits entirely on suitable, hazard-free, fully covered terrain. Relax slope/footprint criteria or enlarge the region.</Empty>
                ) : (
                  <ol className="space-y-1" data-testid="candidates">
                    {analysis.candidates.map((c, i) => (
                      <li key={i}>
                        <button onClick={() => setSelected(i)} className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs ${selected === i ? 'border-cyan bg-cyan/10' : 'border-line hover:bg-panel-2'}`}>
                          <span><span className="mr-2 font-semibold text-cyan">{i + 1}</span><span className="num">{formatLat(c.lat)} · {formatLon(c.lon)}</span></span>
                          <span className="num text-muted">score {c.footprint_mean_suitability.toFixed(3)} · {fmt(c.elevation_m, 1)} m</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                {cand && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => { inputs.setTarget(cand.lat, cand.lon, `Candidate ${selected! + 1}`); setForm((f) => ({ ...f, latitude_deg: cand.lat.toFixed(5), longitude_deg: cand.lon.toFixed(5) })) }} data-testid="use-target">Use as landing target</Button>
                  </div>
                )}
              </Panel>
              <Panel title={cand ? `Why site ${selected! + 1} scored this way` : 'Score explanation'}>
                {cand ? <ExplanationView ex={cand.explanation} /> : <div className="text-xs text-dim">Select a candidate.</div>}
              </Panel>
            </div>

            <Panel title="Save this region">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><label className="mb-1 block text-[11px] text-muted" htmlFor="rname">Region name</label>
                  <input id="rname" data-testid="region-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={128} className="w-full rounded border border-line-2 bg-space-900 px-2 py-1.5 text-xs outline-none focus:border-cyan" /></div>
                <Button onClick={saveRegion} disabled={!saveName.trim() || lat === null || lon === null} data-testid="save-region">Save region</Button>
                {saveMsg && <span className="text-xs text-muted">{saveMsg}</span>}
              </div>
            </Panel>
            <p className="text-[10px] text-dim">Parameters used: {humanize(analysis.parameters.roughness_method)} roughness, window {analysis.parameters.window_m} m, footprint r {analysis.parameters.footprint_radius_m} m, slope limit {analysis.parameters.slope_limit_deg}°.</p>
          </>
        )}
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { ElevationPoint } from '../api/types'
import { MoonGlobe } from '../components/globe/MoonGlobe'
import { RegionalTerrain3D } from '../components/terrain/RegionalTerrain3D'
import { Badge, Button, Empty, ErrorBanner, NumberField, Panel, SelectField, Spinner, Stat, SyntheticNotice, Toggle } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { LAYER_STYLES } from '../lib/colormap'
import { fmt } from '../lib/format'
import { formatLat, formatLon, inCoverageBox, wrapLon } from '../lib/geo'
import { TERRAIN_FIELDS, validateNumber } from '../lib/validation'
import { useInputs, useSession } from '../store/appStore'

export default function ExplorerPage() {
  const inputs = useInputs()
  const { terrainWindow, setTerrainWindow, analysis } = useSession()
  const sources = useFetch(() => api.dataSources(), [])
  const regions = useFetch(() => api.regions(), [])
  const [view, setView] = useState<'globe' | 'relief'>('globe')
  const [grid, setGrid] = useState(true)
  const [hover, setHover] = useState<{ lat: number; lon: number } | null>(null)
  const [focus, setFocus] = useState(0)
  const [latS, setLatS] = useState(String(inputs.target.lat)), [lonS, setLonS] = useState(String(inputs.target.lon))
  const [radiusS, setRadiusS] = useState(String(inputs.analysisRadius_m))
  const [probe, setProbe] = useState<ElevationPoint | null>(null)
  const [busy, setBusy] = useState<null | 'probe' | 'relief'>(null)
  const [error, setError] = useState<unknown>(null)
  const [exag, setExag] = useState(3)
  const [layerKey, setLayerKey] = useState('elevation')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const datasets = sources.data?.installed ?? []
  const real = datasets.filter((d) => !d.synthetic), synth = datasets.filter((d) => d.synthetic)
  const t = inputs.target
  const covering = useMemo(() => datasets.filter((d) => inCoverageBox(t.lat, t.lon, d.coverage)), [datasets, t])

  const select = (lat: number, lon: number) => { const la = Number(lat.toFixed(5)), lo = Number(wrapLon(lon).toFixed(5)); inputs.setTarget(la, lo); setLatS(String(la)); setLonS(String(lo)); setProbe(null); setError(null) }
  const applyInputs = () => {
    const a = Number(latS), b = Number(lonS)
    if (!validateNumber(latS, TERRAIN_FIELDS.latitude_deg) && !validateNumber(lonS, TERRAIN_FIELDS.longitude_deg)) { inputs.setTarget(a, wrapLon(b)); setProbe(null); setFocus((f) => f + 1) }
  }
  const latErr = validateNumber(latS, TERRAIN_FIELDS.latitude_deg), lonErr = validateNumber(lonS, TERRAIN_FIELDS.longitude_deg), radErr = validateNumber(radiusS, TERRAIN_FIELDS.radius_m)

  const doProbe = async () => {
    setBusy('probe'); setError(null)
    try { setProbe(await api.elevation({ latitude_deg: t.lat, longitude_deg: t.lon, dataset_id: inputs.datasetId, allow_synthetic: inputs.allowSynthetic })) } catch (e) { setError(asApiError(e)); setProbe(null) } finally { setBusy(null) }
  }
  const loadRelief = async () => {
    setBusy('relief'); setError(null)
    try {
      const w = await api.terrain({ latitude_deg: t.lat, longitude_deg: t.lon, radius_m: Number(radiusS), dataset_id: inputs.datasetId, max_grid: 160, allow_synthetic: inputs.allowSynthetic })
      setTerrainWindow(w); setView('relief'); inputs.setAnalysisRadius(Number(radiusS))
    } catch (e) { setError(asApiError(e)) } finally { setBusy(null) }
  }
  const saveRegion = async () => {
    setMsg(null)
    try { const r = await api.createRegion({ name: name.trim(), latitude_deg: t.lat, longitude_deg: t.lon, radius_m: Number(radiusS), dataset_id: terrainWindow?.provenance.dataset_id ?? null }); inputs.setRegionId(r.id); regions.reload(); setMsg(`Saved region #${r.id}`); setName('') }
    catch (e) { setMsg(asApiError(e).describe()) }
  }

  const windowMatchesAnalysis = analysis && terrainWindow && Math.abs(analysis.geometry.center.latitude_deg - terrainWindow.geometry.center.latitude_deg) < 1e-6 && Math.abs(analysis.geometry.center.longitude_deg - terrainWindow.geometry.center.longitude_deg) < 1e-6
  const noRealData = sources.data && real.length === 0

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-3 p-4 lg:flex-row">
      <div className="flex min-h-[420px] min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <Button variant={view === 'globe' ? 'primary' : 'secondary'} onClick={() => setView('globe')} data-testid="view-globe">Globe</Button>
            <Button variant={view === 'relief' ? 'primary' : 'secondary'} onClick={() => setView('relief')} disabled={!terrainWindow} data-testid="view-relief" title={terrainWindow ? '' : 'Load regional relief first'}>Regional relief (real DEM)</Button>
          </div>
          {view === 'globe' && <Toggle checked={grid} onChange={setGrid} label="Lat/lon grid (30°)" />}
          {view === 'globe' && <Button onClick={() => setFocus((f) => f + 1)}>Centre on target</Button>}
          <div className="num ml-auto text-[11px] text-muted" data-testid="hover-coords">{hover ? `${formatLat(hover.lat)} · ${formatLon(hover.lon)}` : 'hover the globe for coordinates'}</div>
        </div>
        {noRealData && (
          <div className="rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
            No real DEM is installed on the core, so no relief can be shown. The sphere below is a plain reference surface — <strong>not terrain</strong>. See <Link className="underline" to="/data">Data Sources</Link>.
            {synth.length > 0 && ' A synthetic test DEM is present: enable “Allow synthetic” to try the pipeline in demo mode.'}
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded border border-line bg-space-950" data-testid="globe-wrap">
          {view === 'globe' ? (
            <>
              <MoonGlobe selected={t} onSelect={select} onHover={setHover} showGrid={grid} datasets={datasets} regions={regions.data ?? []} candidates={analysis?.candidates} focusSignal={focus} />
              <div className="pointer-events-none absolute bottom-2 left-2 space-y-0.5 rounded bg-space-950/80 p-2 text-[10px] text-muted">
                <div><span className="mr-1 inline-block h-0.5 w-4 bg-cyan align-middle" />real DEM coverage <span className="ml-2 mr-1 inline-block h-0.5 w-4 bg-warn align-middle" />synthetic coverage</div>
                <div><span className="mr-1 inline-block h-2 w-2 rounded-full bg-bad align-middle" />selected <span className="ml-2 mr-1 inline-block h-2 w-2 rounded-full bg-blue align-middle" />saved regions <span className="ml-2 mr-1 inline-block h-2 w-2 rounded-full bg-ok align-middle" />candidates</div>
                <div className="text-dim">Reference sphere only — click to select a point. Drag = rotate · wheel = zoom · right-drag = pan.</div>
              </div>
            </>
          ) : terrainWindow ? (
            <div className="h-full">
              <RegionalTerrain3D elevation={terrainWindow.elevation_m} geometry={terrainWindow.geometry} analysis={windowMatchesAnalysis ? analysis : null} layerKey={windowMatchesAnalysis ? layerKey : 'elevation'}
                exaggeration={exag} className="h-full"
                markers={[{ lat: t.lat, lon: t.lon, label: 'selected', color: '#ef4444' }, ...(windowMatchesAnalysis ? analysis!.candidates.map((c, i) => ({ lat: c.lat, lon: c.lon, elevation_m: c.elevation_m, label: `site ${i + 1}`, color: '#22c55e' })) : [])]} />
            </div>
          ) : <div className="p-4"><Empty title="No regional relief loaded">Select a point and press “Load regional relief”.</Empty></div>}
        </div>
        {view === 'relief' && terrainWindow && (
          <div className="flex flex-wrap items-end gap-4 text-xs">
            <label className="text-[11px] text-muted">Vertical exaggeration ×{exag}<input type="range" min={1} max={10} step={0.5} value={exag} onChange={(e) => setExag(Number(e.target.value))} className="ml-2 w-32 align-middle accent-cyan" /></label>
            {windowMatchesAnalysis && <div className="w-44"><SelectField label="Colour by (analysis layer)" value={layerKey} onChange={setLayerKey} options={LAYER_STYLES.filter((s) => analysis!.layers[s.key]).map((s) => ({ value: s.key, label: s.label }))} /></div>}
            <span className="text-[11px] text-dim">{terrainWindow.provenance.provider} · {terrainWindow.provenance.product}</span>
          </div>
        )}
      </div>

      <aside className="w-full shrink-0 space-y-3 lg:w-80">
        <Panel title="Selected point">
          <div className="grid grid-cols-2 gap-2">
            <NumberField spec={TERRAIN_FIELDS.latitude_deg} value={latS} onChange={setLatS} error={latErr} compact />
            <NumberField spec={TERRAIN_FIELDS.longitude_deg} value={lonS} onChange={setLonS} error={lonErr} compact />
          </div>
          <div className="mt-2 flex gap-2"><Button onClick={applyInputs} disabled={!!latErr || !!lonErr} data-testid="apply-coords">Set point</Button></div>
          <div className="num mt-3 text-sm" data-testid="selected-coords">{formatLat(t.lat)} · {formatLon(t.lon)}</div>
          <div className="mt-2 text-[11px] text-muted">
            Dataset coverage: {sources.loading ? '…' : covering.length === 0 ? <span className="text-warn">no installed dataset reports coverage here</span> : covering.map((d) => <Badge key={d.id} tone={d.synthetic ? 'warn' : 'info'}>{d.synthetic ? 'synthetic' : d.product}</Badge>)}
          </div>
        </Panel>
        <Panel title="Real terrain data">
          <div className="space-y-2">
            <Toggle checked={inputs.allowSynthetic} onChange={inputs.setAllowSynthetic} label="Allow SYNTHETIC test terrain" />
            {inputs.allowSynthetic && <SyntheticNotice compact />}
            <NumberField spec={TERRAIN_FIELDS.radius_m} value={radiusS} onChange={setRadiusS} error={radErr} compact />
            <div className="flex flex-wrap gap-2">
              <Button onClick={doProbe} disabled={busy !== null} data-testid="probe">{busy === 'probe' ? <Spinner /> : 'Probe elevation'}</Button>
              <Button variant="primary" onClick={loadRelief} disabled={busy !== null || !!radErr} data-testid="load-relief">{busy === 'relief' ? <Spinner label="Loading…" /> : 'Load regional relief'}</Button>
            </div>
            {probe && (
              <div className="grid grid-cols-2 gap-2" data-testid="probe-result">
                <Stat label="Elevation" value={fmt(probe.elevation_m, 2)} unit="m" />
                <Stat label="Dataset" value={probe.dataset_id} />
                {probe.synthetic && <div className="col-span-2"><SyntheticNotice compact /></div>}
              </div>
            )}
            {terrainWindow && (
              <div className="grid grid-cols-2 gap-2 border-t border-line pt-2">
                <Stat label="Min" value={fmt(terrainWindow.statistics.min_m, 1)} unit="m" /><Stat label="Max" value={fmt(terrainWindow.statistics.max_m, 1)} unit="m" />
                <Stat label="Mean" value={fmt(terrainWindow.statistics.mean_m, 1)} unit="m" /><Stat label="Valid" value={fmt(terrainWindow.statistics.valid_fraction * 100, 1)} unit="%" />
                {terrainWindow.provenance.synthetic && <div className="col-span-2"><SyntheticNotice compact /></div>}
              </div>
            )}
            {error != null && <ErrorBanner error={error} title="Terrain request failed" />}
          </div>
        </Panel>
        <Panel title="Next steps">
          <div className="flex flex-col gap-2">
            <Link to="/terrain" className="rounded border border-line-2 bg-panel-2 px-3 py-1.5 text-center text-xs hover:bg-line">Analyse this region →</Link>
            <Link to="/simulation" className="rounded border border-line-2 bg-panel-2 px-3 py-1.5 text-center text-xs hover:bg-line">Simulate a landing here →</Link>
          </div>
        </Panel>
        <Panel title="Saved regions">
          <div className="space-y-2">
            <div className="flex gap-2"><input aria-label="Region name" data-testid="explorer-region-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this point" maxLength={128} className="min-w-0 flex-1 rounded border border-line-2 bg-space-900 px-2 py-1 text-xs outline-none focus:border-cyan" />
              <Button onClick={saveRegion} disabled={!name.trim() || !!radErr}>Save</Button></div>
            {msg && <div className="text-[11px] text-muted">{msg}</div>}
            {regions.error && <ErrorBanner error={regions.error} onRetry={regions.reload} />}
            {regions.data?.length === 0 && <div className="text-[11px] text-dim">No saved regions.</div>}
            <ul className="space-y-1">{regions.data?.map((r) => (
              <li key={r.id}><button onClick={() => { select(r.latitude_deg, r.longitude_deg); inputs.setRegionId(r.id); setRadiusS(String(r.radius_m)); setFocus((f) => f + 1) }} className="flex w-full justify-between gap-2 rounded border border-line px-2 py-1 text-left text-xs hover:bg-panel-2">
                <span className="truncate">{r.name}</span><span className="num shrink-0 text-dim">{r.latitude_deg.toFixed(2)}, {r.longitude_deg.toFixed(2)}</span></button></li>))}</ul>
          </div>
        </Panel>
      </aside>
    </div>
  )
}

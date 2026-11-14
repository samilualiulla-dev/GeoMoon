import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { ElevationPoint } from '../api/types'
import { MoonGlobe } from '../components/globe/MoonGlobe'
import { RegionalTerrain3D } from '../components/terrain/RegionalTerrain3D'
import { Icon } from '../components/ui/Icon'
import { RadiusHint } from '../components/ui/RadiusHint'
import { Badge, Button, Empty, ErrorBanner, NumberField, PageHeader, Panel, Segmented, SelectField, Spinner, Stat, SyntheticNotice, TextField, Toggle } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { DEM_STATUS_RU, label, tr } from '../i18n/ru'
import { LAYER_STYLES, RAMPS, rgbCss, sample } from '../lib/colormap'
import { pickDataset, radiusAdvice } from '../lib/datasets'
import { fmt, fmtDate } from '../lib/format'
import { formatLat, formatLon, inCoverageBox, wrapLon } from '../lib/geo'
import { globeElevationRange, type GlobeColorMode } from '../lib/globeMesh'
import { LANDMARKS, parseCoords, searchPlaces, type Landmark } from '../lib/landmarks'
import { TERRAIN_FIELDS, validateNumber } from '../lib/validation'
import { useInputs, useSession } from '../store/appStore'

export default function ExplorerPage() {
  const inputs = useInputs()
  const { terrainWindow, setTerrainWindow, analysis } = useSession()
  const sources = useFetch(() => api.dataSources(), [])
  const regions = useFetch(() => api.regions(), [])
  const [view, setView] = useState<'globe' | 'relief'>('globe')
  const [grid, setGrid] = useState(true)
  const [coverage, setCoverage] = useState(true)
  const [markers, setMarkers] = useState(true)
  const [colorMode, setColorMode] = useState<GlobeColorMode>('natural')
  const [hover, setHover] = useState<{ lat: number; lon: number } | null>(null)
  const [focus, setFocus] = useState(0)
  const [latS, setLatS] = useState(String(inputs.target.lat)), [lonS, setLonS] = useState(String(inputs.target.lon))
  const [radiusS, setRadiusS] = useState(String(inputs.analysisRadius_m))
  const [probe, setProbe] = useState<ElevationPoint | null>(null)
  const [busy, setBusy] = useState<null | 'probe' | 'relief'>(null)
  const [error, setError] = useState<unknown>(null)
  const [exag, setExag] = useState(3)
  const [globeExag, setGlobeExag] = useState(10)
  const [layerKey, setLayerKey] = useState('natural')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const datasets = sources.data?.installed ?? []
  const dems = datasets.filter((d) => d.usable_as_dem)
  const real = dems.filter((d) => !d.synthetic), synth = dems.filter((d) => d.synthetic)
  const supplementary = datasets.filter((d) => !d.usable_as_dem)
  const t = inputs.target
  const globalAvail = dems.some((d) => d.is_geographic_crs && d.coverage.lat_range_deg && d.coverage.lat_range_deg[1] - d.coverage.lat_range_deg[0] >= 170 && (!d.synthetic || inputs.allowSynthetic))
  const globe = useFetch((s) => api.globe({ allow_synthetic: inputs.allowSynthetic, rows: 180, cols: 360 }, s), [inputs.allowSynthetic, globalAvail], globalAvail)
  const globeRange = globe.data ? globeElevationRange(globe.data) : null

  const covering = useMemo(() => dems.filter((d) => inCoverageBox(t.lat, t.lon, d.coverage)), [dems, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const used = useMemo(() => pickDataset(datasets, t.lat, t.lon, { datasetId: inputs.datasetId, allowSynthetic: inputs.allowSynthetic }), [datasets, t, inputs.datasetId, inputs.allowSynthetic])
  const advice = useMemo(() => radiusAdvice(used, Number(radiusS)), [used, radiusS])
  useEffect(() => { if (advice?.tooSmall) setRadiusS(String(Math.round(advice.recommended_m))) }, [advice?.dataset.id, advice?.tooSmall]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = (lat: number, lon: number, doFocus = false) => {
    const la = Number(lat.toFixed(5)), lo = Number(wrapLon(lon).toFixed(5))
    inputs.setTarget(la, lo); setLatS(String(la)); setLonS(String(lo)); setProbe(null); setError(null)
    if (doFocus) setFocus((f) => f + 1)
  }
  const latErr = validateNumber(latS, TERRAIN_FIELDS.latitude_deg), lonErr = validateNumber(lonS, TERRAIN_FIELDS.longitude_deg), radErr = validateNumber(radiusS, TERRAIN_FIELDS.radius_m)
  const applyInputs = () => { if (!latErr && !lonErr) select(Number(latS), Number(lonS), true) }

  const places: Landmark[] = useMemo(() => (regions.data ?? []).map((r) => ({ name: r.name, lat: r.latitude_deg, lon: wrapLon(r.longitude_deg), kind: 'сохранённый регион' })), [regions.data])
  const coordsQuery = parseCoords(query)
  const results = useMemo(() => searchPlaces(query, places), [query, places])
  const go = (l: { lat: number; lon: number }) => { select(l.lat, l.lon, true); setQuery('') }

  const doProbe = async () => {
    setBusy('probe'); setError(null)
    try { setProbe(await api.elevation({ latitude_deg: t.lat, longitude_deg: t.lon, dataset_id: inputs.datasetId, allow_synthetic: inputs.allowSynthetic })) } catch (e) { setError(e); setProbe(null) } finally { setBusy(null) }
  }
  const loadRelief = async () => {
    setBusy('relief'); setError(null)
    try {
      const w = await api.terrain({ latitude_deg: t.lat, longitude_deg: t.lon, radius_m: Number(radiusS), dataset_id: inputs.datasetId, max_grid: 160, allow_synthetic: inputs.allowSynthetic })
      setTerrainWindow(w); setView('relief'); inputs.setAnalysisRadius(Number(radiusS))
    } catch (e) { setError(e) } finally { setBusy(null) }
  }
  const saveRegion = async () => {
    setMsg(null)
    try { const r = await api.createRegion({ name: name.trim(), latitude_deg: t.lat, longitude_deg: t.lon, radius_m: Number(radiusS), dataset_id: terrainWindow?.provenance.dataset_id ?? null }); inputs.setRegionId(r.id); regions.reload(); setMsg(`Регион сохранён (№${r.id})`); setName('') }
    catch (e) { setMsg(tr(asApiError(e).describe())) }
  }

  const windowMatchesAnalysis = !!(analysis && terrainWindow && Math.abs(analysis.geometry.center.latitude_deg - terrainWindow.geometry.center.latitude_deg) < 1e-6 && Math.abs(analysis.geometry.center.longitude_deg - terrainWindow.geometry.center.longitude_deg) < 1e-6)
  const noRealData = sources.data && real.length === 0 && !globe.data
  const layerOptions = [{ value: 'natural', label: 'Естественный цвет' }, { value: 'elevation', label: 'По высоте (шкала)' },
    ...(windowMatchesAnalysis ? LAYER_STYLES.filter((s) => s.key !== 'elevation' && analysis!.layers[s.key]).map((s) => ({ value: s.key, label: `Слой: ${s.label}` })) : [])]

  return (
    <div className="p-4 lg:p-5">
      <PageHeader icon="globe" title="Исследование Луны" subtitle="Интерактивный глобус: выберите точку на поверхности, найдите регион по названию или координатам, посмотрите, какие реальные данные DEM её покрывают." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-3">
          {noRealData && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px] text-warn">
              Реальный DEM не установлен, поэтому рельеф показать нельзя: ниже обычная сфера, <strong>не рельеф</strong>. См. <Link className="underline" to="/data">Источники данных</Link>.
              {synth.length > 0 && ' Есть синтетический тестовый DEM: включите «Разрешить синтетику», чтобы увидеть работу конвейера (в демо-режиме).'}
            </div>
          )}
          {supplementary.length > 0 && real.length === 0 && !globe.data && <div className="rounded-lg border border-line bg-panel p-3 text-[12.5px] text-muted">Установлены, но это не высоты: {supplementary.map((d) => `${d.product} (${label({ roughness: 'шероховатость', slope: 'уклон' }, d.quantity)})`).join(', ')}. Для рельефа нужен продукт высот (LOLA LDEM).</div>}
          {globe.data?.provenance.synthetic && <SyntheticNotice compact />}
          {globe.error && <ErrorBanner error={globe.error} title="Глобальный рельеф недоступен" onRetry={globe.reload} />}

          <div className="relative min-h-[560px] flex-1 overflow-hidden rounded-lg border border-line bg-space-950 xl:min-h-[calc(100vh-17rem)]" data-testid="globe-wrap">
            {view === 'globe' ? (
              <div className="absolute inset-0">
                <MoonGlobe selected={t} onSelect={(la, lo) => select(la, lo)} onHover={setHover} showGrid={grid} datasets={coverage ? datasets : []} regions={markers ? regions.data ?? [] : []}
                  candidates={markers ? analysis?.candidates : undefined} focusSignal={focus} globe={globe.data} exaggeration={globeExag} colorMode={colorMode} />
              </div>
            ) : terrainWindow ? (
              <div className="absolute inset-0">
                <RegionalTerrain3D elevation={terrainWindow.elevation_m} geometry={terrainWindow.geometry} analysis={windowMatchesAnalysis ? analysis : null} layerKey={windowMatchesAnalysis || layerKey === 'natural' || layerKey === 'elevation' ? layerKey : 'natural'}
                  exaggeration={exag} className="relative h-full w-full"
                  markers={[{ lat: t.lat, lon: t.lon, label: 'выбрано', color: '#ef4444' }, ...(markers && windowMatchesAnalysis ? analysis!.candidates.map((c, i) => ({ lat: c.lat, lon: c.lon, elevation_m: c.elevation_m, label: `площадка ${i + 1}`, color: '#22c55e' })) : [])]} />
              </div>
            ) : <div className="p-6"><Empty title="Рельеф региона не загружен" icon="mountain">Выберите точку и нажмите «Загрузить рельеф региона».</Empty></div>}

            {/* search overlay */}
            <div className="absolute left-3 top-3 z-20 w-[min(22rem,calc(100%-1.5rem))]">
              <div className="relative">
                <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
                <input data-testid="place-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: Шеклтон, Аполлон-11, 18.7 -41.0…"
                  aria-label="Поиск региона" onKeyDown={(e) => { if (e.key === 'Enter') { if (coordsQuery) go(coordsQuery); else if (results[0]) go(results[0]) } if (e.key === 'Escape') setQuery('') }}
                  className="h-11 w-full rounded-lg border border-line-2 bg-space-950/90 pl-9 pr-3 text-[13.5px] outline-none backdrop-blur placeholder:text-dim focus:border-cyan" />
              </div>
              {query.trim() && (
                <ul className="mt-1 max-h-72 overflow-auto rounded-lg border border-line-2 bg-panel shadow-xl" data-testid="search-results">
                  {coordsQuery && <li><button className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-[13px] hover:bg-panel-2" onClick={() => go(coordsQuery)}><span>Перейти к координатам</span><span className="num text-dim">{coordsQuery.lat}, {coordsQuery.lon}</span></button></li>}
                  {results.map((r, i) => (
                    <li key={i}><button className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-[13px] hover:bg-panel-2" onClick={() => go(r)}><span className="truncate">{r.name}</span><span className="shrink-0 text-[11px] text-dim">{r.kind}</span></button></li>
                  ))}
                  {!coordsQuery && results.length === 0 && <li className="px-3 py-3 text-[12.5px] text-dim">Ничего не найдено. Введите название ориентира или координаты «широта, долгота».</li>}
                  <li className="border-t border-line px-3 py-2 text-[11px] text-dim">Координаты ориентиров приблизительные — для навигации по глобусу.</li>
                </ul>
              )}
            </div>

            <div className="absolute right-3 top-3 z-10"><Segmented value={view} onChange={setView} testIdPrefix="view" options={[{ value: 'globe', label: 'Глобус' }, { value: 'relief', label: 'Рельеф региона', disabled: !terrainWindow, title: terrainWindow ? '' : 'Сначала загрузите рельеф региона' }]} /></div>

            <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-md space-y-1 rounded-lg border border-line bg-space-950/85 p-3 text-[11.5px] text-muted backdrop-blur">
              <div className="num text-ink" data-testid="hover-coords">{hover ? `${formatLat(hover.lat)} · ${formatLon(hover.lon)}` : 'Наведите курсор на глобус — появятся координаты'}</div>
              {view === 'globe' && globe.data && globeRange && (
                <div data-testid="globe-legend">
                  <div className="flex items-center gap-2"><span className="h-2 w-24 rounded-sm" style={{ background: colorMode === 'natural' ? 'linear-gradient(90deg,#4d4a45,#a9a49c)' : `linear-gradient(90deg, ${Array.from({ length: 6 }, (_, i) => rgbCss(sample(RAMPS.viridis, i / 5))).join(',')})` }} />
                    <span className="num">{fmt(globeRange[0], 0)} … {fmt(globeRange[1], 0)} м</span></div>
                  <div>Реальный рельеф {globe.data.provenance.product}, радиус преувеличен ×{globeExag}{colorMode === 'natural' ? '. Окраска условная: ниже — темнее' : ''}</div>
                </div>
              )}
              {view === 'globe' && !globe.data && <div>Обычная сфера — без глобального DEM рельеф не рисуется. Клик выбирает точку.</div>}
              {view === 'relief' && terrainWindow && <div>{terrainWindow.provenance.provider} · {terrainWindow.provenance.product}{terrainWindow.provenance.synthetic ? ' · СИНТЕТИКА' : ''}</div>}
              <div className="text-dim">Вращение — левая кнопка, перемещение — правая, масштаб — колесо.</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-panel/80 px-4 py-2.5">
            {view === 'globe' ? (<>
              <Toggle checked={grid} onChange={setGrid} label="Сетка 30°" /><Toggle checked={coverage} onChange={setCoverage} label="Покрытие DEM" /><Toggle checked={markers} onChange={setMarkers} label="Метки" />
              <Segmented value={colorMode} onChange={setColorMode} options={[{ value: 'natural', label: 'Естественный' }, { value: 'elevation', label: 'По высоте' }]} />
              {globe.data && <label className="flex items-center gap-2 text-[12.5px] text-muted">Рельеф ×{globeExag}<input type="range" aria-label="Вертикальное преувеличение глобуса" data-testid="globe-exag" min={1} max={40} step={1} value={globeExag} onChange={(e) => setGlobeExag(Number(e.target.value))} className="w-32 accent-cyan" /></label>}
              <Button size="sm" onClick={() => setFocus((f) => f + 1)}>Центрировать на цели</Button>
            </>) : (<>
              <div className="w-56"><SelectField label="Окраска" value={layerKey} onChange={setLayerKey} options={layerOptions} /></div>
              <label className="flex items-center gap-2 text-[12.5px] text-muted">Рельеф ×{exag}<input type="range" aria-label="Вертикальное преувеличение" min={1} max={10} step={0.5} value={exag} onChange={(e) => setExag(Number(e.target.value))} className="w-32 accent-cyan" /></label>
              <Toggle checked={markers} onChange={setMarkers} label="Метки площадок" />
            </>)}
          </div>
        </div>

        <aside className="space-y-4">
          <Panel title="Выбранная точка" icon="target">
            <div className="grid grid-cols-2 gap-3">
              <NumberField spec={TERRAIN_FIELDS.latitude_deg} value={latS} onChange={setLatS} error={latErr} compact />
              <NumberField spec={TERRAIN_FIELDS.longitude_deg} value={lonS} onChange={setLonS} error={lonErr} compact />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3"><Button onClick={applyInputs} disabled={!!latErr || !!lonErr} data-testid="apply-coords">Перейти к точке</Button>
              <span className="num text-[13px]" data-testid="selected-coords">{formatLat(t.lat)} · {formatLon(t.lon)}</span></div>
          </Panel>

          <Panel title="Данные DEM в этой точке" icon="database">
            {sources.loading && <Spinner label="Загрузка…" />}
            {sources.error && <ErrorBanner error={sources.error} onRetry={sources.reload} />}
            {sources.data && covering.length === 0 && <Empty title="Нет покрытия" icon="alert">Ни один установленный набор не покрывает эту точку{inputs.allowSynthetic ? '' : ' (синтетические наборы не учитываются)'}.</Empty>}
            <ul className="space-y-2" data-testid="coverage-list">
              {covering.filter((d) => !d.synthetic || inputs.allowSynthetic).map((d) => (
                <li key={d.id} className={`rounded-md border p-3 text-[12.5px] ${used?.id === d.id ? 'border-cyan/50 bg-cyan/5' : 'border-line'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{d.product}</span><span className="flex gap-1">{used?.id === d.id && <Badge tone="info">используется</Badge>}{d.synthetic && <Badge tone="warn">синтетика</Badge>}</span></div>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted">
                    <dt className="text-dim">Источник</dt><dd>{d.provider}</dd>
                    <dt className="text-dim">Версия</dt><dd>{d.version ?? 'не указана'}</dd>
                    <dt className="text-dim">Разрешение</dt><dd className="num">{d.resolution_m_per_px ? `${fmt(d.resolution_m_per_px, 0)} м/ячейка` : '—'}</dd>
                    <dt className="text-dim">Импортирован</dt><dd>{fmtDate(d.installed_at)}</dd>
                    <dt className="text-dim">Статус</dt><dd>{label(DEM_STATUS_RU, d.status)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
            {used && <div className="mt-2 text-[11.5px] text-dim">Цитирование: {used.citation ?? 'не указано'}</div>}
          </Panel>

          <Panel title="Реальный рельеф" icon="mountain">
            <div className="space-y-3">
              <Toggle checked={inputs.allowSynthetic} onChange={inputs.setAllowSynthetic} label="Разрешить синтетику (тест)" hint="Нужно, чтобы использовать наборы, помеченные как синтетические" />
              {inputs.allowSynthetic && <SyntheticNotice compact />}
              <div><NumberField spec={TERRAIN_FIELDS.radius_m} value={radiusS} onChange={setRadiusS} error={radErr} compact /><RadiusHint advice={advice} onApply={(r) => setRadiusS(String(r))} /></div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={doProbe} disabled={busy !== null} data-testid="probe">{busy === 'probe' ? <Spinner /> : 'Узнать высоту'}</Button>
                <Button variant="primary" onClick={loadRelief} disabled={busy !== null || !!radErr} data-testid="load-relief">{busy === 'relief' ? <Spinner label="Загрузка…" /> : 'Загрузить рельеф региона'}</Button>
              </div>
              {probe && (
                <div className="grid grid-cols-2 gap-3" data-testid="probe-result">
                  <Stat label="Высота" value={fmt(probe.elevation_m, 2)} unit="м" /><Stat label="Набор" value={probe.dataset_id} />
                  {probe.synthetic && <div className="col-span-2"><SyntheticNotice compact /></div>}
                </div>
              )}
              {terrainWindow && (
                <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
                  <Stat label="Минимум" value={fmt(terrainWindow.statistics.min_m, 1)} unit="м" /><Stat label="Максимум" value={fmt(terrainWindow.statistics.max_m, 1)} unit="м" />
                  <Stat label="Среднее" value={fmt(terrainWindow.statistics.mean_m, 1)} unit="м" /><Stat label="Валидных ячеек" value={fmt(terrainWindow.statistics.valid_fraction * 100, 1)} unit="%" />
                  {terrainWindow.provenance.synthetic && <div className="col-span-2"><SyntheticNotice compact /></div>}
                </div>
              )}
              {error != null && <ErrorBanner error={error} title="Запрос рельефа не выполнен" />}
            </div>
          </Panel>

          <Panel title="Дальнейшие шаги" icon="play">
            <div className="flex flex-col gap-2">
              <Link to="/terrain" className="flex min-h-11 items-center justify-between rounded-md border border-line-2 bg-panel-2 px-4 text-[13px] hover:bg-panel-3">Проанализировать этот регион <span>→</span></Link>
              <Link to="/simulation" className="flex min-h-11 items-center justify-between rounded-md border border-line-2 bg-panel-2 px-4 text-[13px] hover:bg-panel-3">Смоделировать посадку здесь <span>→</span></Link>
            </div>
          </Panel>

          <Panel title="Сохранённые регионы" icon="database">
            <div className="space-y-3">
              <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><TextField id="explorer-region-name" testId="explorer-region-name" label="Название региона" value={name} onChange={setName} maxLength={128} placeholder="Например, «Кандидат №1»" /></div>
                <Button onClick={saveRegion} disabled={!name.trim() || !!radErr}>Сохранить</Button></div>
              {msg && <div className="text-[12.5px] text-muted">{msg}</div>}
              {regions.error && <ErrorBanner error={regions.error} onRetry={regions.reload} />}
              {regions.data?.length === 0 && <div className="text-[12.5px] text-dim">Сохранённых регионов нет.</div>}
              <ul className="space-y-1.5">{regions.data?.map((r) => (
                <li key={r.id}><button onClick={() => { select(r.latitude_deg, r.longitude_deg, true); inputs.setRegionId(r.id); setRadiusS(String(r.radius_m)) }} className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-line px-3 text-left text-[13px] hover:bg-panel-2">
                  <span className="truncate">{r.name}</span><span className="num shrink-0 text-[11.5px] text-dim">{r.latitude_deg.toFixed(2)}, {r.longitude_deg.toFixed(2)}</span></button></li>))}</ul>
            </div>
          </Panel>
          <p className="text-[11px] text-dim">Ориентиры в поиске: {LANDMARKS.length} известных мест с приблизительными координатами.</p>
        </aside>
      </div>
    </div>
  )
}

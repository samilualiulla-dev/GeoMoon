import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/http'
import { ControlPanel } from '../components/orbital/ControlPanel'
import { LiveTelemetry } from '../components/orbital/LiveTelemetry'
import { OrbitGraphs } from '../components/orbital/OrbitGraphs'
import { OrbitMap2D } from '../components/orbital/OrbitMap2D'
import { OrbitScene3D, type CamMode } from '../components/orbital/OrbitScene3D'
import { SetupPanel } from '../components/orbital/SetupPanel'
import { eventRu, TimeBar } from '../components/orbital/TimeBar'
import { Badge, Button, Empty, ErrorBanner, PageHeader, Panel, Segmented, Spinner, Toggle } from '../components/ui/ui'
import { orbApi } from '../api/orbital'
import { orbitalClock } from '../hooks/useOrbitalClock'
import { fmtDistance, fmtTime, type MapCenter, type MapPlane } from '../lib/orbital'
import { useOrbital } from '../store/orbitalStore'

type View = 'split' | 'map' | 'scene'

export default function OrbitalPage() {
  const { summary, data, events, busy, error, simId, load, run, resetSim, clearError } = useOrbital()
  const [tab, setTab] = useState<'setup' | 'control'>('setup')
  const [view, setView] = useState<View>('split')
  const [center, setCenter] = useState<MapCenter>('earth')
  const [plane, setPlane] = useState<MapPlane>('equator')
  const [cam, setCam] = useState<CamMode>('earth')
  const [camCmd, setCamCmd] = useState({ nonce: 0, preset: 'default' })
  const [relTrail, setRelTrail] = useState(false)
  const [showTrail, setShowTrail] = useState(true)
  const [showMoonTrack, setShowMoonTrack] = useState(true)
  const [labels, setLabels] = useState(true)
  const [exag, setExag] = useState(10)
  const [moonPos, setMoonPos] = useState<{ lat: number | null; lon: number | null; alt: number } | null>(null)
  const [sims, setSims] = useState<{ id: string; name: string; status: string; t_now_s: number }[]>([])
  const box = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)

  useEffect(() => { if (simId && !summary) void load(simId) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { orbApi.list().then((r) => setSims(r.simulations)).catch(() => setSims([])) }, [summary?.id, summary?.status, summary?.t_now_s])
  useEffect(() => { const h = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', h); return () => { document.removeEventListener('fullscreenchange', h); orbitalClock.pause() } }, [])
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void box.current?.requestFullscreen?.() }
  const allEvents = useMemo(() => events, [events])
  const end = summary?.final_state
  return (
    <div className="mx-auto max-w-[1900px] p-4 md:p-5" data-testid="orbital-page">
      <PageHeader icon="rocket" title="Орбитальный симулятор полёта" subtitle="Система Земля–Луна: двумерная карта и трёхмерная сцена строятся из одних и тех же данных ядра. Физика считается на сервере (гравитация Земли, Луны, Солнца, численное интегрирование)."
        actions={<>{summary && <Badge tone="info">{summary.name}</Badge>}{busy && <Spinner label={busy} />}</>} />
      {error && <div className="mb-3"><ErrorBanner error={new ApiError('http', error)} title="Ошибка орбитального ядра" onRetry={clearError} /></div>}
      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_300px]">
        <aside className="min-w-0 space-y-3 xl:max-h-[calc(100vh-150px)] xl:overflow-auto xl:pr-1">
          <Segmented value={tab} onChange={setTab} testIdPrefix="otab" options={[{ value: 'setup', label: 'Настройка' }, { value: 'control', label: 'Управление' }]} />
          {tab === 'setup' ? <SetupPanel /> : <Panel title="Ручное и программное управление"><ControlPanel /></Panel>}
          {sims.length > 0 && (
            <Panel title="Сохранённые симуляции" padded>
              <ul className="max-h-40 space-y-1 overflow-auto text-[12.5px]">
                {sims.slice(0, 12).map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <button type="button" className={`min-w-0 flex-1 truncate text-left hover:text-cyan ${s.id === simId ? 'text-cyan' : 'text-muted'}`} onClick={() => void load(s.id)}>{s.name} <span className="num text-dim">· {s.id.slice(0, 6)} · {fmtTime(s.t_now_s)}</span></button>
                    <button type="button" className="text-dim hover:text-bad" aria-label="Удалить" onClick={() => void orbApi.remove(s.id).then(() => setSims((x) => x.filter((y) => y.id !== s.id)))}>✕</button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
        <section className="min-w-0 space-y-4">
          <div ref={box} className={`flex flex-col overflow-hidden rounded-lg border border-line bg-panel/95 ${full ? 'h-screen' : ''}`} data-testid="orbit-viewport">
            <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
              <Segmented value={view} onChange={setView} testIdPrefix="view" options={[{ value: 'split', label: '2D + 3D' }, { value: 'map', label: '2D карта' }, { value: 'scene', label: '3D сцена' }]} />
              {view !== 'scene' && <>
                <span className="text-dim">Центр карты</span>
                <Segmented value={center} onChange={setCenter} options={[{ value: 'earth', label: 'Земля' }, { value: 'moon', label: 'Луна' }, { value: 'vehicle', label: 'Аппарат' }]} />
                <Segmented value={plane} onChange={setPlane} options={[{ value: 'equator', label: 'экватор' }, { value: 'orbit', label: 'плоск. орбиты' }]} />
              </>}
              {view !== 'map' && <>
                <span className="text-dim">Камера</span>
                <Segmented value={cam} onChange={(c) => { setCam(c); setCamCmd((x) => ({ nonce: x.nonce + 1, preset: 'default' })) }} testIdPrefix="cam" options={[{ value: 'earth', label: 'Земля' }, { value: 'moon', label: 'Луна' }, { value: 'vehicle', label: 'Аппарат' }, { value: 'free', label: 'Свободно' }]} />
              </>}
              <Button size="sm" className="ml-auto" onClick={toggleFull} data-testid="btn-fullscreen">{full ? 'Выйти из полного экрана' : 'Полный экран'}</Button>
            </div>
            <div className="relative min-h-[460px] flex-1 md:min-h-[560px]">
              {!data ? (
                <div className="absolute inset-0 flex items-center justify-center p-6"><Empty title="Симуляция не создана" icon="rocket">Выберите сценарий слева, при необходимости измените условия и нажмите «Создать симуляцию». Расчёт выполняет ядро (Земля + Луна + Солнце).</Empty></div>
              ) : (
                <div className={`absolute inset-0 grid ${view === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                  {view !== 'scene' && <div className="relative min-h-[300px] border-r border-line"><OrbitMap2D data={data} events={allEvents} center={center} plane={plane} showMoonTrack={showMoonTrack} showLabels={labels} /></div>}
                  {view !== 'map' && <div className="relative min-h-[300px]"><OrbitScene3D data={data} camMode={cam} camCmd={camCmd} relativeTrail={relTrail} showTrail={showTrail} exaggeration={exag} onVehicleMoon={(lat, lon, alt) => setMoonPos((p) => (p && p.lat === lat && p.lon === lon && Math.abs(p.alt - alt) < 50 ? p : { lat, lon, alt }))} /></div>}
                </div>
              )}
            </div>
            <div className="no-print flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-3 py-2 text-xs">
              <Toggle checked={showTrail} onChange={setShowTrail} label="траектория" />
              <Toggle checked={relTrail} onChange={setRelTrail} label="траектория в системе Луны (3D)" />
              <Toggle checked={showMoonTrack} onChange={setShowMoonTrack} label="орбита Луны (2D)" />
              <Toggle checked={labels} onChange={setLabels} label="подписи" />
              <label className="flex items-center gap-2 text-muted">Рельеф Луны ×<input type="range" min={1} max={40} value={exag} onChange={(e) => setExag(Number(e.target.value))} className="w-28 accent-cyan" aria-label="Преувеличение рельефа" /><span className="num text-ink">{exag}</span></label>
            </div>
            <TimeBar onRun={() => void run({ extend: true, duration_s: Math.max(86400, (summary?.mission_duration_s ?? 86400) * 0.5) })} />
          </div>
          {summary && end && (
            <Panel title="Итог расчёта" icon="check">
              <div className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="text-muted">Статус: </span><span className="text-ink">{summary.status}</span></div>
                <div><span className="text-muted">Рассчитано до: </span><span className="num text-ink">{fmtTime(summary.t_now_s)}</span></div>
                <div><span className="text-muted">Остаток топлива: </span><span className="num text-ink">{end.fuel_kg.toFixed(0)} кг</span></div>
                <div><span className="text-muted">Расстояние от Земли: </span><span className="num text-ink">{fmtDistance(Math.hypot(...end.r))}</span></div>
              </div>
              <p className="mt-2 text-[11.5px] text-dim">Образовательная модель: точечные массы Земли, Луны и Солнца, J2 Земли; эфемериды — аналитические с невысокой точностью (≈0,3° по Луне). Не полётное ПО; результат не гарантирует безопасности.</p>
              <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void resetSim()} disabled={!!busy}>Сбросить симуляцию</Button><Button size="sm" onClick={() => void run({ extend: true, duration_s: 86400 })} disabled={!!busy}>+1 сутки расчёта</Button></div>
            </Panel>
          )}
        </section>
        <aside className="min-w-0 space-y-4">
          {data ? <LiveTelemetry data={data} moonFixed={moonPos} /> : <Panel title="Телеметрия"><p className="text-[12.5px] text-muted">Данные появятся после создания симуляции.</p></Panel>}
          <Panel title="События" icon="alert" padded>
            <ul className="max-h-72 space-y-0.5 overflow-auto text-[12px]" data-testid="orbit-events">
              {allEvents.length === 0 && <li className="text-dim">нет событий</li>}
              {allEvents.map((e, i) => <li key={i}><button type="button" className="w-full truncate text-left hover:text-cyan" onClick={() => orbitalClock.seek(e.t_s)}><span className="num text-dim">{fmtTime(e.t_s)}</span> <span className="text-ink">{eventRu(e.type)}</span>{typeof e.details.altitude_m === 'number' ? <span className="text-muted"> · {fmtDistance(e.details.altitude_m)}</span> : null}{typeof e.details.speed_mps === 'number' ? <span className="text-muted"> · {(e.details.speed_mps as number).toFixed(1)} м/с</span> : null}</button></li>)}
            </ul>
          </Panel>
        </aside>
      </div>
      {data && <div className="mt-4"><OrbitGraphs data={data} /></div>}
    </div>
  )
}

import { useMemo } from 'react'
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { OrbEvent, OrbSummary } from '../../api/orbital'
import { useThrottledClock } from '../../hooks/useOrbitalClock'
import { fmtTime, interpScalar, type OrbData } from '../../lib/orbital'
import { eventRu } from './TimeBar'
import { OrbitMap2D } from './OrbitMap2D'

const C = 299_792_458
const PHASES = ['Старт', 'Орбита Земли', 'Отлёт к Луне', 'Сфера влияния Луны', 'Орбита Луны', 'Возврат / иное', 'Контакт с поверхностью']

/** Phase is inferred from core telemetry (dominant body, orbit energy, events) — a label, not a mission plan. */
function phaseAt(g: (k: string) => number | null, events: OrbEvent[], t: number, status: string, tEnd: number): number {
  const contact = events.find((e) => (e.type === 'moon_contact' || e.type === 'earth_impact') && e.t_s <= t + 1e-6)
  if (contact) return 6
  if (status !== 'ready' && t >= tEnd - 1e-6 && ['landed', 'impact'].includes(status)) return 6
  const moon = (g('dominant_body_is_moon') ?? 0) > 0.5
  const ecc = g('ecc') ?? 0, peri = g('periapsis_alt_m') ?? 0
  if (moon) return ecc < 0.9 && peri > 0 && (g('apoapsis_alt_m') ?? -1) > 0 ? 4 : 3
  const entered = events.some((e) => e.type === 'moon_soi_entry' && e.t_s <= t)
  if (entered) return 5
  const apo = g('apoapsis_alt_m')
  if (apo === null || apo > 2_000_000 || (g('dist_earth_m') ?? 0) > 12_000_000) return 2
  return t < 1 ? 0 : 1
}

const Card = ({ label, value, unit, tone = 'cyan' }: { label: string; value: string; unit?: string; tone?: 'cyan' | 'amber' | 'white' }) => (
  <div className="rounded-lg border border-cyan/20 bg-space-950/70 p-3 text-center shadow-[inset_0_0_24px_rgba(34,211,238,.05)]">
    <div className="text-[10.5px] uppercase tracking-[0.2em] text-muted">{label}</div>
    <div className={`num mt-1 text-2xl font-semibold ${tone === 'amber' ? 'text-warn' : tone === 'white' ? 'text-ink' : 'text-cyan'}`}>{value}<span className="ml-1.5 text-sm font-normal text-muted">{unit}</span></div>
  </div>
)

function Spark({ rows, k, color, t, label, value }: { rows: Record<string, number>[]; k: string; color: string; t: number; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-space-950/70 p-3">
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-widest text-muted"><span>{label}</span><span className="num text-sm normal-case tracking-normal" style={{ color }}>{value}</span></div>
      <div className="mt-1 h-24"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide /><YAxis hide domain={['auto', 'auto']} />
          <Area dataKey={k} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          <ReferenceLine x={t} stroke="#fbbf24" strokeDasharray="3 2" />
        </AreaChart></ResponsiveContainer></div>
    </div>
  )
}

/** Mission-control style summary of the vehicle at the current playback time. All values come from core telemetry. */
export function MissionControl({ data, events, summary }: { data: OrbData; events: OrbEvent[]; summary: OrbSummary }) {
  const t = useThrottledClock(150)
  const g = (k: string) => interpScalar(data.tel.t_s, data.tel.series[k] ?? [], t)
  const ph = phaseAt(g, events, t, summary.status, summary.t_now_s)
  const next = events.filter((e) => e.t_s > t && !['burn_end', 'control_change'].includes(e.type)).sort((a, b) => a.t_s - b.t_s)[0]
  const epoch = new Date(summary.epoch_iso).getTime()
  const utc = new Date(epoch + t * 1000)
  const dE = g('dist_earth_m'), dM = g('dist_moon_m'), sp = g('speed_inertial_mps')
  const rows = useMemo(() => data.tel.t_s.map((tt, i) => ({ t: tt, v: (data.tel.series.speed_inertial_mps?.[i] ?? 0) / 1000, d: (data.tel.series.dist_earth_m?.[i] ?? 0) / 1000 })), [data])
  const fuelPct = (() => { const f = g('fuel_kg'), f0 = summary.config.vehicle.fuel_mass_kg; return f !== null && f0 > 0 ? (f / f0) * 100 : null })()
  const log = events.filter((e) => e.t_s <= t).slice(-6).reverse()
  return (
    <section className="space-y-3 rounded-xl border border-cyan/25 bg-gradient-to-b from-space-900 to-space-950 p-3" data-testid="mission-control" aria-label="Центр управления">
      <div className="flex items-center justify-between px-1"><div><div className="text-lg font-semibold tracking-[0.2em] text-cyan">{summary.name.toUpperCase()}</div><div className="text-[10px] uppercase tracking-[0.3em] text-muted">центр управления полётом · данные ядра</div></div>
        <span className="rounded border border-bad/50 px-2 py-0.5 text-[11px] text-bad">{summary.status === 'ready' || summary.status === 'completed' ? 'РАСЧЁТ' : summary.status.toUpperCase()}</span></div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-center md:grid-cols-4 xl:grid-cols-7">
        {[['Фаза', PHASES[ph], 'text-cyan'], ['Время миссии', `T+${fmtTime(t)}`, 'text-cyan'], ['Сутки', `${Math.floor(t / 86400) + 1} / ${Math.max(1, Math.ceil(summary.t_now_s / 86400))}`, 'text-ink'],
          ['Скорость', sp === null ? '—' : `${(sp / 1000).toFixed(2)} км/с`, 'text-cyan'], ['Следующее событие', next ? `${eventRu(next.type)} · ${fmtTime(next.t_s - t)}` : '—', 'text-warn'],
          ['UTC', utc.toISOString().slice(11, 19), 'text-ink'], ['Местное', utc.toLocaleTimeString('ru-RU'), 'text-muted']].map(([k, v, c]) => (
          <div key={k} className="bg-space-950 px-2 py-2.5"><div className="text-[10px] uppercase tracking-[0.18em] text-muted">{k}</div><div className={`num mt-0.5 text-[13.5px] font-semibold ${c}`} data-testid={k === 'Фаза' ? 'mc-phase' : undefined}>{v}</div></div>))}
      </div>
      <div className="flex items-center gap-1 px-1" aria-label="Фазы">{PHASES.slice(0, 6).map((p, i) => <div key={p} className="flex-1"><div className={`h-1.5 rounded ${i < ph ? 'bg-ok' : i === ph ? 'bg-cyan shadow-[0_0_8px_#22d3ee]' : 'bg-line'}`} /><div className={`mt-1 truncate text-[10px] ${i === ph ? 'text-cyan' : i < ph ? 'text-ok' : 'text-dim'}`}>{p}</div></div>)}</div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="relative h-72 overflow-hidden rounded-lg border border-cyan/20"><OrbitMap2D data={data} events={events} center="earth" plane="equator" showMoonTrack showLabels /></div>
        <div className="grid grid-cols-2 gap-3">
          <Card label="Расстояние · Земля" value={dE === null ? '—' : Math.round(dE / 1000).toLocaleString('ru-RU')} unit="км" />
          <Card label="Скорость" value={sp === null ? '—' : (sp / 1000).toFixed(2)} unit="км/с" />
          <Card label="Расстояние · Луна" value={dM === null ? '—' : Math.round(dM / 1000).toLocaleString('ru-RU')} unit="км" tone="white" />
          <Card label="Задержка связи" value={dE === null ? '—' : (dE / C).toFixed(2)} unit="с" tone="amber" />
          <Card label="Масса" value={(g('mass_kg') ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} unit="кг" tone="white" />
          <Card label="Топливо" value={fuelPct === null ? '—' : fuelPct.toFixed(1)} unit="%" tone="amber" />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Spark rows={rows} k="v" color="#22d3ee" t={t} label="Профиль скорости, км/с" value={sp === null ? '—' : (sp / 1000).toFixed(2)} />
        <Spark rows={rows} k="d" color="#f59e0b" t={t} label="Расстояние от Земли, км" value={dE === null ? '—' : Math.round(dE / 1000).toLocaleString('ru-RU')} />
        <div className="rounded-lg border border-ok/30 bg-black/50 p-3 font-mono text-[12px] text-ok" data-testid="mc-log">
          <div className="mb-1 text-[10.5px] uppercase tracking-widest text-ok/70">журнал полёта // {PHASES[ph]}</div>
          {log.length === 0 && <div className="text-ok/60">&gt; ожидание событий</div>}
          {log.map((e, i) => <div key={i} className="truncate">&gt; <span className="text-ok/60">{fmtTime(e.t_s)}</span> {eventRu(e.type)}</div>)}
        </div>
      </div>
    </section>
  )
}

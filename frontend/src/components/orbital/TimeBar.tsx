import { useState } from 'react'
import { orbitalClock, SPEEDS, useClock } from '../../hooks/useOrbitalClock'
import { fmtTime } from '../../lib/orbital'
import { useOrbital } from '../../store/orbitalStore'
import { Badge, Button } from '../ui/ui'

const STEPS = [{ v: 1, l: '1 с' }, { v: 10, l: '10 с' }, { v: 60, l: '1 мин' }, { v: 600, l: '10 мин' }, { v: 3600, l: '1 ч' }, { v: 86400, l: '1 сут' }]
const EVENT_TONE: Record<string, string> = { impulse: '#fb923c', burn_start: '#fb923c', control_change: '#22d3ee', periselene: '#22c55e', moon_soi_entry: '#a78bfa', moon_contact: '#ef4444', earth_impact: '#ef4444', fuel_exhausted: '#eab308' }
const EVENT_RU: Record<string, string> = { impulse: 'импульс Δv', burn_start: 'включение двигателя', burn_end: 'выключение', control_change: 'команда управления', periselene: 'перилуний', aposelene: 'апоселений', perigee: 'перигей', apogee: 'апогей', moon_soi_entry: 'вход в сферу влияния Луны', moon_soi_exit: 'выход из сферы влияния', moon_contact: 'контакт с Луной', earth_impact: 'контакт с Землёй', fuel_exhausted: 'топливо закончилось', impulse_limited: 'импульс ограничен топливом', integration_failed: 'сбой интегрирования' }
export const eventRu = (t: string) => EVENT_RU[t] ?? t

export function TimeBar({ onRun }: { onRun: () => void }) {
  const { summary, events, busy } = useOrbital()
  const c = useClock()
  const [step, setStep] = useState(60)
  const off = !summary || c.limit <= 0
  return (
    <div className="border-t border-line bg-panel/90 px-4 py-3" data-testid="orbit-timebar">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="play" disabled={off} onClick={() => { orbitalClock.seek(0); orbitalClock.play() }} data-testid="btn-start">Старт</Button>
        <Button disabled={off || !c.playing} onClick={() => orbitalClock.pause()} data-testid="btn-pause">Пауза</Button>
        <Button disabled={off || c.playing} onClick={() => orbitalClock.play()} data-testid="btn-resume">Продолжить</Button>
        <Button disabled={off} onClick={() => orbitalClock.reset()} data-testid="btn-reset">Сброс</Button>
        <Button disabled={off} onClick={() => { orbitalClock.seek(0); orbitalClock.play() }} data-testid="btn-replay">Повтор</Button>
        <span className="mx-1 h-6 w-px bg-line" />
        <Button size="sm" disabled={off} onClick={() => orbitalClock.step(-step)} data-testid="btn-step-back" aria-label="Шаг назад">◀ шаг</Button>
        <Button size="sm" disabled={off} onClick={() => orbitalClock.step(step)} data-testid="btn-step-fwd" aria-label="Шаг вперёд">шаг ▶</Button>
        <select value={step} onChange={(e) => setStep(Number(e.target.value))} aria-label="Размер шага" className="h-8 rounded-md border border-line-2 bg-space-900 px-2 text-xs text-ink">{STEPS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
        <span className="ml-auto flex items-center gap-2">
          {summary && <Badge tone={summary.status === 'ready' || summary.status === 'completed' ? 'neutral' : summary.status === 'landed' ? 'ok' : 'bad'}>{summary.status === 'ready' ? 'расчёт идёт' : summary.status === 'completed' ? 'расчёт завершён' : summary.status === 'landed' ? 'контакт на малой скорости' : summary.status === 'impact' ? 'удар о поверхность' : 'сбой'}</Badge>}
          <Button size="sm" disabled={off || !!busy || !summary || ['landed', 'impact', 'failed'].includes(summary.status)} onClick={onRun} data-testid="btn-extend">Продлить расчёт</Button>
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted">Скорость
          <select value={String(c.speed)} onChange={(e) => orbitalClock.setSpeed(Number(e.target.value))} aria-label="Скорость времени" data-testid="speed" className="h-9 rounded-md border border-line-2 bg-space-900 px-2 text-[13px] text-ink">{SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}</select>
        </label>
        <div className="relative min-w-0 flex-1">
          <input type="range" aria-label="Время симуляции" min={0} max={c.limit || 1} step={(c.limit || 1) / 2000} value={c.t} disabled={off} onChange={(e) => orbitalClock.seek(Number(e.target.value))} className="h-6 w-full accent-cyan" data-testid="timeline" />
          <div className="pointer-events-none absolute inset-x-0 top-[1px] h-6" aria-hidden>
            {c.limit > 0 && events.filter((e) => EVENT_TONE[e.type]).map((e, i) => <span key={i} title={`${eventRu(e.type)} · ${fmtTime(e.t_s)}`} className="absolute top-0 h-2.5 w-0.5 -translate-x-1/2 rounded" style={{ left: `${(e.t_s / c.limit) * 100}%`, background: EVENT_TONE[e.type] }} />)}
          </div>
        </div>
        <span className="num shrink-0 text-[13px] text-ink" data-testid="orbit-time">{fmtTime(c.t)} <span className="text-dim">/ {fmtTime(c.limit)}</span></span>
      </div>
    </div>
  )
}

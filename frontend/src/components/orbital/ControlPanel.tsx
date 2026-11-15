import { useState } from 'react'
import { useClock } from '../../hooks/useOrbitalClock'
import { fmtTime } from '../../lib/orbital'
import { useOrbital } from '../../store/orbitalStore'
import { Badge, Button } from '../ui/ui'
import { Num, Sel } from './fields'

const DIR_RU: Record<string, string> = { prograde: 'по скорости (прогрейд)', retrograde: 'против скорости (ретроград)', radial_out: 'от центра (радиально)', radial_in: 'к центру', normal: 'нормаль к плоскости орбиты', antinormal: 'анти-нормаль', to_moon: 'на Луну', to_earth: 'на Землю', inertial: 'фиксированный вектор', surface_retro: 'торможение относительно поверхности' }

/** Manual engine control at the current simulation time + programmed burns. The core re-integrates the future and keeps history. */
export function ControlPanel() {
  const { summary, control, busy, events } = useOrbital()
  const clock = useClock()
  const [thr, setThr] = useState(1)
  const [dir, setDir] = useState('prograde')
  const [ref, setRef] = useState('auto')
  const [dur, setDur] = useState<number | null>(60)
  const [dv, setDv] = useState<number | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const ended = summary && ['landed', 'impact', 'failed'].includes(summary.status)
  const vehicle = summary?.config.vehicle
  const noEngine = !vehicle || vehicle.engines.reduce((a, e) => a + e.thrust_n, 0) <= 0
  const ctl = (extra: Record<string, unknown>) => void control({ t_s: at ?? clock.t, direction: dir, reference: ref, ...extra, horizon_s: summary?.t_now_s })
  const manual = events.filter((e) => e.type === 'control_change' || e.type === 'impulse')
  return (
    <div className="space-y-3 text-[13px]" data-testid="orbit-control">
      <div className="flex items-center justify-between">
        <span className="text-muted">Управление на моменте <span className="num text-ink" data-testid="control-time">{fmtTime(at ?? clock.t)}</span></span>
        {at !== null && <button className="text-[11px] text-cyan" onClick={() => setAt(null)}>= текущее время</button>}
      </div>
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="w-28"><Num label="Свой момент" unit="с" nullable value={at} onChange={setAt} min={0} /></div>
      </div>
      <label className="block text-xs text-muted"><span className="mb-1 flex justify-between"><span>Тяга двигателя</span><span className="num text-ink">{Math.round(thr * 100)} %</span></span>
        <input type="range" min={0} max={1} step={0.05} value={thr} onChange={(e) => setThr(Number(e.target.value))} className="h-6 w-full accent-cyan" aria-label="Тяга" data-testid="throttle" disabled={noEngine || !!ended} /></label>
      <Sel label="Направление тяги" value={dir} onChange={setDir} testId="ctl-dir" options={Object.entries(DIR_RU).map(([value, label]) => ({ value, label }))} />
      <Sel label="Относительно" value={ref} onChange={setRef} options={[{ value: 'auto', label: 'авто (по сфере влияния)' }, { value: 'earth', label: 'Земли' }, { value: 'moon', label: 'Луны' }]} />
      <div className="grid grid-cols-2 gap-2.5">
        <Num label="Длительность (пусто = до отмены)" unit="с" nullable value={dur} min={0.1} onChange={setDur} testId="ctl-dur" />
        <Num label="Импульс Δv (мгновенный)" unit="м/с" nullable value={dv} onChange={setDv} testId="ctl-dv" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" icon="play" disabled={!summary || !!busy || noEngine || !!ended} onClick={() => ctl(dv !== null ? { delta_v_mps: dv, throttle: 1, duration_s: null } : { throttle: thr, duration_s: dur })} data-testid="btn-apply-control">Включить</Button>
        <Button variant="danger" disabled={!summary || !!busy || !!ended} onClick={() => ctl({ throttle: 0, duration_s: null })} data-testid="btn-cut">Выключить</Button>
      </div>
      {noEngine && <p className="text-[11.5px] text-warn">У аппарата нет тяги — задайте двигатель в «Начальные условия».</p>}
      {ended && <p className="text-[11.5px] text-warn">Симуляция завершена ({summary?.status}). Сбросьте её, чтобы управлять заново.</p>}
      <p className="text-[11px] leading-snug text-dim">Новая команда действует с выбранного момента: история до него сохраняется (события не стираются), будущее пересчитывается ядром. Мгновенный Δv — приближение короткого импульса.</p>
      {manual.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wider text-dim">Журнал команд</div>
          <ul className="max-h-36 space-y-0.5 overflow-auto text-[12px]">
            {manual.map((e, k) => <li key={k} className="flex gap-2"><Badge tone={e.type === 'impulse' ? 'warn' : 'info'}>{e.type === 'impulse' ? 'Δv' : 'упр.'}</Badge><span className="num text-muted">{fmtTime(e.t_s)}</span><span className="truncate text-ink">{String((e.details as { direction?: string }).direction ?? '')}{(e.details as { throttle?: number }).throttle !== undefined ? ` · ${Math.round(((e.details as { throttle: number }).throttle) * 100)} %` : ''}{(e.details as { delta_v_mps?: number }).delta_v_mps !== undefined ? ` · ${(e.details as { delta_v_mps: number }).delta_v_mps.toFixed(1)} м/с` : ''}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

import type { SimSummary } from '../../api/types'
import { playback, usePlaybackSnapshot } from '../../hooks/usePlayback'
import { EVENT_RU, PLAY_RU, label } from '../../i18n/ru'
import { fmtDuration } from '../../lib/format'
import { Badge, Button } from '../ui/ui'

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 25]

/** Playback controls + timeline with markers for the events reported by the core. Replays the stored series; no physics here. */
export function Timeline({ duration, events, disabled }: { duration: number; events: SimSummary['events']; disabled?: boolean }) {
  const pb = { ...usePlaybackSnapshot(), start: playback.start, pause: playback.pause, resume: playback.resume, reset: playback.reset, replay: playback.replay, seek: playback.seek, setSpeed: playback.setSpeed.bind(playback) }
  const off = disabled || duration <= 0
  return (
    <div className="border-t border-line bg-panel/90 px-4 py-3" data-testid="controls">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="play" onClick={pb.start} disabled={off} className="px-3.5" data-testid="btn-start">Старт</Button>
        <Button onClick={pb.pause} disabled={off || pb.state !== 'playing'} className="px-3" data-testid="btn-pause">Пауза</Button>
        <Button onClick={pb.resume} disabled={off || pb.state === 'playing' || pb.state === 'idle'} className="px-3" data-testid="btn-resume">Продолжить</Button>
        <Button onClick={pb.reset} disabled={off} className="px-3" data-testid="btn-reset">Сброс</Button>
        <Button onClick={pb.replay} disabled={off || pb.state !== 'finished'} className="px-3" data-testid="btn-replay">Повтор</Button>
        <div className="ml-auto"><Badge tone={pb.state === 'playing' ? 'info' : 'neutral'}>{label(PLAY_RU, pb.state)}</Badge></div>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted">Скорость
          <select value={String(pb.speed)} onChange={(e) => pb.setSpeed(Number(e.target.value))} aria-label="Скорость воспроизведения" className="h-9 rounded-md border border-line-2 bg-space-900 px-2 text-[13px] text-ink outline-none focus:border-cyan">
            {SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}
          </select>
        </label>
        <div className="relative min-w-0 flex-1">
          <input type="range" aria-label="Время симуляции" min={0} max={duration || 1} step={(duration || 1) / 1000} value={pb.t} disabled={off} onChange={(e) => pb.seek(Number(e.target.value))} className="h-6 w-full accent-cyan" />
          <div className="pointer-events-none absolute inset-x-0 top-[1px] h-6" aria-hidden>
            {duration > 0 && events.map((e, i) => (
              <span key={i} title={`${label(EVENT_RU, e.event)} · ${e.t_s.toFixed(1)} с`} className="absolute top-0 h-2.5 w-0.5 -translate-x-1/2 rounded bg-warn/90" style={{ left: `${(e.t_s / duration) * 100}%` }} />
            ))}
          </div>
        </div>
        <span className="num shrink-0 text-[13px] text-ink" data-testid="time-readout">{fmtDuration(pb.t)} <span className="text-dim">/ {fmtDuration(duration)}</span></span>
      </div>
      {events.length > 0 && <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-muted">{events.map((e, i) => <button key={i} type="button" onClick={() => pb.seek(e.t_s)} className="hover:text-cyan"><span className="text-warn">▮</span> {label(EVENT_RU, e.event)} · <span className="num">{e.t_s.toFixed(1)} с</span></button>)}</div>}
    </div>
  )
}

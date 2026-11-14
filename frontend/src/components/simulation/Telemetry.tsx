import type { SimResults } from '../../api/types'
import { fmt, fmtDuration } from '../../lib/format'
import { sampleAt } from '../../lib/series'
import { Badge, Stat } from '../ui/ui'

export function Telemetry({ results, t }: { results: SimResults; t: number }) {
  const ts = results.time_series
  const s = sampleAt(ts, t)
  const fuelOutAt = results.summary.events.find((e) => e.event === 'fuel_exhausted')?.t_s
  const cutAt = results.summary.events.find((e) => e.event === 'cutoff_speed')?.t_s
  const lit = s.thrust_n > 0
  const engine = lit ? <Badge tone="warn">ON · {Math.round((s.throttle ?? 0) * 100)} %</Badge>
    : fuelOutAt !== undefined && t >= fuelOutAt ? <Badge tone="bad">OFF · fuel exhausted</Badge>
    : cutAt !== undefined && t >= cutAt ? <Badge>OFF · cut-off</Badge> : <Badge>OFF</Badge>
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-2" data-testid="telemetry">
      <Stat label="Elapsed" value={fmtDuration(s.time_s)} />
      <Stat label="Height above surface" value={fmt(s.distance_to_surface_m, 1)} unit="m" />
      <Stat label="Speed (surface-rel.)" value={fmt(s.speed_surface_m_s, 2)} unit="m/s" />
      <Stat label="Vertical speed" value={fmt(s.vertical_speed_m_s, 2)} unit="m/s" />
      <Stat label="Horizontal speed" value={fmt(s.horizontal_speed_m_s, 2)} unit="m/s" />
      <Stat label="Acceleration |a|" value={fmt(s.acceleration_m_s2, 3)} unit="m/s²" />
      <Stat label="Thrust accel. F/m" value={fmt(s.proper_acceleration_m_s2, 3)} unit="m/s²" />
      <Stat label="Thrust" value={fmt(s.thrust_n, 0)} unit="N" />
      <Stat label="Fuel remaining" value={fmt(s.fuel_remaining_kg, 1)} unit="kg" />
      <Stat label="Mass" value={fmt(s.mass_kg, 1)} unit="kg" />
      <Stat label="Distance to target" value={fmt(s.distance_to_target_m, 1)} unit="m" />
      <Stat label="Altitude (ref. sphere)" value={fmt(s.altitude_m, 1)} unit="m" />
      <div className="col-span-full"><div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Engine</div>{engine}</div>
    </div>
  )
}

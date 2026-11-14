import type { SimResults } from '../../api/types'
import { fmt, fmtDuration } from '../../lib/format'
import { usePlaybackSnapshot } from '../../hooks/usePlayback'
import { sampleAt } from '../../lib/series'
import { Badge } from '../ui/ui'

function Row({ label, value, unit, strong }: { label: string; value: string; unit?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-0">
      <span className="text-[12px] text-muted">{label}</span>
      <span className={`num text-right ${strong ? 'text-[16px] text-ink' : 'text-[13.5px] text-ink/95'}`}>{value}{unit && <span className="ml-1 text-[11px] text-muted">{unit}</span>}</span>
    </div>
  )
}

/** Live values: everything is interpolated from the core's time series at the playback time. */
export function Telemetry({ results }: { results: SimResults }) {
  const { t } = usePlaybackSnapshot()
  const s = sampleAt(results.time_series, t)
  const fuelOutAt = results.summary.events.find((e) => e.event === 'fuel_exhausted')?.t_s
  const cutAt = results.summary.events.find((e) => e.event === 'cutoff_speed')?.t_s
  const lit = s.thrust_n > 0
  const engine = lit ? <Badge tone="warn">ВКЛ · {Math.round((s.throttle ?? 0) * 100)} %</Badge>
    : fuelOutAt !== undefined && t >= fuelOutAt ? <Badge tone="bad">ВЫКЛ · топливо выработано</Badge>
    : cutAt !== undefined && t >= cutAt ? <Badge>ВЫКЛ · отсечка</Badge> : <Badge>ВЫКЛ</Badge>
  return (
    <div data-testid="telemetry">
      <Row label="Время миссии" value={fmtDuration(s.time_s)} strong />
      <Row label="Высота над поверхностью" value={fmt(s.distance_to_surface_m, 1)} unit="м" strong />
      <Row label="Скорость (отн. поверхности)" value={fmt(s.speed_surface_m_s, 2)} unit="м/с" strong />
      <Row label="Вертикальная скорость" value={fmt(s.vertical_speed_m_s, 2)} unit="м/с" />
      <Row label="Горизонтальная скорость" value={fmt(s.horizontal_speed_m_s, 2)} unit="м/с" />
      <Row label="Ускорение |a|" value={fmt(s.acceleration_m_s2, 3)} unit="м/с²" />
      <Row label="Ускорение от тяги F/m" value={fmt(s.proper_acceleration_m_s2, 3)} unit="м/с²" />
      <Row label="Тяга" value={fmt(s.thrust_n, 0)} unit="Н" />
      <Row label="Остаток топлива" value={fmt(s.fuel_remaining_kg, 1)} unit="кг" strong />
      <Row label="Масса" value={fmt(s.mass_kg, 1)} unit="кг" />
      <Row label="Расстояние до цели" value={fmt(s.distance_to_target_m, 1)} unit="м" />
      <Row label="Высота над сферой 1737,4 км" value={fmt(s.altitude_m, 1)} unit="м" />
      <div className="flex items-center justify-between pt-2"><span className="text-[12px] text-muted">Двигатель</span>{engine}</div>
    </div>
  )
}

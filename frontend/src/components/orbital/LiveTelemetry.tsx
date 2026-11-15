import { useEffect, useState } from 'react'
import { useThrottledClock } from '../../hooks/useOrbitalClock'
import { fmtDistance, fmtSpeed, interpScalar, type OrbData } from '../../lib/orbital'
import { Panel } from '../ui/ui'

const Row = ({ k, v, unit }: { k: string; v: string; unit?: string }) => <div className="contents"><dt className="text-muted">{k}</dt><dd className="num text-right text-ink">{v}{unit ? <span className="text-dim"> {unit}</span> : null}</dd></div>

/** Live telemetry at the playback time (interpolated from core series). Units shown explicitly. */
export function LiveTelemetry({ data, moonFixed }: { data: OrbData; moonFixed: { lat: number | null; lon: number | null; alt: number } | null }) {
  const t = useThrottledClock(120)
  const [, tick] = useState(0)
  useEffect(() => { tick((x) => x + 1) }, [data])
  const g = (k: string) => interpScalar(data.tel.t_s, data.tel.series[k] ?? [], t)
  const f = (k: string, d = 1) => { const x = g(k); return x === null ? '—' : x.toLocaleString('ru-RU', { maximumFractionDigits: d }) }
  const moonDom = (g('dominant_body_is_moon') ?? 0) > 0.5
  return (
    <Panel title="Телеметрия" icon="info" className="h-full" >
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px]" data-testid="live-telemetry">
        <Row k="Высота над Землёй" v={fmtDistance(g('alt_earth_m'))} />
        <Row k="Высота над Луной" v={fmtDistance(g('alt_moon_m'))} />
        <Row k="Расстояние до Луны (центр)" v={fmtDistance(g('dist_moon_m'))} />
        <Row k="Скорость (инерц.)" v={fmtSpeed(g('speed_inertial_mps'))} />
        <Row k="Скорость отн. Луны" v={fmtSpeed(g('speed_moon_rel_mps'))} />
        <Row k="Верт. скорость (Земля)" v={fmtSpeed(g('vertical_speed_earth_mps'))} />
        <Row k="Верт. скорость (Луна)" v={fmtSpeed(g('vertical_speed_moon_mps'))} />
        <Row k={`Перицентр (${moonDom ? 'Луна' : 'Земля'})`} v={fmtDistance(g('periapsis_alt_m'))} />
        <Row k={`Апоцентр (${moonDom ? 'Луна' : 'Земля'})`} v={g('apoapsis_alt_m') === null ? 'открытая орбита' : fmtDistance(g('apoapsis_alt_m'))} />
        <Row k="Эксцентриситет" v={f('ecc', 4)} />
        <Row k="Наклонение" v={f('inclination_deg', 2)} unit="°" />
        <Row k="Масса" v={f('mass_kg', 0)} unit="кг" />
        <Row k="Топливо" v={f('fuel_kg', 0)} unit="кг" />
        <Row k="Тяга" v={f('thrust_n', 0)} unit="Н" />
        <Row k="Остаток Δv" v={f('delta_v_remaining_mps', 0)} unit="м/с" />
        <Row k="Перегрузка от тяги" v={f('g_load', 2)} unit="g" />
        <Row k="Ускорение гравитации (Земля)" v={f('grav_accel_earth_mps2', 3)} unit="м/с²" />
        <Row k="Ускорение гравитации (Луна)" v={f('grav_accel_moon_mps2', 4)} unit="м/с²" />
        {moonFixed && moonFixed.lat !== null && <Row k="Над точкой Луны" v={`${moonFixed.lat!.toFixed(3)}°, ${moonFixed.lon!.toFixed(3)}°`} />}
        <Row k="Доминирующее тело" v={moonDom ? 'Луна' : 'Земля'} />
      </dl>
    </Panel>
  )
}

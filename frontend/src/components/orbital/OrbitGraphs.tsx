import { useMemo } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useThrottledClock } from '../../hooks/useOrbitalClock'
import { GRAPH_COLORS, type OrbData } from '../../lib/orbital'
import { Panel } from '../ui/ui'

const AXIS = { stroke: '#5f6f8a', fontSize: 11 }
const TIP = { contentStyle: { background: '#060a12', border: '1px solid #243653', fontSize: 12, borderRadius: 8 }, labelStyle: { color: '#8b9bb6' } }

// graph id -> title, series: [key, label, divisor, unit]
export const GRAPHS: { id: string; title: string; unit: string; lines: { key: string; name: string; div?: number }[] }[] = [
  { id: 'altitude', title: 'Высота над Землёй и Луной', unit: 'км', lines: [{ key: 'alt_earth_m', name: 'над Землёй', div: 1e3 }, { key: 'alt_moon_m', name: 'над Луной', div: 1e3 }] },
  { id: 'speed', title: 'Скорость', unit: 'км/с', lines: [{ key: 'speed_inertial_mps', name: 'инерциальная', div: 1e3 }, { key: 'speed_moon_rel_mps', name: 'отн. Луны', div: 1e3 }] },
  { id: 'mass', title: 'Масса и топливо', unit: 'кг', lines: [{ key: 'mass_kg', name: 'масса' }, { key: 'fuel_kg', name: 'топливо' }] },
  { id: 'thrust', title: 'Тяга и дроссель', unit: 'кН / доля', lines: [{ key: 'thrust_n', name: 'тяга, кН', div: 1e3 }, { key: 'throttle', name: 'дроссель' }] },
  { id: 'energy', title: 'Удельная орбитальная энергия', unit: 'МДж/кг', lines: [{ key: 'energy_j_per_kg', name: 'энергия', div: 1e6 }] },
  { id: 'gravity', title: 'Ускорение гравитации', unit: 'м/с²', lines: [{ key: 'grav_accel_earth_mps2', name: 'Земля' }, { key: 'grav_accel_moon_mps2', name: 'Луна' }] },
  { id: 'apsides', title: 'Перицентр / апоцентр (дом. тело)', unit: 'км', lines: [{ key: 'periapsis_alt_m', name: 'перицентр', div: 1e3 }, { key: 'apoapsis_alt_m', name: 'апоцентр', div: 1e3 }] },
  { id: 'moon', title: 'Расстояние до Луны', unit: 'км', lines: [{ key: 'dist_moon_m', name: 'до центра Луны', div: 1e3 }] },
  { id: 'dv', title: 'Остаток Δv', unit: 'м/с', lines: [{ key: 'delta_v_remaining_mps', name: 'Δv' }] },
]

/** 9 graphs from the core's telemetry series. The cursor follows playback; values are never recomputed in the browser. */
export function OrbitGraphs({ data }: { data: OrbData }) {
  const t = useThrottledClock(300)
  const rows = useMemo(() => data.tel.t_s.map((tt, i) => { const r: Record<string, number | null> = { t: tt / 3600 }; for (const g of GRAPHS) for (const l of g.lines) { const v = data.tel.series[l.key]?.[i]; r[l.key] = v === null || v === undefined || !Number.isFinite(v) ? null : v / (l.div ?? 1) } return r }), [data])
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="orbit-graphs">
      {GRAPHS.map((g) => (
        <Panel key={g.id} title={`${g.title}, ${g.unit}`}>
          <div className="h-52" data-testid={`graph-${g.id}`}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#18243a" strokeDasharray="3 3" />
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} stroke={AXIS.stroke} tickFormatter={(v: number) => (v >= 48 ? (v / 24).toFixed(1) + ' сут' : v.toFixed(1) + ' ч')} />
                <YAxis tick={AXIS} stroke={AXIS.stroke} width={58} tickFormatter={(v: number) => (Math.abs(v) >= 10000 ? v.toExponential(1) : String(Math.round(v * 100) / 100))} />
                <Tooltip {...TIP} formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : String(v))} labelFormatter={(l) => `t = ${Number(l).toFixed(2)} ч`} />
                {g.lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                {g.lines.map((l, i) => <Line key={l.key} dataKey={l.key} name={l.name} stroke={GRAPH_COLORS[i % 4]} dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls={false} />)}
                <ReferenceLine x={t / 3600} stroke="#fbbf24" strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ))}
    </div>
  )
}

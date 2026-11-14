import { useMemo } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SimResults } from '../../api/types'
import { useThrottledT } from '../../hooks/usePlayback'
import { eastNorthOffset } from '../../lib/geo'
import { sampleAt, thinIndices } from '../../lib/series'
import { Panel } from '../ui/ui'

const AXIS = { stroke: '#5f6f8a', fontSize: 11 }
const TIP = { contentStyle: { background: '#060a12', border: '1px solid #243653', fontSize: 12, borderRadius: 8 }, labelStyle: { color: '#8b9bb6' } }

function TimeChart({ title, rows, lines, t, unit }: { title: string; rows: Record<string, number>[]; lines: { key: string; name: string; color: string }[]; t: number; unit: string }) {
  return (
    <Panel title={`${title}, ${unit}`}>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#18243a" strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} stroke={AXIS.stroke} tickFormatter={(v: number) => v.toFixed(0)} unit=" с" />
            <YAxis tick={AXIS} stroke={AXIS.stroke} width={56} tickFormatter={(v: number) => (Math.abs(v) >= 10000 ? v.toExponential(1) : String(Math.round(v * 100) / 100))} />
            <Tooltip {...TIP} formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : String(v))} labelFormatter={(l) => `t = ${Number(l).toFixed(1)} с`} />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {lines.map((l) => <Line key={l.key} dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={1.8} isAnimationActive={false} />)}
            <ReferenceLine x={t} stroke="#22d3ee" strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

/** All series come straight from the core's time series (thinned for drawing only). */
export function Charts({ results, t: fixedT }: { results: SimResults; t?: number }) {
  const liveT = useThrottledT(250)
  const t = fixedT ?? liveT
  const ts = results.time_series
  const rows = useMemo(() => thinIndices(ts.time_s.length, 600).map((i) => ({
    t: ts.time_s[i], h: ts.distance_to_surface_m[i], v: ts.speed_surface_m_s[i], vv: ts.vertical_speed_m_s[i], vh: ts.horizontal_speed_m_s[i],
    a: ts.acceleration_m_s2[i], ap: ts.proper_acceleration_m_s2[i], fuel: ts.fuel_remaining_kg[i], m: ts.mass_kg[i],
  })), [ts])
  const track = useMemo(() => {
    const t0 = results.trajectory.target
    return thinIndices(ts.time_s.length, 600).map((i) => {
      const o = eastNorthOffset(t0.latitude_deg, t0.longitude_deg, ts.latitude_deg[i], ts.longitude_deg[i])
      return { east: o.east, north: o.north, up: ts.altitude_m[i] }
    })
  }, [ts, results])
  const now = sampleAt(ts, t)
  const nowO = eastNorthOffset(results.trajectory.target.latitude_deg, results.trajectory.target.longitude_deg, now.latitude_deg, now.longitude_deg)
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="charts">
      <TimeChart title="Высота над поверхностью" unit="м" rows={rows} t={t} lines={[{ key: 'h', name: 'высота', color: '#22d3ee' }]} />
      <TimeChart title="Скорость" unit="м/с" rows={rows} t={t} lines={[{ key: 'v', name: 'полная', color: '#22d3ee' }, { key: 'vv', name: 'вертикальная (+вверх)', color: '#3b82f6' }, { key: 'vh', name: 'горизонтальная', color: '#eab308' }]} />
      <TimeChart title="Ускорение" unit="м/с²" rows={rows} t={t} lines={[{ key: 'a', name: '|a| полное', color: '#22d3ee' }, { key: 'ap', name: 'F/m от тяги', color: '#fb923c' }]} />
      <TimeChart title="Топливо и масса" unit="кг" rows={rows} t={t} lines={[{ key: 'fuel', name: 'топливо', color: '#22c55e' }, { key: 'm', name: 'масса', color: '#8b9bb6' }]} />
      <Panel title="Профиль траектории (восток — высота), м">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={track} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#18243a" strokeDasharray="3 3" />
              <XAxis dataKey="east" type="number" domain={['auto', 'auto']} tick={AXIS} stroke={AXIS.stroke} tickFormatter={(v: number) => v.toFixed(0)} />
              <YAxis dataKey="up" type="number" domain={['auto', 'auto']} tick={AXIS} stroke={AXIS.stroke} width={56} />
              <Tooltip {...TIP} formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v))} />
              <Line dataKey="up" stroke="#3b82f6" dot={false} strokeWidth={1.8} isAnimationActive={false} name="высота" />
              <ReferenceDot x={nowO.east} y={now.altitude_m} r={5} fill="#22d3ee" stroke="none" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="След на поверхности (восток — север), м">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={track} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#18243a" strokeDasharray="3 3" />
              <XAxis dataKey="east" type="number" domain={['auto', 'auto']} tick={AXIS} stroke={AXIS.stroke} tickFormatter={(v: number) => v.toFixed(0)} />
              <YAxis dataKey="north" type="number" domain={['auto', 'auto']} tick={AXIS} stroke={AXIS.stroke} width={56} />
              <Tooltip {...TIP} formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v))} />
              <Line dataKey="north" stroke="#eab308" dot={false} strokeWidth={1.8} isAnimationActive={false} name="север" />
              <ReferenceDot x={0} y={0} r={5} fill="#ef4444" stroke="none" label={{ value: 'цель', fill: '#ef4444', fontSize: 11, position: 'top' }} />
              <ReferenceDot x={nowO.east} y={nowO.north} r={5} fill="#22d3ee" stroke="none" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  )
}

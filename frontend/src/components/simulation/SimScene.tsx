import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import type { Geometry, SimResults, TerrainWindow } from '../../api/types'
import { eastNorthOffset } from '../../lib/geo'
import { sampleAt } from '../../lib/series'
import { LabelSprite } from '../terrain/LabelSprite'
import { RegionalTerrain3D } from '../terrain/RegionalTerrain3D'
import { TerrainCanvas } from '../terrain/TerrainCanvas'

export interface Enu { east: number; north: number; up: number }

/** Convert core lat/lon/altitude samples to local ENU (drawing only). up = altitude above reference sphere. */
export function toEnu(results: SimResults, geom: { center: { latitude_deg: number; longitude_deg: number }; reference_radius_m: number }): Enu[] {
  const ts = results.time_series
  return ts.time_s.map((_, i) => {
    const o = eastNorthOffset(geom.center.latitude_deg, geom.center.longitude_deg, ts.latitude_deg[i], ts.longitude_deg[i], geom.reference_radius_m)
    return { east: o.east, north: o.north, up: ts.altitude_m[i] }
  })
}

function Lander({ pos, size, thrusting, throttle }: { pos: [number, number, number]; size: number; thrusting: boolean; throttle: number }) {
  return (
    <group position={pos}>
      <mesh position={[0, size * 0.55, 0]}><boxGeometry args={[size, size * 0.8, size]} /><meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.5} /></mesh>
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b], i) => (
        <Line key={i} points={[[a * size * 0.3, size * 0.3, b * size * 0.3], [a * size * 0.7, 0, b * size * 0.7]]} color="#94a3b8" lineWidth={2} />
      ))}
      {thrusting && (
        <mesh position={[0, -size * (0.4 + throttle * 0.5), 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[size * 0.28, size * (0.8 + throttle), 16]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  )
}

function Trajectory({ enu, t, results, zRef, exag, extent }: { enu: Enu[]; t: number; results: SimResults; zRef: number; exag: number; extent: number }) {
  const ts = results.time_series
  const toV = (p: Enu): [number, number, number] => [p.east, (p.up - zRef) * exag, -p.north]
  const full = useMemo(() => enu.map(toV), [enu, zRef, exag])  // eslint-disable-line react-hooks/exhaustive-deps
  const now = sampleAt(ts, t)
  const k = Math.max(1, ts.time_s.findIndex((x) => x > t))
  const idx = ts.time_s.findIndex((x) => x > t) === -1 ? enu.length : k
  const done = useMemo(() => full.slice(0, idx), [full, idx])
  const p0 = full[0], pe = full[full.length - 1]
  const td = results.summary.touchdown
  const thrusting = now.thrust_n > 0
  const size = Math.max(extent * 0.012, 3)
  // current position from interpolated lat/lon/alt
  const i1 = Math.min(enu.length - 1, idx), i0 = Math.max(0, i1 - 1)
  const span = ts.time_s[i1] - ts.time_s[i0]
  const f = span > 0 ? Math.min(1, Math.max(0, (t - ts.time_s[i0]) / span)) : 0
  const lerp = (a: number, b: number) => a + (b - a) * f
  const curPos: [number, number, number] = [lerp(enu[i0].east, enu[i1].east), (lerp(enu[i0].up, enu[i1].up) - zRef) * exag, -lerp(enu[i0].north, enu[i1].north)]
  return (
    <>
      <Line points={full} color="#3b82f6" lineWidth={1} transparent opacity={0.45} dashed dashSize={size * 2} gapSize={size} />
      {done.length > 1 && <Line points={done} color="#22d3ee" lineWidth={2.5} />}
      <mesh position={p0}><sphereGeometry args={[size * 0.4, 12, 12]} /><meshBasicMaterial color="#22c55e" /></mesh>
      <LabelSprite text="start" color="#22c55e" position={[p0[0], p0[1] + size, p0[2]]} height={size * 0.9} />
      {td && <>
        <mesh position={pe}><sphereGeometry args={[size * 0.4, 12, 12]} /><meshBasicMaterial color="#eab308" /></mesh>
        <LabelSprite text="touchdown" color="#eab308" position={[pe[0], pe[1] + size, pe[2]]} height={size * 0.9} />
      </>}
      <Lander pos={curPos} size={size} thrusting={thrusting} throttle={now.throttle ?? 1} />
    </>
  )
}

/** 3-D scene: real DEM relief (if the core returned a window), trajectory, target, lander. */
export function SimScene({ results, terrain, t, exaggeration, className }: { results: SimResults; terrain: TerrainWindow | null; t: number; exaggeration: number; className?: string }) {
  const target = results.trajectory.target
  const geom: Geometry | null = terrain?.geometry ?? null
  const fallbackGeom = {
    center: { latitude_deg: target.latitude_deg, longitude_deg: target.longitude_deg }, reference_radius_m: 1_737_400,
  }
  const enu = useMemo(() => toEnu(results, geom ?? fallbackGeom), [results, geom]) // eslint-disable-line react-hooks/exhaustive-deps
  const extent = useMemo(() => {
    const spread = Math.max(...enu.map((p) => Math.max(Math.abs(p.east), Math.abs(p.north))), 50)
    const terr = geom ? Math.max(geom.cols * geom.cell_size_m.dx, geom.rows * geom.cell_size_m.dy) : 0
    return Math.max(spread * 2.2, terr, 100)
  }, [enu, geom])

  if (terrain) {
    return (
      <RegionalTerrain3D elevation={terrain.elevation_m} geometry={terrain.geometry} exaggeration={exaggeration} className={className}
        markers={[{ lat: target.latitude_deg, lon: target.longitude_deg, label: 'target', color: '#ef4444' }]}>
        {({ zRef, exaggeration: ex }) => <Trajectory enu={enu} t={t} results={results} zRef={zRef} exag={ex} extent={extent} />}
      </RegionalTerrain3D>
    )
  }
  const zRef = Math.min(...enu.map((p) => p.up), 0)
  return (
    <TerrainCanvas extent_m={extent} className={className}>
      <gridHelper args={[extent, 20, '#26344b', '#1b2638']} />
      <LabelSprite text="no terrain data — flat reference grid" color="#eab308" position={[0, 0, 0]} height={extent * 0.03} />
      <Trajectory enu={enu} t={t} results={results} zRef={zRef} exag={exaggeration} extent={extent} />
    </TerrainCanvas>
  )
}

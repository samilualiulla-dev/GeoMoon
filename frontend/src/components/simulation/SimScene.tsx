import { Line } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Geometry, Grid, SimResults, TerrainWindow } from '../../api/types'
import { naturalRgb } from '../../lib/colormap'
import { bfToEnu, enuBasisBF, eastNorthOffset } from '../../lib/geo'
import { usePlaybackSnapshot } from '../../hooks/usePlayback'
import { fmt } from '../../lib/format'
import { sampleAt } from '../../lib/series'
import { LabelSprite } from '../terrain/LabelSprite'
import { TerrainMesh } from '../terrain/TerrainMesh'
import { SceneCanvas, type CamCmd } from './SceneCanvas'

export interface SceneLayers { terrain: boolean; grid: boolean; trajectory: boolean; vectors: boolean; labels: boolean; altitude: boolean }
export const DEFAULT_LAYERS: SceneLayers = { terrain: true, grid: true, trajectory: true, vectors: true, labels: true, altitude: true }
export type TrajMode = 'full' | 'traveled'

export interface Enu { east: number; north: number; up: number }

/** Convert core lat/lon/altitude samples to local ENU (drawing only). up = altitude above the reference sphere. */
export function toEnu(results: SimResults, geom: { center: { latitude_deg: number; longitude_deg: number }; reference_radius_m: number }): Enu[] {
  const ts = results.time_series
  return ts.time_s.map((_, i) => {
    const o = eastNorthOffset(geom.center.latitude_deg, geom.center.longitude_deg, ts.latitude_deg[i], ts.longitude_deg[i], geom.reference_radius_m)
    return { east: o.east, north: o.north, up: ts.altitude_m[i] }
  })
}

function minMax(g: Grid): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const row of g.data) for (const v of row) if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v }
  return Number.isFinite(lo) ? [lo, hi === lo ? lo + 1 : hi] : [0, 1]
}

export function centerElevation(g: Grid): number | null {
  const r = g.rows >> 1, c = g.cols >> 1
  const vals = [g.data[r]?.[c], g.data[r - 1]?.[c], g.data[r]?.[c - 1], g.data[r - 1]?.[c - 1]].filter((v): v is number => v !== null && v !== undefined)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function niceStep(x: number): number { const p = 10 ** Math.floor(Math.log10(x)); const m = x / p; return (m < 2 ? 1 : m < 5 ? 2 : 5) * p }

function Arrow({ origin, dir, length, color, head }: { origin: [number, number, number]; dir: THREE.Vector3; length: number; color: string; head: number }) {
  const a = useMemo(() => new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color, 1, 1), [color])
  useEffect(() => {
    const d = dir.clone(); if (d.lengthSq() < 1e-12) { a.visible = false; return }
    a.visible = true; a.position.set(...origin); a.setDirection(d.normalize()); a.setLength(Math.max(length, 1e-3), Math.min(head, length * 0.6), head * 0.45)
  }, [a, origin, dir, length, head])
  useEffect(() => () => { a.dispose() }, [a])
  return <primitive object={a} />
}

function Lander({ pos, S, flame, throttle }: { pos: [number, number, number]; S: number; flame: boolean; throttle: number }) {
  return (
    <group position={pos}>
      <mesh position={[0, S * 0.62, 0]}><cylinderGeometry args={[S * 0.42, S * 0.5, S * 0.7, 8]} /><meshStandardMaterial color="#d9c98a" metalness={0.55} roughness={0.45} /></mesh>
      <mesh position={[0, S * 1.12, 0]}><coneGeometry args={[S * 0.42, S * 0.36, 8]} /><meshStandardMaterial color="#cfd5de" metalness={0.5} roughness={0.4} /></mesh>
      <mesh position={[0, S * 0.18, 0]}><coneGeometry args={[S * 0.22, S * 0.28, 12]} /><meshStandardMaterial color="#3b4252" metalness={0.6} roughness={0.5} /></mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4, x = Math.cos(a), z = Math.sin(a)
        return (
          <group key={i}>
            <Line points={[[x * S * 0.35, S * 0.45, z * S * 0.35], [x * S * 0.78, 0, z * S * 0.78]]} color="#9aa5b8" lineWidth={2.5} />
            <mesh position={[x * S * 0.78, S * 0.02, z * S * 0.78]}><cylinderGeometry args={[S * 0.13, S * 0.13, S * 0.04, 12]} /><meshStandardMaterial color="#9aa5b8" /></mesh>
          </group>
        )
      })}
      {flame && (
        <mesh position={[0, -S * (0.1 + throttle * 0.55), 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[S * 0.2, S * (0.5 + throttle * 1.1), 14]} />
          <meshBasicMaterial color="#ff9a3c" transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  )
}

interface Props {
  results: SimResults | null
  terrain: TerrainWindow | null
  target: { lat: number; lon: number }
  previewAltitude_m?: number
  exaggeration: number
  layers: SceneLayers
  trajMode: TrajMode
  cam: CamCmd
  fov: number
  follow: boolean
  className?: string
}

/** Landing scene: real DEM relief (natural lunar grey), lander, trajectory, markers, vectors, grid. All numbers come from the core's results. */
export function SimScene({ results, terrain, target, previewAltitude_m, exaggeration, layers, trajMode, cam, fov, follow, className }: Props) {
  const { t } = usePlaybackSnapshot()
  const geom: Geometry | null = terrain?.geometry ?? null
  const center = geom ? { latitude_deg: geom.center.latitude_deg, longitude_deg: geom.center.longitude_deg } : { latitude_deg: target.lat, longitude_deg: target.lon }
  const R = geom?.reference_radius_m ?? 1_737_400
  const enu = useMemo(() => (results ? toEnu(results, { center, reference_radius_m: R }) : []), [results, center.latitude_deg, center.longitude_deg, R]) // eslint-disable-line react-hooks/exhaustive-deps
  const basis = useMemo(() => enuBasisBF(results?.trajectory.target.latitude_deg ?? target.lat, results?.trajectory.target.longitude_deg ?? target.lon), [results, target])
  const terrExtent = geom ? Math.max(geom.cols * geom.cell_size_m.dx, geom.rows * geom.cell_size_m.dy) : 0
  const grid = terrain?.elevation_m ?? null
  const zRef = useMemo(() => (grid ? minMax(grid)[0] : enu.length ? Math.min(...enu.map((p) => p.up)) - 1 : 0), [grid, enu])
  const ex = exaggeration

  const centerZ = grid ? centerElevation(grid) : null
  const preview = !results
  const trajSpan = useMemo(() => {
    if (!enu.length) return Math.max(previewAltitude_m ?? 100, 50) * 2
    const e = enu.map((p) => p.east), n = enu.map((p) => p.north), u = enu.map((p) => p.up)
    return Math.max(Math.max(...e) - Math.min(...e), Math.max(...n) - Math.min(...n), (Math.max(...u) - Math.min(...u)) * ex, 40)
  }, [enu, previewAltitude_m, ex])
  const ref = Math.max(trajSpan, 40)
  const extent = Math.max(terrExtent, ref * 2.4, 100)
  const toV = (p: Enu): [number, number, number] => [p.east, (p.up - zRef) * ex, -p.north]

  const now = results ? sampleAt(results.time_series, t) : null
  const idx = results ? Math.max(1, results.time_series.time_s.findIndex((x) => x > t)) : 0
  const upTo = results && results.time_series.time_s.findIndex((x) => x > t) === -1 ? enu.length : idx
  const full = useMemo(() => enu.map(toV), [enu, zRef, ex]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = useMemo(() => full.slice(0, upTo), [full, upTo])

  let cur: [number, number, number] = [0, 0, 0]
  if (results && enu.length) {
    const ts = results.time_series
    const i1 = Math.min(enu.length - 1, upTo), i0 = Math.max(0, i1 - 1)
    const span = ts.time_s[i1] - ts.time_s[i0]
    const f = span > 0 ? Math.min(1, Math.max(0, (t - ts.time_s[i0]) / span)) : 0
    const L = (a: number, b: number) => a + (b - a) * f
    cur = [L(enu[i0].east, enu[i1].east), (L(enu[i0].up, enu[i1].up) - zRef) * ex, -L(enu[i0].north, enu[i1].north)]
  } else if (preview) {
    const base = centerZ !== null ? (centerZ - zRef) * ex : 0
    cur = [0, base + (previewAltitude_m ?? 0) * ex, 0]
  }
  const groundY = now ? ((now.altitude_m - now.distance_to_surface_m) - zRef) * ex : preview && centerZ !== null ? (centerZ - zRef) * ex : 0

  const maxSpeed = results ? Math.max(...results.time_series.speed_surface_m_s, 1) : 1
  const vEnu = now ? bfToEnu([now.velocity_x_m_s, now.velocity_y_m_s, now.velocity_z_m_s], basis) : null
  const vDir = vEnu ? new THREE.Vector3(vEnu.east, vEnu.up, -vEnu.north) : new THREE.Vector3()
  const tDir = now && now.thrust_n > 0 ? (() => { const b = bfToEnu([now.thrust_dir_x, now.thrust_dir_y, now.thrust_dir_z], basis); return new THREE.Vector3(b.east, b.up, -b.north) })() : new THREE.Vector3()
  const S = Math.max(ref * 0.06, 1.2)
  const focus: [number, number, number] = useMemo(() => {
    if (full.length) { const ys = full.map((p) => p[1]); return [0, (Math.min(...ys) + Math.max(...ys)) / 2, 0] }
    return [0, cur[1] / 2, 0]
  }, [full]) // eslint-disable-line react-hooks/exhaustive-deps
  const gridStep = niceStep(extent / 12)
  const gridSize = Math.ceil(extent / gridStep / 2) * gridStep * 2
  const lastTd = results?.summary.touchdown ? full[full.length - 1] : null
  const spec = useMemo(() => (grid ? { grid, extentEast_m: geom!.cols * geom!.cell_size_m.dx, extentNorth_m: geom!.rows * geom!.cell_size_m.dy } : null), [grid, geom])
  const colorOf = useMemo(() => {
    if (!grid) return () => naturalRgb(0.5)
    const [lo, hi] = minMax(grid)
    return (r: number, c: number) => naturalRgb(((grid.data[r]?.[c] ?? lo) - lo) / (hi - lo))
  }, [grid])

  return (
    <SceneCanvas className={className} cmd={cam} focus={focus} ref_m={ref} extent_m={extent} fov={fov} follow={follow} followPos={cur}>
      {layers.terrain && spec && <TerrainMesh spec={spec} zRef={zRef} exaggeration={ex} colorOf={colorOf} />}
      {layers.grid && (
        <>
          <gridHelper args={[gridSize, Math.round(gridSize / gridStep), '#2b3f5e', '#16233a']} position={[0, -0.5 * ex, 0]} />
          <axesHelper args={[gridStep * 1.5]} position={[-gridSize / 2, 0, gridSize / 2]} />
          {layers.labels && <>
            <LabelSprite text="С ↑" color="#7dd3fc" position={[0, 0, -gridSize / 2]} height={gridStep * 0.32} />
            <LabelSprite text="В →" color="#7dd3fc" position={[gridSize / 2, 0, 0]} height={gridStep * 0.32} />
            <LabelSprite text={`клетка сетки ${gridStep >= 1000 ? gridStep / 1000 + ' км' : gridStep + ' м'}`} color="#7d8ca8" position={[-gridSize / 2 + gridStep * 3, 0, gridSize / 2 + gridStep * 0.6]} height={gridStep * 0.28} />
          </>}
        </>
      )}
      {/* target (as returned by the core) */}
      <group position={[0, centerZ !== null ? (centerZ - zRef) * ex : 0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[S * 1.1, S * 1.35, 40]} /><meshBasicMaterial color="#ef4444" side={THREE.DoubleSide} /></mesh>
        {layers.labels && <LabelSprite text="цель" color="#fca5a5" position={[0, S * 1.5, 0]} height={S * 1.15} />}
      </group>
      {results && layers.trajectory && full.length > 1 && (
        <>
          {trajMode === 'full' && <Line points={full} color="#3b82f6" lineWidth={1.2} transparent opacity={0.5} dashed dashSize={S * 1.5} gapSize={S * 0.8} />}
          {done.length > 1 && <Line points={done} color="#22d3ee" lineWidth={3} />}
        </>
      )}
      {results && full.length > 0 && (
        <>
          <mesh position={full[0]}><sphereGeometry args={[S * 0.28, 14, 14]} /><meshBasicMaterial color="#22c55e" /></mesh>
          {layers.labels && <LabelSprite text="старт" color="#86efac" position={[full[0][0], full[0][1] + S * 1.1, full[0][2]]} height={S * 1.15} />}
          {lastTd && (<>
            <mesh position={lastTd}><sphereGeometry args={[S * 0.28, 14, 14]} /><meshBasicMaterial color="#eab308" /></mesh>
            {layers.labels && <LabelSprite text="касание" color="#fde047" position={[lastTd[0], lastTd[1] + S * 1.1, lastTd[2]]} height={S * 1.15} />}
          </>)}
        </>
      )}
      {layers.altitude && (results || preview) && cur[1] > groundY + S * 0.2 && (
        <>
          <Line points={[[cur[0], groundY, cur[2]], cur]} color="#a5b4fc" lineWidth={1.4} dashed dashSize={S * 0.6} gapSize={S * 0.4} />
          {layers.labels && <LabelSprite text={now ? `h = ${fmt(now.distance_to_surface_m, 1)} м` : `h = ${fmt(previewAltitude_m ?? 0, 0)} м (старт)`} color="#c7d2fe" position={[cur[0] + S * 1.2, (cur[1] + groundY) / 2, cur[2]]} height={S * 1.1} />}
        </>
      )}
      <Lander pos={cur} S={S} flame={!!now && now.thrust_n > 0} throttle={now?.throttle ?? 1} />
      {layers.vectors && results && now && (
        <>
          <Arrow origin={[cur[0], cur[1] + S * 0.6, cur[2]]} dir={vDir} length={Math.max(S * 3 * (now.speed_surface_m_s / maxSpeed), S * 0.8)} color="#38bdf8" head={S * 0.8} />
          {layers.labels && vDir.lengthSq() > 1e-9 && <LabelSprite text={`v = ${fmt(now.speed_surface_m_s, 1)} м/с`} color="#7dd3fc" position={[cur[0] - S * 3.2, cur[1] + S * 2.6, cur[2]]} height={S * 1.05} />}
          {tDir.lengthSq() > 0.5 && <Arrow origin={[cur[0], cur[1] + S * 0.6, cur[2]]} dir={tDir} length={S * 2.4 * Math.max(now.throttle ?? 1, 0.3)} color="#fb923c" head={S * 0.7} />}
          {layers.labels && tDir.lengthSq() > 0.5 && <LabelSprite text={`тяга ${fmt(now.thrust_n, 0)} Н`} color="#fdba74" position={[cur[0] + S * 3.2, cur[1] + S * 2.6, cur[2]]} height={S * 1.05} />}
        </>
      )}
      {preview && layers.labels && <LabelSprite text="предпросмотр сцены: запустите симуляцию" color="#8b9bb6" position={[0, (cur[1] + groundY) / 2 + S * 3, 0]} height={S * 1.15} />}
    </SceneCanvas>
  )
}


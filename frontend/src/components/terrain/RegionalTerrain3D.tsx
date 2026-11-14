import { Line } from '@react-three/drei'
import { useMemo, type ReactNode } from 'react'
import type { AnalysisResult, Geometry, Grid } from '../../api/types'
import { LAYER_STYLES, colorFor, layerRange } from '../../lib/colormap'
import { eastNorthOffset } from '../../lib/geo'
import { LabelSprite } from './LabelSprite'
import { TerrainCanvas } from './TerrainCanvas'
import { TerrainMesh, type MeshSpec } from './TerrainMesh'

export interface Marker3D { lat: number; lon: number; label: string; color: string; elevation_m?: number }
export interface SceneCtx { zRef: number; exaggeration: number; center: { lat: number; lon: number } }

function minOf(g: Grid): number {
  let m = Infinity
  for (const row of g.data) for (const v of row) if (v !== null && v < m) m = v
  return Number.isFinite(m) ? m : 0
}

/** Real-DEM relief mesh (optionally coloured by an analysis layer) with markers and scene children (e.g. trajectory). */
export function RegionalTerrain3D({ elevation, geometry, analysis, layerKey = 'elevation', exaggeration = 1, markers = [], wireframe = false, className = 'h-[480px]', children }: {
  elevation: Grid; geometry: Geometry; analysis?: AnalysisResult | null; layerKey?: string; exaggeration?: number
  markers?: Marker3D[]; wireframe?: boolean; className?: string; children?: (ctx: SceneCtx) => ReactNode
}) {
  const grid = analysis?.layers.elevation ?? elevation
  const ex = geometry.cols * geometry.cell_size_m.dx, ey = geometry.rows * geometry.cell_size_m.dy
  const spec: MeshSpec = useMemo(() => ({ grid, extentEast_m: ex, extentNorth_m: ey }), [grid, ex, ey])
  const zRef = useMemo(() => minOf(grid), [grid])
  const center = { lat: geometry.center.latitude_deg, lon: geometry.center.longitude_deg }

  const colorOf = useMemo(() => {
    const style = LAYER_STYLES.find((s) => s.key === layerKey) ?? LAYER_STYLES[0]
    const L = layerKey === 'elevation' || !analysis?.layers[layerKey] ? { ...grid, min: minMax(grid)[0], max: minMax(grid)[1] } : analysis.layers[layerKey]
    const [lo, hi] = layerRange(style, L.min, L.max)
    return (r: number, c: number) => colorFor(style, L.data[r]?.[c] ?? null, lo, hi)
  }, [layerKey, analysis, grid])

  const pts = markers.map((m) => ({ ...m, ...eastNorthOffset(center.lat, center.lon, m.lat, m.lon, geometry.reference_radius_m) }))
  const extent = Math.max(ex, ey)
  return (
    <TerrainCanvas extent_m={extent} className={className}>
      <TerrainMesh spec={spec} zRef={zRef} exaggeration={exaggeration} colorOf={colorOf} wireframe={wireframe} />
      <gridHelper args={[extent, 10, '#26344b', '#1b2638']} position={[0, -1, 0]} />
      {pts.map((m, i) => {
        const y = ((m.elevation_m ?? zRef) - zRef) * exaggeration
        return (
          <group key={i} position={[m.east, y, -m.north]}>
            <Line points={[[0, 0, 0], [0, Math.max(extent * 0.06, 5), 0]]} color={m.color} lineWidth={1.5} />
            <mesh position={[0, Math.max(extent * 0.06, 5), 0]}><sphereGeometry args={[Math.max(extent * 0.008, 0.8), 12, 12]} /><meshBasicMaterial color={m.color} /></mesh>
            <LabelSprite text={m.label} color={m.color} position={[0, Math.max(extent * 0.075, 6), 0]} height={Math.max(extent * 0.022, 2)} />
          </group>
        )
      })}
      {children?.({ zRef, exaggeration, center })}
    </TerrainCanvas>
  )
}

function minMax(g: Grid): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const row of g.data) for (const v of row) if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v }
  return Number.isFinite(lo) ? [lo, hi === lo ? lo + 1 : hi] : [0, 1]
}

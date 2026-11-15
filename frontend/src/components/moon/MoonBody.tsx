import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { GlobeData, TerrainWindow } from '../../api/types'
import { naturalRgb, srgbToLinear } from '../../lib/colormap'
import { latLonFromOffset, latLonToThree } from '../../lib/geo'
import { buildGlobeGeometry } from '../../lib/globeMesh'

/** Displaced sphere built from the core's global elevation grid (real DEM or flagged-synthetic). Unit radius; scale it via `radius`.
 *  Without a global DEM a plain reference sphere is drawn - relief is NEVER invented. */
export function MoonSurface({ globe, exaggeration, radius }: { globe: GlobeData | null; exaggeration: number; radius: number }) {
  const geo = useMemo(() => {
    if (!globe) return null
    const d = buildGlobeGeometry(globe, exaggeration, 'natural')
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3))
    g.setIndex(new THREE.BufferAttribute(d.indices, 1))
    g.computeVertexNormals(); g.computeBoundingSphere()
    return g
  }, [globe, exaggeration])
  useEffect(() => () => geo?.dispose(), [geo])
  return (
    <mesh scale={radius} name="moon-surface">
      {geo ? <primitive key="relief-geo" object={geo} attach="geometry" /> : <sphereGeometry key="plain-geo" args={[1, 96, 64]} />}
      {geo ? <meshStandardMaterial key="relief-mat" vertexColors roughness={0.95} metalness={0} /> : <meshStandardMaterial key="plain-mat" color="#8f8b84" roughness={1} metalness={0} />}
    </mesh>
  )
}

/** High-resolution terrain window curved onto the sphere (LOD near the surface). Vertex = (R + k*h) * unit(lat, lon). */
export function SpherePatch({ terrain, exaggeration, radius, maxGrid = 160 }: { terrain: TerrainWindow; exaggeration: number; radius: number; maxGrid?: number }) {
  const geo = useMemo(() => {
    const g = terrain.geometry, grid = terrain.elevation_m
    const sr = Math.max(1, Math.ceil(g.rows / maxGrid)), sc = Math.max(1, Math.ceil(g.cols / maxGrid))
    const rows = Math.ceil(g.rows / sr), cols = Math.ceil(g.cols / sc)
    const R = g.reference_radius_m
    let lo = Infinity, hi = -Infinity
    for (const row of grid.data) for (const v of row) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1 }
    if (hi === lo) hi = lo + 1
    const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3), valid = new Uint8Array(rows * cols)
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const r = Math.min(i * sr, g.rows - 1), c = Math.min(j * sc, g.cols - 1)
      const z = grid.data[r][c]
      const east = (c + 0.5 - g.cols / 2) * g.cell_size_m.dx
      const north = ((g.row0_is_north ? g.rows / 2 - r - 0.5 : r + 0.5 - g.rows / 2)) * g.cell_size_m.dy
      const ll = latLonFromOffset(g.center.latitude_deg, g.center.longitude_deg, east, north, R)
      const p = latLonToThree(ll.lat, ll.lon, 1 + (z === null ? 0 : (exaggeration * z) / R))
      const o = (i * cols + j) * 3
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z
      const rgb = naturalRgb(z === null ? 0.5 : (z - lo) / (hi - lo))
      col[o] = srgbToLinear(rgb[0] / 255); col[o + 1] = srgbToLinear(rgb[1] / 255); col[o + 2] = srgbToLinear(rgb[2] / 255)
      valid[i * cols + j] = z === null ? 0 : 1
    }
    const idx: number[] = []
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1
      if (!(valid[a] && valid[b] && valid[c] && valid[d])) continue   // no data -> hole, never interpolated
      idx.push(a, c, b, b, c, d)
    }
    const bg = new THREE.BufferGeometry()
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setAttribute('color', new THREE.BufferAttribute(col, 3))
    bg.setIndex(idx); bg.computeVertexNormals(); bg.computeBoundingSphere()
    return bg
  }, [terrain, exaggeration, maxGrid])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo} scale={radius} name="moon-patch" renderOrder={2}>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
    </mesh>
  )
}

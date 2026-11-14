import { useMemo } from 'react'
import * as THREE from 'three'
import type { Grid } from '../../api/types'
import { NODATA_RGB, type RGB } from '../../lib/colormap'

export interface MeshSpec {
  /** elevation grid, row 0 = north (downsampled grid returned by the core) */
  grid: Grid
  /** physical extent covered by the grid [m] */
  extentEast_m: number
  extentNorth_m: number
}

/**
 * Displaced terrain mesh in a local East-North-Up frame, scene units = metres:
 *   three.x = east, three.y = up (elevation - zRef) * exaggeration, three.z = -north.
 * Vertices with no data are NOT interpolated: triangles touching them are omitted (visible holes).
 */
export function TerrainMesh({ spec, zRef, exaggeration, colorOf, wireframe = false, opacity = 1 }: {
  spec: MeshSpec; zRef: number; exaggeration: number; colorOf: (r: number, c: number) => RGB; wireframe?: boolean; opacity?: number
}) {
  const geometry = useMemo(() => {
    const { grid, extentEast_m: ex, extentNorth_m: ey } = spec
    const { rows, cols, data } = grid
    const pos = new Float32Array(rows * cols * 3)
    const col = new Float32Array(rows * cols * 3)
    const valid = new Uint8Array(rows * cols)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const z = data[r][c]
        const x = -ex / 2 + ((c + 0.5) / cols) * ex
        const n = ey / 2 - ((r + 0.5) / rows) * ey
        const ok = z !== null && Number.isFinite(z)
        valid[i] = ok ? 1 : 0
        pos[i * 3] = x; pos[i * 3 + 1] = ok ? ((z as number) - zRef) * exaggeration : 0; pos[i * 3 + 2] = -n
        const rgb = ok ? colorOf(r, c) : NODATA_RGB
        col[i * 3] = rgb[0] / 255; col[i * 3 + 1] = rgb[1] / 255; col[i * 3 + 2] = rgb[2] / 255
      }
    }
    const idx: number[] = []
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1
        if (valid[a] && valid[b] && valid[d] && valid[e]) idx.push(a, d, b, b, d, e)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [spec, zRef, exaggeration, colorOf])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.95} metalness={0} wireframe={wireframe} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

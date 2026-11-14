import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { GlobeData } from '../api/types'
import { srgbToLinear } from './colormap'
import { buildGlobeGeometry } from './globeMesh'

const mk = (data: (number | null)[][]): GlobeData => ({
  rows: data.length, cols: data[0].length, lat_north_deg: 90, lat_south_deg: -90, lon_west_deg: 0, lon_east_deg: 360, reference_radius_m: 1_737_400,
  elevation_m: { rows: data.length, cols: data[0].length, data },
  statistics: { min_m: 0, max_m: 0, mean_m: 0, range_m: 0, valid_fraction: 1 },
  provenance: { dataset_id: 'x', name: 'x', provider: 'x', product: 'x', version: null, citation: null, url: null, resolution_m_per_px: null, synthetic: true, data_notice: '' },
})

describe('globe mesh', () => {
  it('displaces vertices by exaggerated elevation relative to the reference sphere', () => {
    const g = mk([[0, 0, 0, 0], [1737.4, 0, 0, 0], [0, 0, 0, 0]])           // +1737.4 m = 0.001 R
    const a = buildGlobeGeometry(g, 1), b = buildGlobeGeometry(g, 10)
    const nc = 5
    const rad = (m: { positions: Float32Array }, i: number, j: number) => Math.hypot(m.positions[(i * nc + j) * 3], m.positions[(i * nc + j) * 3 + 1], m.positions[(i * nc + j) * 3 + 2])
    expect(rad(a, 2, 0)).toBeCloseTo(1.001, 5); expect(rad(b, 2, 0)).toBeCloseTo(1.01, 5)
    expect(rad(a, 2, 1)).toBeCloseTo(1, 6)
  })
  it('leaves no-data cells on the reference sphere with the no-data colour', () => {
    const m = buildGlobeGeometry(mk([[null, 5], [5, 5]]), 10)
    const o = (1 * 3 + 0) * 3                                               // row 1 (first data row), col 0
    expect(Math.hypot(m.positions[o], m.positions[o + 1], m.positions[o + 2])).toBeCloseTo(1, 6)
    expect(m.colors[o]).toBeCloseTo(srgbToLinear(38 / 255), 4)
  })
  it('closes the longitude seam and builds poles', () => {
    const m = buildGlobeGeometry(mk([[1, 2, 3], [1, 2, 3]]), 1)
    const nc = 4
    // wrap column equals column 0 position
    for (let k = 0; k < 3; k++) expect(m.positions[(1 * nc + 3) * 3 + k]).toBeCloseTo(m.positions[(1 * nc + 0) * 3 + k], 6)
    expect(m.positions[(0 * nc) * 3 + 1]).toBeGreaterThan(0.99)             // north pole row is +y in three.js
    expect(m.indices.length).toBe((4 - 1) * (4 - 1) * 6)
    expect(m.elevRange).toEqual([1, 3])
  })
  it('triangles face outward (normal . position > 0) so the lit side is visible', () => {
    const m = buildGlobeGeometry(mk([[1, 2, 3, 4], [4, 3, 2, 1], [1, 1, 1, 1]]), 1)
    let bad = 0, n = 0
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]])
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const len = Math.hypot(nrm[0], nrm[1], nrm[2]); if (len < 1e-12) continue   // degenerate pole triangles
      const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
      n++; if (nrm[0] * cen[0] + nrm[1] * cen[1] + nrm[2] * cen[2] <= 0) bad++
    }
    expect(n).toBeGreaterThan(10); expect(bad).toBe(0)
  })
  it('three.js vertex normals are finite and point outward', () => {
    const data = Array.from({ length: 12 }, (_, r) => Array.from({ length: 24 }, (_, c) => 100 * Math.sin(r) * Math.cos(c)))
    const m = buildGlobeGeometry(mk(data), 10)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(m.indices, 1)); g.computeVertexNormals()
    const n = g.getAttribute('normal'), p = g.getAttribute('position')
    let nan = 0, inward = 0
    for (let i = 0; i < n.count; i++) {
      const d = n.getX(i) * p.getX(i) + n.getY(i) * p.getY(i) + n.getZ(i) * p.getZ(i)
      if (!Number.isFinite(d) || Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 0.5) nan++
      else if (d <= 0) inward++
    }
    expect({ nan, inward }).toEqual({ nan: 0, inward: 0 })
  })
  it('maps lon 0 / lat 0 to +x', () => {
    const m = buildGlobeGeometry({ ...mk([[0, 0], [0, 0]]), lon_west_deg: -90, lon_east_deg: 90, lat_north_deg: 45, lat_south_deg: -45 }, 1)
    // row index 1 is lat +22.5, row 2 is -22.5; lon samples at -45 and +45 -> x>0, z (three) = -y sign
    const o = (1 * 3 + 1) * 3
    expect(m.positions[o]).toBeGreaterThan(0.5); expect(m.positions[o + 2]).toBeLessThan(0)
  })
})

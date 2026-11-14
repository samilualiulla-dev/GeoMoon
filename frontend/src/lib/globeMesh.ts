// Builds a displaced-sphere mesh from a global elevation grid returned by the core (GET /lunar/globe).
// Radius at each vertex = 1 + exaggeration * elevation / R_ref  (unit sphere = reference sphere). No smoothing of gaps:
// cells without data keep radius 1 and the no-data colour.
import type { GlobeData } from '../api/types'
import { NODATA_RGB, RAMPS, sample, srgbToLinear } from './colormap'
import { latLonToUnit } from './geo'

export interface GlobeGeometryData {
  positions: Float32Array
  colors: Float32Array
  indices: Uint32Array
  elevRange: [number, number]
}

export function globeElevationRange(g: GlobeData): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const row of g.elevation_m.data) for (const v of row) if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v }
  return Number.isFinite(lo) ? [lo, hi === lo ? lo + 1 : hi] : [0, 1]
}

export function buildGlobeGeometry(g: GlobeData, exaggeration: number): GlobeGeometryData {
  const { rows, cols, data } = g.elevation_m
  const R = g.reference_radius_m
  const [lo, hi] = globeElevationRange(g)
  const nr = rows + 2, nc = cols + 1            // + two pole rows, + one wrap column
  const positions = new Float32Array(nr * nc * 3)
  const colors = new Float32Array(nr * nc * 3)
  const latSpan = g.lat_north_deg - g.lat_south_deg, lonSpan = g.lon_east_deg - g.lon_west_deg

  const rowMean = (r: number): number | null => {
    let s = 0, n = 0
    for (const v of data[r]) if (v !== null) { s += v; n++ }
    return n ? s / n : null
  }
  const poleN = rowMean(0), poleS = rowMean(rows - 1)

  for (let i = 0; i < nr; i++) {
    const lat = i === 0 ? g.lat_north_deg : i === nr - 1 ? g.lat_south_deg : g.lat_north_deg - ((i - 1 + 0.5) / rows) * latSpan
    for (let j = 0; j < nc; j++) {
      const lon = g.lon_west_deg + (((j % cols) + 0.5) / cols) * lonSpan
      const z = i === 0 ? poleN : i === nr - 1 ? poleS : data[i - 1][j % cols]
      const [x, y, zz] = latLonToUnit(lat, lon)
      const rad = 1 + (z === null ? 0 : (exaggeration * z) / R)
      const o = (i * nc + j) * 3
      // backend (x, y, z) -> three (x, z, -y)
      positions[o] = x * rad; positions[o + 1] = zz * rad; positions[o + 2] = -y * rad
      const c = z === null ? NODATA_RGB : sample(RAMPS.viridis, (z - lo) / (hi - lo))
      colors[o] = srgbToLinear(c[0] / 255); colors[o + 1] = srgbToLinear(c[1] / 255); colors[o + 2] = srgbToLinear(c[2] / 255)
    }
  }
  const indices = new Uint32Array((nr - 1) * (nc - 1) * 6)
  let k = 0
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
    const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1
    indices[k++] = a; indices[k++] = c; indices[k++] = b
    indices[k++] = b; indices[k++] = c; indices[k++] = d
  }
  return { positions, colors, indices, elevRange: [lo, hi] }
}

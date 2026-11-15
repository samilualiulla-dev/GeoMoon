// Pure helpers for the orbital UI (drawing / unit conversion / interpolation). No physics is computed here:
// every position, velocity and telemetry value comes from the core; the UI only interpolates between its samples.
import * as THREE from 'three'
import type { OrbEphemerides, OrbTelemetry, OrbTrajectory, V3 } from '../api/orbital'

export const R_EARTH_M = 6_378_137
export const R_MOON_M = 1_737_400
export const MOON_SOI_M = 66.1e6
/** Scene unit for the orbital 3-D view: 1 unit = 1000 km. */
export const KM_UNIT = 1e6

/** ECI (x,y,z; z = celestial north) -> three.js (x, z, -y), a proper rotation. */
export const eciToThree = (v: ArrayLike<number>, scale = 1 / KM_UNIT): V3 => [v[0] * scale, v[2] * scale, -v[1] * scale]

/** Index i and fraction f of time t inside a sorted time array. */
export function bracket(ts: ArrayLike<number>, t: number): { i: number; f: number } {
  const n = ts.length
  if (n < 2) return { i: 0, f: 0 }
  if (t <= ts[0]) return { i: 0, f: 0 }
  if (t >= ts[n - 1]) return { i: n - 2, f: 1 }
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m }
  return { i: lo, f: (t - ts[lo]) / (ts[hi] - ts[lo]) }
}

/** Catmull-Rom interpolation of a 3-vector series (drawing only). */
export function interpV3(ts: ArrayLike<number>, vs: ArrayLike<ArrayLike<number>>, t: number): V3 {
  const n = ts.length
  if (n === 0) return [0, 0, 0]
  if (n === 1) return [vs[0][0], vs[0][1], vs[0][2]]
  const { i, f } = bracket(ts, t)
  const p0 = vs[Math.max(i - 1, 0)], p1 = vs[i], p2 = vs[i + 1], p3 = vs[Math.min(i + 2, n - 1)]
  const f2 = f * f, f3 = f2 * f
  const out: V3 = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3)
  }
  return out
}

export function interpScalar(ts: ArrayLike<number>, vs: ArrayLike<number | null>, t: number): number | null {
  if (!ts.length) return null
  const { i, f } = bracket(ts, t)
  const a = vs[i], b = vs[Math.min(i + 1, vs.length - 1)]
  if (a === null || a === undefined || b === null || b === undefined) return a ?? b ?? null
  return a + (b - a) * f
}

export function interpMatrix(ts: ArrayLike<number>, ms: number[][][], t: number): number[][] {
  const { i, f } = bracket(ts, t)
  const a = ms[i], b = ms[Math.min(i + 1, ms.length - 1)]
  const out = a.map((row, r) => row.map((x, c) => x + (b[r][c] - x) * f))
  // re-orthonormalise (Gram-Schmidt) so interpolated axes stay a proper rotation
  const x = new THREE.Vector3(...out[0]).normalize()
  const z = new THREE.Vector3(...out[2]); z.sub(x.clone().multiplyScalar(z.dot(x))).normalize()
  const y = new THREE.Vector3().crossVectors(z, x)
  return [x.toArray(), y.toArray(), z.toArray()]
}

/** Quaternion that rotates a Moon-fixed mesh (modelled in the three.js body-fixed frame) into the ECI->three scene frame.
 *  `axes` rows = Moon-fixed x,y,z expressed in ECI (inertial -> Moon-fixed). */
export function moonQuaternion(axes: number[][]): THREE.Quaternion {
  const [x, y, z] = axes
  // body->eci columns are the axes; then eci->three: (x,y,z) -> (x, z, -y).  Mesh vertices are in three-body coords (bx, bz, -by).
  const P = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)   // eci->three
  const A = new THREE.Matrix4().set(x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1) // body->eci
  const M = P.clone().multiply(A).multiply(P.clone().invert())
  return new THREE.Quaternion().setFromRotationMatrix(M)
}

export function earthQuaternion(eraRad: number): THREE.Quaternion {
  // rotation about ECI z == three y axis
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), eraRad)
}

export const norm3 = (v: ArrayLike<number>) => Math.hypot(v[0], v[1], v[2])
export const sub3 = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

export function fmtDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—'
  const a = Math.abs(m)
  if (a >= 1e9) return `${(m / 1e9).toFixed(3)} Гм`
  if (a >= 1e6) return `${(m / 1e3).toFixed(0)} км`
  if (a >= 1e4) return `${(m / 1e3).toFixed(1)} км`
  return `${m.toFixed(0)} м`
}
export function fmtSpeed(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(3)} км/с` : `${v.toFixed(1)} м/с`
}
export function fmtTime(s: number): string {
  const a = Math.abs(s), sign = s < 0 ? '-' : ''
  const d = Math.floor(a / 86400), h = Math.floor((a % 86400) / 3600), m = Math.floor((a % 3600) / 60), sec = Math.floor(a % 60)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${sign}${d > 0 ? d + ' сут ' : ''}${p(h)}:${p(m)}:${p(sec)}`
}

export interface OrbData { traj: OrbTrajectory; tel: OrbTelemetry; eph: OrbEphemerides }

/** Pick the Moon position for the trajectory sample time (exact core samples are stored alongside). */
export function moonAt(d: OrbData, t: number): V3 { return interpV3(d.traj.t_s, d.traj.moon_r_m, t) }

/** 2-D map projection: ECI x,y plane (top view along celestial north) or the orbit plane of the vehicle; origin = chosen body. */
export type MapCenter = 'earth' | 'moon' | 'vehicle'
export type MapPlane = 'equator' | 'orbit'
export function planeBasis(r: V3, v: V3): { u: V3; w: V3 } {
  // orbit plane: u along r, w = (h x r) normalised
  const h = new THREE.Vector3(...r).cross(new THREE.Vector3(...v))
  if (h.length() < 1e-6) return { u: [1, 0, 0], w: [0, 1, 0] }
  const u = new THREE.Vector3(...r).normalize()
  const w = h.clone().cross(u).normalize()
  return { u: u.toArray() as V3, w: w.toArray() as V3 }
}

export const GRAPH_COLORS = ['#22d3ee', '#fb923c', '#22c55e', '#a78bfa']

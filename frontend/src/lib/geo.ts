// Geometry helpers for DRAWING only (no physics). Backend frame: +Z north, +X -> (0N,0E), +Y -> (0N,90E).
// Three.js is Y-up, so we map backend (x,y,z) -> three (x, z, -y)  (a proper rotation, handedness preserved).
import * as THREE from 'three'

export const MOON_RADIUS_M = 1_737_400
const D2R = Math.PI / 180

export function wrapLon(lon: number): number {
  if (lon >= -180 && lon < 180) return lon // already canonical: avoid float noise from the modulo
  return ((((lon + 180) % 360) + 360) % 360) - 180 }

/** Unit vector in backend frame. */
export function latLonToUnit(latDeg: number, lonDeg: number): [number, number, number] {
  const la = latDeg * D2R, lo = lonDeg * D2R
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
}

export function backendToThree(v: [number, number, number] | number[]): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[2], -v[1])
}

export function threeToBackend(v: THREE.Vector3): [number, number, number] { return [v.x, -v.z, v.y] }

export function latLonToThree(latDeg: number, lonDeg: number, radius = 1): THREE.Vector3 {
  return backendToThree(latLonToUnit(latDeg, lonDeg)).multiplyScalar(radius)
}

export function threeToLatLon(p: THREE.Vector3): { lat: number; lon: number } {
  const [x, y, z] = threeToBackend(p.clone().normalize())
  return { lat: Math.asin(Math.max(-1, Math.min(1, z))) / D2R, lon: Math.atan2(y, x) / D2R }
}

/** Local East/North offsets [m] of (lat, lon) relative to (lat0, lon0) on a sphere (azimuthal projection). */
export function eastNorthOffset(lat0: number, lon0: number, lat: number, lon: number, R = MOON_RADIUS_M): { east: number; north: number } {
  const p0 = latLonToUnit(lat0, lon0), p = latLonToUnit(lat, lon)
  const la0 = lat0 * D2R, lo0 = lon0 * D2R
  const e = [-Math.sin(lo0), Math.cos(lo0), 0]
  const n = [-Math.sin(la0) * Math.cos(lo0), -Math.sin(la0) * Math.sin(lo0), Math.cos(la0)]
  const d = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]]
  return { east: R * (d[0] * e[0] + d[1] * e[1] + d[2] * e[2]), north: R * (d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) }
}

/** Inverse of the small-area approximation used for hover read-outs: ENU offset -> lat/lon. */
export function latLonFromOffset(lat0: number, lon0: number, east: number, north: number, R = MOON_RADIUS_M): { lat: number; lon: number } {
  const lat = lat0 + (north / R) / D2R
  const lon = lon0 + (east / (R * Math.max(Math.cos(lat0 * D2R), 1e-6))) / D2R
  return { lat, lon: wrapLon(lon) }
}

/** Velocity direction unit vector in local ENU for azimuth (clockwise from north) and flight-path angle. */
export function velocityVectorEnu(azimuthDeg: number, fpaDeg: number, speed = 1): { e: number; n: number; u: number } {
  const az = azimuthDeg * D2R, g = fpaDeg * D2R
  return { e: speed * Math.cos(g) * Math.sin(az), n: speed * Math.cos(g) * Math.cos(az), u: speed * Math.sin(g) }
}

export function formatLat(lat: number): string { return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}` }
export function formatLon(lon: number): string { const w = wrapLon(lon); return `${Math.abs(w).toFixed(4)}° ${w >= 0 ? 'E' : 'W'}` }

/** Is (lat, lon) inside a dataset's reported coverage box? (advisory only — the core is authoritative) */
export function inCoverageBox(lat: number, lon: number, cov: { lat_range_deg: [number, number] | null; lon_range_deg: [number, number] | null }): boolean {
  if (!cov.lat_range_deg || !cov.lon_range_deg) return false
  const [a, b] = cov.lat_range_deg
  const [c, d] = cov.lon_range_deg
  const w = wrapLon(lon)
  const lonOk = (w >= c && w <= d) || (w + 360 >= c && w + 360 <= d)
  return lat >= a && lat <= b && lonOk
}

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

/** Azimuthal-equidistant projection about (lat0, lon0): local East/North offsets [m] of (lat, lon). Exact on a sphere, valid at the poles.
 *  Same maths as the core's local metric grid (backend/app/lunar_data/engine.py), so drawn positions agree with the analysis grid. */
export function eastNorthOffset(lat0: number, lon0: number, lat: number, lon: number, R = MOON_RADIUS_M): { east: number; north: number } {
  const la0 = lat0 * D2R, la = lat * D2R, dlo = (lon - lon0) * D2R
  const cosC = Math.sin(la0) * Math.sin(la) + Math.cos(la0) * Math.cos(la) * Math.cos(dlo)
  const c = Math.acos(Math.max(-1, Math.min(1, cosC)))
  const y = Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(dlo)
  const x = Math.cos(la) * Math.sin(dlo)
  const az = Math.atan2(x, y)
  return { east: R * c * Math.sin(az), north: R * c * Math.cos(az) }
}

/** Inverse of {@link eastNorthOffset}: local East/North offsets [m] -> lat/lon (longitude wrapped to [-180, 180)). */
export function latLonFromOffset(lat0: number, lon0: number, east: number, north: number, R = MOON_RADIUS_M): { lat: number; lon: number } {
  const la0 = lat0 * D2R, lo0 = lon0 * D2R
  const rho = Math.hypot(east, north) / R, az = Math.atan2(east, north)
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(la0) * Math.cos(rho) + Math.cos(la0) * Math.sin(rho) * Math.cos(az))))
  const lon = Math.abs(Math.cos(la0)) < 1e-9
    ? lo0 + Math.atan2(east, la0 < 0 ? north : -north)       // centre on a pole: azimuth is measured from lon0
    : lo0 + Math.atan2(Math.sin(az) * Math.sin(rho) * Math.cos(la0), Math.cos(rho) - Math.sin(la0) * Math.sin(lat))
  return { lat: lat / D2R, lon: wrapLon(lon / D2R) }
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

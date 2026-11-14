import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { eastNorthOffset, inCoverageBox, latLonFromOffset, latLonToThree, latLonToUnit, threeToLatLon, velocityVectorEnu, wrapLon, MOON_RADIUS_M } from './geo'

describe('geo', () => {
  it('matches the backend axis convention', () => {
    expect(latLonToUnit(0, 0)).toEqual([1, 0, 0])
    const y = latLonToUnit(0, 90); expect(y[0]).toBeCloseTo(0); expect(y[1]).toBeCloseTo(1)
    expect(latLonToUnit(90, 0)[2]).toBeCloseTo(1)
  })
  it('round-trips lat/lon through three.js space', () => {
    for (const [la, lo] of [[0, 0], [45, 90], [-30, -120], [89, 10], [12.34, 179]]) {
      const p = latLonToThree(la, lo, 3)
      const r = threeToLatLon(p)
      expect(r.lat).toBeCloseTo(la, 6); expect(r.lon).toBeCloseTo(lo, 6)
      expect(p.length()).toBeCloseTo(3)
    }
  })
  it('north pole is +y in three.js', () => { expect(latLonToThree(90, 0).y).toBeCloseTo(1) })
  it('maps are right-handed rotations (east = +x tangent at lon 0 is -z)', () => {
    const p = latLonToThree(0, 0), q = latLonToThree(0, 1)
    expect(q.clone().sub(p).dot(new THREE.Vector3(0, 0, -1))).toBeGreaterThan(0)
  })
  it('does not perturb already-canonical longitudes', () => { expect(wrapLon(23.05)).toBe(23.05); expect(wrapLon(-179.999)).toBe(-179.999) })
  it('wraps longitude', () => { expect(wrapLon(190)).toBe(-170); expect(wrapLon(-180)).toBe(-180); expect(wrapLon(360)).toBeCloseTo(0) })
  it('east/north offsets are metric and invert approximately', () => {
    const o = eastNorthOffset(10, 20, 10, 20 + 0.001)
    expect(o.east).toBeCloseTo(MOON_RADIUS_M * Math.cos(10 * Math.PI / 180) * 0.001 * Math.PI / 180, 1)
    expect(Math.abs(o.north)).toBeLessThan(0.05)
    const back = latLonFromOffset(10, 20, 500, -300)
    const o2 = eastNorthOffset(10, 20, back.lat, back.lon)
    expect(o2.east).toBeCloseTo(500, 0); expect(o2.north).toBeCloseTo(-300, 0)
  })
  it('azimuthal offsets round-trip everywhere, including the poles', () => {
    for (const [la0, lo0] of [[0, 0], [45, 100], [-89.9, 30], [-90, 0], [-90, 45], [90, 0], [89.99, -170], [-60, 179.9]]) {
      for (const [e, n] of [[1000, -700], [-2500, 1500], [40000, -25000], [0, 0]]) {
        const ll = latLonFromOffset(la0, lo0, e, n)
        const back = eastNorthOffset(la0, lo0, ll.lat, ll.lon)
        expect(back.east).toBeCloseTo(e, 3); expect(back.north).toBeCloseTo(n, 3)
      }
    }
  })
  it('matches the core: 5 km due north is exactly 5000/R rad of latitude', () => {
    const ll = latLonFromOffset(10, 20, 0, 5000)
    expect(ll.lat).toBeCloseTo(10 + (5000 / MOON_RADIUS_M) * 180 / Math.PI, 9); expect(ll.lon).toBeCloseTo(20, 9)
  })
  it('keeps metres true next to the south pole (no 1/cos(lat) blow-up)', () => {
    const ll = latLonFromOffset(-89.99, 30, 3000, 0)
    const d = eastNorthOffset(-89.99, 30, ll.lat, ll.lon)
    expect(Math.hypot(d.east, d.north)).toBeCloseTo(3000, 3)
    expect(ll.lat).toBeLessThan(-89.9); expect(Number.isFinite(ll.lon)).toBe(true)
  })
  it('velocity vector from azimuth/FPA', () => {
    const v = velocityVectorEnu(90, 0, 10); expect(v.e).toBeCloseTo(10); expect(v.n).toBeCloseTo(0)
    const d = velocityVectorEnu(0, -90, 5); expect(d.u).toBeCloseTo(-5); expect(d.e).toBeCloseTo(0)
  })
  it('coverage box handles 0..360 datasets', () => {
    const cov = { lat_range_deg: [0.9, 1.0] as [number, number], lon_range_deg: [23, 23.1] as [number, number] }
    expect(inCoverageBox(0.95, 23.05, cov)).toBe(true); expect(inCoverageBox(5, 23.05, cov)).toBe(false)
    expect(inCoverageBox(0.95, 23.05 - 360, cov)).toBe(true)
    expect(inCoverageBox(0, 0, { lat_range_deg: null, lon_range_deg: null })).toBe(false)
  })
})

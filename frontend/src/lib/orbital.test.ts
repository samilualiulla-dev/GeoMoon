import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bracket, eciToThree, earthQuaternion, fmtDistance, fmtSpeed, fmtTime, interpMatrix, interpScalar, interpV3, moonQuaternion, norm3, planeBasis } from './orbital'

describe('orbital helpers', () => {
  it('brackets times and clamps outside the range', () => {
    const t = [0, 10, 20, 40]
    expect(bracket(t, 15)).toEqual({ i: 1, f: 0.5 })
    expect(bracket(t, -5)).toEqual({ i: 0, f: 0 })
    expect(bracket(t, 99)).toEqual({ i: 2, f: 1 })
  })
  it('Catmull-Rom interpolation reproduces sample points and a straight line', () => {
    const t = [0, 1, 2, 3], v = [[0, 0, 0], [1, 2, 3], [2, 4, 6], [3, 6, 9]]
    expect(interpV3(t, v, 1)).toEqual([1, 2, 3])
    const m = interpV3(t, v, 1.5)
    expect(m[0]).toBeCloseTo(1.5, 12); expect(m[1]).toBeCloseTo(3, 12); expect(m[2]).toBeCloseTo(4.5, 12)
  })
  it('interpolates scalars and keeps null gaps (no invented values)', () => {
    expect(interpScalar([0, 10], [0, 100], 2.5)).toBe(25)
    expect(interpScalar([0, 10], [null, 100], 2.5)).toBe(100)
    expect(interpScalar([0, 10], [null, null], 2.5)).toBeNull()
  })
  it('maps ECI to three.js with z-north -> y-up and preserves handedness', () => {
    expect(eciToThree([1, 2, 3], 1)).toEqual([1, 3, -2])
    const a = new THREE.Vector3(...eciToThree([1, 0, 0], 1)), b = new THREE.Vector3(...eciToThree([0, 1, 0], 1)), c = new THREE.Vector3(...eciToThree([0, 0, 1], 1))
    expect(a.clone().cross(b).dot(c)).toBeCloseTo(1, 12)
  })
  it('Moon quaternion maps the Moon-fixed x axis (mesh lat0/lon0) onto the ECI direction of the x axis row', () => {
    // axes: rows = Moon-fixed x,y,z in ECI; here x_m = -Y_eci (Earth direction), z_m = +Z_eci
    const axes = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
    const q = moonQuaternion(axes)
    const meshX = new THREE.Vector3(1, 0, 0)            // lat 0, lon 0 in mesh (three-body) coordinates
    const out = meshX.applyQuaternion(q)
    const expected = new THREE.Vector3(...eciToThree([0, -1, 0], 1))
    expect(out.distanceTo(expected)).toBeLessThan(1e-12)
    const north = new THREE.Vector3(0, 1, 0).applyQuaternion(q)   // mesh north pole -> ECI +Z -> three +Y
    expect(north.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-12)
  })
  it('re-orthonormalises interpolated Moon axes', () => {
    const a = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], b = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]
    const m = interpMatrix([0, 1], [a, b], 0.5)
    for (const r of m) expect(norm3(r)).toBeCloseTo(1, 12)
    expect(m[0][0] * m[1][0] + m[0][1] * m[1][1] + m[0][2] * m[1][2]).toBeCloseTo(0, 12)
  })
  it('Earth rotation is about the ECI z (three y) axis', () => {
    const v = new THREE.Vector3(1, 0, 0).applyQuaternion(earthQuaternion(Math.PI / 2))
    expect(v.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-12)
  })
  it('orbit-plane basis is orthonormal and contains r', () => {
    const { u, w } = planeBasis([7e6, 0, 0], [0, 5e3, 5e3])
    expect(norm3(u)).toBeCloseTo(1, 12); expect(norm3(w)).toBeCloseTo(1, 12)
    expect(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]).toBeCloseTo(0, 12)
    expect(u[0]).toBeCloseTo(1, 12); expect(u[1]).toBeCloseTo(0, 12)
  })
  it('formats units explicitly', () => {
    expect(fmtDistance(384_400_000)).toBe('384400 км'); expect(fmtDistance(850)).toBe('850 м'); expect(fmtDistance(null)).toBe('—')
    expect(fmtSpeed(7726)).toBe('7.726 км/с'); expect(fmtSpeed(12.34)).toBe('12.3 м/с')
    expect(fmtTime(90061)).toBe('1 сут 01:01:01')
  })
})

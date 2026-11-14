import { describe, expect, it } from 'vitest'
import type { Spacecraft } from '../api/types'
import { DEMO_PRESETS, applyOverrides, overridesDiffer, overridesFrom } from './vehicle'

const v: Spacecraft = { id: 1, user_id: null, is_demo: false, ...DEMO_PRESETS[0].payload, name: 'X', derived: {} as never, warnings: [], created_at: 'x' }

describe('vehicle overrides', () => {
  it('seeds from the vehicle and detects no change', () => {
    const o = overridesFrom(v); expect(o.fuel_mass_kg).toBe('300'); expect(o.thrust_n).toBe('5000'); expect(o.max_tilt_deg).toBe('')
    expect(overridesDiffer(v, o)).toBe(false)
  })
  it('detects a changed fuel mass or optional limit and builds the payload', () => {
    const o = { ...overridesFrom(v), fuel_mass_kg: '250', max_tilt_deg: '12' }
    expect(overridesDiffer(v, o)).toBe(true)
    const p = applyOverrides(v, o)
    expect(p.fuel_mass_kg).toBe(250); expect(p.constraints.max_tilt_deg).toBe(12); expect(p.dry_mass_kg).toBe(900); expect(p.engine.thrust_n).toBe(5000)
  })
  it('treats "5000" and "5000.0" as the same value', () => { expect(overridesDiffer(v, { ...overridesFrom(v), thrust_n: '5000.0' })).toBe(false) })
  it('every demo preset is clearly labelled and physically consistent', () => {
    for (const p of DEMO_PRESETS) {
      expect(p.payload.name.startsWith('ДЕМО')).toBe(true)
      expect(p.payload.dry_mass_kg).toBeGreaterThan(0); expect(p.payload.engine.isp_s).toBeGreaterThan(0)
      expect(p.payload.landing_gear.span_m).toBeGreaterThanOrEqual(0.5 * p.payload.dimensions.width_m)         // core rule
    }
  })
})

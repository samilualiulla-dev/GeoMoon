import { describe, expect, it } from 'vitest'
import { SC_FIELDS, SCENARIO_FIELDS, parseNum, validateAll, validateNumber } from './validation'
import { DEFAULT_SCENARIO_FORM, DEFAULT_SPACECRAFT_FORM, buildInitialConditions, buildSimulationCreate, parseSchedule, scenarioFieldKeys, spacecraftCrossErrors, spacecraftFieldKeys, spacecraftPayload } from './payload'

describe('validation', () => {
  it('rejects empty, non-numeric, out of range', () => {
    expect(validateNumber('', SC_FIELDS.dry_mass_kg)).toBe('Required')
    expect(validateNumber('abc', SC_FIELDS.dry_mass_kg)).toBe('Must be a number')
    expect(validateNumber('0', SC_FIELDS.dry_mass_kg)).toMatch(/>/)
    expect(validateNumber('-5', SC_FIELDS.dry_mass_kg)).toMatch(/>/)
    expect(validateNumber('2e7', SC_FIELDS.dry_mass_kg)).toMatch(/≤/)
    expect(validateNumber('900', SC_FIELDS.dry_mass_kg)).toBeNull()
    expect(validateNumber('0', SC_FIELDS.fuel_mass_kg)).toBeNull()   // inclusive lower bound
  })
  it('integers and optional fields', () => {
    expect(validateNumber('1.5', SC_FIELDS.number_of_engines)).toBe('Must be an integer')
    expect(validateNumber('', SC_FIELDS.max_tilt_deg)).toBeNull()
    expect(validateNumber('90', SC_FIELDS.max_tilt_deg)).toMatch(/≤/)
  })
  it('accepts decimal comma', () => { expect(parseNum('1,5')).toBe(1.5); expect(validateNumber('0,5', SC_FIELDS.throttle_max)).toBeNull() })
  it('every spec documents the origin of its bounds', () => {
    for (const s of [...Object.values(SC_FIELDS), ...Object.values(SCENARIO_FIELDS)]) { expect(['api', 'physics', 'ui']).toContain(s.origin); expect(s.help.length).toBeGreaterThan(5) }
  })
  it('default forms are valid', () => {
    expect(validateAll(DEFAULT_SPACECRAFT_FORM as never, SC_FIELDS, spacecraftFieldKeys(DEFAULT_SPACECRAFT_FORM))).toEqual({})
    expect(validateAll(DEFAULT_SCENARIO_FORM as never, SCENARIO_FIELDS, scenarioFieldKeys(DEFAULT_SCENARIO_FORM))).toEqual({})
    expect(spacecraftCrossErrors(DEFAULT_SPACECRAFT_FORM)).toEqual({})
  })
  it('cross-field checks', () => {
    expect(spacecraftCrossErrors({ ...DEFAULT_SPACECRAFT_FORM, throttle_min: '0.9', throttle_max: '0.5' }).throttle_min).toBeTruthy()
    expect(spacecraftCrossErrors({ ...DEFAULT_SPACECRAFT_FORM, gear_span_m: '1', width_m: '3' }).gear_span_m).toBeTruthy()
    expect(spacecraftCrossErrors({ ...DEFAULT_SPACECRAFT_FORM, name: '  ' }).name).toBeTruthy()
  })
})

describe('payload builders', () => {
  it('builds the core spacecraft payload in SI', () => {
    const p = spacecraftPayload(DEFAULT_SPACECRAFT_FORM)
    expect(p.dry_mass_kg).toBe(900); expect(p.engine.isp_s).toBe(300); expect(p.engine.fuel_consumption_kg_s).toBeNull()
    expect(p.constraints.max_tilt_deg).toBeNull(); expect(p.landing_gear.span_m).toBe(5)
    const q = spacecraftPayload({ ...DEFAULT_SPACECRAFT_FORM, flowMode: 'mass_flow', fuel_consumption_kg_s: '1.7', max_tilt_deg: '15' })
    expect(q.engine.isp_s).toBeNull(); expect(q.engine.fuel_consumption_kg_s).toBe(1.7); expect(q.constraints.max_tilt_deg).toBe(15)
  })
  it('parses throttle schedules strictly', () => {
    expect(parseSchedule('0, 0\n10, 1').rows).toEqual([[0, 0], [10, 1]])
    expect(parseSchedule('5, 1\n2, 0').error).toMatch(/increasing/)
    expect(parseSchedule('0, 1.5').error).toMatch(/throttle/)
    expect(parseSchedule('a, b').error).toMatch(/numeric/)
    expect(parseSchedule('').error).toMatch(/empty/)
  })
  it('maps burn modes into the burn plan', () => {
    const t = { lat: 1, lon: 2 }
    const alt = buildInitialConditions({ ...DEFAULT_SCENARIO_FORM, burnMode: 'altitude', ignition_altitude_m: '500', cutoff_speed_m_s: '1' }, t)
    expect(alt.burn).toMatchObject({ mode: 'altitude', ignition_altitude_m: 500, cutoff_speed_m_s: 1, throttle_schedule: null, ignition_time_s: null })
    const sch = buildInitialConditions({ ...DEFAULT_SCENARIO_FORM, burnMode: 'schedule', scheduleText: '0,0\n5,0.5' }, t)
    expect(sch.burn.throttle_schedule).toEqual([[0, 0], [5, 0.5]]); expect(sch.burn.cutoff_speed_m_s).toBeNull()
    expect(alt.target_latitude_deg).toBe(1)
  })
  it('builds a full simulation request', () => {
    const r = buildSimulationCreate({ spacecraftId: 3, regionId: null, scenario: DEFAULT_SCENARIO_FORM, target: { lat: 0.95, lon: 23.05 }, allowSynthetic: true, datasetId: null, terrainParams: null })
    expect(r.spacecraft_id).toBe(3); expect(r.terrain.allow_synthetic).toBe(true); expect(r.terrain.radius_m).toBe(1500); expect(r.settings.integrator).toBe('dop853')
  })
})

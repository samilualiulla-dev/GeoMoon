import { describe, expect, it } from 'vitest'
import type { TimeSeries } from '../api/types'
import { sampleAt, thinIndices } from './series'
import { reportToRows, rowsToCsv, timeSeriesToCsv } from './csv'
import { LAYER_STYLES, colorFor, layerRange, sample, RAMPS, NODATA_RGB } from './colormap'
import { fmt, fmtDuration, pct } from './format'

const ts = { time_s: [0, 10, 20], altitude_m: [100, 50, 0], fuel_remaining_kg: [10, 5, 0] } as unknown as TimeSeries

describe('series', () => {
  it('interpolates linearly and clamps', () => {
    expect(sampleAt(ts, 5).altitude_m).toBeCloseTo(75)
    expect(sampleAt(ts, 15).fuel_remaining_kg).toBeCloseTo(2.5)
    expect(sampleAt(ts, -3).altitude_m).toBe(100); expect(sampleAt(ts, 99).altitude_m).toBe(0)
    expect(sampleAt(ts, 10).altitude_m).toBe(50)
  })
  it('thins indices keeping endpoints', () => {
    const i = thinIndices(1000, 10); expect(i.length).toBe(10); expect(i[0]).toBe(0); expect(i[9]).toBe(999)
    expect(thinIndices(5, 10)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('csv', () => {
  it('writes column-wise series to rows', () => {
    const csv = timeSeriesToCsv(ts).split('\n')
    expect(csv[0]).toBe('time_s,altitude_m,fuel_remaining_kg'); expect(csv).toHaveLength(4); expect(csv[2]).toBe('10,50,5')
  })
  it('escapes values', () => { expect(rowsToCsv([['a', 'x,"y"']]).split('\n')[1]).toBe('a,"x,""y"""') })
  it('report rows only contain provided values', () => {
    const rows = reportToRows({ mission: { id: 1, name: 'm', description: null, region_id: null, spacecraft_id: null, simulation_id: null, user_id: null, created_at: 'x' }, disclaimer: 'd' })
    expect(rows.map((r) => r[0])).toEqual(['mission_id', 'mission_name', 'created_at', 'disclaimer'])
  })
})

describe('colormap & format', () => {
  it('ramps interpolate', () => {
    expect(sample(RAMPS.badGood, 0)).toEqual([239, 68, 68]); expect(sample(RAMPS.badGood, 1)).toEqual([34, 197, 94])
    expect(sample(RAMPS.badGood, 2)).toEqual([34, 197, 94])
  })
  it('no-data is never coloured as data', () => {
    const s = LAYER_STYLES[0]; expect(colorFor(s, null, 0, 1)).toEqual(NODATA_RGB); expect(colorFor(s, NaN, 0, 1)).toEqual(NODATA_RGB)
  })
  it('layer ranges', () => {
    expect(layerRange(LAYER_STYLES.find((s) => s.key === 'slope')!, 0, 3)).toEqual([0, 30])
    expect(layerRange(LAYER_STYLES[0], 5, 5)).toEqual([5, 6]); expect(layerRange(LAYER_STYLES[0], null, null)).toEqual([0, 1])
  })
  it('formats missing values as a dash, never as 0', () => { expect(fmt(-2.3e-10, 1)).toBe('0.0'); expect(fmt(null)).toBe('—'); expect(fmt(NaN)).toBe('—'); expect(fmt(1.234, 1, 'm')).toBe('1.2 m'); expect(pct(undefined)).toBe('—'); expect(fmtDuration(75)).toBe('1:15.0') })
})

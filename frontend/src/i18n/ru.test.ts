import { describe, expect, it } from 'vitest'
import { OVERALL_RU, STATUS_RU, label, tr, trCheck } from './ru'

describe('Russian translation of core messages', () => {
  it('keeps numbers and units intact while translating the sentence', () => {
    expect(tr('vertical touchdown speed: 40.8 m/s exceeds limit 2')).toBe('вертикальная скорость касания: 40.8 m/s превышает лимит 2')
    expect(tr('relief within footprint vs gear clearance: 1.24 m exceeds 0.5')).toContain('1.24 m превышает лимит 0.5')
  })
  it('translates the structured explanation sentence', () => {
    const s = tr('Surface: outside_limits; Trajectory: outside_limits; Vehicle: not_assessed. At least one checked limit was exceeded - see the issue list.')
    expect(s).toContain('Поверхность: за пределами лимитов'); expect(s).toContain('аппарат: не оценивалось'); expect(s).toContain('Превышен хотя бы один')
  })
  it('translates the resolution and enlargement warnings with their numbers', () => {
    expect(tr('DEM cell size (1895 m) is larger than the vehicle footprint radius (2.65 m): the terrain under the landing gear is not resolved, so the values')).toContain('1895 м')
    expect(tr("Terrain window enlarged from 1,500 m to 18,952 m radius: dataset 'ldem_16' has ~1,895 m cells, so the requested window held too few cells. At this resolution x")).toContain('1,500 м до 18,952 м')
    expect(tr('At 1895 m/cell craters and slopes smaller than ~3790 m are not resolved; results are regional-scale context only.')).toContain('мельче ~3790 м')
  })
  it('translates API errors', () => {
    expect(tr("The region (radius 1,000 m) is smaller than 3x3 cells of dataset 'ldem_16' (one cell is about 1,895 m). Use radius_m >= 2,843 m (recommended ~37,904 m).")).toContain('не менее 2,843 м')
    expect(tr('No installed real DEM covers lat=0.0, lon=0.0')).toContain('не покрывает')
    expect(tr('spacecraft 3 not found')).toBe('Не найдено: аппарат №3')
  })
  it('leaves unknown messages untouched (never invents text)', () => { expect(tr('Some brand new backend message 42')).toBe('Some brand new backend message 42'); expect(tr('')).toBe('') })
  it('maps enums and falls back to a readable form', () => {
    expect(STATUS_RU.within_limits).toBe('в пределах лимитов'); expect(OVERALL_RU.limits_exceeded).toBe('Лимиты превышены')
    expect(label(STATUS_RU, 'brand_new_status')).toBe('brand new status'); expect(label(STATUS_RU, null)).toBe('—')
    expect(trCheck('peak thrust acceleration')).toBe('пиковое ускорение от тяги')
  })
})

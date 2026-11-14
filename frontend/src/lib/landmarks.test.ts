import { describe, expect, it } from 'vitest'
import { LANDMARKS, parseCoords, searchPlaces } from './landmarks'

describe('landmark search', () => {
  it('finds places by name (case/ё-insensitive) and kind', () => {
    expect(searchPlaces('шеклтон')[0].name).toContain('Шеклтон')
    expect(searchPlaces('АПОЛЛОН').length).toBe(6)
    expect(searchPlaces('Море').some((r) => r.kind === 'море')).toBe(true)
    expect(searchPlaces('')).toEqual([]); expect(searchPlaces('нет такого места')).toEqual([])
  })
  it('puts saved regions first', () => {
    expect(searchPlaces('мой', [{ name: 'Мой регион', lat: 1, lon: 2, kind: 'сохранённый регион' }])[0].name).toBe('Мой регион')
  })
  it('parses coordinate input in several formats', () => {
    expect(parseCoords('18.768, -41.036')).toEqual({ lat: 18.768, lon: -41.036 })
    expect(parseCoords('18,768 -41,036')).toEqual({ lat: 18.768, lon: -41.036 })
    expect(parseCoords('91, 0')).toBeNull(); expect(parseCoords('abc')).toBeNull(); expect(parseCoords('10')).toBeNull()
  })
  it('landmark coordinates are valid', () => { for (const l of LANDMARKS) { expect(Math.abs(l.lat)).toBeLessThanOrEqual(90); expect(l.lon).toBeGreaterThanOrEqual(-180); expect(l.lon).toBeLessThanOrEqual(180) } })
})

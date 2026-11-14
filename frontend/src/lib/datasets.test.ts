import { describe, expect, it } from 'vitest'
import type { DatasetInfo } from '../api/types'
import { pickDataset, radiusAdvice } from './datasets'

const ds = (id: string, res: number, o: Partial<DatasetInfo> = {}): DatasetInfo => ({
  id, name: id, provider: 'p', product: id, version: null, citation: null, url: null, resolution_m_per_px: res,
  coverage: { lat_range_deg: [-90, 90], lon_range_deg: [0, 360], includes_pole: true, nominal: null }, crs: null, is_geographic_crs: true,
  shape_rows_cols: [1, 1], elevation_unit: 'm', vertical_reference_radius_m: 1737400, synthetic: false, quantity: 'elevation', unit: 'm', usable_as_dem: true,
  min_radius_m: 1.5 * res, recommended_radius_m: Math.min(20 * res, 200000), status: 'available', warnings: [], file: id, ...o,
})

describe('dataset advice', () => {
  const coarse = ds('ldem_16', 1895), fine = ds('fine', 20, { coverage: { lat_range_deg: [0, 1], lon_range_deg: [23, 24], includes_pole: false, nominal: null } })
  it('picks the finest covering real DEM', () => {
    expect(pickDataset([coarse, fine], 0.5, 23.5, { allowSynthetic: false })?.id).toBe('fine')
    expect(pickDataset([coarse, fine], 18, -41, { allowSynthetic: false })?.id).toBe('ldem_16')
  })
  it('never picks synthetic or non-DEM products unless allowed / usable', () => {
    expect(pickDataset([ds('s', 20, { synthetic: true })], 0, 100, { allowSynthetic: false })).toBeNull()
    expect(pickDataset([ds('s', 20, { synthetic: true })], 0, 100, { allowSynthetic: true })?.id).toBe('s')
    expect(pickDataset([ds('r', 20, { usable_as_dem: false, quantity: 'roughness' })], 0, 100, { allowSynthetic: true })).toBeNull()
  })
  it('honours an explicitly selected dataset', () => { expect(pickDataset([coarse, fine], 18, -41, { datasetId: 'fine', allowSynthetic: false })?.id).toBe('fine') })
  it('flags the exact situation from the bug report: 1000 m radius on a 1.9 km DEM', () => {
    const a = radiusAdvice(coarse, 1000)!
    expect(a.tooSmall).toBe(true); expect(a.min_m).toBeCloseTo(2842.5, 1); expect(a.recommended_m).toBe(37900)
    expect(radiusAdvice(coarse, 50000)!.tooSmall).toBe(false)
    expect(radiusAdvice(fine, 1000)!.tooSmall).toBe(false)
  })
  it('gives no advice without a dataset', () => { expect(radiusAdvice(null, 1000)).toBeNull() })
})

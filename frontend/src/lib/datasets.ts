import type { DatasetInfo } from '../api/types'
import { inCoverageBox } from './geo'

/** Dataset the core would use for a point: the selected one, else the finest real DEM whose coverage box contains it
 *  (synthetic ones only if allowed). Advisory — the core decides. */
export function pickDataset(datasets: DatasetInfo[], lat: number, lon: number, opts: { datasetId?: string | null; allowSynthetic: boolean }): DatasetInfo | null {
  if (opts.datasetId) return datasets.find((d) => d.id === opts.datasetId && d.usable_as_dem) ?? null
  const c = datasets
    .filter((d) => d.usable_as_dem && (!d.synthetic || opts.allowSynthetic) && inCoverageBox(lat, lon, d.coverage))
    .sort((a, b) => (a.resolution_m_per_px ?? 1e12) - (b.resolution_m_per_px ?? 1e12))
  return c[0] ?? null
}

export interface RadiusAdvice { dataset: DatasetInfo; cell_m: number; min_m: number; recommended_m: number; tooSmall: boolean }

export function radiusAdvice(d: DatasetInfo | null, radius_m: number): RadiusAdvice | null {
  if (!d || !d.resolution_m_per_px || d.min_radius_m == null || d.recommended_radius_m == null) return null
  return { dataset: d, cell_m: d.resolution_m_per_px, min_m: d.min_radius_m, recommended_m: d.recommended_radius_m, tooSmall: !(radius_m >= d.min_radius_m) }
}

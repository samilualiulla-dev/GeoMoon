import type { RadiusAdvice } from '../../lib/datasets'
import { fmt } from '../../lib/format'
import { Button } from './ui'

/** Explains how the region radius relates to the DEM cell size, with a one-click fix. */
export function RadiusHint({ advice, onApply }: { advice: RadiusAdvice | null; onApply: (r: number) => void }) {
  if (!advice) return null
  const { dataset: d, cell_m, min_m, recommended_m, tooSmall } = advice
  return (
    <div data-testid="radius-hint" className={`mt-1 rounded border p-2 text-[11px] ${tooSmall ? 'border-bad/50 bg-bad/10 text-ink' : 'border-line text-muted'}`}>
      <div>
        <span className="text-ink/90">{d.product}</span>: one DEM cell ≈ <span className="num">{fmt(cell_m, 0)} m</span>. Region must be ≥ 3 cells across →
        radius ≥ <span className="num">{fmt(min_m, 0)} m</span>; recommended ≈ <span className="num">{fmt(recommended_m, 0)} m</span>.
      </div>
      {tooSmall && <div className="mt-1 text-bad">The current radius is too small for this dataset and the core will refuse it.</div>}
      <Button className="mt-1.5" onClick={() => onApply(Math.round(recommended_m))} data-testid="apply-radius">Use recommended radius ({fmt(recommended_m / 1000, recommended_m >= 10000 ? 0 : 1)} km)</Button>
    </div>
  )
}

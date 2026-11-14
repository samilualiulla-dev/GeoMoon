import type { RadiusAdvice } from '../../lib/datasets'
import { fmt } from '../../lib/format'
import { Button } from './ui'

/** Explains how the region radius relates to the DEM cell size, with a one-click fix. */
export function RadiusHint({ advice, onApply }: { advice: RadiusAdvice | null; onApply: (r: number) => void }) {
  if (!advice) return null
  const { dataset: d, cell_m, min_m, recommended_m, tooSmall } = advice
  return (
    <div data-testid="radius-hint" className={`mt-2 rounded-md border p-2.5 text-[12px] ${tooSmall ? 'border-bad/50 bg-bad/10 text-ink' : 'border-line text-muted'}`}>
      <div>
        <span className="text-ink/90">{d.product}</span>: одна ячейка DEM ≈ <span className="num">{fmt(cell_m, 0)} м</span>. Регион должен быть не меньше 3 ячеек в поперечнике →
        радиус ≥ <span className="num">{fmt(min_m, 0)} м</span>; рекомендуется ≈ <span className="num">{fmt(recommended_m, 0)} м</span>.
      </div>
      {tooSmall && <div className="mt-1 text-bad">Текущий радиус слишком мал для этого набора, ядро его отклонит.</div>}
      <Button size="sm" className="mt-2" onClick={() => onApply(Math.round(recommended_m))} data-testid="apply-radius">Взять рекомендуемый радиус ({fmt(recommended_m / 1000, recommended_m >= 10000 ? 0 : 1)} км)</Button>
    </div>
  )
}

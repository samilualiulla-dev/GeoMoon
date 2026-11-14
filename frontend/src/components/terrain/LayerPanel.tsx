import type { AnalysisResult } from '../../api/types'
import { LAYER_STYLES, RAMPS, layerRange, rgbCss, sample, type LayerStyle } from '../../lib/colormap'
import { fmt } from '../../lib/format'
import type { LayerState } from './HeatmapCanvas'

export function Legend({ style, analysis }: { style: LayerStyle; analysis: AnalysisResult }) {
  const L = analysis.layers[style.key]
  const [lo, hi] = layerRange(style, L?.min ?? null, L?.max ?? null)
  let bar: string
  if (style.ramp === 'class') bar = 'linear-gradient(90deg,#ef4444 0 33%,#22c55e 33% 66%,#64748b 66%)'
  else if (style.ramp === 'binary') bar = 'linear-gradient(90deg,#14532d 0 50%,#ef4444 50%)'
  else bar = `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, i) => rgbCss(sample(RAMPS[style.ramp as keyof typeof RAMPS], i / 8))).join(',')})`
  return (
    <div className="text-[10px]">
      <div className="h-2 rounded-sm" style={{ background: bar }} />
      {style.ramp === 'class' ? (
        <div className="mt-0.5 flex justify-between text-dim"><span>unsuitable</span><span>suitable</span><span>no data</span></div>
      ) : style.ramp === 'binary' ? (
        <div className="mt-0.5 flex justify-between text-dim"><span>clear</span><span>hazard</span></div>
      ) : (
        <div className="num mt-0.5 flex justify-between text-dim"><span>{fmt(lo, 2)}</span><span>{style.unit}</span><span>{fmt(hi, 2)}</span></div>
      )}
    </div>
  )
}

/** Per-layer visibility + opacity, each with legend, units, source and calculation description. */
export function LayerPanel({ analysis, state, onChange }: { analysis: AnalysisResult; state: Record<string, LayerState>; onChange: (key: string, s: LayerState) => void }) {
  const p = analysis.provenance
  return (
    <div className="space-y-2" data-testid="layer-panel">
      {LAYER_STYLES.filter((s) => analysis.layers[s.key]).map((s) => {
        const st = state[s.key] ?? { visible: false, opacity: 0.8 }
        return (
          <div key={s.key} className="rounded border border-line p-2">
            <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2">
                <input type="checkbox" data-testid={`layer-${s.key}`} checked={st.visible} onChange={(e) => onChange(s.key, { ...st, visible: e.target.checked })} className="accent-cyan" />
                <span className="text-ink">{s.label}</span>
              </span>
              <input type="range" aria-label={`${s.label} opacity`} min={0.1} max={1} step={0.05} value={st.opacity} onChange={(e) => onChange(s.key, { ...st, opacity: Number(e.target.value) })} className="w-16 accent-cyan" />
            </label>
            {st.visible && (
              <div className="mt-1.5 space-y-1">
                <Legend style={s} analysis={analysis} />
                <p className="text-[10px] leading-snug text-dim">{s.description}</p>
                <p className="text-[10px] text-dim">Source: {p.provider} · {p.product}{p.version ? ` v${p.version}` : ''}{p.synthetic ? ' (SYNTHETIC)' : ''}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

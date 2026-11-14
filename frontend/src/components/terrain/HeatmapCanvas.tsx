import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisResult, Candidate } from '../../api/types'
import { LAYER_STYLES, colorFor, layerRange } from '../../lib/colormap'
import { fmt } from '../../lib/format'
import { formatLat, formatLon, latLonFromOffset } from '../../lib/geo'

export interface LayerState { visible: boolean; opacity: number }

/** Draws the selected analysis layers stacked (bottom -> top = elevation ... class). Hover shows real values. */
export function HeatmapCanvas({ analysis, layers, candidates, selected, onSelectCandidate, onPick, className = '' }: {
  analysis: AnalysisResult
  layers: Record<string, LayerState>
  candidates?: Candidate[]
  selected?: number | null
  onSelectCandidate?: (i: number) => void
  onPick?: (lat: number, lon: number) => void
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null)
  const first = Object.values(analysis.layers)[0]
  const rows = first.rows, cols = first.cols
  const g = analysis.geometry

  const ordered = useMemo(() => LAYER_STYLES.filter((s) => analysis.layers[s.key] && layers[s.key]?.visible), [analysis, layers])

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = cols; cv.height = rows
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cols, rows)
    ctx.fillStyle = '#04070d'; ctx.fillRect(0, 0, cols, rows)
    ordered.forEach((style, li) => {
      const L = analysis.layers[style.key]
      const [lo, hi] = layerRange(style, L.min, L.max)
      const img = ctx.createImageData(cols, rows)
      const alpha = Math.round(255 * (layers[style.key]?.opacity ?? 1))
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const v = L.data[r][c]
        const o = (r * cols + c) * 4
        const overlay = li > 0
        if ((v === null && overlay) || (style.ramp === 'binary' && (v ?? 0) <= 0.5)) { img.data[o + 3] = 0; continue }
        const rgb = colorFor(style, v, lo, hi)
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = alpha
      }
      const tmp = document.createElement('canvas'); tmp.width = cols; tmp.height = rows
      tmp.getContext('2d')!.putImageData(img, 0, 0)
      ctx.drawImage(tmp, 0, 0)
    })
  }, [analysis, ordered, layers, rows, cols])

  const extentE = g.cols * g.cell_size_m.dx, extentN = g.rows * g.cell_size_m.dy

  const cellAt = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height
    return { r: Math.min(rows - 1, Math.max(0, Math.floor(fy * rows))), c: Math.min(cols - 1, Math.max(0, Math.floor(fx * cols))), fx, fy }
  }

  const hoverInfo = hover && (() => {
    const east = (hover.c + 0.5) / cols * extentE - extentE / 2
    const north = extentN / 2 - (hover.r + 0.5) / rows * extentN
    const ll = latLonFromOffset(g.center.latitude_deg, g.center.longitude_deg, east, north, g.reference_radius_m)
    return { ll, vals: LAYER_STYLES.filter((s) => analysis.layers[s.key]).map((s) => ({ s, v: analysis.layers[s.key].data[hover.r][hover.c] })) }
  })()

  return (
    <div className={`relative ${className}`}>
      <div className="relative w-full overflow-hidden rounded border border-line bg-space-950" style={{ aspectRatio: `${extentE} / ${extentN}`, maxHeight: '70vh' }}
        onMouseMove={(e) => { const { r, c } = cellAt(e); setHover({ r, c, x: e.clientX, y: e.clientY }) }} onMouseLeave={() => setHover(null)}
        onClick={(e) => { if (!onPick) return; const { r, c } = cellAt(e); const east = (c + 0.5) / cols * extentE - extentE / 2; const north = extentN / 2 - (r + 0.5) / rows * extentN; const ll = latLonFromOffset(g.center.latitude_deg, g.center.longitude_deg, east, north, g.reference_radius_m); onPick(ll.lat, ll.lon) }}>
        <canvas ref={ref} data-testid="heatmap" className="absolute inset-0 h-full w-full" style={{ imageRendering: 'pixelated' }} />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${g.cols} ${g.rows}`} preserveAspectRatio="none">
          {candidates?.map((c, i) => (
            <g key={i}>
              <circle cx={c.col + 0.5} cy={c.row + 0.5} r={Math.max(g.cols, g.rows) * 0.012} fill="none" stroke={selected === i ? '#22d3ee' : '#ffffff'} strokeWidth={Math.max(g.cols, g.rows) * 0.004} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
        {candidates?.map((c, i) => (
          <button key={i} aria-label={`Candidate ${i + 1}`} onClick={(e) => { e.stopPropagation(); onSelectCandidate?.(i) }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-1 text-[10px] font-semibold ${selected === i ? 'border-cyan bg-cyan text-space-950' : 'border-white/70 bg-space-950/80 text-white'}`}
            style={{ left: `${((c.col + 0.5) / g.cols) * 100}%`, top: `${((c.row + 0.5) / g.rows) * 100}%` }}>{i + 1}</button>
        ))}
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-space-950/80 px-1.5 py-0.5 text-[10px] text-muted">N ↑ · {fmt(extentE, 0)} × {fmt(extentN, 0)} m</div>
      </div>
      {hover && hoverInfo && (
        <div className="num pointer-events-none fixed z-50 rounded border border-line-2 bg-space-950/95 p-2 text-[10px] shadow-lg" style={{ left: Math.min(hover.x + 14, window.innerWidth - 220), top: hover.y + 14 }}>
          <div className="text-ink">{formatLat(hoverInfo.ll.lat)} · {formatLon(hoverInfo.ll.lon)}</div>
          {hoverInfo.vals.map(({ s, v }) => <div key={s.key} className="flex justify-between gap-4 text-muted"><span>{s.label}</span><span className="text-ink">{v === null ? 'no data' : `${fmt(v, 2)} ${s.unit}`}</span></div>)}
        </div>
      )}
    </div>
  )
}

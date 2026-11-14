import { useState } from 'react'
import { Button } from '../ui/ui'
import type { CamPreset } from './SceneCanvas'
import type { SceneLayers, TrajMode } from './SimScene'

const LAYER_LABELS: [keyof SceneLayers, string][] = [['terrain', 'Рельеф'], ['grid', 'Координатная сетка'], ['trajectory', 'Траектория'], ['vectors', 'Векторы скорости и тяги'], ['altitude', 'Линия высоты'], ['labels', 'Подписи']]
const PRESETS: [CamPreset, string][] = [['frame', 'Траектория'], ['iso', 'Рельеф'], ['top', 'Сверху'], ['side', 'Сбоку']]

/** Overlays for the 3-D scene: quick camera buttons (top-left) and a layers/camera popover (top-right). */
export function SceneToolbar({ layers, onLayers, trajMode, onTrajMode, onPreset, fov, onFov, exag, onExag, follow, onFollow, canFollow }: {
  layers: SceneLayers; onLayers: (l: SceneLayers) => void; trajMode: TrajMode; onTrajMode: (m: TrajMode) => void; onPreset: (p: CamPreset) => void
  fov: number; onFov: (v: number) => void; exag: number; onExag: (v: number) => void; follow: boolean; onFollow: (v: boolean) => void; canFollow: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="no-print" data-testid="scene-toolbar">
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-11.5rem)] flex-wrap gap-1.5">
        {PRESETS.map(([p, l]) => (
          <button key={p} type="button" data-testid={`cam-${p}`} onClick={() => onPreset(p)}
            className="min-h-9 rounded-md border border-line-2 bg-space-950/80 px-2.5 text-[12.5px] text-muted backdrop-blur hover:border-cyan/50 hover:text-ink">{l}</button>
        ))}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end">
        <Button size="md" icon="layers" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="layers-toggle" className="pointer-events-auto bg-space-950/85 backdrop-blur">Слои и камера</Button>
        {open && (
          <div className="panel-glow pointer-events-auto mt-2 w-72 rounded-lg border border-line-2 bg-panel p-4" data-testid="layers-popover">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">Слои сцены</div>
            <div className="space-y-0.5">
              {LAYER_LABELS.map(([k, l]) => (
                <label key={k} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px]">
                  <input type="checkbox" data-testid={`layer-${k}`} checked={layers[k]} onChange={() => onLayers({ ...layers, [k]: !layers[k] })} className="h-4 w-4 accent-cyan" />{l}
                </label>
              ))}
              <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px]">
                <input type="checkbox" data-testid="traj-mode" checked={trajMode === 'full'} onChange={() => onTrajMode(trajMode === 'full' ? 'traveled' : 'full')} className="h-4 w-4 accent-cyan" />Показывать траекторию целиком
              </label>
            </div>
            <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-dim">Камера</div>
            <label className={`flex min-h-9 items-center gap-2.5 text-[13px] ${canFollow ? 'cursor-pointer' : 'opacity-40'}`} title={canFollow ? '' : 'Доступно после симуляции'}>
              <input type="checkbox" data-testid="cam-follow" checked={follow} disabled={!canFollow} onChange={() => onFollow(!follow)} className="h-4 w-4 accent-cyan" />Следить за аппаратом
            </label>
            <label className="block text-xs text-muted">Угол обзора: <span className="num text-ink">{fov}°</span><input type="range" min={20} max={90} step={1} value={fov} onChange={(e) => onFov(Number(e.target.value))} aria-label="Угол обзора" className="mt-1 block w-full accent-cyan" /></label>
            <label className="mt-2 block text-xs text-muted">Вертикальное преувеличение: <span className="num text-ink">×{exag}</span><input type="range" min={1} max={10} step={0.5} value={exag} onChange={(e) => onExag(Number(e.target.value))} aria-label="Вертикальное преувеличение" className="mt-1 block w-full accent-cyan" /></label>
            <p className="mt-2 text-[11px] leading-snug text-dim">Мышь: вращение — левая кнопка, перемещение — правая, масштаб — колесо.</p>
          </div>
        )}
      </div>
    </div>
  )
}

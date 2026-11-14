// Perceptual-ish colour ramps (hand-tuned stops, linear interpolation in sRGB).
export type RGB = [number, number, number]
type Stops = [number, RGB][]

const VIRIDIS: Stops = [[0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 145, 140]], [0.75, [94, 201, 98]], [1, [253, 231, 37]]]
const INFERNO: Stops = [[0, [0, 0, 4]], [0.25, [87, 16, 110]], [0.5, [188, 55, 84]], [0.75, [249, 142, 9]], [1, [252, 255, 164]]]
const RAMP_BAD_GOOD: Stops = [[0, [239, 68, 68]], [0.5, [234, 179, 8]], [1, [34, 197, 94]]]
const RAMP_GOOD_BAD: Stops = [[0, [34, 197, 94]], [0.5, [234, 179, 8]], [1, [239, 68, 68]]]
const BLUE_RED: Stops = [[0, [30, 64, 175]], [0.5, [226, 232, 240]], [1, [185, 28, 28]]]

export const RAMPS = { viridis: VIRIDIS, inferno: INFERNO, badGood: RAMP_BAD_GOOD, goodBad: RAMP_GOOD_BAD, blueRed: BLUE_RED } as const
export type RampName = keyof typeof RAMPS

export function sample(stops: Stops, t: number): RGB {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]
    if (x <= t1) {
      const [t0, c0] = stops[i - 1]
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0)
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
    }
  }
  return stops[stops.length - 1][1]
}

/** sRGB (0..1) -> linear (0..1). Three.js treats vertex colours as linear and re-encodes on output. */
export function srgbToLinear(c: number): number { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }

/** Natural lunar grey (warm regolith tint). t in 0..1 = relative height: lowlands (maria) darker, highlands lighter.
 *  This is a conventional rendering, NOT measured albedo: the relief shading itself comes from the real DEM. */
export function naturalRgb(t: number): RGB {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5))
  const k = (0.3 + 0.36 * x) * 255
  return [k * 1.0, k * 0.97, k * 0.92]
}

export const NODATA_RGB: RGB = [38, 46, 60]

export interface LayerStyle {
  key: string; label: string; ramp: RampName | 'class' | 'binary'
  /** fixed display range; null => use data min/max returned by the core */
  range: [number, number] | null
  unit: string
  description: string
}

// Display ranges below are VISUALISATION choices (colour stretch), not physical limits.
export const LAYER_STYLES: LayerStyle[] = [
  { key: 'elevation', label: 'Высота', ramp: 'viridis', range: null, unit: 'м', description: 'Высота DEM относительно опорной сферы набора данных. Цветовая шкала растянута между минимумом и максимумом данных.' },
  { key: 'slope', label: 'Уклон', ramp: 'inferno', range: [0, 30], unit: '°', description: 'Уклон по Хорну (окно 3×3); база — размер ячейки DEM. Цветовая шкала зафиксирована 0–30°.' },
  { key: 'roughness', label: 'Шероховатость', ramp: 'inferno', range: null, unit: 'м', description: 'СКО высот относительно локальной плоскости (размер окна задаётся в параметрах анализа).' },
  { key: 'local_relief', label: 'Локальный рельеф', ramp: 'inferno', range: null, unit: 'м', description: 'Перепад max − min высот внутри окна анализа.' },
  { key: 'hazard', label: 'Карта опасностей', ramp: 'binary', range: [0, 1], unit: '', description: 'Объединение детекторов: крутой склон, разрыв высот, неровная поверхность, топографическая аномалия. Разрешение DEM ограничивает то, что можно обнаружить.' },
  { key: 'suitability', label: 'Пригодность для посадки', ramp: 'badGood', range: [0, 1], unit: '0–1', description: 'Взвешенная геометрическая оценка (не вероятность безопасности). Шкала 0–1.' },
  { key: 'class', label: 'Классы площадок', ramp: 'class', range: [0, 2], unit: '', description: 'Классификация по пятну посадки: непригодно / пригодно / недостаточно данных.' },
]

export function colorFor(style: LayerStyle, v: number | null, lo: number, hi: number): RGB {
  if (v === null || !Number.isFinite(v)) return NODATA_RGB
  if (style.ramp === 'class') return v === 1 ? [34, 197, 94] : v === 2 ? [100, 116, 139] : [239, 68, 68]
  if (style.ramp === 'binary') return v > 0.5 ? [239, 68, 68] : [20, 83, 45]
  const t = hi === lo ? 0 : (v - lo) / (hi - lo)
  return sample(RAMPS[style.ramp], t)
}

export function layerRange(style: LayerStyle, min: number | null, max: number | null): [number, number] {
  if (style.range) return style.range
  if (min === null || max === null) return [0, 1]
  return [min, max === min ? min + 1 : max]
}

export function rgbCss(c: RGB, a = 1): string { return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})` }

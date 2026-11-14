import { useMemo, useState } from 'react'
import type { AnalysisParams, DatasetInfo } from '../../api/types'
import type { RadiusAdvice } from '../../lib/datasets'
import { parseNum, TERRAIN_FIELDS, validateAll } from '../../lib/validation'
import { RadiusHint } from '../ui/RadiusHint'
import { Button, NumberField, Panel, SelectField, SyntheticNotice, Toggle } from '../ui/ui'

export interface TerrainFormState {
  latitude_deg: string; longitude_deg: string; radius_m: string
  slope_limit_deg: string; footprint_radius_m: string; window_m: string; roughness_limit_m: string; relief_limit_m: string
  tpi_limit_m: string; hazard_safe_distance_m: string; suitable_threshold: string; max_candidates: string
  roughness_method: 'std' | 'detrended'
  weights: AnalysisParams['weights']
}

export function formFromParams(p: AnalysisParams, lat: number, lon: number, radius: number): TerrainFormState {
  return {
    latitude_deg: String(lat), longitude_deg: String(lon), radius_m: String(radius),
    slope_limit_deg: String(p.slope_limit_deg), footprint_radius_m: String(p.footprint_radius_m), window_m: String(p.window_m),
    roughness_limit_m: String(p.roughness_limit_m), relief_limit_m: String(p.relief_limit_m), tpi_limit_m: String(p.tpi_limit_m),
    hazard_safe_distance_m: String(p.hazard_safe_distance_m), suitable_threshold: String(p.suitable_threshold), max_candidates: String(p.max_candidates),
    roughness_method: p.roughness_method, weights: p.weights,
  }
}

export function paramsFromForm(f: TerrainFormState): AnalysisParams {
  const n = (s: string) => parseNum(s) as number
  return {
    window_m: n(f.window_m), roughness_method: f.roughness_method, slope_limit_deg: n(f.slope_limit_deg), roughness_limit_m: n(f.roughness_limit_m),
    relief_limit_m: n(f.relief_limit_m), tpi_limit_m: n(f.tpi_limit_m), hazard_safe_distance_m: n(f.hazard_safe_distance_m),
    footprint_radius_m: n(f.footprint_radius_m), suitable_threshold: n(f.suitable_threshold), weights: f.weights,
    max_candidates: n(f.max_candidates), min_candidate_separation_m: null,
  }
}

export function terrainFormErrors(f: TerrainFormState): Record<string, string> {
  const e = validateAll(f as unknown as Record<string, string>, TERRAIN_FIELDS)
  if (Object.values(f.weights).every((x) => x === 0)) e.weights = 'Хотя бы один вес должен быть больше нуля'
  return e
}

const WEIGHT_LABELS: Record<keyof AnalysisParams['weights'], string> = { slope: 'Уклон', roughness: 'Шероховатость', relief: 'Локальный рельеф', hazard: 'Близость опасностей' }

export function AnalysisForm({ value, onChange, datasets, datasetId, onDataset, allowSynthetic, onAllowSynthetic, onRun, running, vehicleFootprint, vehicleTilt, onUseVehicle, autoRerun, onAutoRerun, hasResult, radiusAdvice }: {
  value: TerrainFormState; onChange: (f: TerrainFormState) => void
  datasets: DatasetInfo[]; datasetId: string | null; onDataset: (id: string | null) => void
  allowSynthetic: boolean; onAllowSynthetic: (v: boolean) => void
  onRun: () => void; running: boolean
  vehicleFootprint: number | null; vehicleTilt: number | null; onUseVehicle: () => void
  autoRerun: boolean; onAutoRerun: (v: boolean) => void; hasResult: boolean; radiusAdvice: RadiusAdvice | null
}) {
  const [touched, setTouched] = useState(false)
  const errors = useMemo(() => terrainFormErrors(value), [value])
  const set = (k: keyof TerrainFormState, v: string) => onChange({ ...value, [k]: v })
  const F = ({ k }: { k: keyof typeof TERRAIN_FIELDS & keyof TerrainFormState }) => (
    <NumberField spec={TERRAIN_FIELDS[k]} value={value[k] as string} onChange={(v) => set(k, v)} error={touched ? errors[k] : null} />
  )
  const wsum = Object.values(value.weights).reduce((a, b) => a + b, 0)
  const run = () => { setTouched(true); if (Object.keys(errors).length === 0) onRun() }
  return (
    <div className="space-y-4">
      <Panel title="Регион" icon="globe">
        <div className="grid grid-cols-2 gap-3">
          <F k="latitude_deg" /><F k="longitude_deg" />
          <div className="col-span-2"><F k="radius_m" /><RadiusHint advice={radiusAdvice} onApply={(r) => set('radius_m', String(r))} /></div>
          <div className="col-span-2">
            <SelectField label="Набор данных DEM" id="dataset" value={datasetId ?? ''} onChange={(v) => onDataset(v === '' ? null : v)}
              options={[{ value: '', label: 'Авто (лучший реальный набор, покрывающий точку)' }, ...datasets.filter((d) => d.usable_as_dem).map((d) => ({ value: d.id, label: `${d.name}${d.synthetic ? ' — СИНТЕТИКА' : ''}` }))]} />
          </div>
          <div className="col-span-2 space-y-2">
            <Toggle checked={allowSynthetic} onChange={onAllowSynthetic} label="Разрешить синтетику (тест)" hint="Нужно для наборов, помеченных как синтетические" />
            {allowSynthetic && <SyntheticNotice compact />}
          </div>
        </div>
      </Panel>
      <Panel title="Критерии" icon="alert">
        <div className="grid grid-cols-2 gap-3">
          <F k="slope_limit_deg" /><F k="footprint_radius_m" />
          <div className="col-span-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onUseVehicle} disabled={vehicleFootprint === null} data-testid="use-vehicle">Взять из аппарата{vehicleFootprint !== null ? ` (r ${vehicleFootprint.toFixed(2)} м${vehicleTilt !== null ? `, ${vehicleTilt.toFixed(1)}°` : ''})` : ''}</Button>
            {vehicleFootprint === null && <span className="text-[12px] text-dim">Выберите аппарат в разделе «Аппараты».</span>}
          </div>
          <F k="window_m" /><F k="max_candidates" />
          <F k="roughness_limit_m" /><F k="relief_limit_m" /><F k="tpi_limit_m" /><F k="hazard_safe_distance_m" />
          <F k="suitable_threshold" />
          <SelectField label="Метод шероховатости" value={value.roughness_method} onChange={(m) => onChange({ ...value, roughness_method: m })}
            options={[{ value: 'detrended', label: 'СКО от плоскости' }, { value: 'std', label: 'Простое СКО' }]} />
        </div>
      </Panel>
      <Panel title="Веса пригодности" icon="layers" actions={<span className="num text-[11px] text-dim">Σ = {wsum.toFixed(2)}</span>}>
        <div className="space-y-3">
          {(Object.keys(WEIGHT_LABELS) as (keyof AnalysisParams['weights'])[]).map((k) => (
            <label key={k} className="block text-[12.5px]">
              <span className="flex justify-between text-muted"><span>{WEIGHT_LABELS[k]}</span><span className="num text-ink">{wsum > 0 ? ((value.weights[k] / wsum) * 100).toFixed(0) : 0} %</span></span>
              <input type="range" data-testid={`w-${k}`} min={0} max={1} step={0.05} value={value.weights[k]} onChange={(e) => onChange({ ...value, weights: { ...value.weights, [k]: Number(e.target.value) } })} className="mt-1 h-6 w-full accent-cyan" />
            </label>
          ))}
          {touched && errors.weights && <div className="text-[11px] text-bad">{errors.weights}</div>}
          <p className="text-[11px] leading-snug text-dim">оценка = Σ wₖ·оценкаₖ / Σ wₖ. Веса относительные; изменение пересчитывает слой пригодности на ядре.</p>
          <Toggle checked={autoRerun} onChange={onAutoRerun} label="Пересчитывать при изменении критериев" disabled={!hasResult} />
        </div>
      </Panel>
      <Button variant="primary" size="lg" className="w-full" onClick={run} disabled={running} data-testid="run-analysis" icon="play">{running ? 'Анализ на ядре…' : 'Запустить анализ рельефа'}</Button>
      {touched && Object.keys(errors).length > 0 && <div className="text-[12px] text-bad">Исправьте поля с ошибками: {Object.keys(errors).length}.</div>}
    </div>
  )
}

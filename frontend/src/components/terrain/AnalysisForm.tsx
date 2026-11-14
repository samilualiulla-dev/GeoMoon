import { useMemo, useState } from 'react'
import type { AnalysisParams, DatasetInfo } from '../../api/types'
import { parseNum, TERRAIN_FIELDS, validateAll } from '../../lib/validation'
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
  const w = Object.values(f.weights)
  if (w.every((x) => x === 0)) e.weights = 'At least one weight must be > 0'
  return e
}

const WEIGHT_LABELS: Record<keyof AnalysisParams['weights'], string> = { slope: 'Slope', roughness: 'Roughness', relief: 'Local relief', hazard: 'Hazard proximity' }

export function AnalysisForm({ value, onChange, datasets, datasetId, onDataset, allowSynthetic, onAllowSynthetic, onRun, running, vehicleFootprint, vehicleTilt, onUseVehicle, autoRerun, onAutoRerun, hasResult }: {
  value: TerrainFormState; onChange: (f: TerrainFormState) => void
  datasets: DatasetInfo[]; datasetId: string | null; onDataset: (id: string | null) => void
  allowSynthetic: boolean; onAllowSynthetic: (v: boolean) => void
  onRun: () => void; running: boolean
  vehicleFootprint: number | null; vehicleTilt: number | null; onUseVehicle: () => void
  autoRerun: boolean; onAutoRerun: (v: boolean) => void; hasResult: boolean
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
    <div className="space-y-3">
      <Panel title="Region">
        <div className="grid grid-cols-2 gap-3">
          <F k="latitude_deg" /><F k="longitude_deg" />
          <div className="col-span-2"><F k="radius_m" /></div>
          <div className="col-span-2">
            <SelectField label="DEM dataset" id="dataset" value={datasetId ?? ''} onChange={(v) => onDataset(v === '' ? null : v)}
              options={[{ value: '', label: 'Auto (best real dataset covering the point)' }, ...datasets.filter((d) => d.usable_as_dem).map((d) => ({ value: d.id, label: `${d.name}${d.synthetic ? ' — SYNTHETIC' : ''}` }))]} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Toggle checked={allowSynthetic} onChange={onAllowSynthetic} label="Allow SYNTHETIC test terrain" hint="Required to use datasets flagged synthetic" />
            {allowSynthetic && <SyntheticNotice compact />}
          </div>
        </div>
      </Panel>
      <Panel title="Criteria">
        <div className="grid grid-cols-2 gap-3">
          <F k="slope_limit_deg" /><F k="footprint_radius_m" />
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <Button onClick={onUseVehicle} disabled={vehicleFootprint === null} data-testid="use-vehicle">Use vehicle footprint{vehicleFootprint !== null ? ` (${vehicleFootprint.toFixed(2)} m` + (vehicleTilt !== null ? `, ${vehicleTilt.toFixed(1)}° tilt)` : ')') : ''}</Button>
            {vehicleFootprint === null && <span className="text-dim">Save a vehicle on the Spacecraft page first.</span>}
          </div>
          <F k="window_m" /><F k="max_candidates" />
          <F k="roughness_limit_m" /><F k="relief_limit_m" /><F k="tpi_limit_m" /><F k="hazard_safe_distance_m" />
          <F k="suitable_threshold" />
          <SelectField label="Roughness method" value={value.roughness_method} onChange={(m) => onChange({ ...value, roughness_method: m })}
            options={[{ value: 'detrended', label: 'Plane-detrended RMS' }, { value: 'std', label: 'Plain std-dev' }]} />
        </div>
      </Panel>
      <Panel title="Suitability weights" actions={<span className="num text-[10px] text-dim">normalised Σ = {wsum.toFixed(2)}</span>}>
        <div className="space-y-2">
          {(Object.keys(WEIGHT_LABELS) as (keyof AnalysisParams['weights'])[]).map((k) => (
            <label key={k} className="block text-[11px]">
              <span className="flex justify-between text-muted"><span>{WEIGHT_LABELS[k]}</span><span className="num text-ink">{wsum > 0 ? ((value.weights[k] / wsum) * 100).toFixed(0) : 0} %</span></span>
              <input type="range" data-testid={`w-${k}`} min={0} max={1} step={0.05} value={value.weights[k]} onChange={(e) => onChange({ ...value, weights: { ...value.weights, [k]: Number(e.target.value) } })} className="w-full accent-cyan" />
            </label>
          ))}
          {touched && errors.weights && <div className="text-[10px] text-bad">{errors.weights}</div>}
          <p className="text-[10px] text-dim">score = Σ wₖ·scoreₖ / Σ wₖ. Weights are relative; changing them re-computes the suitability layer on the core.</p>
          <Toggle checked={autoRerun} onChange={onAutoRerun} label="Re-run automatically when criteria change" disabled={!hasResult} />
        </div>
      </Panel>
      <Button variant="primary" className="w-full py-2" onClick={run} disabled={running} data-testid="run-analysis">{running ? 'Analysing on the core…' : 'Run terrain analysis'}</Button>
      {touched && Object.keys(errors).length > 0 && <div className="text-[11px] text-bad">Fix {Object.keys(errors).length} invalid field(s) above.</div>}
    </div>
  )
}

import { useMemo } from 'react'
import { type SpacecraftForm, spacecraftCrossErrors, spacecraftFieldKeys } from '../../lib/payload'
import { SC_FIELDS, validateAll } from '../../lib/validation'
import { NumberField, Panel } from '../ui/ui'

export function useSpacecraftErrors(f: SpacecraftForm) {
  return useMemo(() => ({ ...validateAll(f as unknown as Record<string, string>, SC_FIELDS, spacecraftFieldKeys(f)), ...spacecraftCrossErrors(f) }), [f])
}

export function SpacecraftFormView({ value, onChange, errors, showErrors }: { value: SpacecraftForm; onChange: (f: SpacecraftForm) => void; errors: Record<string, string>; showErrors: boolean }) {
  const set = <K extends keyof SpacecraftForm>(k: K, v: SpacecraftForm[K]) => onChange({ ...value, [k]: v })
  const F = ({ k, step }: { k: keyof SpacecraftForm & string; step?: string }) => (
    <NumberField spec={SC_FIELDS[k]} value={value[k] as string} onChange={(v) => set(k, v as never)} error={showErrors ? errors[k] : null} step={step} />
  )
  return (
    <div className="space-y-3">
      <Panel title="Identification & mass">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label htmlFor="f-name" className="mb-1 block text-[11px] text-muted">Configuration name</label>
            <input id="f-name" data-testid="f-name" value={value.name} onChange={(e) => set('name', e.target.value)} maxLength={120}
              className={`w-full rounded border bg-space-900 px-2 py-1.5 text-xs outline-none focus:border-cyan ${showErrors && errors.name ? 'border-bad' : 'border-line-2'}`} />
            {showErrors && errors.name && <div className="mt-0.5 text-[10px] text-bad">{errors.name}</div>}
          </div>
          <F k="dry_mass_kg" /><F k="fuel_mass_kg" />
        </div>
      </Panel>
      <Panel title="Dimensions & landing gear">
        <div className="grid gap-3 sm:grid-cols-3">
          <F k="length_m" /><F k="width_m" /><F k="height_m" />
          <F k="gear_span_m" /><F k="pad_diameter_m" /><F k="gear_height_m" />
        </div>
        <p className="mt-2 text-[10px] text-dim">Footprint radius = span/2 + pad/2 (used as the minimum site radius). Static tipping angle = atan((span/2) / CG height); both are computed by the core.</p>
      </Panel>
      <Panel title="Propulsion">
        <div className="grid gap-3 sm:grid-cols-3">
          <F k="thrust_n" /><F k="number_of_engines" step="1" />
          <div>
            <label className="mb-1 block text-[11px] text-muted">Propellant flow given as</label>
            <div className="flex gap-1 text-xs">
              {(['isp', 'mass_flow'] as const).map((m) => (
                <button key={m} type="button" onClick={() => set('flowMode', m)} data-testid={`flow-${m}`}
                  className={`flex-1 rounded border px-2 py-1.5 ${value.flowMode === m ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line-2 text-muted hover:text-ink'}`}>{m === 'isp' ? 'Isp' : 'Mass flow'}</button>
              ))}
            </div>
          </div>
          {value.flowMode === 'isp' ? <F k="isp_s" /> : <F k="fuel_consumption_kg_s" />}
          <F k="throttle_min" step="0.05" /><F k="throttle_max" step="0.05" />
        </div>
        <p className="mt-2 text-[10px] text-dim">Thrust level during descent is set by the burn plan (constant, time-varying schedule, cut-off) in the scenario section; the core clamps it to the throttle limits above.</p>
      </Panel>
      <Panel title="Landing constraints (user limits)">
        <div className="grid gap-3 sm:grid-cols-3">
          <F k="max_vertical_touchdown_speed_m_s" /><F k="max_horizontal_touchdown_speed_m_s" /><F k="max_distance_to_target_m" />
          <F k="max_tilt_deg" /><F k="max_acceleration_m_s2" />
        </div>
        <p className="mt-2 text-[10px] text-dim">These are limits YOU define for the vehicle. Initial values are illustrative placeholders from the project brief, not validated spacecraft specifications.</p>
      </Panel>
    </div>
  )
}

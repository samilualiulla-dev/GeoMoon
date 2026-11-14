import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { IgnitionSuggestion, Spacecraft } from '../api/types'
import { ScenarioFormView, useScenarioErrors } from '../components/spacecraft/ScenarioFormView'
import { SpacecraftFormView, useSpacecraftErrors } from '../components/spacecraft/SpacecraftFormView'
import { Badge, Button, Empty, ErrorBanner, Panel, Stat } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { fmt } from '../lib/format'
import { DEFAULT_SCENARIO_FORM, DEFAULT_SPACECRAFT_FORM, spacecraftPayload, type SpacecraftForm } from '../lib/payload'
import { useInputs } from '../store/appStore'

function formFromSpacecraft(s: Spacecraft): SpacecraftForm {
  const e = s.engine, c = s.constraints
  return {
    name: s.name, dry_mass_kg: String(s.dry_mass_kg), fuel_mass_kg: String(s.fuel_mass_kg),
    length_m: String(s.dimensions.length_m), width_m: String(s.dimensions.width_m), height_m: String(s.dimensions.height_m),
    gear_span_m: String(s.landing_gear.span_m), pad_diameter_m: String(s.landing_gear.pad_diameter_m), gear_height_m: String(s.landing_gear.gear_height_m),
    thrust_n: String(e.thrust_n), number_of_engines: String(e.number_of_engines), flowMode: e.isp_s ? 'isp' : 'mass_flow',
    isp_s: e.isp_s ? String(e.isp_s) : '', fuel_consumption_kg_s: e.fuel_consumption_kg_s ? String(e.fuel_consumption_kg_s) : '',
    throttle_min: String(e.throttle_min), throttle_max: String(e.throttle_max),
    max_vertical_touchdown_speed_m_s: String(c.max_vertical_touchdown_speed_m_s), max_horizontal_touchdown_speed_m_s: String(c.max_horizontal_touchdown_speed_m_s),
    max_tilt_deg: c.max_tilt_deg === null ? '' : String(c.max_tilt_deg), max_acceleration_m_s2: c.max_acceleration_m_s2 === null ? '' : String(c.max_acceleration_m_s2),
    max_distance_to_target_m: String(c.max_distance_to_target_m),
  }
}

export default function SpacecraftPage() {
  const inputs = useInputs()
  const form = inputs.spacecraftForm, scenario = inputs.scenario
  const scErrors = useSpacecraftErrors(form)
  const scnErrors = useScenarioErrors(scenario)
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState<Spacecraft | null>(null)
  const list = useFetch(() => api.spacecraftList(), [])
  const [suggestion, setSuggestion] = useState<IgnitionSuggestion | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const current = list.data?.find((s) => s.id === inputs.spacecraftId) ?? saved

  const save = async () => {
    setShow(true); setError(null)
    if (Object.keys(scErrors).length) return
    setSaving(true)
    try {
      const s = await api.createSpacecraft(spacecraftPayload(form))
      setSaved(s); inputs.setSpacecraftId(s.id); list.reload()
    } catch (e) { setError(asApiError(e)) } finally { setSaving(false) }
  }

  const suggest = async () => {
    if (inputs.spacecraftId === null) return
    setSuggesting(true); setSuggestion(null); setError(null)
    try {
      setSuggestion(await api.suggestIgnition({ spacecraft_id: inputs.spacecraftId, initial_altitude_m: Number(scenario.initial_altitude_m), initial_speed_m_s: Number(scenario.initial_speed_m_s), throttle: Number(scenario.throttle) || 1 }))
    } catch (e) { setError(asApiError(e)) } finally { setSuggesting(false) }
  }

  const derived = current?.derived
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Spacecraft configuration</h1>
          <p className="text-xs text-muted">Hypothetical lander for research purposes. All values are SI and are validated here and again by the core. Numbers shown as defaults are illustrative, not a real spacecraft.</p>
        </div>
        <SpacecraftFormView value={form} onChange={inputs.setSpacecraftForm} errors={scErrors} showErrors={show} />
        <h2 className="pt-2 text-sm font-semibold">Descent scenario</h2>
        <ScenarioFormView value={scenario} onChange={inputs.setScenario} errors={scnErrors} showErrors={show} target={inputs.target}
          suggestion={suggestion} onSuggest={suggest} canSuggest={inputs.spacecraftId !== null && !scnErrors.initial_altitude_m && !scnErrors.initial_speed_m_s} suggesting={suggesting} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={save} disabled={saving} data-testid="save-spacecraft">{saving ? 'Saving…' : 'Validate & save vehicle to core'}</Button>
          <Link to="/simulation" className="rounded border border-line-2 bg-panel-2 px-3 py-1.5 text-xs hover:bg-line">Go to Landing Simulation →</Link>
          <Button variant="ghost" onClick={() => { inputs.setSpacecraftForm(DEFAULT_SPACECRAFT_FORM); inputs.setScenario(DEFAULT_SCENARIO_FORM); setShow(false) }}>Reset form</Button>
          {show && (Object.keys(scErrors).length > 0 || Object.keys(scnErrors).length > 0) && <span className="text-xs text-bad">{Object.keys(scErrors).length + Object.keys(scnErrors).length} invalid field(s)</span>}
        </div>
        {error != null && <ErrorBanner error={error} title="Core rejected the request" />}
      </div>
      <div className="space-y-4">
        <Panel title="Computed by the core" >
          {!derived ? <Empty title="Not saved yet">Save the vehicle to see derived quantities (thrust-to-weight, ideal Δv, footprint, tipping angle). They are computed by the core, not in the browser.</Empty> : (
            <div data-testid="derived">
              <div className="mb-2 text-xs text-muted">#{current!.id} · {current!.name}</div>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Total mass" value={fmt(derived.total_mass_kg, 1)} unit="kg" />
                <Stat label="T/W at lunar surface" value={fmt(derived.thrust_to_weight_lunar_surface, 2)} tone={derived.thrust_to_weight_lunar_surface < 1 ? 'warn' : undefined} />
                <Stat label="Effective Isp" value={fmt(derived.effective_isp_s, 1)} unit="s" />
                <Stat label="Mass flow (100 %)" value={fmt(derived.mass_flow_full_throttle_kg_s, 3)} unit="kg/s" />
                <Stat label="Max burn time" value={fmt(derived.max_burn_time_s, 1)} unit="s" />
                <Stat label="Ideal Δv" value={fmt(derived.delta_v_ideal_m_s, 0)} unit="m/s" />
                <Stat label="Footprint radius" value={fmt(derived.footprint_radius_m, 2)} unit="m" />
                <Stat label="Tipping angle" value={fmt(derived.tipping_angle_deg, 1)} unit="°" />
                <Stat label="Tilt limit used" value={fmt(derived.max_tilt_deg_used, 1)} unit="°" />
              </div>
              {current!.warnings.map((w, i) => <div key={i} className="mt-2"><Badge tone="warn">warning</Badge> <span className="text-[11px] text-warn">{w}</span></div>)}
            </div>
          )}
        </Panel>
        <Panel title="Saved vehicles" actions={<Button variant="ghost" onClick={list.reload}>Refresh</Button>}>
          {list.error && <ErrorBanner error={list.error} onRetry={list.reload} />}
          {list.data && list.data.length === 0 && <Empty title="None yet">Saved configurations appear here and can be selected for simulations.</Empty>}
          <ul className="space-y-1" data-testid="saved-vehicles">
            {list.data?.map((s) => (
              <li key={s.id} className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs ${inputs.spacecraftId === s.id ? 'border-cyan bg-cyan/10' : 'border-line'}`}>
                <span className="min-w-0 truncate">#{s.id} {s.name}<span className="num ml-2 text-dim">{fmt(s.derived.total_mass_kg, 0)} kg</span></span>
                <span className="flex shrink-0 gap-1">
                  <Button onClick={() => inputs.setSpacecraftId(s.id)}>Select</Button>
                  <Button onClick={() => { inputs.setSpacecraftForm(formFromSpacecraft(s)); inputs.setSpacecraftId(s.id) }}>Load</Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

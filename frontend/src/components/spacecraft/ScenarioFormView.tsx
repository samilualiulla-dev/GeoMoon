import { useMemo } from 'react'
import type { IgnitionSuggestion } from '../../api/types'
import { fmt } from '../../lib/format'
import { formatLat, formatLon, velocityVectorEnu } from '../../lib/geo'
import { type ScenarioForm, parseSchedule, scenarioFieldKeys } from '../../lib/payload'
import { SCENARIO_FIELDS, validateAll } from '../../lib/validation'
import { Button, NumberField, Panel, SelectField, Toggle } from '../ui/ui'

export function useScenarioErrors(f: ScenarioForm) {
  return useMemo(() => {
    const e = validateAll(f as unknown as Record<string, string>, SCENARIO_FIELDS, scenarioFieldKeys(f))
    if (f.burnMode === 'schedule') { const s = parseSchedule(f.scheduleText); if (s.error) e.scheduleText = s.error }
    return e
  }, [f])
}

export function ScenarioFormView({ value, onChange, errors, showErrors, target, suggestion, onSuggest, canSuggest, suggesting }: {
  value: ScenarioForm; onChange: (f: ScenarioForm) => void; errors: Record<string, string>; showErrors: boolean
  target: { lat: number; lon: number }; suggestion: IgnitionSuggestion | null; onSuggest: () => void; canSuggest: boolean; suggesting: boolean
}) {
  const set = <K extends keyof ScenarioForm>(k: K, v: ScenarioForm[K]) => onChange({ ...value, [k]: v })
  const F = ({ k, step }: { k: keyof ScenarioForm & string; step?: string }) => (
    <NumberField spec={SCENARIO_FIELDS[k]} value={value[k] as string} onChange={(v) => set(k, v as never)} error={showErrors ? errors[k] : null} step={step} />
  )
  const v = velocityVectorEnu(Number(value.azimuth_deg) || 0, Number(value.flight_path_angle_deg) || 0, Number(value.initial_speed_m_s) || 0)
  return (
    <div className="space-y-3">
      <Panel title="Initial state (relative to the lunar surface)">
        <div className="mb-3 rounded border border-line bg-space-900 p-2 text-[11px] text-muted">Target: <span className="num text-ink">{formatLat(target.lat)} · {formatLon(target.lon)}</span> — change it in Lunar Explorer or Terrain Analysis.</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <F k="initial_altitude_m" /><F k="initial_speed_m_s" /><F k="initial_downrange_m" />
          <F k="azimuth_deg" /><F k="flight_path_angle_deg" />
          <div className="rounded border border-line p-2 text-[11px]" data-testid="velocity-vector">
            <div className="text-dim">Velocity vector (local E, N, U)</div>
            <div className="num mt-0.5 text-ink">[{fmt(v.e, 2)}, {fmt(v.n, 2)}, {fmt(v.u, 2)}] m/s</div>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-dim">Heading is clockwise from north; flight-path angle −90° = straight down. Orientation (attitude) is not simulated by the core (point-mass model).</p>
      </Panel>
      <Panel title="Burn plan — open-loop scenario (not a guidance law)">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Burn mode" value={value.burnMode} onChange={(m) => set('burnMode', m)} id="burn-mode" options={[
            { value: 'none', label: 'No burn (ballistic)' }, { value: 'altitude', label: 'Ignite at altitude' },
            { value: 'time', label: 'Ignite at time' }, { value: 'schedule', label: 'Throttle schedule (variable thrust)' }]} />
          {value.burnMode === 'altitude' && <F k="ignition_altitude_m" />}
          {value.burnMode === 'time' && <F k="ignition_time_s" />}
          {(value.burnMode === 'altitude' || value.burnMode === 'time') && <><F k="throttle" step="0.05" /><F k="cutoff_speed_m_s" /></>}
          {value.burnMode !== 'none' && <SelectField label="Thrust direction" value={value.direction} onChange={(d) => set('direction', d)} options={[{ value: 'retrograde', label: 'Retrograde (against velocity)' }, { value: 'radial_up', label: 'Radial up (local vertical)' }]} />}
        </div>
        {value.burnMode === 'schedule' && (
          <div className="mt-3">
            <label htmlFor="schedule" className="mb-1 block text-[11px] text-muted">Throttle schedule — one “time_s, throttle” pair per line (piecewise constant; throttle 0 = engine off)</label>
            <textarea id="schedule" data-testid="schedule" rows={4} value={value.scheduleText} onChange={(e) => set('scheduleText', e.target.value)}
              className={`num w-full rounded border bg-space-900 p-2 text-xs outline-none focus:border-cyan ${showErrors && errors.scheduleText ? 'border-bad' : 'border-line-2'}`} />
            {showErrors && errors.scheduleText && <div className="text-[10px] text-bad">{errors.scheduleText}</div>}
          </div>
        )}
        {value.burnMode === 'altitude' && (
          <div className="mt-3 rounded border border-line p-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onSuggest} disabled={!canSuggest || suggesting} data-testid="suggest-ignition">{suggesting ? 'Asking core…' : 'Suggest ignition altitude (core estimate)'}</Button>
              {!canSuggest && <span className="text-dim">Save the vehicle first and enter altitude/speed.</span>}
            </div>
            {suggestion && (suggestion.feasible || suggestion.reason) && (
              <div className="mt-2 text-muted" data-testid="suggestion">
                {suggestion.feasible ? (<>
                  Ignition at <span className="num text-ink">{fmt(suggestion.ignition_altitude_m, 0)} m</span> · speed then <span className="num">{fmt(suggestion.speed_at_ignition_m_s, 1)} m/s</span> · burn <span className="num">{fmt(suggestion.burn_time_s, 1)} s</span> · fuel <span className="num">{fmt(suggestion.fuel_needed_kg, 1)} / {fmt(suggestion.fuel_available_kg, 1)} kg</span>
                  <div className="mt-1"><Button onClick={() => set('ignition_altitude_m', String(Math.round(suggestion.ignition_altitude_m ?? 0)))}>Apply</Button></div>
                  <div className="mt-1 text-[10px] text-dim">{suggestion.note}</div></>) : <span className="text-warn">Not feasible: {suggestion.reason ?? 'insufficient fuel'}</span>}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-[10px] text-dim">The engine automatically shuts off on fuel exhaustion or at the cut-off speed. The core does not search for an optimal trajectory.</p>
      </Panel>
      <Panel title="Simulation settings">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Integrator" value={value.integrator} onChange={(i) => set('integrator', i)} options={[{ value: 'dop853', label: 'DOP853 (adaptive, 8th order)' }, { value: 'rk4', label: 'RK4 (fixed step)' }]} />
          <F k="output_dt_s" />{value.integrator === 'rk4' && <F k="rk4_step_s" />}<F k="max_time_s" />
          <div className="flex items-end"><Toggle checked={value.moon_rotation} onChange={(c) => set('moon_rotation', c)} label="Include Moon rotation" hint="Surface-relative velocities; the Moon rotates once per 27.32 days" /></div>
          <div className="flex items-end"><Toggle checked={value.terrain_enabled} onChange={(c) => set('terrain_enabled', c)} label="Couple with real DEM" hint="Touchdown on DEM surface and surface assessment" /></div>
          {value.terrain_enabled && <F k="terrain_radius_m" />}
        </div>
      </Panel>
    </div>
  )
}

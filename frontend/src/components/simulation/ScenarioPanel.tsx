import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { IgnitionSuggestion, Spacecraft } from '../../api/types'
import { BURN_RU, DIRECTION_RU } from '../../i18n/ru'
import { fmt } from '../../lib/format'
import { formatLat, formatLon, velocityVectorEnu } from '../../lib/geo'
import { type ScenarioForm, parseSchedule, scenarioFieldKeys } from '../../lib/payload'
import { OVERRIDE_KEYS, type Overrides, overridesDiffer } from '../../lib/vehicle'
import { SC_FIELDS, SCENARIO_FIELDS, TERRAIN_FIELDS, validateAll, validateNumber } from '../../lib/validation'
import { Badge, Button, NumberField, SelectField, Section, Toggle } from '../ui/ui'

export function useScenarioErrors(f: ScenarioForm) {
  return useMemo(() => {
    const e = validateAll(f as unknown as Record<string, string>, SCENARIO_FIELDS, scenarioFieldKeys(f))
    if (f.burnMode === 'schedule') { const s = parseSchedule(f.scheduleText); if (s.error) e.scheduleText = s.error }
    return e
  }, [f])
}

export function useOverrideErrors(o: Overrides | null) {
  return useMemo(() => {
    if (!o) return {}
    const e = validateAll(o as unknown as Record<string, string>, SC_FIELDS, OVERRIDE_KEYS as string[])
    return e
  }, [o])
}

export function useTargetErrors(lat: string, lon: string) {
  return useMemo(() => ({ lat: validateNumber(lat, TERRAIN_FIELDS.latitude_deg), lon: validateNumber(lon, TERRAIN_FIELDS.longitude_deg) }), [lat, lon])
}

interface Props {
  scenario: ScenarioForm; onScenario: (f: ScenarioForm) => void; errors: Record<string, string>
  vehicles: Spacecraft[]; vehicleId: number | null; onVehicle: (id: number | null) => void
  overrides: Overrides | null; onOverrides: (o: Overrides) => void; overrideErrors: Record<string, string>
  targetLat: string; targetLon: string; onTarget: (lat: string, lon: string) => void; targetErrors: { lat: string | null; lon: string | null }
  showErrors: boolean; disabled: boolean
  suggestion: IgnitionSuggestion | null; onSuggest: () => void; suggesting: boolean
}

/** Left column of the simulation workspace: everything the run depends on, editable before launch. */
export function ScenarioPanel(p: Props) {
  const { scenario: f, errors, showErrors, disabled } = p
  const vehicle = p.vehicles.find((v) => v.id === p.vehicleId) ?? null
  const set = <K extends keyof ScenarioForm>(k: K, v: ScenarioForm[K]) => p.onScenario({ ...f, [k]: v })
  const F = ({ k, step }: { k: keyof ScenarioForm & string; step?: string }) => (
    <NumberField spec={SCENARIO_FIELDS[k]} value={f[k] as string} onChange={(v) => set(k, v as never)} error={showErrors ? errors[k] : null} step={step} disabled={disabled} compact />
  )
  const O = ({ k }: { k: keyof Overrides }) => (
    <NumberField spec={SC_FIELDS[k === 'fuel_mass_kg' ? 'fuel_mass_kg' : k]} value={p.overrides?.[k] ?? ''} onChange={(v) => p.overrides && p.onOverrides({ ...p.overrides, [k]: v })}
      error={showErrors ? p.overrideErrors[k] : null} disabled={disabled || !p.overrides} compact />
  )
  const v = velocityVectorEnu(Number(f.azimuth_deg) || 0, Number(f.flight_path_angle_deg) || 0, Number(f.initial_speed_m_s) || 0)
  const changed = vehicle && p.overrides ? overridesDiffer(vehicle, p.overrides) : false
  const d = vehicle?.derived

  return (
    <div className="divide-y divide-line" data-testid="scenario-panel">
      <Section title="Аппарат" icon="rocket" testId="sec-vehicle">
        <SelectField label="Выбранный аппарат" id="vehicle" value={String(p.vehicleId ?? '')} onChange={(x) => p.onVehicle(x === '' ? null : Number(x))} disabled={disabled}
          options={[{ value: '', label: p.vehicles.length ? '— выберите аппарат —' : '— нет сохранённых аппаратов —' }, ...p.vehicles.map((x) => ({ value: String(x.id), label: `${x.is_demo ? '[ДЕМО] ' : ''}№${x.id} ${x.name}` }))]} />
        {vehicle && d ? (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]" data-testid="vehicle-summary">
            <div><div className="text-dim">Полная масса</div><div className="num">{fmt(d.total_mass_kg, 0)} кг</div></div>
            <div><div className="text-dim">Тяга / вес (Луна)</div><div className={`num ${d.thrust_to_weight_lunar_surface < 1 ? 'text-warn' : ''}`}>{fmt(d.thrust_to_weight_lunar_surface, 2)}</div></div>
            <div><div className="text-dim">Идеальное Δv</div><div className="num">{fmt(d.delta_v_ideal_m_s, 0)} м/с</div></div>
            <div><div className="text-dim">Радиус пятна</div><div className="num">{fmt(d.footprint_radius_m, 2)} м</div></div>
            {vehicle.is_demo && <div className="col-span-2"><Badge tone="warn">ДЕМО — условные значения, не реальный аппарат</Badge></div>}
            {vehicle.warnings.map((w, i) => <div key={i} className="col-span-2 text-warn">{w}</div>)}
          </div>
        ) : <p className="mt-2 text-[12px] text-dim">Аппараты создаются и сравниваются в разделе «Аппараты».</p>}
        <Link to="/spacecraft" className="mt-3 inline-block text-[12.5px] text-cyan underline decoration-cyan/40 underline-offset-2">Каталог аппаратов →</Link>
      </Section>

      <Section title="Цель посадки" icon="target" testId="sec-target">
        <div className="grid grid-cols-2 gap-3">
          <NumberField spec={TERRAIN_FIELDS.latitude_deg} value={p.targetLat} onChange={(x) => p.onTarget(x, p.targetLon)} error={showErrors ? p.targetErrors.lat : null} disabled={disabled} compact />
          <NumberField spec={TERRAIN_FIELDS.longitude_deg} value={p.targetLon} onChange={(x) => p.onTarget(p.targetLat, x)} error={showErrors ? p.targetErrors.lon : null} disabled={disabled} compact />
        </div>
        <p className="mt-2 text-[12px] text-muted num">{!p.targetErrors.lat && !p.targetErrors.lon ? `${formatLat(Number(p.targetLat))} · ${formatLon(Number(p.targetLon))}` : 'Введите корректные координаты'}</p>
        <Link to="/explorer" className="mt-1 inline-block text-[12.5px] text-cyan underline decoration-cyan/40 underline-offset-2">Выбрать на глобусе →</Link>
      </Section>

      <Section title="Начальные условия" icon="globe" testId="sec-initial">
        <div className="grid grid-cols-2 gap-3">
          <F k="initial_altitude_m" /><F k="initial_speed_m_s" />
          <F k="azimuth_deg" /><F k="flight_path_angle_deg" />
          <div className="col-span-2"><F k="initial_downrange_m" /></div>
        </div>
        <div className="mt-3 rounded-md border border-line bg-space-900 p-2.5 text-[12px]" data-testid="velocity-vector">
          <div className="text-dim">Вектор скорости (местные В, С, Z)</div>
          <div className="num mt-0.5 text-ink">[{fmt(v.e, 2)}, {fmt(v.n, 2)}, {fmt(v.u, 2)}] м/с</div>
        </div>
        <p className="mt-2 text-[11px] text-dim">Курс отсчитывается от севера по часовой; угол −90° — строго вниз. Ориентация аппарата ядром не моделируется (модель материальной точки).</p>
      </Section>

      <Section title="План тяги" icon="play" testId="sec-burn" badge={<Badge>{BURN_RU[f.burnMode]}</Badge>}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><SelectField label="Режим" id="burn-mode" value={f.burnMode} onChange={(m) => set('burnMode', m)} disabled={disabled}
            options={Object.entries(BURN_RU).map(([value, label]) => ({ value: value as ScenarioForm['burnMode'], label }))} /></div>
          {f.burnMode === 'altitude' && <div className="col-span-2"><F k="ignition_altitude_m" /></div>}
          {f.burnMode === 'time' && <div className="col-span-2"><F k="ignition_time_s" /></div>}
          {(f.burnMode === 'altitude' || f.burnMode === 'time') && <><F k="throttle" step="0.05" /><F k="cutoff_speed_m_s" /></>}
          {f.burnMode !== 'none' && <div className="col-span-2"><SelectField label="Направление тяги" value={f.direction} onChange={(x) => set('direction', x)} disabled={disabled}
            options={(['retrograde', 'radial_up'] as const).map((value) => ({ value, label: DIRECTION_RU[value] }))} /></div>}
        </div>
        {f.burnMode === 'schedule' && (
          <div className="mt-3">
            <label htmlFor="schedule" className="mb-1 block text-xs text-muted">Расписание: «время_с, дроссель» в строке (кусочно-постоянно; 0 — двигатель выключен)</label>
            <textarea id="schedule" data-testid="schedule" rows={4} value={f.scheduleText} onChange={(e) => set('scheduleText', e.target.value)} disabled={disabled}
              className={`num w-full rounded-md border bg-space-900 p-2.5 text-[13px] outline-none focus:border-cyan ${showErrors && errors.scheduleText ? 'border-bad' : 'border-line-2'}`} />
            {showErrors && errors.scheduleText && <div className="text-[11px] text-bad">{errors.scheduleText}</div>}
          </div>
        )}
        {f.burnMode === 'altitude' && (
          <div className="mt-3 rounded-md border border-line p-2.5 text-[12px]">
            <Button size="sm" onClick={p.onSuggest} disabled={!p.vehicleId || p.suggesting || disabled} data-testid="suggest-ignition">{p.suggesting ? 'Запрос к ядру…' : 'Подсказать высоту зажигания'}</Button>
            {p.suggestion && (p.suggestion.feasible || p.suggestion.reason) && (
              <div className="mt-2 text-muted" data-testid="suggestion">
                {p.suggestion.feasible ? (<>
                  Зажигание на <span className="num text-ink">{fmt(p.suggestion.ignition_altitude_m, 0)} м</span>, скорость <span className="num">{fmt(p.suggestion.speed_at_ignition_m_s, 1)} м/с</span>, работа <span className="num">{fmt(p.suggestion.burn_time_s, 1)} с</span>, топливо <span className="num">{fmt(p.suggestion.fuel_needed_kg, 1)} / {fmt(p.suggestion.fuel_available_kg, 1)} кг</span>
                  <div className="mt-1.5"><Button size="sm" onClick={() => set('ignition_altitude_m', String(Math.round(p.suggestion?.ignition_altitude_m ?? 0)))}>Применить</Button></div>
                  <div className="mt-1 text-[11px] text-dim">Оценка для вертикального спуска с постоянным замедлением; только подсказка, не закон управления.</div></>) : <span className="text-warn">Невыполнимо: {p.suggestion.reason ?? 'не хватает топлива'}</span>}
              </div>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-dim">Сценарий задан заранее (без обратной связи). Двигатель выключается автоматически при выработке топлива или на скорости отсечки.</p>
      </Section>

      <Section title="Параметры аппарата на этот запуск" icon="edit" defaultOpen={false} testId="sec-overrides" badge={changed ? <Badge tone="warn">изменено</Badge> : undefined}>
        {!vehicle ? <p className="text-[12px] text-dim">Сначала выберите аппарат.</p> : (<>
          <div className="grid grid-cols-2 gap-3">
            <O k="fuel_mass_kg" /><O k="thrust_n" />
            <O k="max_vertical_touchdown_speed_m_s" /><O k="max_horizontal_touchdown_speed_m_s" />
            <O k="max_distance_to_target_m" /><O k="max_tilt_deg" />
            <div className="col-span-2"><O k="max_acceleration_m_s2" /></div>
          </div>
          <p className={`mt-2 text-[11.5px] ${changed ? 'text-warn' : 'text-dim'}`}>
            {changed ? 'Параметры отличаются от сохранённых: при запуске будет создана копия аппарата «' + vehicle.name + ' (для запуска)», исходный не изменится.' : 'Изменения не затрагивают сохранённый аппарат: при запуске создаётся его копия.'}
          </p>
        </>)}
      </Section>

      <Section title="Расчёт" icon="layers" defaultOpen={false} testId="sec-settings">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><SelectField label="Интегратор" value={f.integrator} onChange={(i) => set('integrator', i)} disabled={disabled}
            options={[{ value: 'dop853', label: 'DOP853 (адаптивный, 8-й порядок)' }, { value: 'rk4', label: 'RK4 (фиксированный шаг)' }]} /></div>
          <F k="output_dt_s" />{f.integrator === 'rk4' ? <F k="rk4_step_s" /> : <div />}
          <div className="col-span-2"><F k="max_time_s" /></div>
          <div className="col-span-2"><Toggle checked={f.moon_rotation} onChange={(c) => set('moon_rotation', c)} disabled={disabled} label="Учитывать вращение Луны" hint="Скорости относительно поверхности; Луна делает один оборот за 27,32 суток" /></div>
          <div className="col-span-2"><Toggle checked={f.terrain_enabled} onChange={(c) => set('terrain_enabled', c)} disabled={disabled} label="Связать с реальным DEM" hint="Касание по поверхности DEM и оценка поверхности" /></div>
          {f.terrain_enabled && <div className="col-span-2"><F k="terrain_radius_m" /></div>}
        </div>
      </Section>
    </div>
  )
}

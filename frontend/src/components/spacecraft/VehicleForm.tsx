import { useMemo } from 'react'
import { type SpacecraftForm, spacecraftCrossErrors, spacecraftFieldKeys } from '../../lib/payload'
import { SC_FIELDS, validateAll } from '../../lib/validation'
import { NumberField, Panel, TextField, Toggle } from '../ui/ui'

export function useSpacecraftErrors(f: SpacecraftForm) {
  return useMemo(() => ({ ...validateAll(f as unknown as Record<string, string>, SC_FIELDS, spacecraftFieldKeys(f)), ...spacecraftCrossErrors(f) }), [f])
}

/** Full editor for one vehicle configuration (all values SI; validated here and again by the core). */
export function VehicleForm({ value, onChange, errors, showErrors, isDemo, onDemo }: {
  value: SpacecraftForm; onChange: (f: SpacecraftForm) => void; errors: Record<string, string>; showErrors: boolean; isDemo: boolean; onDemo: (v: boolean) => void
}) {
  const set = <K extends keyof SpacecraftForm>(k: K, v: SpacecraftForm[K]) => onChange({ ...value, [k]: v })
  const F = ({ k, step }: { k: keyof SpacecraftForm & string; step?: string }) => (
    <NumberField spec={SC_FIELDS[k]} value={value[k] as string} onChange={(v) => set(k, v as never)} error={showErrors ? errors[k] : null} step={step} />
  )
  return (
    <div className="space-y-4">
      <Panel title="Идентификация и масса" icon="rocket">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3"><TextField id="f-name" label="Название конфигурации" value={value.name} onChange={(v) => set('name', v)} maxLength={120} error={showErrors ? errors.name : null} /></div>
          <F k="dry_mass_kg" /><F k="fuel_mass_kg" />
          <div className="flex items-end"><Toggle checked={isDemo} onChange={onDemo} label="Пометить как ДЕМО" hint="Демонстрационные конфигурации помечаются во всех списках" /></div>
        </div>
      </Panel>
      <Panel title="Размеры и посадочные опоры" icon="grid">
        <div className="grid gap-4 sm:grid-cols-3"><F k="length_m" /><F k="width_m" /><F k="height_m" /><F k="gear_span_m" /><F k="pad_diameter_m" /><F k="gear_height_m" /></div>
        <p className="mt-3 text-[12px] text-dim">Радиус пятна посадки = база/2 + тарелка/2 (используется как минимальный радиус площадки). Статический угол опрокидывания = atan((база/2) / высота ЦМ); оба значения считает ядро.</p>
      </Panel>
      <Panel title="Двигательная установка" icon="play">
        <div className="grid gap-4 sm:grid-cols-3">
          <F k="thrust_n" /><F k="number_of_engines" step="1" />
          <div>
            <label className="mb-1 block text-xs text-muted">Расход задан через</label>
            <div className="flex gap-1.5">
              {(['isp', 'mass_flow'] as const).map((m) => (
                <button key={m} type="button" onClick={() => set('flowMode', m)} data-testid={`flow-${m}`} aria-pressed={value.flowMode === m}
                  className={`min-h-10 flex-1 rounded-md border px-2 text-[13px] ${value.flowMode === m ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line-2 text-muted hover:text-ink'}`}>{m === 'isp' ? 'Удельный импульс' : 'Расход топлива'}</button>
              ))}
            </div>
          </div>
          {value.flowMode === 'isp' ? <F k="isp_s" /> : <F k="fuel_consumption_kg_s" />}
          <F k="throttle_min" step="0.05" /><F k="throttle_max" step="0.05" />
        </div>
        <p className="mt-3 text-[12px] text-dim">Уровень тяги при снижении задаётся планом тяги в сценарии (постоянная, по расписанию, с отсечкой); ядро ограничивает его пределами дросселя.</p>
      </Panel>
      <Panel title="Ограничения посадки (ваши лимиты)" icon="alert">
        <div className="grid gap-4 sm:grid-cols-3"><F k="max_vertical_touchdown_speed_m_s" /><F k="max_horizontal_touchdown_speed_m_s" /><F k="max_distance_to_target_m" /><F k="max_tilt_deg" /><F k="max_acceleration_m_s2" /></div>
        <p className="mt-3 text-[12px] text-dim">Это лимиты, которые задаёте ВЫ для своего аппарата. Начальные значения — условные примеры из ТЗ, а не проверенные характеристики реального аппарата.</p>
      </Panel>
    </div>
  )
}

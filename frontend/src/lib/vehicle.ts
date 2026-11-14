import type { Spacecraft, SpacecraftPayload } from '../api/types'
import { parseNum } from './validation'

/** Per-run overrides of a saved vehicle (strings, as typed). Saved as a COPY of the vehicle when they differ. */
export interface Overrides {
  fuel_mass_kg: string; thrust_n: string
  max_vertical_touchdown_speed_m_s: string; max_horizontal_touchdown_speed_m_s: string
  max_distance_to_target_m: string; max_tilt_deg: string; max_acceleration_m_s2: string
}
export const OVERRIDE_KEYS: (keyof Overrides)[] = ['fuel_mass_kg', 'thrust_n', 'max_vertical_touchdown_speed_m_s', 'max_horizontal_touchdown_speed_m_s', 'max_distance_to_target_m', 'max_tilt_deg', 'max_acceleration_m_s2']

const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

export function overridesFrom(v: Spacecraft): Overrides {
  return {
    fuel_mass_kg: s(v.fuel_mass_kg), thrust_n: s(v.engine.thrust_n),
    max_vertical_touchdown_speed_m_s: s(v.constraints.max_vertical_touchdown_speed_m_s), max_horizontal_touchdown_speed_m_s: s(v.constraints.max_horizontal_touchdown_speed_m_s),
    max_distance_to_target_m: s(v.constraints.max_distance_to_target_m), max_tilt_deg: s(v.constraints.max_tilt_deg), max_acceleration_m_s2: s(v.constraints.max_acceleration_m_s2),
  }
}

export function payloadFromSpacecraft(v: Spacecraft): SpacecraftPayload {
  return { name: v.name, dry_mass_kg: v.dry_mass_kg, fuel_mass_kg: v.fuel_mass_kg, dimensions: v.dimensions, landing_gear: v.landing_gear, engine: v.engine, constraints: v.constraints }
}

export function applyOverrides(v: Spacecraft, o: Overrides): SpacecraftPayload {
  const p = payloadFromSpacecraft(v)
  return {
    ...p,
    fuel_mass_kg: parseNum(o.fuel_mass_kg) ?? p.fuel_mass_kg,
    engine: { ...p.engine, thrust_n: parseNum(o.thrust_n) ?? p.engine.thrust_n },
    constraints: {
      max_vertical_touchdown_speed_m_s: parseNum(o.max_vertical_touchdown_speed_m_s) ?? p.constraints.max_vertical_touchdown_speed_m_s,
      max_horizontal_touchdown_speed_m_s: parseNum(o.max_horizontal_touchdown_speed_m_s) ?? p.constraints.max_horizontal_touchdown_speed_m_s,
      max_distance_to_target_m: parseNum(o.max_distance_to_target_m) ?? p.constraints.max_distance_to_target_m,
      max_tilt_deg: parseNum(o.max_tilt_deg), max_acceleration_m_s2: parseNum(o.max_acceleration_m_s2),
    },
  }
}

export function overridesDiffer(v: Spacecraft, o: Overrides): boolean {
  const base = overridesFrom(v)
  return OVERRIDE_KEYS.some((k) => (parseNum(base[k]) ?? null) !== (parseNum(o[k]) ?? null))
}

/** Demonstration configurations (illustrative values, NOT real spacecraft). */
export interface Preset { id: string; title: string; description: string; payload: SpacecraftPayload }
const base = { throttle_min: 0, throttle_max: 1 }
const cons = { max_vertical_touchdown_speed_m_s: 2, max_horizontal_touchdown_speed_m_s: 1, max_tilt_deg: null, max_acceleration_m_s2: null, max_distance_to_target_m: 100 }
export const DEMO_PRESETS: Preset[] = [
  { id: 'brief', title: 'Условный аппарат из ТЗ', description: 'Пример из технического задания проекта: 900 кг + 300 кг топлива, один двигатель 5 кН.',
    payload: { name: 'ДЕМО · Условный аппарат из ТЗ', dry_mass_kg: 900, fuel_mass_kg: 300, dimensions: { length_m: 3, width_m: 3, height_m: 4 },
      landing_gear: { span_m: 5, pad_diameter_m: 0.3, gear_height_m: 0.5, cg_height_m: null }, engine: { thrust_n: 5000, number_of_engines: 1, isp_s: 300, fuel_consumption_kg_s: null, ...base }, constraints: cons } },
  { id: 'light', title: 'Лёгкий демонстратор', description: 'Малый аппарат: 250 кг + 120 кг топлива, один двигатель 1,5 кН, база опор 2,4 м.',
    payload: { name: 'ДЕМО · Лёгкий демонстратор', dry_mass_kg: 250, fuel_mass_kg: 120, dimensions: { length_m: 1.5, width_m: 1.5, height_m: 2 },
      landing_gear: { span_m: 2.4, pad_diameter_m: 0.2, gear_height_m: 0.4, cg_height_m: null }, engine: { thrust_n: 1500, number_of_engines: 1, isp_s: 290, fuel_consumption_kg_s: null, ...base }, constraints: { ...cons, max_distance_to_target_m: 50 } } },
  { id: 'heavy', title: 'Тяжёлый грузовой', description: 'Условный крупный аппарат: 3 500 кг + 2 500 кг топлива, четыре двигателя по 6 кН, база опор 8 м.',
    payload: { name: 'ДЕМО · Тяжёлый грузовой', dry_mass_kg: 3500, fuel_mass_kg: 2500, dimensions: { length_m: 4.5, width_m: 4.5, height_m: 5.5 },
      landing_gear: { span_m: 8, pad_diameter_m: 0.6, gear_height_m: 0.9, cg_height_m: null }, engine: { thrust_n: 6000, number_of_engines: 4, isp_s: 315, fuel_consumption_kg_s: null, ...base }, constraints: { ...cons, max_vertical_touchdown_speed_m_s: 1.5, max_distance_to_target_m: 150 } } },
]

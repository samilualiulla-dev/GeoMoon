// Declarative field specs: unit, bounds, WHERE THE BOUND COMES FROM, and a validator. The UI shows `origin`
// next to each limit so no constraint is arbitrary. "api" = enforced by the GeoMoon core schema.
export type Origin = 'api' | 'physics' | 'ui'

export interface FieldSpec {
  key: string
  label: string
  unit: string
  min?: number
  max?: number
  minExclusive?: boolean
  integer?: boolean
  optional?: boolean
  origin: Origin
  help: string
}

export function validateNumber(raw: string, spec: FieldSpec): string | null {
  const s = raw.trim()
  if (s === '') return spec.optional ? null : 'Обязательное поле'
  const v = Number(s.replace(',', '.'))
  if (!Number.isFinite(v)) return 'Должно быть числом'
  if (spec.integer && !Number.isInteger(v)) return 'Должно быть целым числом'
  if (spec.min !== undefined && (spec.minExclusive ? v <= spec.min : v < spec.min)) return `Должно быть ${spec.minExclusive ? '>' : '≥'} ${spec.min} ${spec.unit}`.trim()
  if (spec.max !== undefined && v > spec.max) return `Должно быть ≤ ${spec.max} ${spec.unit}`.trim()
  return null
}

export function parseNum(raw: string): number | null {
  const s = raw.trim()
  if (s === '') return null
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

export const ORIGIN_LABEL: Record<Origin, string> = {
  api: 'предел задан схемой API ядра GeoMoon',
  physics: 'физическое требование (значение должно иметь физический смысл)',
  ui: 'только ограничение формата ввода',
}

const A = 'api' as const, P = 'physics' as const

export const SC_FIELDS: Record<string, FieldSpec> = {
  dry_mass_kg: { key: 'dry_mass_kg', label: 'Сухая масса', unit: 'кг', min: 0, minExclusive: true, max: 1e7, origin: A, help: 'Масса аппарата без топлива. Должна быть > 0 (физика); верхняя граница — предел API.' },
  fuel_mass_kg: { key: 'fuel_mass_kg', label: 'Масса топлива', unit: 'кг', min: 0, max: 1e7, origin: A, help: 'Доступный запас топлива. 0 = неуправляемое баллистическое снижение.' },
  length_m: { key: 'length_m', label: 'Длина корпуса', unit: 'м', min: 0, minExclusive: true, max: 100, origin: A, help: 'Длина корпуса.' },
  width_m: { key: 'width_m', label: 'Ширина корпуса', unit: 'м', min: 0, minExclusive: true, max: 100, origin: A, help: 'Ширина корпуса.' },
  height_m: { key: 'height_m', label: 'Высота корпуса', unit: 'м', min: 0, minExclusive: true, max: 100, origin: A, help: 'Высота корпуса (используется для оценки центра масс по умолчанию).' },
  gear_span_m: { key: 'gear_span_m', label: 'База опор (диаметр)', unit: 'м', min: 0, minExclusive: true, max: 100, origin: A, help: 'Диаметр окружности через посадочные опоры. Определяет радиус пятна посадки и статический угол опрокидывания.' },
  pad_diameter_m: { key: 'pad_diameter_m', label: 'Диаметр опорной тарелки', unit: 'м', min: 0, minExclusive: true, max: 10, origin: A, help: 'Размер опорной тарелки (добавляется к радиусу пятна посадки).' },
  gear_height_m: { key: 'gear_height_m', label: 'Клиренс корпуса', unit: 'м', min: 0, max: 20, origin: A, help: 'Просвет под корпусом на опорах; с ним сравнивается перепад рельефа в пятне посадки.' },
  thrust_n: { key: 'thrust_n', label: 'Тяга одного двигателя', unit: 'Н', min: 0, minExclusive: true, max: 1e8, origin: A, help: 'Вакуумная тяга ОДНОГО двигателя при полном дросселе.' },
  number_of_engines: { key: 'number_of_engines', label: 'Число двигателей', unit: '', min: 1, max: 64, integer: true, origin: A, help: 'Одинаковые двигатели; суммарная тяга = тяга × число.' },
  isp_s: { key: 'isp_s', label: 'Удельный импульс', unit: 'с', min: 0, minExclusive: true, max: 1000, origin: A, help: 'Isp; расход = F / (Isp·g0).' },
  fuel_consumption_kg_s: { key: 'fuel_consumption_kg_s', label: 'Расход топлива (все двигатели, 100 %)', unit: 'кг/с', min: 0, minExclusive: true, origin: P, help: 'Суммарный расход при полном дросселе; ядро вычисляет Isp = F/(ṁ·g0).' },
  throttle_min: { key: 'throttle_min', label: 'Мин. дроссель (при работе)', unit: '0–1', min: 0, max: 1, origin: A, help: 'Наименьшая доля тяги при включённом двигателе.' },
  throttle_max: { key: 'throttle_max', label: 'Макс. дроссель', unit: '0–1', min: 0, minExclusive: true, max: 1, origin: A, help: 'Наибольшая доля тяги.' },
  max_vertical_touchdown_speed_m_s: { key: 'max_vertical_touchdown_speed_m_s', label: 'Макс. вертикальная скорость касания', unit: 'м/с', min: 0, minExclusive: true, max: 100, origin: A, help: 'Предел шасси — задайте по ВАШЕМУ аппарату. Значение по умолчанию (2 м/с) — условный пример, а не сертифицированная величина.' },
  max_horizontal_touchdown_speed_m_s: { key: 'max_horizontal_touchdown_speed_m_s', label: 'Макс. горизонтальная скорость касания', unit: 'м/с', min: 0, max: 100, origin: A, help: 'Значение по умолчанию (1 м/с) — условный пример.' },
  max_tilt_deg: { key: 'max_tilt_deg', label: 'Макс. допустимый уклон площадки', unit: '°', min: 0, minExclusive: true, max: 89.99, optional: true, origin: A, help: 'Уклон, который выдерживает аппарат. Пусто = статический угол опрокидывания atan((база/2) / высота ЦМ).' },
  max_acceleration_m_s2: { key: 'max_acceleration_m_s2', label: 'Макс. ускорение', unit: 'м/с²', min: 0, minExclusive: true, optional: true, origin: P, help: 'Предел по прочности/полезной нагрузке для ускорения от тяги. Пусто = не оценивается.' },
  max_distance_to_target_m: { key: 'max_distance_to_target_m', label: 'Макс. промах от цели', unit: 'м', min: 0, minExclusive: true, origin: A, help: 'Допустимое расстояние между точкой касания и целью.' },
}

export const SCENARIO_FIELDS: Record<string, FieldSpec> = {
  initial_altitude_m: { key: 'initial_altitude_m', label: 'Начальная высота над поверхностью', unit: 'м', min: 0, minExclusive: true, max: 5e6, origin: A, help: 'Высота над местной поверхностью в начальной точке.' },
  initial_speed_m_s: { key: 'initial_speed_m_s', label: 'Начальная скорость (относительно поверхности)', unit: 'м/с', min: 0, max: 5000, origin: A, help: 'Скорость относительно вращающейся поверхности Луны.' },
  azimuth_deg: { key: 'azimuth_deg', label: 'Курс (азимут от севера, по часовой)', unit: '°', min: -360, max: 360, origin: A, help: 'Горизонтальное направление движения.' },
  flight_path_angle_deg: { key: 'flight_path_angle_deg', label: 'Угол траектории', unit: '°', min: -90, max: 90, origin: A, help: '−90 = строго вниз, 0 = горизонтально, + = набор высоты.' },
  initial_downrange_m: { key: 'initial_downrange_m', label: 'Смещение старта от цели', unit: 'м', min: 0, max: 1e7, origin: A, help: 'Расстояние по поверхности от цели назад вдоль −курса.' },
  ignition_altitude_m: { key: 'ignition_altitude_m', label: 'Высота зажигания', unit: 'м', min: 0, minExclusive: true, origin: A, help: 'Сценарий без обратной связи: двигатель включается, когда высота над поверхностью ≤ этого значения.' },
  ignition_time_s: { key: 'ignition_time_s', label: 'Время зажигания', unit: 'с', min: 0, origin: A, help: 'Двигатель включается в этот момент времени.' },
  throttle: { key: 'throttle', label: 'Дроссель', unit: '0–1', min: 0, max: 1, origin: A, help: 'Заданная доля тяги (ядро ограничивает её пределами двигателя).' },
  cutoff_speed_m_s: { key: 'cutoff_speed_m_s', label: 'Скорость отсечки двигателя', unit: 'м/с', min: 0, optional: true, origin: A, help: 'Двигатель выключается, когда скорость относительно поверхности падает ниже этого значения. Пусто = работать до выработки топлива.' },
  output_dt_s: { key: 'output_dt_s', label: 'Шаг вывода', unit: 'с', min: 0, minExclusive: true, max: 600, origin: A, help: 'Шаг дискретизации временного ряда (разрешение телеметрии).' },
  rk4_step_s: { key: 'rk4_step_s', label: 'Шаг RK4', unit: 'с', min: 0, minExclusive: true, max: 10, origin: A, help: 'Фиксированный шаг интегрирования при методе RK4.' },
  max_time_s: { key: 'max_time_s', label: 'Макс. время симуляции', unit: 'с', min: 0, minExclusive: true, max: 86400, origin: A, help: 'Остановить, если аппарат не сел за это время.' },
  terrain_radius_m: { key: 'terrain_radius_m', label: 'Радиус окна рельефа', unit: 'м', min: 1, max: 50000, origin: A, help: 'Радиус окна реального DEM для касания и оценки посадки. Ядро расширит его, если окно слишком мало для разрешения DEM.' },
}

export const TERRAIN_FIELDS: Record<string, FieldSpec> = {
  latitude_deg: { key: 'latitude_deg', label: 'Широта', unit: '°', min: -90, max: 90, origin: P, help: 'Планетоцентрическая широта, север — положительная.' },
  longitude_deg: { key: 'longitude_deg', label: 'Долгота', unit: '°', min: -180, max: 360, origin: A, help: 'Восточная долгота положительна; значения до 360 приводятся ядром к [−180, 180).' },
  radius_m: { key: 'radius_m', label: 'Радиус анализа', unit: 'м', min: 1, max: 200000, origin: A, help: 'Половина ширины анализируемого окна. Окно должно содержать не менее 3×3 ячеек DEM.' },
  slope_limit_deg: { key: 'slope_limit_deg', label: 'Допустимый уклон', unit: '°', min: 0, minExclusive: true, max: 89.99, origin: A, help: 'Уклон, при котором оценка уклона падает до 0 и ячейка считается крутой.' },
  footprint_radius_m: { key: 'footprint_radius_m', label: 'Мин. радиус площадки', unit: 'м', min: 0, minExclusive: true, max: 1000, origin: A, help: 'Весь круг такого радиуса должен быть пригодным и без опасностей. «Взять из аппарата» подставляет значение выбранного аппарата.' },
  window_m: { key: 'window_m', label: 'Окно анализа', unit: 'м', min: 0, minExclusive: true, max: 5000, origin: A, help: 'Размер окрестности для шероховатости, локального рельефа и топографической позиции.' },
  roughness_limit_m: { key: 'roughness_limit_m', label: 'Предел шероховатости', unit: 'м', min: 0, minExclusive: true, origin: A, help: 'СКО отклонений от плоскости, при котором оценка шероховатости падает до 0.' },
  relief_limit_m: { key: 'relief_limit_m', label: 'Предел локального рельефа', unit: 'м', min: 0, minExclusive: true, origin: A, help: 'Перепад max − min в окне, при котором оценка рельефа падает до 0.' },
  tpi_limit_m: { key: 'tpi_limit_m', label: 'Предел топографической аномалии', unit: 'м', min: 0, minExclusive: true, origin: A, help: '|z − среднее в окне|, выше которого ячейка помечается (дно/вал кратера, бугор).' },
  hazard_safe_distance_m: { key: 'hazard_safe_distance_m', label: 'Безопасная дистанция до опасностей', unit: 'м', min: 0, minExclusive: true, origin: A, help: 'Расстояние до ближайшей опасности, при котором оценка близости равна 1.' },
  suitable_threshold: { key: 'suitable_threshold', label: 'Порог пригодности', unit: '0–1', min: 0, minExclusive: true, max: 1, origin: A, help: 'Минимальная взвешенная оценка, при которой ячейка считается пригодной.' },
  max_candidates: { key: 'max_candidates', label: 'Макс. число кандидатов', unit: '', min: 1, max: 50, integer: true, origin: A, help: 'Сколько ранжированных площадок вернуть.' },
}

export function validateAll(values: Record<string, string>, specs: Record<string, FieldSpec>, keys?: string[]): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const k of keys ?? Object.keys(specs)) {
    const spec = specs[k]
    if (!spec) continue
    const e = validateNumber(values[k] ?? '', spec)
    if (e) errs[k] = e
  }
  return errs
}

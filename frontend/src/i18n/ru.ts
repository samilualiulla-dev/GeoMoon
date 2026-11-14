// Russian UI vocabulary + translation of the core's (English) messages.
// Numbers, units and identifiers are never altered: only phrasing is translated; unknown messages are shown as received.

export const STATUS_RU: Record<string, string> = {
  within_limits: 'в пределах лимитов', outside_limits: 'за пределами лимитов', not_assessed: 'не оценивалось',
  no_terrain_data: 'нет данных рельефа', no_touchdown: 'посадки не произошло', touchdown_outside_analysed_region: 'точка касания вне окна анализа',
}
export const OVERALL_RU: Record<string, string> = {
  limits_exceeded: 'Лимиты превышены', within_all_assessed_limits: 'В пределах всех оценённых лимитов',
  insufficient_data_or_not_fully_assessed: 'Оценка неполная',
}
export const CLASS_RU: Record<string, string> = {
  geometrically_suitable: 'геометрически пригодна', geometrically_unsuitable: 'геометрически непригодна', insufficient_data: 'недостаточно данных',
}
export const TERMINATION_RU: Record<string, string> = { touchdown: 'касание поверхности', max_time_reached: 'достигнуто макс. время' }
export const QUANTITY_RU: Record<string, string> = { elevation: 'высота (DEM)', roughness: 'шероховатость', slope: 'уклон', other: 'другое' }
export const EVENT_RU: Record<string, string> = {
  ignition: 'зажигание двигателя', touchdown: 'касание', fuel_exhausted: 'топливо выработано', cutoff_speed: 'отсечка по скорости', throttle_set: 'смена тяги',
}
export const BURN_RU: Record<string, string> = { none: 'без тяги (баллистика)', altitude: 'зажигание по высоте', time: 'зажигание по времени', schedule: 'расписание тяги' }
export const DIRECTION_RU: Record<string, string> = { retrograde: 'против скорости (ретроград)', radial_up: 'по местной вертикали', fixed_enu: 'фиксированное (ENU)' }
export const COMPONENT_RU: Record<string, string> = { slope: 'Уклон', roughness: 'Шероховатость', relief: 'Локальный рельеф', hazard: 'Близость опасностей' }
export const UNCERTAINTY_RU: Record<string, string> = { high: 'высокая', moderate: 'умеренная', not_applicable_synthetic_terrain: 'неприменимо (синтетический рельеф)' }
export const DEM_STATUS_RU: Record<string, string> = { available: 'доступен', synthetic_demo: 'синтетический (тест)', missing: 'файл отсутствует' }
export const SIM_STATUS_RU: Record<string, string> = { created: 'создана', queued: 'в очереди', running: 'выполняется', completed: 'завершена', failed: 'ошибка', idle: 'ожидание' }
export const PLAY_RU: Record<string, string> = { idle: 'ожидание', playing: 'воспроизведение', paused: 'пауза', finished: 'завершено' }

const CHECK_RU: Record<string, string> = {
  'vertical touchdown speed': 'вертикальная скорость касания', 'horizontal touchdown speed': 'горизонтальная скорость касания',
  'miss distance from target': 'промах относительно цели', 'footprint best-fit plane tilt': 'наклон плоскости под опорами',
  'max local slope within footprint': 'макс. локальный уклон в пятне посадки', 'relief within footprint vs gear clearance': 'перепад высот в пятне vs клиренс',
  'data coverage within footprint (missing fraction)': 'доля пропусков данных в пятне посадки', 'peak thrust acceleration': 'пиковое ускорение от тяги',
  'remaining fuel (>= 0)': 'остаток топлива (≥ 0)',
}
export const trCheck = (s: string) => CHECK_RU[s] ?? s

const EXACT: Record<string, string> = {
  'Simplified 3-DOF model without attitude control, gravity harmonics or guidance.': 'Упрощённая модель 3-DOF: без управления ориентацией, гармоник гравитации и наведения.',
  'DEM-derived metrics cannot resolve boulders/craters smaller than ~2 cells.': 'Метрики по DEM не разрешают валуны и кратеры мельче ~2 ячеек.',
  'SYNTHETIC TERRAIN: surface results are not real lunar data.': 'СИНТЕТИЧЕСКИЙ РЕЛЬЕФ: результаты по поверхности не относятся к реальной Луне.',
  'This is an analytical research estimate, not a certified landing-safety assessment or probability.': 'Это аналитическая исследовательская оценка, а не сертифицированная оценка или вероятность безопасности посадки.',
  'Point-mass 3-DOF model: attitude is not simulated; thrust points along the commanded direction instantly.': 'Модель материальной точки 3-DOF: ориентация не моделируется; тяга мгновенно направлена по заданному направлению.',
  'Central-body gravity mu/r^2 only (no gravity harmonics/mascons, no third-body forces).': 'Только центральная гравитация μ/r² (без гармоник и масконов, без возмущений от третьих тел).',
  'Spherical Moon of radius 1737.4 km; DEM heights are measured from this reference sphere.': 'Сферическая Луна радиусом 1737,4 км; высоты DEM отсчитываются от этой сферы.',
  'Open-loop burn scenario supplied by the user; no guidance, navigation or control law is simulated.': 'Сценарий тяги задан пользователем (разомкнутый контур); наведение, навигация и законы управления не моделируются.',
  'No atmosphere (lunar exosphere drag neglected).': 'Атмосферы нет (сопротивление экзосферы не учитывается).',
  'Constant-Isp engine; no start-up/shut-down transients or throttle rate limits.': 'Двигатель с постоянным Isp; без переходных процессов запуска/остановки и ограничений скорости дросселирования.',
  'Result is a simplified-model estimate; it is not operational flight software and not a proof of landing safety.': 'Результат получен по упрощённой модели; это не полётное ПО и не доказательство безопасности посадки.',
  'Surface contact uses DEM height at the ground track where DEM coverage exists, otherwise the target elevation.': 'Контакт с поверхностью считается по высоте DEM под траекторией там, где есть покрытие, иначе по высоте цели.',
  'Fuel was exhausted during the burn.': 'Топливо закончилось во время работы двигателя.',
  'Vehicle did not reach the surface within max_time_s.': 'Аппарат не достиг поверхности за максимальное время симуляции.',
  'Vehicle did not reach the surface before max_time_s.': 'Аппарат не достиг поверхности за максимальное время симуляции.',
  'No real DEM available at the touchdown point; surface not assessed.': 'В точке касания нет реального DEM: поверхность не оценивалась.',
  'Touchdown point lies outside the analysed DEM window; enlarge the analysis radius.': 'Точка касания вне окна анализа DEM; увеличьте радиус окна.',
  'Terrain data around the touchdown point are incomplete (missing cells or window touches the patch edge).': 'Данные рельефа вокруг точки касания неполные (пропуски или окно упирается в край фрагмента).',
  'Touchdown cell is classified geometrically unsuitable by the terrain analysis (see explanation).': 'Анализ рельефа классифицировал точку касания как геометрически непригодную (см. объяснение).',
  'max_acceleration_m_s2 not set by user: acceleration limit not assessed.': 'Ограничение ускорения не задано: оценка по ускорению не проводилась.',
  'At least one checked limit was exceeded - see the issue list.': 'Превышен хотя бы один проверяемый лимит — см. список проблем.',
  'All assessed limits were met in this simplified model; this does NOT guarantee a safe landing.': 'В этой упрощённой модели все оценённые лимиты соблюдены; это НЕ гарантирует безопасную посадку.',
  'Some domains lack data or limits, so the result is incomplete.': 'Для части областей нет данных или лимитов, поэтому результат неполный.',
  'Geometric suitability estimate from DEM data; not a certified landing-safety probability.': 'Геометрическая оценка пригодности по DEM; это не сертифицированная вероятность безопасной посадки.',
  'Suitability is a geometric DEM-based estimate, not a landing-safety probability.': 'Пригодность — геометрическая оценка по DEM, а не вероятность безопасной посадки.',
  'SYNTHETIC TEST TERRAIN - NOT REAL LUNAR DATA': 'СИНТЕТИЧЕСКИЙ ТЕСТОВЫЙ РЕЛЬЕФ — НЕ РЕАЛЬНЫЕ ДАННЫЕ ЛУНЫ',
  'Real dataset; see citation': 'Реальный набор данных; см. цитирование',
  'SYNTHETIC TEST/DEMO TERRAIN - NOT NASA OR ANY REAL LUNAR DATA': 'СИНТЕТИЧЕСКИЙ ТЕСТОВЫЙ РЕЛЬЕФ — НЕ ДАННЫЕ NASA И НЕ РЕАЛЬНАЯ ЛУНА',
  'Thrust-to-weight at lunar gravity is': 'Тяговооружённость',
}

type Rule = [RegExp, (m: RegExpMatchArray) => string]
const RULES: Rule[] = [
  [/^(.+): (-?[\d.eE+-]+) (\S*) exceeds (?:limit )?(-?[\d.eE+-]+)$/, (m) => `${trCheck(m[1])}: ${m[2]} ${m[3]} превышает лимит ${m[4]}`],
  [/^Surface: (\S+); Trajectory: (\S+); Vehicle: (\S+)\. (.*)$/, (m) => `Поверхность: ${STATUS_RU[m[1]] ?? m[1]}; траектория: ${STATUS_RU[m[2]] ?? m[2]}; аппарат: ${STATUS_RU[m[3]] ?? m[3]}. ${tr(m[4])}`],
  [/^(slope|roughness|relief|hazard): no data \(window touches missing cells or patch edge\)$/, (m) => `${COMPONENT_RU[m[1]]}: нет данных (окно задевает пропуски или край фрагмента)`],
  [/^(slope|roughness|relief|hazard) is a limiting factor: (.+) vs limit (.+) \(score (.+)\)$/, (m) => `${COMPONENT_RU[m[1]]} — ограничивающий фактор: ${m[2]} при лимите ${m[3]} (оценка ${m[4]})`],
  [/^cell flagged by hazard detectors: (.+)$/, (m) => `ячейка помечена детекторами опасностей: ${m[1].split(', ').map((x) => HAZ_RU[x] ?? x).join(', ')}`],
  [/^DEM cell size \((.+) m\) is larger than the landing footprint radius \((.+) m\): slope, roughness and hazard values are regional averages and cannot show whether the footprint fits\. Use a finer DEM for site selection\.$/,
    (m) => `Размер ячейки DEM (${m[1]} м) больше радиуса пятна посадки (${m[2]} м): уклон, шероховатость и опасности — региональные средние и не показывают, помещается ли площадка. Для выбора площадки нужен более детальный DEM.`],
  [/^At (.+) m\/cell craters and slopes smaller than ~(.+) m are not resolved; results are regional-scale context only\.$/,
    (m) => `При ${m[1]} м на ячейку кратеры и склоны мельче ~${m[2]} м не разрешаются; результаты — только региональный контекст.`],
  [/^DEM cell size \((.+) m\) is larger than the vehicle footprint radius \((.+) m\): the terrain under the landing gear is not resolved.*$/,
    (m) => `Размер ячейки DEM (${m[1]} м) больше радиуса пятна аппарата (${m[2]} м): рельеф под опорами не разрешается, значения — региональные средние, пригодность поверхности подтвердить нельзя. Нужен DEM с более мелким шагом.`],
  [/^DEM resolution \((.+) m\/cell\) is coarser than the landing footprint \((.+) m radius\): surface suitability at the touchdown point is not resolved\.$/,
    (m) => `Разрешение DEM (${m[1]} м/ячейка) грубее пятна посадки (радиус ${m[2]} м): пригодность поверхности в точке касания не разрешается.`],
  [/^Terrain window enlarged from (.+) m to (.+) m radius: dataset '(.+)' has ~(.+) m cells.*$/,
    (m) => `Окно рельефа увеличено с ${m[1]} м до ${m[2]} м радиуса: у набора «${m[3]}» ячейки ~${m[4]} м, и запрошенное окно содержало слишком мало ячеек. При таком разрешении оценка места касания — только региональная.`],
  [/^Terrain not available - trajectory computed without DEM, surface not assessed: (.+)$/, (m) => `Рельеф недоступен — траектория рассчитана без DEM, поверхность не оценивалась: ${tr(m[1])}`],
  [/^Thrust-to-weight at lunar gravity is (.+) < 1: the vehicle cannot hover or arrest descent against gravity\.$/, (m) => `Тяговооружённость у поверхности Луны ${m[1]} < 1: аппарат не сможет зависнуть или погасить снижение против гравитации.`],
  [/^fuel_mass_kg is 0: unpowered ballistic descent\.$/, () => 'Масса топлива равна 0: неуправляемое баллистическое снижение.'],
  [/^initial speed is 0: azimuth\/flight_path_angle have no effect$/, () => 'Начальная скорость равна 0: азимут и угол траектории ни на что не влияют.'],
  [/^No installed real DEM covers lat=(.+), lon=(.+)$/, (m) => `Ни один установленный реальный DEM не покрывает точку широта=${m[1]}, долгота=${m[2]}`],
  [/^No real DEM covers this point\..*$/, () => 'Эту точку не покрывает ни один реальный DEM. См. «Источники данных».'],
  [/^The region \(radius (.+) m\) is smaller than 3x3 cells of dataset '(.+)' \(one cell is about (.+) m\)\. Use radius_m >= (.+) m \(recommended ~(.+) m\)\.$/,
    (m) => `Регион (радиус ${m[1]} м) меньше 3×3 ячеек набора «${m[2]}» (одна ячейка ≈ ${m[3]} м). Задайте радиус не менее ${m[4]} м (рекомендуется ≈ ${m[5]} м).`],
  [/^Dataset '(.+)' is a (.+) product, not elevation; it cannot be used as a DEM$/, (m) => `Набор «${m[1]}» — это продукт «${QUANTITY_RU[m[2]] ?? m[2]}», а не высоты; использовать его как DEM нельзя.`],
  [/^Dataset '(.+)' is SYNTHETIC test data; pass allow_synthetic=true to use it knowingly\.$/, (m) => `Набор «${m[1]}» — СИНТЕТИЧЕСКИЕ тестовые данные; включите «Разрешить синтетику», чтобы использовать их осознанно.`],
  [/^Dataset '(.+)' is not installed$/, (m) => `Набор данных «${m[1]}» не установлен`],
  [/^No global elevation dataset is installed.*$/, () => 'Не установлен глобальный набор высот (например, LOLA LDEM_16 / LDEM_64).'],
  [/^Point lat=(.+), lon=(.+) lies outside dataset '(.+)' .*coverage$/, (m) => `Точка (${m[1]}, ${m[2]}) вне покрытия набора «${m[3]}»`],
  [/^No valid elevation data at this point$/, () => 'В этой точке нет корректных данных высоты'],
  [/^Request validation failed$/, () => 'Ошибка проверки запроса'],
  [/^Cannot reach the GeoMoon core\. Is the backend running\? \((.+)\)$/, (m) => `Нет связи с ядром GeoMoon. Запущен ли бэкенд? (${m[1]})`],
  [/^spacecraft (\d+) is used by (\d+) simulation\(s\) and (\d+) mission\(s\) and cannot be edited; save a copy instead$/, (m) => `Аппарат №${m[1]} используется в симуляциях (${m[2]}) и миссиях (${m[3]}), поэтому его нельзя изменить; сохраните копию.`],
  [/^spacecraft (\d+) is used by (\d+) simulation\(s\) and (\d+) mission\(s\) and cannot be deleted$/, (m) => `Аппарат №${m[1]} используется в симуляциях (${m[2]}) и миссиях (${m[3]}), поэтому его нельзя удалить.`],
  [/^region '(.+)' exists$/, (m) => `Регион «${m[1]}» уже существует`], [/^mission '(.+)' exists$/, (m) => `Миссия «${m[1]}» уже существует`],
  [/^(spacecraft|simulation|mission|region|analysis) (\d+) not found$/, (m) => `Не найдено: ${({ spacecraft: 'аппарат', simulation: 'симуляция', mission: 'миссия', region: 'регион', analysis: 'анализ' } as Record<string, string>)[m[1]]} №${m[2]}`],
  [/^simulation (\d+) is (\w+); results not available$/, (m) => `Симуляция №${m[1]}: статус «${SIM_STATUS_RU[m[2]] ?? m[2]}», результатов пока нет`],
  [/^metadata key '(.+)' not provided$/, (m) => `в метаданных нет ключа «${m[1]}»`],
  [/^This raster is a '(.+)' product, not elevation: it is listed for provenance but never used as a DEM$/, (m) => `Этот растр — продукт «${QUANTITY_RU[m[1]] ?? m[1]}», а не высоты: он показан для справки и никогда не используется как DEM.`],
  [/^Burn requested but fuel_mass_kg is 0$/, () => 'Запрошена работа двигателя, но масса топлива равна 0'],
  [/^burn throttle (.+) below engine throttle_min (.+)$/, (m) => `Дроссель плана тяги (${m[1]}) ниже минимального дросселя двигателя (${m[2]})`],
  [/^burn throttle (.+) above engine throttle_max (.+)$/, (m) => `Дроссель плана тяги (${m[1]}) выше максимального дросселя двигателя (${m[2]})`],
]
const HAZ_RU: Record<string, string> = { steep_slope: 'крутой склон', elevation_discontinuity: 'разрыв высот', rough_surface: 'неровная поверхность', topographic_anomaly: 'топографическая аномалия' }

/** Translate a message coming from the core; returns the original text if unknown. */
export function tr(text: string | null | undefined): string {
  if (!text) return text ?? ''
  if (EXACT[text]) return EXACT[text]
  for (const [re, fn] of RULES) { const m = text.match(re); if (m) return fn(m) }
  for (const [k, v] of Object.entries(EXACT)) if (text.startsWith(k)) return v + text.slice(k.length)
  return text
}
export const label = (map: Record<string, string>, key: string | null | undefined): string => (key ? map[key] ?? key.replace(/_/g, ' ') : '—')

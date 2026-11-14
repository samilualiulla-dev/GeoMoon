// Well-known lunar landmarks for the search box. APPROXIMATE planetocentric coordinates (±0.1–0.5°) for navigation only —
// they are not measurements and must not be used as landing coordinates; check the IAU Gazetteer of Planetary Nomenclature.
export interface Landmark { name: string; lat: number; lon: number; kind: string }

export const LANDMARKS: Landmark[] = [
  { name: 'Аполлон-11 (Море Спокойствия)', lat: 0.674, lon: 23.473, kind: 'место посадки' },
  { name: 'Аполлон-12', lat: -3.012, lon: -23.422, kind: 'место посадки' },
  { name: 'Аполлон-14', lat: -3.645, lon: -17.471, kind: 'место посадки' },
  { name: 'Аполлон-15', lat: 26.132, lon: 3.633, kind: 'место посадки' },
  { name: 'Аполлон-16', lat: -8.973, lon: 15.501, kind: 'место посадки' },
  { name: 'Аполлон-17 (Тавр — Литтров)', lat: 20.19, lon: 30.77, kind: 'место посадки' },
  { name: 'Кратер Шеклтон (южный полюс)', lat: -89.9, lon: 129.8, kind: 'кратер' },
  { name: 'Кратер Хаворт', lat: -87.5, lon: -5.0, kind: 'кратер' },
  { name: 'Кратер Фаустини', lat: -87.3, lon: 77.0, kind: 'кратер' },
  { name: 'Кратер Кабео', lat: -84.9, lon: -35.5, kind: 'кратер' },
  { name: 'Кратер Амундсен', lat: -84.5, lon: 82.8, kind: 'кратер' },
  { name: 'Кратер Тихо', lat: -43.31, lon: -11.36, kind: 'кратер' },
  { name: 'Кратер Коперник', lat: 9.62, lon: -20.08, kind: 'кратер' },
  { name: 'Море Дождей', lat: 32.8, lon: -15.6, kind: 'море' },
  { name: 'Море Ясности', lat: 28.0, lon: 17.5, kind: 'море' },
  { name: 'Море Спокойствия', lat: 8.5, lon: 31.4, kind: 'море' },
  { name: 'Океан Бурь', lat: 18.4, lon: -57.4, kind: 'море' },
  { name: 'Бассейн Южный полюс — Эйткен (центр)', lat: -53.0, lon: -169.0, kind: 'бассейн' },
  { name: 'Самая высокая область (5,4° с. ш.)', lat: 5.41, lon: 201.34 - 360, kind: 'экстремум высоты' },
  { name: 'Самая низкая область (кратер Антониади)', lat: -70.34, lon: 187.53 - 360, kind: 'экстремум высоты' },
  { name: 'Южный полюс', lat: -90, lon: 0, kind: 'полюс' },
  { name: 'Северный полюс', lat: 90, lon: 0, kind: 'полюс' },
]

/** "lat, lon" (also with comma decimals / spaces) -> numbers, else null. */
export function parseCoords(q: string): { lat: number; lon: number } | null {
  const m = q.trim().replace(/;/g, ' ').match(/^(-?\d+(?:[.,]\d+)?)[\s,]+(-?\d+(?:[.,]\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1].replace(',', '.')), lon = Number(m[2].replace(',', '.'))
  return Math.abs(lat) <= 90 && lon >= -180 && lon <= 360 ? { lat, lon } : null
}

export function searchPlaces(q: string, extra: Landmark[] = []): Landmark[] {
  const s = q.trim().toLowerCase().replace(/ё/g, 'е')
  if (!s) return []
  return [...extra, ...LANDMARKS].filter((l) => l.name.toLowerCase().replace(/ё/g, 'е').includes(s) || l.kind.includes(s)).slice(0, 8)
}

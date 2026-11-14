export function fmt(v: number | null | undefined, digits = 2, unit = ''): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (Math.abs(v) < 1e-6) v = 0 // numerical noise (e.g. -2e-10 m at touchdown) is shown as zero
  const a = Math.abs(v)
  const s = a >= 1e6 ? v.toExponential(2) : v.toFixed(digits)
  return unit ? `${s} ${unit}` : s
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU')
}

export function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return '—'
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)} с`
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)} %`
}

export function humanize(s: string): string { return s.replace(/_/g, ' ') }

export function fmtInt(v: number, digits = 0): string { return Number.isFinite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—' }

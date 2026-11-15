import { useEffect, useState } from 'react'

/** Number input that keeps what the user types (including partial input) and commits only valid finite values. */
export function Num({ label, value, onChange, unit, step = 'any', min, max, disabled, testId, scale = 1, nullable }: {
  label: string; value: number | null; onChange: (v: number | null) => void; unit?: string; step?: string; min?: number; max?: number; disabled?: boolean; testId?: string; scale?: number; nullable?: boolean
}) {
  const show = (v: number | null) => (v === null ? '' : String(Number((v / scale).toPrecision(10))))
  const [txt, setTxt] = useState(show(value))
  useEffect(() => { setTxt((cur) => (Number(cur) === (value === null ? NaN : value / scale) || (cur === '' && value === null) ? cur : show(value))) }, [value, scale]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = Number(txt)
  const bad = txt !== '' && (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max))
  return (
    <label className="block text-xs text-muted">
      <span className="mb-1 flex justify-between"><span>{label}</span>{unit && <span className="text-dim">{unit}</span>}</span>
      <input type="number" inputMode="decimal" step={step} value={txt} disabled={disabled} data-testid={testId} aria-invalid={bad}
        onChange={(e) => { setTxt(e.target.value); const v = Number(e.target.value); if (e.target.value === '' && nullable) onChange(null); else if (e.target.value !== '' && Number.isFinite(v) && !(min !== undefined && v < min) && !(max !== undefined && v > max)) onChange(v * scale) }}
        className={`num h-10 w-full rounded-md border bg-space-900 px-2.5 text-[13px] text-ink outline-none focus:border-cyan disabled:opacity-40 ${bad ? 'border-bad' : 'border-line-2'}`} />
      {bad && <span className="mt-0.5 block text-[11px] text-bad">недопустимое значение{min !== undefined ? ` (≥ ${min / 1})` : ''}</span>}
    </label>
  )
}

export function Sel<T extends string>({ label, value, onChange, options, testId }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; testId?: string }) {
  return (
    <label className="block text-xs text-muted">
      <span className="mb-1 block">{label}</span>
      <select value={value} data-testid={testId} onChange={(e) => onChange(e.target.value as T)} className="h-10 w-full rounded-md border border-line-2 bg-space-900 px-2 text-[13px] text-ink outline-none focus:border-cyan">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

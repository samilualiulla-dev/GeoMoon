import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { ApiError } from '../../api/http'
import { ORIGIN_LABEL, type FieldSpec } from '../../lib/validation'

export function Panel({ title, actions, children, className = '', padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-md border border-line bg-panel ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-3' : ''}>{children}</div>
    </section>
  )
}

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info'
const TONES: Record<Tone, string> = {
  neutral: 'border-line-2 text-muted', ok: 'border-ok/40 text-ok bg-ok/10', warn: 'border-warn/40 text-warn bg-warn/10',
  bad: 'border-bad/40 text-bad bg-bad/10', info: 'border-cyan/40 text-cyan bg-cyan/10',
}
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${TONES[tone]}`}>{children}</span>
}

export function Button({ variant = 'secondary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const v = {
    primary: 'bg-cyan text-space-950 hover:bg-cyan/90 border-cyan font-semibold',
    secondary: 'bg-panel-2 text-ink hover:bg-line border-line-2',
    ghost: 'bg-transparent text-muted hover:text-ink hover:bg-panel-2 border-transparent',
    danger: 'bg-bad/15 text-bad hover:bg-bad/25 border-bad/40',
  }[variant]
  return <button type="button" {...p} className={`inline-flex items-center justify-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`} />
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" role="status">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-2 border-t-cyan" />
      {label}
    </span>
  )
}

export function ErrorBanner({ error, title = 'Request failed', onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  if (!error) return null
  const e = error instanceof ApiError ? error : null
  const msg = e ? e.describe() : error instanceof Error ? error.message : String(error)
  const hint = e?.kind === 'network' ? 'Start the core: cd backend && uvicorn app.asgi:app --port 8000'
    : e?.code === 'data_unavailable' || e?.code === 'out_of_coverage' ? 'No real DEM covers this point. See Data Sources for how to install one.' : null
  return (
    <div role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-bad">{title}{e?.status ? ` · HTTP ${e.status}` : ''}{e?.code && e.kind === 'http' ? ` · ${e.code}` : ''}</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-ink/90">{msg}</div>
          {hint && <div className="mt-1 text-muted">{hint}</div>}
        </div>
        {onRetry && <Button variant="secondary" onClick={onRetry}>Retry</Button>}
      </div>
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded border border-dashed border-line-2 p-4 text-xs text-muted">
      <div className="font-medium text-ink/80">{title}</div>
      {children && <div>{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function Stat({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const c = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink'
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`num truncate text-sm ${c}`}>{value}{unit && <span className="ml-1 text-[11px] text-muted">{unit}</span>}</div>
    </div>
  )
}

export function NumberField({ spec, value, onChange, error, label, disabled, step = 'any', compact }: {
  spec: FieldSpec; value: string; onChange: (v: string) => void; error?: string | null; label?: string; disabled?: boolean; step?: string; compact?: boolean
}) {
  const id = `f-${spec.key}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted" title={`${spec.help}\n(${ORIGIN_LABEL[spec.origin]})`}>
        <span className="truncate">{label ?? spec.label}</span>
        <span className="num shrink-0 text-dim">{spec.unit}</span>
      </label>
      <input id={id} data-testid={id} type="number" inputMode="decimal" step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
        className={`num w-full rounded border bg-space-900 px-2 ${compact ? 'py-1' : 'py-1.5'} text-xs text-ink outline-none transition-colors focus:border-cyan disabled:opacity-50 ${error ? 'border-bad' : 'border-line-2'}`} />
      {error && <div id={`${id}-err`} className="mt-0.5 text-[10px] text-bad">{error}</div>}
    </div>
  )
}

export function SelectField<T extends string>({ label, value, onChange, options, disabled, id }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean; id?: string }) {
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-[11px] text-muted">{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded border border-line-2 bg-space-900 px-2 py-1.5 text-xs text-ink outline-none focus:border-cyan disabled:opacity-50">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 text-xs ${disabled ? 'opacity-40' : ''}`} title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-4 w-7 rounded-full border border-line-2 bg-space-900 transition-colors peer-checked:border-cyan peer-checked:bg-cyan/30 peer-focus-visible:ring-1 peer-focus-visible:ring-cyan after:absolute after:left-0.5 after:top-0.5 after:h-2.5 after:w-2.5 after:rounded-full after:bg-muted after:transition-all peer-checked:after:left-3.5 peer-checked:after:bg-cyan" />
      <span className="text-ink/90">{label}</span>
    </label>
  )
}

export function SyntheticNotice({ compact }: { compact?: boolean }) {
  return (
    <div role="note" className={`rounded border border-warn/50 bg-warn/10 text-warn ${compact ? 'px-2 py-1 text-[10px]' : 'p-2 text-xs'}`}>
      <strong>SYNTHETIC TEST TERRAIN — NOT REAL LUNAR DATA.</strong>{!compact && ' Results computed on it only demonstrate the software pipeline.'}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="num rounded border border-line-2 bg-space-900 px-1 text-[10px] text-muted">{children}</kbd> }

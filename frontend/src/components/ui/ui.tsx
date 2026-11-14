import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ApiError } from '../../api/http'
import { tr } from '../../i18n/ru'
import { ORIGIN_LABEL, type FieldSpec } from '../../lib/validation'
import { Icon } from './Icon'

export function Panel({ title, actions, children, className = '', padded = true, icon }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; icon?: string }) {
  return (
    <section className={`panel-glow rounded-lg border border-line bg-panel/95 ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.13em] text-muted">
            {icon && <Icon name={icon} size={14} className="text-cyan/80" />}{title}
          </h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">{icon && <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan/10 text-cyan"><Icon name={icon} size={18} /></span>}{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info'
const TONES: Record<Tone, string> = {
  neutral: 'border-line-2 text-muted', ok: 'border-ok/40 text-ok bg-ok/10', warn: 'border-warn/40 text-warn bg-warn/10',
  bad: 'border-bad/40 text-bad bg-bad/10', info: 'border-cyan/40 text-cyan bg-cyan/10',
}
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${TONES[tone]}`}>{children}</span>
}

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: string }) {
  const v = {
    primary: 'bg-cyan text-space-950 hover:bg-cyan/90 active:bg-cyan/80 border-cyan font-semibold shadow-[0_0_0_1px_rgba(34,211,238,.25),0_4px_16px_rgba(34,211,238,.15)]',
    secondary: 'bg-panel-2 text-ink hover:bg-panel-3 active:bg-line border-line-2',
    ghost: 'bg-transparent text-muted hover:text-ink hover:bg-panel-2 border-transparent',
    danger: 'bg-bad/15 text-bad hover:bg-bad/25 border-bad/40',
  }[variant]
  const s = { sm: 'min-h-8 px-3 text-xs gap-1.5', md: 'min-h-10 px-4 text-[13px] gap-2', lg: 'min-h-11 px-5 text-sm gap-2' }[size]
  return (
    <button type="button" {...p} className={`inline-flex select-none items-center justify-center rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${s} ${v} ${className}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}{children}
    </button>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-2 border-t-cyan" />
      {label}
    </span>
  )
}

export function ErrorBanner({ error, title = 'Ошибка запроса', onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  if (!error) return null
  const e = error instanceof ApiError ? error : null
  const raw = e ? e.describe() : error instanceof Error ? error.message : String(error)
  const msg = tr(raw.includes(': ') && e?.kind === 'http' && (e.details as { errors?: unknown }).errors ? raw : raw)
  const hint = e?.kind === 'network' ? 'Запустите ядро: cd backend → uvicorn app.asgi:app --port 8000'
    : e?.code === 'data_unavailable' || e?.code === 'out_of_coverage' ? 'Реальный DEM не покрывает эту точку. Как установить данные — в разделе «Источники данных».' : null
  return (
    <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3.5 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-2.5">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-bad" />
          <div>
            <div className="font-semibold text-bad">{title}{e?.status ? ` · HTTP ${e.status}` : ''}{e?.code && e.kind === 'http' ? ` · ${e.code}` : ''}</div>
            <div className="mt-1 whitespace-pre-wrap break-words text-ink/90">{msg}</div>
            {hint && <div className="mt-1 text-muted">{hint}</div>}
          </div>
        </div>
        {onRetry && <Button size="sm" onClick={onRetry}>Повторить</Button>}
      </div>
    </div>
  )
}

export function Empty({ title, children, action, icon = 'info' }: { title: string; children?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-line-2 p-4 text-[13px] text-muted">
      <Icon name={icon} size={20} className="mt-0.5 shrink-0 text-dim" />
      <div className="flex flex-col gap-1">
        <div className="font-medium text-ink/85">{title}</div>
        {children && <div>{children}</div>}
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  )
}

export function Stat({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const c = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink'
  return (
    <div className="min-w-0">
      <div className="truncate text-[10.5px] uppercase tracking-wider text-dim" title={label}>{label}</div>
      <div className={`num truncate text-[15px] ${c}`}>{value}{unit && <span className="ml-1 text-xs text-muted">{unit}</span>}</div>
    </div>
  )
}

const INPUT = 'num w-full rounded-md border bg-space-900 px-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-dim focus:border-cyan disabled:opacity-50'

export function NumberField({ spec, value, onChange, error, label, disabled, step = 'any', compact }: {
  spec: FieldSpec; value: string; onChange: (v: string) => void; error?: string | null; label?: string; disabled?: boolean; step?: string; compact?: boolean
}) {
  const id = `f-${spec.key}`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs leading-tight text-muted" title={`${spec.help}\n(${ORIGIN_LABEL[spec.origin]})`}>{label ?? spec.label}</label>
      <div className="relative">
        <input id={id} data-testid={id} type="number" inputMode="decimal" step={step} value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          className={`${INPUT} ${compact ? 'h-9' : 'h-10'} ${spec.unit ? 'pr-12' : ''} ${error ? 'border-bad' : 'border-line-2 hover:border-line-2/80'}`} />
        {spec.unit && <span className="num pointer-events-none absolute right-2.5 top-1/2 max-w-[3.6rem] -translate-y-1/2 truncate text-[11px] text-dim">{spec.unit}</span>}
      </div>
      {error && <div id={`${id}-err`} className="mt-1 text-[11px] text-bad">{error}</div>}
    </div>
  )
}

export function TextField({ label, value, onChange, error, id, placeholder, maxLength, testId }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; id: string; placeholder?: string; maxLength?: number; testId?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs text-muted">{label}</label>
      <input id={id} data-testid={testId ?? id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength}
        className={`${INPUT} h-10 font-sans ${error ? 'border-bad' : 'border-line-2'}`} />
      {error && <div className="mt-1 text-[11px] text-bad">{error}</div>}
    </div>
  )
}

export function SelectField<T extends string>({ label, value, onChange, options, disabled, id }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean; id?: string }) {
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-xs text-muted" htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}
        className="h-10 w-full rounded-md border border-line-2 bg-space-900 px-2.5 text-[13px] text-ink outline-none hover:border-line-2/80 focus:border-cyan disabled:opacity-50">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-9 cursor-pointer items-center gap-2.5 text-[13px] ${disabled ? 'opacity-40' : ''}`} title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-5 w-9 shrink-0 rounded-full border border-line-2 bg-space-900 transition-colors peer-checked:border-cyan peer-checked:bg-cyan/30 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan/60 after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-muted after:transition-all peer-checked:after:left-[18px] peer-checked:after:bg-cyan" />
      <span className="text-ink/90">{label}</span>
    </label>
  )
}

/** Segmented control (tabs / mode switch). */
export function Segmented<T extends string>({ value, onChange, options, testIdPrefix }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; testIdPrefix?: string }) {
  return (
    <div role="tablist" className="inline-flex rounded-md border border-line-2 bg-space-900 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} disabled={o.disabled} title={o.title} data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded px-3.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${value === o.value ? 'bg-cyan/15 text-cyan' : 'text-muted hover:text-ink'}`}>{o.label}</button>
      ))}
    </div>
  )
}

/** Collapsible group of controls. */
export function Section({ title, children, defaultOpen = true, badge, icon, testId }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode; icon?: string; testId?: string }) {
  return (
    <details open={defaultOpen} className="group border-b border-line last:border-b-0" data-testid={testId}>
      <summary className="flex min-h-11 items-center justify-between gap-2 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted hover:text-ink">
        <span className="flex items-center gap-2">{icon && <Icon name={icon} size={14} className="text-cyan/80" />}{title}</span>
        <span className="flex items-center gap-2">{badge}<Icon name="chevron" size={14} className="transition-transform group-open:rotate-180" /></span>
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  )
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const id = useId()
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className={`panel-glow my-4 w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-xl border border-line-2 bg-panel`}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-ink"><Icon name="x" /></button>
        </header>
        <div className="p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

/** Confirmation for destructive actions. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Удалить', onConfirm, onCancel, busy }: { open: boolean; title: ReactNode; children: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <Modal open={open} title={title} onClose={onCancel} footer={<><Button onClick={onCancel} data-testid="confirm-cancel">Отмена</Button><Button variant="danger" onClick={onConfirm} disabled={busy} data-testid="confirm-ok">{busy ? 'Выполняется…' : confirmLabel}</Button></>}>
      <div className="text-[13px] text-ink/90">{children}</div>
    </Modal>
  )
}

export function SyntheticNotice({ compact }: { compact?: boolean }) {
  return (
    <div role="note" className={`rounded-md border border-warn/50 bg-warn/10 text-warn ${compact ? 'px-2.5 py-1.5 text-[11px]' : 'p-3 text-[13px]'}`}>
      <strong>СИНТЕТИЧЕСКИЙ ТЕСТОВЫЙ РЕЛЬЕФ — НЕ РЕАЛЬНЫЕ ДАННЫЕ ЛУНЫ.</strong>{!compact && ' Результаты на нём лишь демонстрируют работу программы.'}
    </div>
  )
}

export function DemoBadge() { return <Badge tone="warn" title="Демонстрационная конфигурация, не реальный аппарат">ДЕМО</Badge> }

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="num rounded border border-line-2 bg-space-900 px-1.5 text-[11px] text-muted">{children}</kbd> }

import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useHealth } from '../../hooks/useHealth'
import { tr } from '../../i18n/ru'
import { formatLat, formatLon } from '../../lib/geo'
import { useInputs } from '../../store/appStore'
import { Icon } from '../ui/Icon'
import { Badge } from '../ui/ui'

const NAV = [
  { to: '/', label: 'Обзор', icon: 'dashboard', end: true },
  { to: '/explorer', label: 'Исследование Луны', icon: 'globe' },
  { to: '/terrain', label: 'Анализ рельефа', icon: 'layers' },
  { to: '/spacecraft', label: 'Аппараты', icon: 'rocket' },
  { to: '/simulation', label: 'Симуляция посадки', icon: 'target' },
  { to: '/reports', label: 'Отчёты миссий', icon: 'file' },
  { to: '/data', label: 'Источники данных', icon: 'database' },
]

export function Shell() {
  const [open, setOpen] = useState(false)
  const status = useHealth()
  const { target, allowSynthetic } = useInputs()
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="no-print z-30 flex shrink-0 flex-col border-line bg-space-900/95 md:w-60 md:border-r">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-500 shadow-[0_0_18px_rgba(34,211,238,.25)]">
              <span className="h-3 w-3 translate-x-1.5 -translate-y-1 rounded-full bg-slate-600/70" />
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-tight tracking-wide"><span className="text-cyan">Geo</span>Moon</div>
              <div className="text-[9.5px] uppercase leading-tight tracking-[0.16em] text-dim">карта посадочной геометрии</div>
            </div>
          </div>
          <button className="flex h-10 w-10 items-center justify-center rounded-md border border-line-2 text-muted md:hidden" aria-label="Меню" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="menu" /></button>
        </div>
        <nav className={`${open ? 'flex' : 'hidden'} flex-col gap-1 px-3 pb-3 md:flex`} aria-label="Основная навигация">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} data-testid={`nav-${n.to === '/' ? 'home' : n.to.slice(1)}`}
              className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-md px-3 text-[13.5px] transition-colors ${isActive ? 'bg-cyan/10 text-cyan shadow-[inset_2px_0_0_#22d3ee]' : 'text-muted hover:bg-panel-2 hover:text-ink'}`}>
              <Icon name={n.icon} size={18} />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-line p-4 text-[11px] leading-relaxed text-dim md:block">
          Исследовательский и учебный прототип. Это не полётное ПО; результаты не являются гарантией безопасной посадки.
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="no-print flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-space-900/80 px-5 py-2.5 text-[13px] backdrop-blur">
          <div className="flex items-center gap-2" data-testid="core-status">
            <span className={`h-2.5 w-2.5 rounded-full ${status.state === 'online' ? 'bg-ok shadow-[0_0_8px_#22c55e]' : status.state === 'offline' ? 'bg-bad' : 'animate-pulse bg-warn'}`} />
            <span className="text-muted">Ядро</span>
            <span className="text-ink">{status.state === 'online' ? `на связи · API v${status.health.api_version}` : status.state === 'offline' ? 'недоступно' : 'проверка…'}</span>
          </div>
          {status.state === 'online' && (
            <div className="flex items-center gap-2 text-muted">
              DEM: <span className="text-ink">{status.health.real_datasets_installed} реальных</span>
              {status.health.datasets_installed > status.health.real_datasets_installed && <Badge tone="warn">{status.health.datasets_installed - status.health.real_datasets_installed} синтетических</Badge>}
            </div>
          )}
          {status.state === 'offline' && <span className="text-bad">{tr(status.error.describe())}</span>}
          <div className="num ml-auto flex items-center gap-2 text-muted"><Icon name="target" size={14} className="text-cyan" />Цель <span className="text-ink">{formatLat(target.lat)} · {formatLon(target.lon)}</span></div>
          {allowSynthetic && <Badge tone="warn" title="Синтетический тестовый рельеф разрешён в запросах">синтетический рельеф разрешён</Badge>}
        </header>
        <main className="min-h-0 flex-1 overflow-auto"><Outlet /></main>
      </div>
    </div>
  )
}

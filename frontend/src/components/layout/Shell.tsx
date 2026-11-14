import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useHealth } from '../../hooks/useHealth'
import { formatLat, formatLon } from '../../lib/geo'
import { useInputs } from '../../store/appStore'
import { Badge } from '../ui/ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◈', end: true },
  { to: '/explorer', label: 'Lunar Explorer', icon: '◐' },
  { to: '/terrain', label: 'Terrain Analysis', icon: '▦' },
  { to: '/spacecraft', label: 'Spacecraft', icon: '⏃' },
  { to: '/simulation', label: 'Landing Simulation', icon: '↓' },
  { to: '/reports', label: 'Mission Reports', icon: '▤' },
  { to: '/data', label: 'Data Sources', icon: '⛁' },
]

export function Shell() {
  const [open, setOpen] = useState(false)
  const status = useHealth()
  const { target, allowSynthetic } = useInputs()
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className={`no-print z-30 flex shrink-0 flex-col border-line bg-space-900 md:w-56 md:border-r ${open ? 'max-md:h-auto' : ''}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-sm font-semibold tracking-wide text-ink"><span className="text-cyan">Geo</span>Moon</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-dim">Lunar Landing Geometric Map</div>
          </div>
          <button className="rounded border border-line-2 px-2 py-1 text-xs text-muted md:hidden" aria-label="Toggle navigation" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
        </div>
        <nav className={`${open ? 'flex' : 'hidden'} flex-col gap-0.5 px-2 pb-3 md:flex`} aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] transition-colors ${isActive ? 'bg-cyan/10 text-cyan' : 'text-muted hover:bg-panel-2 hover:text-ink'}`}>
              <span className="w-4 text-center text-base leading-none">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-line p-3 text-[10px] leading-relaxed text-dim md:block">
          Research / educational prototype. Not certified flight software; results are not a landing-safety guarantee.
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-space-900 px-4 py-2 text-xs">
          <div className="flex items-center gap-2" data-testid="core-status">
            <span className={`h-2 w-2 rounded-full ${status.state === 'online' ? 'bg-ok' : status.state === 'offline' ? 'bg-bad' : 'animate-pulse bg-warn'}`} />
            <span className="text-muted">Core</span>
            <span className="text-ink">{status.state === 'online' ? `online · API v${status.health.api_version}` : status.state === 'offline' ? 'offline' : 'checking…'}</span>
          </div>
          {status.state === 'online' && (
            <div className="flex items-center gap-2 text-muted">
              DEM: <span className="text-ink">{status.health.real_datasets_installed} real</span>
              {status.health.datasets_installed > status.health.real_datasets_installed && <Badge tone="warn">{status.health.datasets_installed - status.health.real_datasets_installed} synthetic</Badge>}
            </div>
          )}
          {status.state === 'offline' && <span className="text-bad">{status.error.describe()}</span>}
          <div className="num ml-auto text-muted">Target <span className="text-ink">{formatLat(target.lat)} · {formatLon(target.lon)}</span></div>
          {allowSynthetic && <Badge tone="warn" title="Synthetic test terrain is allowed in requests">synthetic terrain enabled</Badge>}
        </header>
        <main className="min-h-0 flex-1 overflow-auto"><Outlet /></main>
      </div>
    </div>
  )
}

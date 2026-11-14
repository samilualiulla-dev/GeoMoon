import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import { Badge, Empty, ErrorBanner, Panel, Spinner, Stat } from '../components/ui/ui'
import { useFetch } from '../hooks/useFetch'
import { useHealth } from '../hooks/useHealth'
import { fmtDate } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { useInputs } from '../store/appStore'

function Card({ to, title, text }: { to: string; title: string; text: string }) {
  return <Link to={to} className="block rounded border border-line bg-panel p-3 transition-colors hover:border-cyan/60 hover:bg-panel-2"><div className="text-sm font-medium text-ink">{title} →</div><div className="mt-1 text-xs text-muted">{text}</div></Link>
}

export default function DashboardPage() {
  const status = useHealth()
  const { target, targetName, regionId, spacecraftId } = useInputs()
  const missions = useFetch(() => api.missions(), [])
  const regions = useFetch(() => api.regions(), [])
  const vehicles = useFetch(() => api.spacecraftList(), [])
  const sources = useFetch(() => api.dataSources(), [])
  const region = regions.data?.find((r) => r.id === regionId)
  const real = sources.data?.installed.filter((d) => !d.synthetic).length ?? 0
  const synth = sources.data?.installed.filter((d) => d.synthetic).length ?? 0
  const offline = status.state === 'offline'
  return (
    <div className="space-y-4 p-4">
      <div><h1 className="text-xl font-semibold"><span className="text-cyan">Geo</span>Moon <span className="text-muted">· Lunar Landing Geometric Map</span></h1>
        <p className="mt-1 max-w-3xl text-xs text-muted">Interactive terrain analysis and landing-simulation workbench driven by the GeoMoon computational core. A research and educational prototype — not certified flight software.</p></div>

      {offline && <ErrorBanner error={status.error} title="Computational core unreachable" />}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="System status">
          {status.state === 'checking' ? <Spinner label="Checking…" /> : status.state === 'online' ? (
            <div className="space-y-1 text-xs" data-testid="system-status"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ok" />Core online</div><div className="text-muted">{status.health.service} · API v{status.health.api_version}</div></div>
          ) : <div className="flex items-center gap-2 text-xs text-bad"><span className="h-2 w-2 rounded-full bg-bad" />Core offline</div>}
        </Panel>
        <Panel title="Lunar data">
          {sources.loading ? <Spinner /> : sources.error ? <div className="text-xs text-bad">unavailable</div> : real + synth === 0 ? (
            <div className="text-xs"><Badge tone="warn">no DEM loaded</Badge><div className="mt-1 text-muted">Install a real DEM to enable terrain analysis.</div><Link className="text-cyan underline" to="/data">How →</Link></div>
          ) : (
            <div className="grid grid-cols-2 gap-3" data-testid="data-status"><Stat label="Real datasets" value={real} tone={real ? 'ok' : 'warn'} /><Stat label="Synthetic (test)" value={synth} tone={synth ? 'warn' : undefined} /></div>
          )}
        </Panel>
        <Panel title="Current target">
          <div className="num text-sm" data-testid="dash-target">{formatLat(target.lat)}<br />{formatLon(target.lon)}</div>
          <div className="mt-1 text-[11px] text-muted">{targetName ?? (region ? region.name : 'Manually set point (default 0°, 0° is only a placeholder)')}</div>
        </Panel>
        <Panel title="Saved items">
          <div className="grid grid-cols-3 gap-2" data-testid="counts">
            <Stat label="Missions" value={missions.data ? missions.data.length : '—'} />
            <Stat label="Vehicles" value={vehicles.data ? vehicles.data.length : '—'} />
            <Stat label="Regions" value={regions.data ? regions.data.length : '—'} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card to="/explorer" title="Lunar Explorer" text="Rotate the Moon, pick coordinates and load real regional relief." />
        <Card to="/terrain" title="Analyse surface" text="Slope, roughness, hazards and landing-site suitability for a region." />
        <Card to="/simulation" title="Simulate landing" text="Integrate a descent on the core and replay it in 3-D with telemetry." />
      </div>

      <Panel title="Recent studies">
        {missions.loading && <Spinner />}
        {missions.error && <ErrorBanner error={missions.error} onRetry={missions.reload} />}
        {missions.data && missions.data.length === 0 && <Empty title="No saved studies yet">Run a simulation and save it as a mission — it will appear here.</Empty>}
        <ul className="divide-y divide-line">{missions.data?.slice(-5).reverse().map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span>#{m.id} {m.name}</span><span className="text-dim">{fmtDate(m.created_at)}</span></li>))}</ul>
        {spacecraftId === null && <p className="mt-2 text-[11px] text-dim">No vehicle selected — configure one on the Spacecraft page.</p>}
      </Panel>
    </div>
  )
}

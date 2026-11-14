import { api } from '../api/endpoints'
import { Badge, Button, Empty, ErrorBanner, Panel, Spinner } from '../components/ui/ui'
import { useFetch } from '../hooks/useFetch'
import { fmt } from '../lib/format'

const LIMITS: Record<string, string> = {
  'LOLA LDEM': 'Elevations are relative to the 1737.4 km reference sphere. Use polar stereographic tiles for |lat| > 85°. Resolution varies by product.',
  SLDEM2015: 'Covers only ≈ 60°S–60°N. It has NO coverage of the lunar poles; GeoMoon refuses points outside the raster bounds.',
  LROC: 'Individual site DTMs (high resolution, tiny coverage). Coverage checks matter; most of the Moon has no LROC DTM.',
  'Moon Trek': 'A discovery/visualisation portal. No direct download API is assumed; use it to locate products, then install the files.',
}
const limitFor = (product: string) => Object.entries(LIMITS).find(([k]) => product.toLowerCase().includes(k.toLowerCase()))?.[1] ?? 'See provider documentation.'

export default function DataSourcesPage() {
  const q = useFetch(() => api.dataSources(), [])
  const rescan = async () => { await api.dataSources(true); q.reload() }
  const installedFor = (product: string) => q.data?.installed.filter((d) => {
    const p = product.toLowerCase()
    return d.product.toLowerCase().includes(p.split(' ')[0].toLowerCase()) || d.name.toLowerCase().includes(p.split(' ')[0].toLowerCase())
  }) ?? []
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-end justify-between gap-3">
        <div><h1 className="text-lg font-semibold">Data sources</h1>
          <p className="text-xs text-muted">Scientific datasets known to GeoMoon and what is actually installed on the core. Nothing is fabricated: a source without a file is shown as not installed.</p></div>
        <Button onClick={rescan}>Rescan DEM directory</Button>
      </div>
      {q.loading && <Spinner label="Loading…" />}
      {q.error && <ErrorBanner error={q.error} onRetry={q.reload} />}
      {q.data && (
        <>
          <Panel title="Installed on the core">
            {q.data.installed.length === 0 ? (
              <Empty title="No DEM installed">Place a real DEM raster with a .meta.json provenance sidecar in <code className="num">{q.data.dem_directory}</code> and rescan. See documentation/DATA_SETUP.md.</Empty>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="installed">
                <thead><tr className="text-left text-dim"><th className="py-1 font-normal">Name</th><th className="font-normal">Provider / product</th><th className="font-normal">Status</th><th className="font-normal">Coverage</th><th className="font-normal">Resolution</th><th className="font-normal">Version</th><th className="font-normal">Notes</th></tr></thead>
                <tbody>{q.data.installed.map((d) => (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2 font-medium">{d.name}<div className="num text-[10px] text-dim">{d.file}</div></td>
                    <td className="pr-2 text-muted">{d.provider}<div>{d.product}</div></td>
                    <td className="pr-2"><Badge tone={d.synthetic ? 'warn' : 'ok'}>{d.synthetic ? 'synthetic test' : d.status}</Badge></td>
                    <td className="num pr-2 text-muted">{d.coverage.lat_range_deg ? `lat ${fmt(d.coverage.lat_range_deg[0], 2)}…${fmt(d.coverage.lat_range_deg[1], 2)}` : '—'}<br />{d.coverage.lon_range_deg ? `lon ${fmt(d.coverage.lon_range_deg[0], 2)}…${fmt(d.coverage.lon_range_deg[1], 2)}` : ''}{d.coverage.includes_pole ? ' · pole' : ''}</td>
                    <td className="num pr-2">{d.resolution_m_per_px ? `${fmt(d.resolution_m_per_px, 1)} m/px` : 'unknown'}</td>
                    <td className="pr-2">{d.version ?? <span className="text-dim">not provided</span>}</td>
                    <td className="text-[11px] text-dim">{d.citation && <div>{d.citation}</div>}{d.url && <a className="text-cyan underline" href={d.url} target="_blank" rel="noreferrer">source</a>}{d.warnings.map((w, i) => <div key={i} className={w.includes('SYNTHETIC') ? 'text-warn' : ''}>{w}</div>)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {Object.keys(q.data.rejected_files).length > 0 && (
              <div className="mt-3 rounded border border-bad/40 bg-bad/10 p-2 text-[11px]"><div className="font-semibold text-bad">Files found but rejected</div>
                <ul className="mt-1 list-inside list-disc text-ink/90">{Object.entries(q.data.rejected_files).map(([f, r]) => <li key={f}><span className="num">{f}</span>: {r}</li>)}</ul></div>
            )}
          </Panel>
          <Panel title="Scientific products">
            <div className="grid gap-3 md:grid-cols-2" data-testid="known">
              {q.data.known_products.map((k) => {
                const inst = installedFor(k.product)
                return (
                  <div key={k.product} className="rounded border border-line p-3 text-xs">
                    <div className="flex items-start justify-between gap-2"><div className="font-semibold">{k.product}</div><Badge tone={inst.length ? (inst.every((d) => d.synthetic) ? 'warn' : 'ok') : 'neutral'}>{inst.length ? 'installed' : 'not installed'}</Badge></div>
                    <div className="mt-1 text-muted">{k.provider}</div>
                    <dl className="mt-2 grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[11px]">
                      <dt className="text-dim">Coverage</dt><dd>{k.coverage}</dd>
                      <dt className="text-dim">Format</dt><dd>{k.format}</dd>
                      <dt className="text-dim">Usage limits</dt><dd className="text-warn/90">{limitFor(k.product)}</dd>
                      <dt className="text-dim">Notes</dt><dd className="text-muted">{k.notes}</dd>
                      <dt className="text-dim">Source</dt><dd className="break-all">{k.url.split(' , ').map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 text-cyan underline">{u}</a>)}</dd>
                    </dl>
                  </div>)
              })}
            </div>
            <p className="mt-3 text-[11px] text-dim">{q.data.notice}</p>
          </Panel>
        </>
      )}
    </div>
  )
}

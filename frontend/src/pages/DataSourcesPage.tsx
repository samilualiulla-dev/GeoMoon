import { api } from '../api/endpoints'
import { Badge, Button, Empty, ErrorBanner, PageHeader, Panel, Spinner } from '../components/ui/ui'
import { useFetch } from '../hooks/useFetch'
import { DEM_STATUS_RU, QUANTITY_RU, label, tr } from '../i18n/ru'
import { fmt, fmtDate } from '../lib/format'

const LIMITS: Record<string, string> = {
  'LOLA LDEM': 'Высоты отсчитываются от опорной сферы 1737,4 км. Для |широты| > 85° используйте полярные тайлы. Разрешение зависит от продукта.',
  SLDEM2015: 'Покрывает только ≈ 60° ю. ш. — 60° с. ш. На полюсах покрытия НЕТ; GeoMoon отказывает для точек вне растра.',
  LROC: 'DTM отдельных мест (высокое разрешение, крошечное покрытие). Проверка покрытия важна: на большей части Луны DTM LROC нет.',
  'Moon Trek': 'Портал поиска и визуализации. Прямого API для скачивания не предполагается: через него находят продукты, затем устанавливают файлы.',
}
const limitFor = (product: string) => Object.entries(LIMITS).find(([k]) => product.toLowerCase().includes(k.toLowerCase()))?.[1] ?? 'См. документацию поставщика данных.'

export default function DataSourcesPage() {
  const q = useFetch(() => api.dataSources(), [])
  const rescan = async () => { await api.dataSources(true); q.reload() }
  const installedFor = (product: string) => q.data?.installed.filter((d) => {
    const p = product.toLowerCase().split(' ')[0]
    return d.product.toLowerCase().includes(p) || d.name.toLowerCase().includes(p)
  }) ?? []
  return (
    <div className="p-4 lg:p-5">
      <PageHeader icon="database" title="Источники данных" subtitle="Научные наборы данных, которые знает GeoMoon, и то, что реально установлено на ядре. Ничего не выдумывается: источник без файла помечается как не установленный."
        actions={<Button icon="reset" onClick={rescan}>Пересканировать папку DEM</Button>} />
      {q.loading && <Spinner label="Загрузка…" />}
      {q.error && <ErrorBanner error={q.error} onRetry={q.reload} />}
      {q.data && (
        <div className="space-y-4">
          <Panel title="Установлено на ядре" icon="database">
            {q.data.installed.length === 0 ? (
              <Empty title="DEM не установлен" icon="alert">Поместите растр реального DEM и файл происхождения .meta.json в <code className="num">{q.data.dem_directory}</code> и пересканируйте (или импортируйте файл LOLA: <code className="num">python scripts/import_pds.py …</code>). См. documentation/DATA_SETUP.md.</Empty>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-[13px]" data-testid="installed">
                <thead><tr className="text-left text-dim"><th className="py-1.5 font-normal">Название</th><th className="font-normal">Источник / продукт</th><th className="font-normal">Статус</th><th className="font-normal">Покрытие</th><th className="font-normal">Разрешение</th><th className="font-normal">Версия</th><th className="font-normal">Загружен</th><th className="font-normal">Примечания и ограничения</th></tr></thead>
                <tbody>{q.data.installed.map((d) => (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="py-2.5 pr-3 font-medium">{d.name}<div className="num text-[11px] text-dim">{d.file}</div></td>
                    <td className="pr-3 text-muted">{d.provider}<div>{d.product}</div></td>
                    <td className="pr-3"><div className="flex flex-col items-start gap-1"><Badge tone={d.synthetic ? 'warn' : 'ok'}>{d.synthetic ? 'синтетический тест' : label(DEM_STATUS_RU, d.status)}</Badge><Badge tone={d.usable_as_dem ? 'info' : 'neutral'} title={d.usable_as_dem ? 'Используется для анализа рельефа' : 'Показан для справки; это не DEM'}>{label(QUANTITY_RU, d.quantity)}{d.usable_as_dem ? '' : ' · не DEM'}</Badge></div></td>
                    <td className="num pr-3 text-muted">{d.coverage.lat_range_deg ? `шир. ${fmt(d.coverage.lat_range_deg[0], 2)}…${fmt(d.coverage.lat_range_deg[1], 2)}` : '—'}<br />{d.coverage.lon_range_deg ? `долг. ${fmt(d.coverage.lon_range_deg[0], 2)}…${fmt(d.coverage.lon_range_deg[1], 2)}` : ''}{d.coverage.includes_pole ? ' · полюс' : ''}</td>
                    <td className="num pr-3">{d.resolution_m_per_px ? `${fmt(d.resolution_m_per_px, 1)} м/ячейка` : 'неизвестно'}</td>
                    <td className="pr-3">{d.version ?? <span className="text-dim">не указана</span>}</td>
                    <td className="pr-3 text-muted">{fmtDate(d.installed_at)}</td>
                    <td className="text-[12px] text-dim">{d.citation && <div>{d.citation}</div>}{d.url && <a className="text-cyan underline" href={d.url} target="_blank" rel="noreferrer">источник</a>}{d.warnings.map((w, i) => <div key={i} className={w.includes('SYNTHETIC') ? 'text-warn' : ''}>{tr(w)}</div>)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {Object.keys(q.data.rejected_files).length > 0 && (
              <div className="mt-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-[12.5px]"><div className="font-semibold text-bad">Найдены, но отклонены</div>
                <ul className="mt-1 list-inside list-disc text-ink/90">{Object.entries(q.data.rejected_files).map(([f, r]) => <li key={f}><span className="num">{f}</span>: {r}</li>)}</ul></div>
            )}
          </Panel>
          <Panel title="Научные продукты" icon="layers">
            <div className="grid gap-4 md:grid-cols-2" data-testid="known">
              {q.data.known_products.map((k) => {
                const inst = installedFor(k.product)
                return (
                  <div key={k.product} className="rounded-lg border border-line p-4 text-[13px]">
                    <div className="flex items-start justify-between gap-2"><div className="font-semibold">{k.product}</div><Badge tone={inst.length ? (inst.every((d) => d.synthetic) ? 'warn' : 'ok') : 'neutral'}>{inst.length ? 'установлен' : 'не установлен'}</Badge></div>
                    <div className="mt-1 text-muted">{k.provider}</div>
                    <dl className="mt-3 grid grid-cols-[96px_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
                      <dt className="text-dim">Покрытие</dt><dd>{k.coverage}</dd>
                      <dt className="text-dim">Формат</dt><dd>{k.format}</dd>
                      <dt className="text-dim">Ограничения</dt><dd className="text-warn/90">{limitFor(k.product)}</dd>
                      <dt className="text-dim">Примечания</dt><dd className="text-muted">{k.notes}</dd>
                      <dt className="text-dim">Источник</dt><dd className="break-all">{k.url.split(' , ').map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 text-cyan underline">{u}</a>)}</dd>
                    </dl>
                  </div>)
              })}
            </div>
            <p className="mt-4 text-[12px] text-dim">Используются только растры из папки DEM с файлом происхождения .meta.json. Данные не выдумываются и не подставляются.</p>
          </Panel>
        </div>
      )}
    </div>
  )
}

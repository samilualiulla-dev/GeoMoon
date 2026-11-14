import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import { Icon } from '../components/ui/Icon'
import { Badge, Empty, ErrorBanner, PageHeader, Panel, Spinner, Stat } from '../components/ui/ui'
import { useFetch } from '../hooks/useFetch'
import { useHealth } from '../hooks/useHealth'
import { tr } from '../i18n/ru'
import { fmtDate } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { useInputs } from '../store/appStore'

function Card({ to, title, text, icon }: { to: string; title: string; text: string; icon: string }) {
  return (
    <Link to={to} className="group block rounded-lg border border-line bg-panel/90 p-4 transition-colors hover:border-cyan/50 hover:bg-panel-2">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan/10 text-cyan"><Icon name={icon} size={20} /></span>
        <div className="text-[15px] font-medium text-ink">{title}<span className="ml-1.5 text-cyan opacity-0 transition-opacity group-hover:opacity-100">→</span></div></div>
      <div className="mt-2 text-[13px] text-muted">{text}</div>
    </Link>
  )
}

export default function DashboardPage() {
  const status = useHealth()
  const { target, targetName, regionId, spacecraftId } = useInputs()
  const missions = useFetch(() => api.missions(), [])
  const regions = useFetch(() => api.regions(), [])
  const vehicles = useFetch(() => api.spacecraftList(), [])
  const sources = useFetch(() => api.dataSources(), [])
  const region = regions.data?.find((r) => r.id === regionId)
  const vehicle = vehicles.data?.find((v) => v.id === spacecraftId)
  const real = sources.data?.installed.filter((d) => !d.synthetic && d.usable_as_dem).length ?? 0
  const synth = sources.data?.installed.filter((d) => d.synthetic && d.usable_as_dem).length ?? 0
  const supp = sources.data?.installed.filter((d) => !d.usable_as_dem).length ?? 0
  return (
    <div className="p-4 lg:p-5">
      <PageHeader icon="dashboard" title={<><span className="text-cyan">Geo</span>Moon <span className="font-normal text-muted">· карта посадочной геометрии Луны</span></>}
        subtitle="Рабочая среда для анализа лунного рельефа и моделирования посадки: реальные данные LOLA → анализ поверхности → аппарат → траектория → оценка → отчёт. Исследовательский прототип, не полётное ПО." />

      {status.state === 'offline' && <div className="mb-4"><ErrorBanner error={status.error} title="Вычислительное ядро недоступно" /></div>}

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Состояние системы" icon="info">
          {status.state === 'checking' ? <Spinner label="Проверка…" /> : status.state === 'online' ? (
            <div className="space-y-1 text-[13px]" data-testid="system-status"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-ok shadow-[0_0_8px_#22c55e]" />Ядро на связи</div><div className="text-muted">{status.health.service} · API v{status.health.api_version}</div></div>
          ) : <div className="flex items-center gap-2 text-[13px] text-bad"><span className="h-2.5 w-2.5 rounded-full bg-bad" />Ядро недоступно</div>}
        </Panel>
        <Panel title="Данные Луны" icon="database">
          {sources.loading ? <Spinner /> : sources.error ? <div className="text-[13px] text-bad">недоступно</div> : real + synth === 0 ? (
            <div className="text-[13px]"><Badge tone="warn">DEM не загружен</Badge><div className="mt-2 text-muted">Установите реальный DEM, чтобы включить анализ рельефа.</div><Link className="text-cyan underline" to="/data">Как это сделать →</Link></div>
          ) : (
            <div className="grid grid-cols-2 gap-3" data-testid="data-status"><Stat label="Реальных наборов" value={real} tone={real ? 'ok' : 'warn'} /><Stat label="Синтетических (тест)" value={synth} tone={synth ? 'warn' : undefined} />{supp > 0 && <Stat label="Прочих продуктов" value={supp} />}</div>
          )}
        </Panel>
        <Panel title="Текущая цель" icon="target">
          <div className="num text-[14px]" data-testid="dash-target">{formatLat(target.lat)}<br />{formatLon(target.lon)}</div>
          <div className="mt-1.5 text-[12px] text-muted">{targetName ?? (region ? region.name : 'Точка задана вручную (0°, 0° — лишь начальное значение)')}</div>
        </Panel>
        <Panel title="Сохранённое" icon="file">
          <div className="grid grid-cols-3 gap-2" data-testid="counts">
            <Stat label="Миссии" value={missions.data ? missions.data.length : '—'} /><Stat label="Аппараты" value={vehicles.data ? vehicles.data.length : '—'} /><Stat label="Регионы" value={regions.data ? regions.data.length : '—'} />
          </div>
        </Panel>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Card to="/explorer" icon="globe" title="Исследование Луны" text="Вращайте глобус, ищите регион, выбирайте координаты и загружайте реальный рельеф." />
        <Card to="/terrain" icon="layers" title="Анализ рельефа" text="Уклон, шероховатость, опасности и пригодность площадок для выбранного региона." />
        <Card to="/simulation" icon="target" title="Симуляция посадки" text="Траектория считается на ядре; воспроизведение в 3D с телеметрией и графиками." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Последние исследования" icon="file">
          {missions.loading && <Spinner />}
          {missions.error && <ErrorBanner error={missions.error} onRetry={missions.reload} />}
          {missions.data && missions.data.length === 0 && <Empty title="Сохранённых исследований пока нет" icon="file">Запустите симуляцию и сохраните её как миссию — она появится здесь.</Empty>}
          <ul className="divide-y divide-line">{missions.data?.slice(-5).reverse().map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2.5 text-[13px]"><span>№{m.id} {m.name}</span><span className="text-dim">{fmtDate(m.created_at)}</span></li>))}</ul>
        </Panel>
        <Panel title="Выбранный аппарат" icon="rocket">
          {vehicle ? (
            <div className="grid grid-cols-3 gap-3"><Stat label="Название" value={<span className="text-[13px]">{vehicle.name}</span>} /><Stat label="Масса" value={Math.round(vehicle.derived.total_mass_kg)} unit="кг" /><Stat label="Тяга/вес" value={vehicle.derived.thrust_to_weight_lunar_surface.toFixed(2)} />
              {vehicle.warnings.map((w, i) => <div key={i} className="col-span-3 text-[12px] text-warn">{tr(w)}</div>)}</div>
          ) : <Empty title="Аппарат не выбран" icon="rocket">Создайте или выберите аппарат в разделе <Link className="text-cyan underline" to="/spacecraft">«Аппараты»</Link>.</Empty>}
        </Panel>
      </div>
    </div>
  )
}

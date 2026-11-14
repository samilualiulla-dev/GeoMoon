import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { MissionReport, SimResults } from '../api/types'
import { AssessmentPanel } from '../components/simulation/AssessmentPanel'
import { Charts } from '../components/simulation/Charts'
import { Badge, Button, Empty, ErrorBanner, PageHeader, Panel, Spinner, Stat, SyntheticNotice } from '../components/ui/ui'
import { asApiError, useFetch } from '../hooks/useFetch'
import { BURN_RU, OVERALL_RU, STATUS_RU, TERMINATION_RU, label, tr } from '../i18n/ru'
import { download, reportToRows, rowsToCsv, timeSeriesToCsv } from '../lib/csv'
import { fmt, fmtDate } from '../lib/format'
import { formatLat, formatLon } from '../lib/geo'
import { useInputs, useSession } from '../store/appStore'

function compareRows(reports: MissionReport[]): { label: string; vals: string[] }[] {
  const f = (fn: (r: MissionReport) => string | number | null | undefined, d = 2) => reports.map((r) => { const v = fn(r); return typeof v === 'number' ? fmt(v, d) : v ?? '—' })
  return [
    { label: 'Цель', vals: reports.map((r) => { const ic = r.simulation?.initial_conditions; return ic ? `${formatLat(ic.target_latitude_deg)} ${formatLon(ic.target_longitude_deg)}` : '—' }) },
    { label: 'Аппарат', vals: f((r) => r.spacecraft?.name) },
    { label: 'Полная масса, кг', vals: f((r) => r.spacecraft?.derived.total_mass_kg, 0) },
    { label: 'Начальная высота, м', vals: f((r) => r.simulation?.initial_conditions.initial_altitude_m, 0) },
    { label: 'Верт. скорость касания, м/с', vals: f((r) => r.simulation?.summary?.touchdown?.vertical_speed_m_s) },
    { label: 'Гориз. скорость касания, м/с', vals: f((r) => r.simulation?.summary?.touchdown?.horizontal_speed_m_s) },
    { label: 'Промах, м', vals: f((r) => r.simulation?.summary?.touchdown?.miss_distance_m, 1) },
    { label: 'Остаток топлива, кг', vals: f((r) => r.simulation?.summary?.fuel_remaining_kg, 1) },
    { label: 'Средний уклон, °', vals: f((r) => r.terrain_analysis?.slope.mean) },
    { label: 'Средняя шероховатость, м', vals: f((r) => r.terrain_analysis?.roughness.mean, 3) },
    { label: 'Средняя пригодность, 0–1', vals: f((r) => r.terrain_analysis?.suitability.stats.mean, 3) },
    { label: 'Оценка поверхности', vals: f((r) => r.landing_assessment && label(STATUS_RU, r.landing_assessment.surface_assessment.status)) },
    { label: 'Оценка траектории', vals: f((r) => r.landing_assessment && label(STATUS_RU, r.landing_assessment.trajectory_assessment.status)) },
    { label: 'Итог', vals: f((r) => r.landing_assessment && label(OVERALL_RU, r.landing_assessment.overall)) },
    { label: 'Данные рельефа', vals: f((r) => (r.terrain_analysis ? (r.terrain_analysis.synthetic ? 'СИНТЕТИКА' : 'реальный DEM') : 'нет')) },
  ]
}

export default function ReportsPage() {
  const missions = useFetch(() => api.missions(), [])
  const nav = useNavigate()
  const inputs = useInputs()
  const { setResults, setSimulation } = useSession()
  const [openId, setOpenId] = useState<number | null>(null)
  const [report, setReport] = useState<MissionReport | null>(null)
  const [series, setSeries] = useState<SimResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [compare, setCompare] = useState<MissionReport[] | null>(null)

  useEffect(() => {
    if (openId === null) return
    let alive = true
    setLoading(true); setError(null); setReport(null); setSeries(null)
    api.missionReport(openId).then(async (r) => {
      if (!alive) return
      setReport(r)
      if (r.simulation?.has_result) { try { const s = await api.simulationResults(r.simulation.id); if (alive) setSeries(s) } catch (e) { if (alive) setError(e) } }
    }).catch((e) => alive && setError(asApiError(e))).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [openId])

  const doCompare = async () => {
    setError(null)
    try { setCompare(await Promise.all(picked.map((id) => api.missionReport(id)))) } catch (e) { setError(asApiError(e)) }
  }
  const openInSim = () => {
    if (!report?.simulation || !series) return
    setSimulation(report.simulation); setResults(series)
    inputs.setTarget(series.trajectory.target.latitude_deg, series.trajectory.target.longitude_deg)
    if (report.spacecraft) inputs.setSpacecraftId(report.spacecraft.id)
    nav('/simulation')
  }
  const exportJson = () => report && download(`mission_${report.mission.id}_report.json`, JSON.stringify(report, null, 2), 'application/json')
  const exportCsv = () => report && download(`mission_${report.mission.id}_report.csv`, rowsToCsv(reportToRows(report)), 'text/csv')
  const exportSeries = () => series && report && download(`mission_${report.mission.id}_timeseries.csv`, timeSeriesToCsv(series.time_series), 'text/csv')
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div className="p-4 lg:p-5">
      <div className="no-print"><PageHeader icon="file" title="Отчёты миссий" subtitle="Сохранённые исследования: параметры аппарата, результаты анализа рельефа, траектория и оценка посадки. Отчёты собираются только из сохранённых результатов расчётов." /></div>
      <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
        <div className="no-print space-y-3">
          <Panel title="Сохранённые миссии" icon="database" actions={<Button size="sm" variant="ghost" onClick={missions.reload}>Обновить</Button>}>
            {missions.loading && <Spinner label="Загрузка…" />}
            {missions.error && <ErrorBanner error={missions.error} onRetry={missions.reload} />}
            {missions.data?.length === 0 && <Empty title="Миссий пока нет" icon="file">Запустите симуляцию и нажмите «Сохранить как миссию» на странице «Симуляция посадки».</Empty>}
            <ul className="space-y-2" data-testid="mission-list">
              {missions.data?.map((m) => (
                <li key={m.id} className={`rounded-lg border p-3 text-[13px] ${openId === m.id ? 'border-cyan bg-cyan/10' : 'border-line'}`}>
                  <div className="flex items-start gap-2.5">
                    <input type="checkbox" aria-label={`Выбрать миссию ${m.id} для сравнения`} checked={picked.includes(m.id)} onChange={() => toggle(m.id)} className="mt-1 h-4 w-4 accent-cyan" />
                    <button className="min-w-0 flex-1 text-left" onClick={() => { setOpenId(m.id); setCompare(null) }}>
                      <div className="truncate font-medium">№{m.id} {m.name}</div>
                      <div className="text-[11.5px] text-dim">{fmtDate(m.created_at)}</div>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2"><Button icon="compare" onClick={doCompare} disabled={picked.length < 2} data-testid="compare">Сравнить ({picked.length})</Button>{picked.length < 2 && <span className="text-[11.5px] text-dim">отметьте ≥ 2</span>}</div>
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          {error != null && <ErrorBanner error={error} />}
          {compare && (
            <Panel title="Сравнение миссий" icon="compare" actions={<Button size="sm" className="no-print" onClick={() => setCompare(null)}>Закрыть</Button>}>
              <div className="overflow-x-auto"><table className="w-full text-[13px]" data-testid="compare-table">
                <thead><tr className="text-left text-dim"><th className="py-1.5 pr-3 font-normal">Показатель</th>{compare.map((r) => <th key={r.mission.id} className="px-2 font-medium text-ink">№{r.mission.id} {r.mission.name}</th>)}</tr></thead>
                <tbody>{compareRows(compare).map((row) => <tr key={row.label} className="border-t border-line"><td className="py-2 pr-3 text-muted">{row.label}</td>{row.vals.map((v, i) => <td key={i} className="num px-2">{v}</td>)}</tr>)}</tbody>
              </table></div>
            </Panel>
          )}
          {openId === null && !compare && <Empty title="Откройте миссию" icon="file">Выберите сохранённую миссию, чтобы увидеть параметры, результаты и оценку, либо отметьте две и больше миссий для сравнения.</Empty>}
          {loading && <Spinner label="Загрузка отчёта…" />}
          {report && (
            <div className="print-area space-y-4" data-testid="report">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h2 className="text-xl font-semibold">Миссия №{report.mission.id} — {report.mission.name}</h2>
                  <div className="text-[13px] text-muted">{fmtDate(report.mission.created_at)}{report.mission.description ? ` · ${report.mission.description}` : ''}</div></div>
                <div className="no-print flex flex-wrap gap-2">
                  <Button onClick={openInSim} disabled={!series} data-testid="open-in-sim">Открыть в симуляции</Button>
                  <Button icon="download" onClick={exportJson} data-testid="export-json">JSON</Button>
                  <Button icon="download" onClick={exportCsv} data-testid="export-csv">CSV</Button>
                  <Button icon="download" onClick={exportSeries} disabled={!series}>Ряд CSV</Button>
                  <Button variant="primary" icon="file" onClick={() => window.print()} data-testid="export-pdf" title="Откроется диалог печати — выберите «Сохранить как PDF»">PDF (печать)</Button>
                </div>
              </div>
              {(report.terrain_analysis?.synthetic || report.simulation?.summary?.terrain_synthetic) && <SyntheticNotice />}
              <div className="grid gap-4 md:grid-cols-2">
                {report.region && <Panel title="Регион" icon="globe"><div className="grid grid-cols-2 gap-4"><Stat label="Название" value={report.region.name} /><Stat label="Радиус" value={fmt(report.region.radius_m, 0)} unit="м" /><Stat label="Широта" value={formatLat(report.region.latitude_deg)} /><Stat label="Долгота" value={formatLon(report.region.longitude_deg)} /></div></Panel>}
                {report.spacecraft && <Panel title={`Аппарат${report.spacecraft.is_demo ? ' (ДЕМО)' : ''}`} icon="rocket"><div className="grid grid-cols-2 gap-4 sm:grid-cols-3"><Stat label="Название" value={report.spacecraft.name} /><Stat label="Сухая масса" value={fmt(report.spacecraft.dry_mass_kg, 0)} unit="кг" /><Stat label="Топливо" value={fmt(report.spacecraft.fuel_mass_kg, 0)} unit="кг" />
                  <Stat label="Тяга (сумма)" value={fmt(report.spacecraft.engine.thrust_n * report.spacecraft.engine.number_of_engines, 0)} unit="Н" /><Stat label="Isp" value={fmt(report.spacecraft.derived.effective_isp_s, 0)} unit="с" /><Stat label="Тяга/вес (Луна)" value={fmt(report.spacecraft.derived.thrust_to_weight_lunar_surface, 2)} /></div></Panel>}
              </div>
              {report.simulation?.initial_conditions && (
                <Panel title="Начальные условия и результат" icon="target">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 lg:grid-cols-6">
                    <Stat label="Цель" value={<span className="num text-xs">{formatLat(report.simulation.initial_conditions.target_latitude_deg)}<br />{formatLon(report.simulation.initial_conditions.target_longitude_deg)}</span>} />
                    <Stat label="Начальная высота" value={fmt(report.simulation.initial_conditions.initial_altitude_m, 0)} unit="м" />
                    <Stat label="Начальная скорость" value={fmt(report.simulation.initial_conditions.initial_speed_m_s, 1)} unit="м/с" />
                    <Stat label="План тяги" value={label(BURN_RU, report.simulation.initial_conditions.burn.mode)} />
                    <Stat label="Завершение" value={label(TERMINATION_RU, report.simulation.summary?.termination_reason)} />
                    <Stat label="Длительность" value={fmt(report.simulation.summary?.duration_s, 1)} unit="с" />
                    <Stat label="Остаток топлива" value={fmt(report.simulation.summary?.fuel_remaining_kg, 1)} unit="кг" />
                    <Stat label="Верт. скорость касания" value={fmt(report.simulation.summary?.touchdown?.vertical_speed_m_s, 2)} unit="м/с" />
                    <Stat label="Гориз. скорость касания" value={fmt(report.simulation.summary?.touchdown?.horizontal_speed_m_s, 2)} unit="м/с" />
                    <Stat label="Промах" value={fmt(report.simulation.summary?.touchdown?.miss_distance_m, 1)} unit="м" />
                  </div>
                  {report.simulation.summary?.warnings?.map((w, i) => <div key={i} className="mt-3 text-[12.5px] text-warn">⚠ {tr(w)}</div>)}
                </Panel>
              )}
              {report.terrain_analysis && (
                <Panel title="Анализ рельефа" icon="layers">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 lg:grid-cols-6">
                    <Stat label="Высота, мин." value={fmt(report.terrain_analysis.suitability.elevation.min_m, 1)} unit="м" /><Stat label="Высота, макс." value={fmt(report.terrain_analysis.suitability.elevation.max_m, 1)} unit="м" />
                    <Stat label="Уклон, средний" value={fmt(report.terrain_analysis.slope.mean, 2)} unit="°" /><Stat label="Уклон, p95" value={fmt(report.terrain_analysis.slope.p95, 2)} unit="°" />
                    <Stat label="Шероховатость, средняя" value={fmt(report.terrain_analysis.roughness.mean, 3)} unit="м" /><Stat label="Пригодность, средняя" value={fmt(report.terrain_analysis.suitability.stats.mean, 3)} />
                  </div>
                  <div className="mt-3 text-[12px] text-dim">Параметры: окно {report.terrain_analysis.parameters.window_m} м · допустимый уклон {report.terrain_analysis.parameters.slope_limit_deg}° · радиус пятна {report.terrain_analysis.parameters.footprint_radius_m} м · веса {JSON.stringify(report.terrain_analysis.parameters.weights)}</div>
                </Panel>
              )}
              {series && (<div><h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.13em] text-muted">Траектория и телеметрия</h3><Charts results={series} t={series.time_series.time_s[series.time_series.time_s.length - 1]} /></div>)}
              {report.landing_assessment ? <AssessmentPanel a={report.landing_assessment} /> : <Badge tone="warn">оценка не сохранена</Badge>}
              <p className="text-[12px] text-dim">{tr(report.disclaimer) === report.disclaimer ? 'Результат исследовательского прототипа; не является оперативным руководством по посадке.' : tr(report.disclaimer)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

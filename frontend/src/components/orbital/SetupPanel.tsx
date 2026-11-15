import { useEffect, useState } from 'react'
import { orbApi, type OrbCatalogue, type OrbConfig } from '../../api/orbital'
import { useOrbital } from '../../store/orbitalStore'
import { fmtDistance } from '../../lib/orbital'
import { Badge, Button, Section, Toggle } from '../ui/ui'
import { Num, Sel } from './fields'

const KIND_RU: Record<string, string> = { free_flight: 'Свободный полёт (без планировщика)', to_moon: 'Полёт к Луне', lunar_flyby: 'Пролёт Луны', lunar_orbit: 'Орбита Луны', approach: 'Сближение с координатами', descent: 'Спуск', landing: 'Посадка' }
const INIT_RU: Record<string, string> = { earth_orbit: 'Орбита Земли', moon_orbit: 'Орбита Луны', lat_lon_surface: 'Стоит на поверхности', cartesian: 'Вектор состояния (ECI)' }

/** Start conditions, vehicle, engine, mission goal and force-model options. Editing resets nothing until "Создать симуляцию". */
export function SetupPanel() {
  const { config, patchConfig, setConfig, createFromConfig, makePlan, plan, busy, simId } = useOrbital()
  const [cat, setCat] = useState<OrbCatalogue | null>(null)
  useEffect(() => { orbApi.catalogue().then(setCat).catch(() => setCat(null)) }, [])
  const i = config.initial, v = config.vehicle, m = config.mission, o = config.options
  const eng = v.engines[0]
  const thrust = v.engines.reduce((a, e) => a + e.thrust_n, 0)
  const dv = eng && eng.isp_s > 0 && thrust > 0 ? eng.isp_s * 9.80665 * Math.log((v.dry_mass_kg + v.fuel_mass_kg) / v.dry_mass_kg) : 0
  const twr = thrust / ((v.dry_mass_kg + v.fuel_mass_kg) * 9.80665)
  return (
    <div className="space-y-3" data-testid="orbit-setup">
      <Section title="Сценарий" icon="rocket" testId="sec-scenario">
        <Sel label="Готовый сценарий (можно менять)" value="" onChange={(id) => {
          const s = cat?.scenarios.find((x) => x.id === id); if (!s) return
          const c = s.config as Partial<OrbConfig>
          setConfig({ ...config, ...c, name: c.name ?? config.name, vehicle: { ...config.vehicle, ...(c.vehicle ?? {}), engines: c.vehicle?.engines ?? config.vehicle.engines },
            initial: { ...config.initial, ...(c.initial ?? {}) }, mission: { ...config.mission, ...(c.mission ?? {}) }, options: { ...config.options, ...(c.options ?? {}) }, commands: [] })
        }} testId="scenario-select" options={[{ value: '', label: '— выбрать —' }, ...(cat?.scenarios ?? []).map((s) => ({ value: s.id, label: s.title }))]} />
        <p className="mt-2 text-[11.5px] leading-snug text-dim">{cat?.scenarios.find((s) => s.config.name === config.name)?.description ?? 'Измените любые параметры ниже — готовые сценарии лишь отправная точка.'}</p>
      </Section>
      <Section title="Начальные условия" icon="target" testId="sec-initial">
        <div className="space-y-2.5">
          <Sel label="Старт" value={i.kind} onChange={(k) => patchConfig((c) => ({ ...c, initial: { ...c.initial, kind: k, body: k === 'moon_orbit' ? 'moon' : k === 'earth_orbit' ? 'earth' : c.initial.body } }))} testId="init-kind" options={Object.entries(INIT_RU).map(([value, label]) => ({ value: value as OrbConfig['initial']['kind'], label }))} />
          {(i.kind === 'earth_orbit' || i.kind === 'moon_orbit') && (
            <div className="grid grid-cols-2 gap-2.5">
              <Num label="Высота перицентра" unit="км" value={i.periapsis_alt_m} scale={1000} min={0} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, periapsis_alt_m: x ?? 0 } }))} testId="init-peri" />
              <Num label="Высота апоцентра (пусто = круговая)" unit="км" value={i.apoapsis_alt_m} scale={1000} min={0} nullable onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, apoapsis_alt_m: x } }))} testId="init-apo" />
              <Num label="Наклонение" unit="°" value={i.inclination_deg} min={0} max={180} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, inclination_deg: x ?? 0 } }))} testId="init-inc" />
              <Num label="Долгота восх. узла" unit="°" value={i.raan_deg} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, raan_deg: x ?? 0 } }))} />
              <Num label="Аргумент перицентра" unit="°" value={i.arg_periapsis_deg} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, arg_periapsis_deg: x ?? 0 } }))} />
              <Num label="Истинная аномалия" unit="°" value={i.true_anomaly_deg} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, true_anomaly_deg: x ?? 0 } }))} />
            </div>
          )}
          {i.kind === 'lat_lon_surface' && (
            <div className="grid grid-cols-2 gap-2.5">
              <Sel label="Тело" value={i.body} onChange={(b) => patchConfig((c) => ({ ...c, initial: { ...c.initial, body: b } }))} options={[{ value: 'moon', label: 'Луна' }, { value: 'earth', label: 'Земля' }]} />
              <Num label="Высота над поверхностью" unit="м" value={i.altitude_m} min={0} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, altitude_m: x ?? 0 } }))} />
              <Num label="Широта" unit="°" value={i.lat_deg} min={-90} max={90} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, lat_deg: x ?? 0 } }))} />
              <Num label="Долгота" unit="°" value={i.lon_deg} min={-180} max={360} onChange={(x) => patchConfig((c) => ({ ...c, initial: { ...c.initial, lon_deg: x ?? 0 } }))} />
            </div>
          )}
          {i.kind === 'cartesian' && (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((k) => <Num key={'r' + k} label={`r${'xyz'[k]}`} unit="км" scale={1000} value={i.r_m?.[k] ?? 0} onChange={(x) => patchConfig((c) => { const r = [...(c.initial.r_m ?? [0, 0, 0])] as [number, number, number]; r[k] = x ?? 0; return { ...c, initial: { ...c.initial, r_m: r } } })} />)}
              {[0, 1, 2].map((k) => <Num key={'v' + k} label={`v${'xyz'[k]}`} unit="м/с" value={i.v_mps?.[k] ?? 0} onChange={(x) => patchConfig((c) => { const r = [...(c.initial.v_mps ?? [0, 0, 0])] as [number, number, number]; r[k] = x ?? 0; return { ...c, initial: { ...c.initial, v_mps: r } } })} />)}
            </div>
          )}
          <label className="block text-xs text-muted"><span className="mb-1 block">Эпоха (UTC), задаёт положение Луны и Солнца</span>
            <input type="text" value={o.epoch_iso} onChange={(e) => patchConfig((c) => ({ ...c, options: { ...c.options, epoch_iso: e.target.value } }))} className="num h-10 w-full rounded-md border border-line-2 bg-space-900 px-2.5 text-[13px] text-ink outline-none focus:border-cyan" data-testid="epoch" />
          </label>
        </div>
      </Section>
      <Section title="Аппарат и двигатель" icon="rocket" testId="sec-vehicle">
        <div className="grid grid-cols-2 gap-2.5">
          <Num label="Сухая масса" unit="кг" value={v.dry_mass_kg} min={1} onChange={(x) => patchConfig((c) => ({ ...c, vehicle: { ...c.vehicle, dry_mass_kg: x ?? 1 } }))} testId="veh-dry" />
          <Num label="Топливо" unit="кг" value={v.fuel_mass_kg} min={0} onChange={(x) => patchConfig((c) => ({ ...c, vehicle: { ...c.vehicle, fuel_mass_kg: x ?? 0 } }))} testId="veh-fuel" />
          <Num label="Тяга" unit="Н" value={eng?.thrust_n ?? 0} min={0} onChange={(x) => patchConfig((c) => ({ ...c, vehicle: { ...c.vehicle, engines: [{ ...(c.vehicle.engines[0] ?? { name: 'Двигатель', isp_s: 340 }), thrust_n: x ?? 0 }, ...c.vehicle.engines.slice(1)] } }))} testId="veh-thrust" />
          <Num label="Удельный импульс" unit="с" value={eng?.isp_s ?? 300} min={1} onChange={(x) => patchConfig((c) => ({ ...c, vehicle: { ...c.vehicle, engines: [{ ...(c.vehicle.engines[0] ?? { name: 'Двигатель', thrust_n: 0 }), isp_s: x ?? 1 }, ...c.vehicle.engines.slice(1)] } }))} testId="veh-isp" />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2 text-[11.5px] text-muted">
          <Badge tone="info">Δv (ур-ние Циолковского) ≈ {dv.toFixed(0)} м/с</Badge>
          <Badge tone={twr < 1 ? 'warn' : 'neutral'}>тяговооружённость {twr.toFixed(2)} g</Badge>
        </div>
      </Section>
      <Section title="Цель миссии и планировщик" icon="target" testId="sec-mission" defaultOpen>
        <Sel label="Режим" value={m.kind} onChange={(k) => patchConfig((c) => ({ ...c, mission: { ...c.mission, kind: k } }))} testId="mission-kind" options={(cat?.mission_kinds ?? Object.keys(KIND_RU)).map((k) => ({ value: k, label: KIND_RU[k] ?? k }))} />
        {m.kind !== 'free_flight' && (
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <Num label="Целевая высота" unit="км" scale={1000} min={0} value={m.target_altitude_m} onChange={(x) => patchConfig((c) => ({ ...c, mission: { ...c.mission, target_altitude_m: x ?? 0 } }))} testId="mission-alt" />
            {['landing', 'descent', 'approach'].includes(m.kind) && <>
              <Num label="Широта цели" unit="°" nullable value={m.target_lat_deg} onChange={(x) => patchConfig((c) => ({ ...c, mission: { ...c.mission, target_lat_deg: x } }))} />
              <Num label="Долгота цели" unit="°" nullable value={m.target_lon_deg} onChange={(x) => patchConfig((c) => ({ ...c, mission: { ...c.mission, target_lon_deg: x } }))} />
            </>}
          </div>
        )}
        <div className="mt-2.5"><Num label="Длительность расчёта" unit="сут" scale={86400} min={0.001} value={m.duration_s} onChange={(x) => patchConfig((c) => ({ ...c, mission: { ...c.mission, duration_s: x ?? 86400 } }))} testId="mission-days" /></div>
        {m.kind !== 'free_flight' && (
          <div className="mt-3 space-y-2">
            <Button onClick={() => void makePlan()} disabled={!!busy} icon="search" className="w-full" data-testid="btn-plan">Спланировать миссию</Button>
            {plan && (
              <div className="rounded-md border border-line bg-space-900/60 p-2.5 text-[12px]" data-testid="plan-result">
                <div className="mb-1 flex items-center gap-2"><Badge tone={plan.feasible ? 'ok' : 'bad'}>{plan.feasible ? 'решение найдено' : 'не выполнимо'}</Badge></div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted">
                  {Object.entries(plan.summary).filter(([, x]) => typeof x === 'number').slice(0, 10).map(([k, x]) => <div key={k} className="contents"><dt className="truncate" title={k}>{k.replace(/_/g, ' ')}</dt><dd className="num text-right text-ink">{Number(x).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}</dd></div>)}
                </dl>
                {plan.notes.map((n, k) => <p key={k} className="mt-1.5 text-warn">⚠ {n}</p>)}
                <details className="mt-1.5 text-dim"><summary className="cursor-pointer">Ограничения модели</summary><ul className="ml-4 list-disc">{plan.limitations.map((l, k) => <li key={k}>{l}</li>)}</ul></details>
              </div>
            )}
          </div>
        )}
      </Section>
      <Section title="Модель сил и интегратор" icon="layers" defaultOpen={false} testId="sec-options">
        <div className="space-y-1.5">
          <Toggle checked={o.include_moon} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, include_moon: x } }))} label="Притяжение Луны" />
          <Toggle checked={o.include_sun} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, include_sun: x } }))} label="Притяжение Солнца" />
          <Toggle checked={o.include_earth_j2} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, include_earth_j2: x } }))} label="Сжатие Земли (J2)" />
          <Toggle checked={o.include_drag} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, include_drag: x } }))} label="Атмосфера Земли (грубая модель)" />
          <Toggle checked={o.use_dem_collision} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, use_dem_collision: x } }))} label="Контакт с рельефом по реальному DEM" hint="Без установленного DEM используется гладкая сфера" />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <Sel label="Интегратор" value={o.integrator} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, integrator: x } }))} options={[{ value: 'DOP853', label: 'DOP853 (8-й порядок)' }, { value: 'RK45', label: 'RK45' }, { value: 'RK4', label: 'RK4 (фикс. шаг)' }]} />
          <Num label="Относит. допуск" value={o.rtol} min={1e-14} max={1e-3} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, rtol: x ?? 1e-10 } }))} />
          <Num label="Макс. шаг" unit="с" value={o.max_step_s} min={0.01} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, max_step_s: x ?? 300 } }))} />
          <Num label="Шаг выдачи (пусто = авто)" unit="с" nullable value={o.sample_dt_s} min={0.01} onChange={(x) => patchConfig((c) => ({ ...c, options: { ...c.options, sample_dt_s: x } }))} />
        </div>
      </Section>
      <div className="sticky bottom-0 -mx-1 space-y-2 bg-space-950/90 px-1 py-2 backdrop-blur">
        <Button variant="primary" size="lg" icon="play" className="w-full" disabled={!!busy} onClick={() => void createFromConfig(m.kind !== 'free_flight')} data-testid="btn-create">
          {m.kind !== 'free_flight' ? 'Спланировать и создать симуляцию' : 'Создать симуляцию'}
        </Button>
        {simId && <p className="text-center text-[11px] text-dim">Текущая симуляция: <span className="num">{simId}</span> · изменения применяются при создании новой</p>}
        <p className="text-center text-[11px] text-dim">Опорный радиус перицентра: Земля {fmtDistance(6378137)}, Луна {fmtDistance(1737400)}</p>
      </div>
    </div>
  )
}

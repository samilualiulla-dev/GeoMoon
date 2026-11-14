import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { Spacecraft } from '../api/types'
import { VehicleForm, useSpacecraftErrors } from '../components/spacecraft/VehicleForm'
import { Badge, Button, ConfirmDialog, DemoBadge, Empty, ErrorBanner, Modal, PageHeader, Panel, Spinner, Stat } from '../components/ui/ui'
import { useFetch } from '../hooks/useFetch'
import { tr } from '../i18n/ru'
import { fmt, fmtDate } from '../lib/format'
import { DEFAULT_SPACECRAFT_FORM, spacecraftPayload, type SpacecraftForm } from '../lib/payload'
import { DEMO_PRESETS } from '../lib/vehicle'
import { useInputs } from '../store/appStore'

function formFromSpacecraft(s: Spacecraft | { name: string; dry_mass_kg: number; fuel_mass_kg: number; dimensions: Spacecraft['dimensions']; landing_gear: Spacecraft['landing_gear']; engine: Spacecraft['engine']; constraints: Spacecraft['constraints'] }): SpacecraftForm {
  const e = s.engine, c = s.constraints
  return {
    name: s.name, dry_mass_kg: String(s.dry_mass_kg), fuel_mass_kg: String(s.fuel_mass_kg),
    length_m: String(s.dimensions.length_m), width_m: String(s.dimensions.width_m), height_m: String(s.dimensions.height_m),
    gear_span_m: String(s.landing_gear.span_m), pad_diameter_m: String(s.landing_gear.pad_diameter_m), gear_height_m: String(s.landing_gear.gear_height_m),
    thrust_n: String(e.thrust_n), number_of_engines: String(e.number_of_engines), flowMode: e.isp_s ? 'isp' : 'mass_flow',
    isp_s: e.isp_s ? String(e.isp_s) : '', fuel_consumption_kg_s: e.fuel_consumption_kg_s ? String(e.fuel_consumption_kg_s) : '',
    throttle_min: String(e.throttle_min), throttle_max: String(e.throttle_max),
    max_vertical_touchdown_speed_m_s: String(c.max_vertical_touchdown_speed_m_s), max_horizontal_touchdown_speed_m_s: String(c.max_horizontal_touchdown_speed_m_s),
    max_tilt_deg: c.max_tilt_deg === null ? '' : String(c.max_tilt_deg), max_acceleration_m_s2: c.max_acceleration_m_s2 === null ? '' : String(c.max_acceleration_m_s2),
    max_distance_to_target_m: String(c.max_distance_to_target_m),
  }
}

const COMPARE_ROWS: { label: string; unit: string; get: (s: Spacecraft) => number | null; digits?: number }[] = [
  { label: 'Сухая масса', unit: 'кг', get: (s) => s.dry_mass_kg, digits: 0 }, { label: 'Масса топлива', unit: 'кг', get: (s) => s.fuel_mass_kg, digits: 0 },
  { label: 'Полная масса', unit: 'кг', get: (s) => s.derived.total_mass_kg, digits: 0 }, { label: 'Суммарная тяга', unit: 'Н', get: (s) => s.engine.thrust_n * s.engine.number_of_engines, digits: 0 },
  { label: 'Тяга / вес (Луна)', unit: '', get: (s) => s.derived.thrust_to_weight_lunar_surface, digits: 2 }, { label: 'Удельный импульс', unit: 'с', get: (s) => s.derived.effective_isp_s, digits: 0 },
  { label: 'Идеальное Δv', unit: 'м/с', get: (s) => s.derived.delta_v_ideal_m_s, digits: 0 }, { label: 'Макс. время работы', unit: 'с', get: (s) => s.derived.max_burn_time_s, digits: 0 },
  { label: 'Радиус пятна посадки', unit: 'м', get: (s) => s.derived.footprint_radius_m, digits: 2 }, { label: 'Угол опрокидывания', unit: '°', get: (s) => s.derived.tipping_angle_deg, digits: 1 },
  { label: 'Допустимый уклон', unit: '°', get: (s) => s.derived.max_tilt_deg_used, digits: 1 },
  { label: 'Макс. верт. скорость касания', unit: 'м/с', get: (s) => s.constraints.max_vertical_touchdown_speed_m_s, digits: 1 },
  { label: 'Макс. гориз. скорость касания', unit: 'м/с', get: (s) => s.constraints.max_horizontal_touchdown_speed_m_s, digits: 1 },
]

export default function SpacecraftPage() {
  const inputs = useInputs()
  const list = useFetch(() => api.spacecraftList(), [])
  const [selected, setSelected] = useState<number | null>(inputs.spacecraftId)
  const [picked, setPicked] = useState<number[]>([])
  const [compare, setCompare] = useState(false)
  const [editor, setEditor] = useState<null | { id: number | null; form: SpacecraftForm; demo: boolean }>(null)
  const [showErr, setShowErr] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [toDelete, setToDelete] = useState<Spacecraft | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const vehicles = list.data ?? []
  const current = vehicles.find((v) => v.id === selected) ?? null
  const formErrors = useSpacecraftErrors(editor?.form ?? DEFAULT_SPACECRAFT_FORM)
  const compared = useMemo(() => vehicles.filter((v) => picked.includes(v.id)), [vehicles, picked])

  const openNew = (form = DEFAULT_SPACECRAFT_FORM, demo = false) => { setEditor({ id: null, form, demo }); setShowErr(false); setError(null) }
  const openEdit = (v: Spacecraft) => { setEditor({ id: v.id, form: formFromSpacecraft(v), demo: v.is_demo }); setShowErr(false); setError(null) }

  const save = async () => {
    if (!editor) return
    setShowErr(true); setError(null)
    if (Object.keys(formErrors).length) return
    setSaving(true)
    try {
      const body = { ...spacecraftPayload(editor.form), is_demo: editor.demo }
      const v = editor.id === null ? await api.createSpacecraft(body) : await api.updateSpacecraft(editor.id, body)
      setSelected(v.id); inputs.setSpacecraftId(v.id); setEditor(null); list.reload(); setMsg(editor.id === null ? `Аппарат «${v.name}» сохранён (№${v.id}).` : `Аппарат «${v.name}» обновлён.`)
    } catch (e) { setError(e) } finally { setSaving(false) }
  }

  const duplicate = async (v: Spacecraft) => {
    try { const c = await api.createSpacecraft({ ...spacecraftPayload(formFromSpacecraft(v)), name: `${v.name} (копия)`, is_demo: v.is_demo }); setSelected(c.id); list.reload(); setMsg(`Создана копия: «${c.name}».`) } catch (e) { setError(e) }
  }

  const addPreset = async (id: string) => {
    const p = DEMO_PRESETS.find((x) => x.id === id)!
    try { const v = await api.createSpacecraft({ ...p.payload, is_demo: true }); setSelected(v.id); list.reload(); setMsg(`Добавлена демонстрационная конфигурация «${v.name}».`) } catch (e) { setError(e) }
  }

  const doDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try { await api.deleteSpacecraft(toDelete.id); if (inputs.spacecraftId === toDelete.id) inputs.setSpacecraftId(null); if (selected === toDelete.id) setSelected(null); setPicked((p) => p.filter((x) => x !== toDelete.id)); setMsg(`Аппарат «${toDelete.name}» удалён.`); setToDelete(null); list.reload() }
    catch (e) { setError(e); setToDelete(null) } finally { setDeleting(false) }
  }

  const togglePick = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]))

  return (
    <div className="p-4 lg:p-5">
      <PageHeader icon="rocket" title="Каталог аппаратов" subtitle="Конфигурации гипотетических посадочных аппаратов. Все величины в СИ, проверяются здесь и ещё раз ядром. Демонстрационные конфигурации помечены и не описывают реальные аппараты."
        actions={<><Button icon="plus" variant="primary" onClick={() => openNew()} data-testid="new-vehicle">Новый аппарат</Button><Button icon="compare" disabled={picked.length < 2} onClick={() => setCompare(true)} data-testid="compare-btn">Сравнить ({picked.length})</Button></>} />

      {msg && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-ok/40 bg-ok/10 p-3 text-[13px] text-ok" data-testid="vehicle-msg"><span>{msg}</span><button className="text-ok/70 hover:text-ok" onClick={() => setMsg(null)} aria-label="Закрыть">✕</button></div>}
      {error != null && !editor && <div className="mb-4"><ErrorBanner error={error} title="Операция не выполнена" /></div>}
      {list.error && <ErrorBanner error={list.error} title="Не удалось получить аппараты" onRetry={list.reload} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <Panel title={`Сохранённые аппараты (${vehicles.length})`} icon="database" actions={<Button size="sm" variant="ghost" onClick={list.reload}>Обновить</Button>}>
            {list.loading && !list.data && <Spinner label="Загрузка…" />}
            {list.data && vehicles.length === 0 && <Empty title="Аппаратов пока нет" icon="rocket">Создайте свою конфигурацию или добавьте демонстрационную из шаблонов справа.</Empty>}
            <ul className="grid gap-3 md:grid-cols-2" data-testid="vehicle-list">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <div className={`rounded-lg border p-3.5 transition-colors ${selected === v.id ? 'border-cyan/60 bg-cyan/5' : 'border-line hover:border-line-2'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button className="min-w-0 text-left" onClick={() => setSelected(v.id)} data-testid={`vehicle-${v.id}`}>
                        <div className="truncate text-[14px] font-semibold">{v.name}</div>
                        <div className="mt-0.5 text-[11.5px] text-dim">№{v.id} · {fmtDate(v.created_at)}</div>
                      </button>
                      <label className="flex min-h-9 shrink-0 items-center gap-1.5 text-[11.5px] text-muted" title="Выбрать для сравнения (до 4)"><input type="checkbox" checked={picked.includes(v.id)} onChange={() => togglePick(v.id)} aria-label={`Сравнить аппарат ${v.id}`} className="h-4 w-4 accent-cyan" />сравнить</label>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">{v.is_demo && <DemoBadge />}{inputs.spacecraftId === v.id && <Badge tone="info">выбран для симуляции</Badge>}{v.warnings.length > 0 && <Badge tone="warn">предупреждения</Badge>}</div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                      <Stat label="Масса" value={fmt(v.derived.total_mass_kg, 0)} unit="кг" /><Stat label="Тяга/вес" value={fmt(v.derived.thrust_to_weight_lunar_surface, 2)} /><Stat label="Δv" value={fmt(v.derived.delta_v_ideal_m_s, 0)} unit="м/с" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          {current && (
            <Panel title={`Характеристики: ${current.name}`} icon="info" actions={current.is_demo ? <DemoBadge /> : undefined}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4" data-testid="vehicle-details">
                <Stat label="Сухая масса" value={fmt(current.dry_mass_kg, 0)} unit="кг" /><Stat label="Топливо" value={fmt(current.fuel_mass_kg, 0)} unit="кг" />
                <Stat label="Полная масса" value={fmt(current.derived.total_mass_kg, 0)} unit="кг" /><Stat label="Суммарная тяга" value={fmt(current.engine.thrust_n * current.engine.number_of_engines, 0)} unit="Н" />
                <Stat label="Двигателей" value={current.engine.number_of_engines} /><Stat label="Удельный импульс" value={fmt(current.derived.effective_isp_s, 0)} unit="с" />
                <Stat label="Расход (100 %)" value={fmt(current.derived.mass_flow_full_throttle_kg_s, 3)} unit="кг/с" /><Stat label="Макс. время работы" value={fmt(current.derived.max_burn_time_s, 0)} unit="с" />
                <Stat label="Тяга / вес (Луна)" value={fmt(current.derived.thrust_to_weight_lunar_surface, 2)} tone={current.derived.thrust_to_weight_lunar_surface < 1 ? 'warn' : undefined} /><Stat label="Идеальное Δv" value={fmt(current.derived.delta_v_ideal_m_s, 0)} unit="м/с" />
                <Stat label="Радиус пятна" value={fmt(current.derived.footprint_radius_m, 2)} unit="м" /><Stat label="Угол опрокидывания" value={fmt(current.derived.tipping_angle_deg, 1)} unit="°" />
                <Stat label="Размеры Д×Ш×В" value={`${current.dimensions.length_m}×${current.dimensions.width_m}×${current.dimensions.height_m}`} unit="м" /><Stat label="База опор" value={fmt(current.landing_gear.span_m, 2)} unit="м" />
                <Stat label="Лимит верт. скорости" value={fmt(current.constraints.max_vertical_touchdown_speed_m_s, 1)} unit="м/с" /><Stat label="Лимит промаха" value={fmt(current.constraints.max_distance_to_target_m, 0)} unit="м" />
              </div>
              {current.warnings.map((w, i) => <div key={i} className="mt-3 text-[12.5px] text-warn">⚠ {tr(w)}</div>)}
              <p className="mt-3 text-[11.5px] text-dim">Производные величины рассчитаны ядром, а не браузером.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => { inputs.setSpacecraftId(current.id); setMsg(`«${current.name}» выбран для симуляции.`) }} data-testid="use-vehicle-btn">Использовать в симуляции</Button>
                <Link to="/simulation" className="inline-flex min-h-10 items-center rounded-md border border-line-2 bg-panel-2 px-4 text-[13px] hover:bg-panel-3" onClick={() => inputs.setSpacecraftId(current.id)}>Перейти к симуляции →</Link>
                <Button icon="edit" onClick={() => openEdit(current)} data-testid="edit-vehicle">Изменить</Button>
                <Button icon="copy" onClick={() => duplicate(current)}>Копия</Button>
                <Button icon="trash" variant="danger" onClick={() => setToDelete(current)} data-testid="delete-vehicle">Удалить</Button>
              </div>
            </Panel>
          )}
          {!current && vehicles.length > 0 && <Empty title="Выберите аппарат" icon="rocket">Нажмите на карточку, чтобы увидеть характеристики, изменить, копировать или удалить конфигурацию.</Empty>}
        </div>

        <div className="space-y-4">
          <Panel title="Демонстрационные шаблоны" icon="layers">
            <p className="mb-3 text-[12.5px] text-muted">Условные конфигурации для знакомства с платформой. Значения придуманы для демонстрации и <strong className="text-warn">не относятся к реальным аппаратам</strong>; они помечаются «ДЕМО».</p>
            <ul className="space-y-3">
              {DEMO_PRESETS.map((p) => (
                <li key={p.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2"><div className="text-[13.5px] font-medium">{p.title}</div><DemoBadge /></div>
                  <p className="mt-1 text-[12px] text-muted">{p.description}</p>
                  <div className="mt-2 flex gap-2"><Button size="sm" icon="plus" onClick={() => addPreset(p.id)} data-testid={`preset-${p.id}`}>Добавить в каталог</Button><Button size="sm" variant="ghost" onClick={() => openNew(formFromSpacecraft(p.payload), true)}>Открыть в редакторе</Button></div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Modal open={!!editor} wide title={editor?.id === null ? 'Новый аппарат' : `Изменение аппарата №${editor?.id}`} onClose={() => setEditor(null)}
        footer={<><Button onClick={() => setEditor(null)}>Отмена</Button><Button variant="primary" onClick={save} disabled={saving} data-testid="save-vehicle">{saving ? 'Сохранение…' : 'Проверить и сохранить'}</Button></>}>
        {editor && <VehicleForm value={editor.form} onChange={(f) => setEditor({ ...editor, form: f })} errors={formErrors} showErrors={showErr} isDemo={editor.demo} onDemo={(d) => setEditor({ ...editor, demo: d })} />}
        {showErr && Object.keys(formErrors).length > 0 && <div className="mt-3 text-[13px] text-bad">Исправьте поля с ошибками: {Object.keys(formErrors).length}.</div>}
        {error != null && <div className="mt-3"><ErrorBanner error={error} title="Ядро отклонило запрос" /></div>}
      </Modal>

      <ConfirmDialog open={!!toDelete} title="Удалить аппарат?" confirmLabel="Удалить аппарат" onConfirm={doDelete} onCancel={() => setToDelete(null)} busy={deleting}>
        Будет удалена конфигурация <strong>«{toDelete?.name}»</strong> (№{toDelete?.id}). Действие нельзя отменить. Если аппарат уже использован в симуляциях или миссиях, ядро откажет в удалении — в этом случае сохраните копию.
      </ConfirmDialog>

      <Modal open={compare} wide title="Сравнение аппаратов" onClose={() => setCompare(false)} footer={<Button onClick={() => setCompare(false)}>Закрыть</Button>}>
        <div className="overflow-x-auto"><table className="w-full text-[13px]" data-testid="compare-vehicles">
          <thead><tr className="text-left text-dim"><th className="py-2 pr-4 font-normal">Параметр</th>{compared.map((v) => <th key={v.id} className="px-3 font-medium text-ink">{v.name}{v.is_demo && <span className="ml-1.5"><DemoBadge /></span>}</th>)}</tr></thead>
          <tbody>{COMPARE_ROWS.map((r) => {
            const vals = compared.map((v) => r.get(v)); const nums = vals.filter((x): x is number => x !== null)
            const max = nums.length ? Math.max(...nums) : null
            return <tr key={r.label} className="border-t border-line"><td className="py-2 pr-4 text-muted">{r.label}{r.unit && <span className="text-dim">, {r.unit}</span>}</td>{vals.map((x, i) => <td key={i} className={`num px-3 ${x !== null && x === max && nums.length > 1 && new Set(nums).size > 1 ? 'text-cyan' : ''}`}>{x === null ? '—' : fmt(x, r.digits ?? 2)}</td>)}</tr>
          })}</tbody>
        </table></div>
        <p className="mt-3 text-[11.5px] text-dim">Подсвечено наибольшее значение в строке. Значения рассчитаны ядром.</p>
      </Modal>
    </div>
  )
}

import type { Check, Explanation, LandingAssessment, SubAssessment } from '../../api/types'
import { CLASS_RU, COMPONENT_RU, OVERALL_RU, STATUS_RU, UNCERTAINTY_RU, label, tr, trCheck } from '../../i18n/ru'
import { fmt, pct } from '../../lib/format'
import { Badge, Panel } from '../ui/ui'

type Tone = 'ok' | 'warn' | 'bad' | 'neutral'
const statusTone = (s: string): Tone => (s === 'within_limits' ? 'ok' : s === 'outside_limits' ? 'bad' : s === 'not_assessed' || s.startsWith('no_') || s.includes('outside_analysed') ? 'warn' : 'neutral')
const overallTone = (o: LandingAssessment['overall']): Tone => (o === 'limits_exceeded' ? 'bad' : o === 'within_all_assessed_limits' ? 'ok' : 'warn')
const UNIT_RU: Record<string, string> = { 'm/s': 'м/с', m: 'м', deg: '°', 'm/s^2': 'м/с²', kg: 'кг', fraction: 'доля' }
const u = (x: string) => UNIT_RU[x] ?? x

export function CheckTable({ checks }: { checks: Check[] }) {
  if (!checks.length) return <div className="text-[12px] text-dim">Проверки провести не удалось.</div>
  return (
    <table className="w-full text-[12.5px]">
      <thead><tr className="text-left text-dim"><th className="py-1 font-normal">Проверка</th><th className="font-normal">Значение</th><th className="font-normal">Лимит</th><th className="text-right font-normal">Статус</th></tr></thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.check} className="border-t border-line">
            <td className="py-1.5 pr-2 text-ink/90">{trCheck(c.check)}</td>
            <td className="num">{c.value === null ? '—' : `${fmt(c.value, 3)} ${u(c.unit)}`}</td>
            <td className="num text-muted">{c.limit === null ? '—' : `${fmt(c.limit, 3)} ${u(c.unit)}`}</td>
            <td className="text-right"><Badge tone={statusTone(c.status)}>{label(STATUS_RU, c.status)}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ExplanationView({ ex }: { ex: Explanation }) {
  return (
    <div className="space-y-3" data-testid="explanation">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone={ex.classification === 'geometrically_suitable' ? 'ok' : ex.classification === 'geometrically_unsuitable' ? 'bad' : 'warn'}>{label(CLASS_RU, ex.classification)}</Badge>
        <span className="text-muted">оценка пригодности</span><span className="num text-ink">{ex.suitability === null ? 'нет данных' : ex.suitability.toFixed(3)}</span>
      </div>
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-dim"><th className="font-normal">Критерий</th><th className="font-normal">Значение</th><th className="font-normal">Лимит</th><th className="font-normal">Оценка</th><th className="pl-3 font-normal">Вес</th></tr></thead>
        <tbody>
          {Object.entries(ex.components).map(([k, c]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5">{COMPONENT_RU[k] ?? k}</td>
              <td className="num">{c.value === null ? '—' : `${fmt(c.value, 2)} ${u(c.unit.split(' ')[0])}`}</td>
              <td className="num text-muted">{fmt(c.limit, 2)}</td>
              <td className="w-32 pr-1">
                <div className="flex items-center gap-1.5"><div className="h-1.5 flex-1 rounded bg-line"><div className="h-1.5 rounded bg-cyan" style={{ width: `${(c.score ?? 0) * 100}%` }} /></div><span className="num text-[11px]">{c.score === null ? '—' : c.score.toFixed(2)}</span></div>
              </td>
              <td className="num pl-3 text-muted">{pct(c.weight, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ex.notes.length > 0 && <ul className="list-inside list-disc text-[12px] text-warn">{ex.notes.map((n, i) => <li key={i}>{tr(n)}</li>)}</ul>}
      <p className="text-[11px] text-dim">{tr(ex.disclaimer)}</p>
    </div>
  )
}

function Sub({ title, a }: { title: string; a: SubAssessment }) {
  return (
    <Panel title={title} actions={<Badge tone={statusTone(a.status)}>{label(STATUS_RU, a.status)}</Badge>}>
      <CheckTable checks={a.checks} />
      {a.footprint && <div className="num mt-3 text-[11.5px] text-muted">пятно r = {fmt(a.footprint.radius_m, 2)} м · наклон плоскости {fmt(a.footprint.best_fit_plane_tilt_deg, 2)}° · макс. уклон {fmt(a.footprint.max_slope_deg, 2)}° · перепад {fmt(a.footprint.relief_m, 2)} м · пропуски {pct(a.footprint.missing_fraction)}</div>}
      {a.fuel_remaining_kg !== undefined && <div className="num mt-3 text-[11.5px] text-muted">остаток топлива {fmt(a.fuel_remaining_kg, 1)} кг ({pct(a.fuel_fraction_remaining ?? null)})</div>}
      {a.issues.length > 0 && <ul className="mt-3 list-inside list-disc text-[12.5px] text-bad">{a.issues.map((n, i) => <li key={i}>{tr(n)}</li>)}</ul>}
      {a.notes?.map((n, i) => <p key={i} className="mt-1.5 text-[11px] text-dim">{tr(n)}</p>)}
    </Panel>
  )
}

/** Renders the core's landing assessment (separate surface / trajectory / vehicle assessments), translated, never reinterpreted. */
export function AssessmentPanel({ a }: { a: LandingAssessment }) {
  return (
    <div className="space-y-4" data-testid="assessment">
      <Panel title="Оценка посадки" icon="check" actions={<Badge tone={overallTone(a.overall)}>{label(OVERALL_RU, a.overall)}</Badge>}>
        <p className="text-[13px] text-ink/90">{tr(a.explanation)}</p>
        {a.issues.length > 0 && (
          <div className="mt-3"><div className="text-[11px] uppercase tracking-wider text-dim">Выявленные проблемы</div>
            <ul className="mt-1.5 list-inside list-disc text-[13px] text-bad">{a.issues.map((n, i) => <li key={i}>{tr(n)}</li>)}</ul></div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><div className="text-[11px] uppercase tracking-wider text-dim">Неопределённость</div>
            <div className="mt-1.5 text-[13px]">Уровень: <span className="text-warn">{label(UNCERTAINTY_RU, a.uncertainty.level)}</span></div>
            <ul className="mt-1.5 list-inside list-disc text-[12px] text-muted">{a.uncertainty.factors.map((f, i) => <li key={i}>{tr(f)}</li>)}</ul>
            {a.uncertainty.min_resolvable_feature_m !== undefined && <div className="num mt-1.5 text-[11px] text-dim">минимально различимый объект ≈ {fmt(a.uncertainty.min_resolvable_feature_m, 1)} м · вертикальная точность DEM: {typeof a.uncertainty.dem_vertical_accuracy_m === 'string' ? 'не указана в метаданных' : fmt(a.uncertainty.dem_vertical_accuracy_m ?? null, 2)}</div>}
          </div>
          <div><div className="text-[11px] uppercase tracking-wider text-dim">Ограничения модели</div>
            <ul className="mt-1.5 list-inside list-disc text-[12px] text-muted">{a.limitations.map((f, i) => <li key={i}>{tr(f)}</li>)}</ul></div>
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Sub title="Поверхность" a={a.surface_assessment} />
        <Sub title="Траектория" a={a.trajectory_assessment} />
        <Sub title="Аппарат" a={a.vehicle_assessment} />
      </div>
      {a.surface_assessment.explanation && <Panel title="Почему такая оценка поверхности"><ExplanationView ex={a.surface_assessment.explanation} /></Panel>}
    </div>
  )
}

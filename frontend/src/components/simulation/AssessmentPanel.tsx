import type { Check, Explanation, LandingAssessment, SubAssessment } from '../../api/types'
import { fmt, humanize, pct } from '../../lib/format'
import { Badge, Panel } from '../ui/ui'

type Tone = 'ok' | 'warn' | 'bad' | 'neutral'
const statusTone = (s: string): Tone => (s === 'within_limits' ? 'ok' : s === 'outside_limits' ? 'bad' : s === 'not_assessed' || s.startsWith('no_') || s.includes('outside_analysed') ? 'warn' : 'neutral')
const overallTone = (o: LandingAssessment['overall']): Tone => (o === 'limits_exceeded' ? 'bad' : o === 'within_all_assessed_limits' ? 'ok' : 'warn')

export function CheckTable({ checks }: { checks: Check[] }) {
  if (!checks.length) return <div className="text-[11px] text-dim">No checks were possible.</div>
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-left text-dim"><th className="py-0.5 font-normal">Check</th><th className="font-normal">Value</th><th className="font-normal">Limit</th><th className="text-right font-normal">Status</th></tr></thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.check} className="border-t border-line">
            <td className="py-1 pr-2 text-ink/90">{c.check}</td>
            <td className="num">{c.value === null ? '—' : `${fmt(c.value, 3)} ${c.unit}`}</td>
            <td className="num text-muted">{c.limit === null ? '—' : `${fmt(c.limit, 3)} ${c.unit}`}</td>
            <td className="text-right"><Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ExplanationView({ ex }: { ex: Explanation }) {
  return (
    <div className="space-y-2" data-testid="explanation">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={ex.classification === 'geometrically_suitable' ? 'ok' : ex.classification === 'geometrically_unsuitable' ? 'bad' : 'warn'}>{humanize(ex.classification)}</Badge>
        <span className="text-muted">suitability score</span><span className="num text-ink">{ex.suitability === null ? 'no data' : ex.suitability.toFixed(3)}</span>
      </div>
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-dim"><th className="font-normal">Criterion</th><th className="font-normal">Value</th><th className="font-normal">Limit</th><th className="font-normal">Score</th><th className="font-normal">Weight</th></tr></thead>
        <tbody>
          {Object.entries(ex.components).map(([k, c]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1 capitalize">{k}</td>
              <td className="num">{c.value === null ? '—' : `${fmt(c.value, 2)} ${c.unit.split(' ')[0]}`}</td>
              <td className="num text-muted">{fmt(c.limit, 2)}</td>
              <td className="w-28 pr-1">
                <div className="flex items-center gap-1.5"><div className="h-1.5 flex-1 rounded bg-line"><div className="h-1.5 rounded bg-cyan" style={{ width: `${(c.score ?? 0) * 100}%` }} /></div><span className="num text-[10px]">{c.score === null ? '—' : c.score.toFixed(2)}</span></div>
              </td>
              <td className="num pl-3 text-muted">{pct(c.weight, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ex.notes.length > 0 && <ul className="list-inside list-disc text-[11px] text-warn">{ex.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <p className="text-[10px] text-dim">{ex.disclaimer}</p>
    </div>
  )
}

function Sub({ title, a }: { title: string; a: SubAssessment }) {
  return (
    <Panel title={title} actions={<Badge tone={statusTone(a.status)}>{humanize(a.status)}</Badge>}>
      <CheckTable checks={a.checks} />
      {a.footprint && <div className="num mt-2 text-[10px] text-muted">footprint r = {fmt(a.footprint.radius_m, 2)} m · plane tilt {fmt(a.footprint.best_fit_plane_tilt_deg, 2)}° · max slope {fmt(a.footprint.max_slope_deg, 2)}° · relief {fmt(a.footprint.relief_m, 2)} m · missing {pct(a.footprint.missing_fraction)}</div>}
      {a.fuel_remaining_kg !== undefined && <div className="num mt-2 text-[10px] text-muted">fuel remaining {fmt(a.fuel_remaining_kg, 1)} kg ({pct(a.fuel_fraction_remaining ?? null)})</div>}
      {a.issues.length > 0 && <ul className="mt-2 list-inside list-disc text-[11px] text-bad">{a.issues.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {a.notes?.map((n, i) => <p key={i} className="mt-1 text-[10px] text-dim">{n}</p>)}
    </Panel>
  )
}

/** Renders the core's landing assessment verbatim (separate surface / trajectory / vehicle assessments). */
export function AssessmentPanel({ a }: { a: LandingAssessment }) {
  return (
    <div className="space-y-3" data-testid="assessment">
      <Panel title="Landing assessment" actions={<Badge tone={overallTone(a.overall)}>{humanize(a.overall)}</Badge>}>
        <p className="text-xs text-ink/90">{a.explanation}</p>
        {a.issues.length > 0 && (
          <div className="mt-2"><div className="text-[10px] uppercase tracking-wider text-dim">Identified issues</div>
            <ul className="mt-1 list-inside list-disc text-xs text-bad">{a.issues.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><div className="text-[10px] uppercase tracking-wider text-dim">Uncertainty</div>
            <div className="mt-1 text-xs">Level: <span className="text-warn">{humanize(a.uncertainty.level)}</span></div>
            <ul className="mt-1 list-inside list-disc text-[11px] text-muted">{a.uncertainty.factors.map((f, i) => <li key={i}>{f}</li>)}</ul>
            {a.uncertainty.min_resolvable_feature_m !== undefined && <div className="num mt-1 text-[10px] text-dim">min resolvable feature ≈ {fmt(a.uncertainty.min_resolvable_feature_m, 1)} m · DEM vertical accuracy: {String(a.uncertainty.dem_vertical_accuracy_m ?? 'n/a')}</div>}
          </div>
          <div><div className="text-[10px] uppercase tracking-wider text-dim">Model limitations</div>
            <ul className="mt-1 list-inside list-disc text-[11px] text-muted">{a.limitations.map((f, i) => <li key={i}>{f}</li>)}</ul></div>
        </div>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-3">
        <Sub title="Surface" a={a.surface_assessment} />
        <Sub title="Trajectory" a={a.trajectory_assessment} />
        <Sub title="Vehicle" a={a.vehicle_assessment} />
      </div>
      {a.surface_assessment.explanation && <Panel title="Why this surface score"><ExplanationView ex={a.surface_assessment.explanation} /></Panel>}
    </div>
  )
}

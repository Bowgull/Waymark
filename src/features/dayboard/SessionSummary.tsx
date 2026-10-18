import { useEffect, useState, type ReactNode } from 'react'

import { FlapButton } from '@/design'
import { apiFetch } from '@/lib/api'
import { foundationLevel } from '@/lib/foundation'
import { getSessionIntent } from '@/lib/sessionIntent'
import { estimatedMinutes } from '@/lib/coach/sessions'

import {
  actualMinutes,
  doneHeadline,
  minutesLine,
  planLiftLine,
  rowStatus,
  runDiffLines,
  strengthDiffLines,
  type DayBoardSession,
  type DiffLine,
  type RunActuals,
  type RunPlan,
  type WorkoutExercise,
} from './rowState'
import './dayboard.css'

// The summary that opens in place on a day board row (page 33, d1 / d3 / d6).
// A to-do shows what's coming (the lifts and weights, the pace, the
// routine) with small REPLACE / SKIP flap buttons; a done session shows what
// was actually done, plan vs actual (rowState.ts). It fetches its own data
// from the existing per-type endpoints, so Today can drop it into a row.

export interface SessionSummaryProps {
  session: DayBoardSession
  /** The block week: Foundation's level (Block Zero weeks 1-2 level 1, 3-4 level 2, then 3). */
  weekNumber?: number | null
  onReplace?: () => void
  onSkip?: () => void
  /** Extra buttons after REPLACE / SKIP (Today's START). */
  actions?: ReactNode
}

interface RunPrescription extends RunPlan {
  targetDesc?: string | null
}

type SummaryData =
  | { kind: 'strength'; exercises: WorkoutExercise[]; notes: string[] }
  | { kind: 'run'; plan: RunPrescription | null; run: RunActuals | null }
  | { kind: 'mobility'; moves: Array<{ name: string; completed: boolean }> }
  | { kind: 'bag'; rounds: number; plannedMin: number | null }
  | { kind: 'rope'; rounds: number | null; roundSec: number | null }
  | { kind: 'mt'; plannedMin: number | null; durationMin: number | null; classType: string | null; focus: string | null }
  | { kind: 'recovery'; hip: boolean | null; foam: boolean | null }
  | { kind: 'none' }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** The coach's reasons for today's loads, from the strength preview. */
function coachNotes(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as { coach?: Record<string, unknown>; blockZero?: Record<string, unknown> }
  const out: string[] = []
  const coach = r.coach ?? {}
  const ramp = coach.returnRamp as { reason?: unknown } | null | undefined
  const ease = coach.coachEase as { reason?: unknown } | null | undefined
  const injury = coach.injury as { note?: unknown } | null | undefined
  for (const v of [ramp?.reason, ease?.reason, injury?.note]) {
    const s = str(v)
    if (s) out.push(s)
  }
  if (Array.isArray(coach.notes)) for (const n of coach.notes) { const s = str(n); if (s) out.push(s) }
  const auto = r.blockZero?.autoEase as { eased?: unknown; reason?: unknown } | undefined
  if (auto?.eased) { const s = str(auto.reason); if (s) out.push(s) }
  return [...new Set(out)]
}

async function loadSummary(s: DayBoardSession): Promise<SummaryData> {
  const done = rowStatus(s.status) === 'done'
  switch (s.type) {
    case 'strength': {
      // A started or finished session reads its logged rows; a planned one the preview.
      const res = await apiFetch<{ exercises?: WorkoutExercise[] } & Record<string, unknown>>(done ? `/api/sessions/${s.id}/workout` : `/api/sessions/${s.id}/strength-preview`)
      return { kind: 'strength', exercises: res.exercises ?? [], notes: done ? [] : coachNotes(res) }
    }
    case 'running':
    case 'foundation_run': {
      const path = s.type === 'foundation_run' ? 'foundation-run-workout' : 'run-workout'
      const res = await apiFetch<{ runSession: RunActuals | null; prescription: RunPrescription | null }>(`/api/sessions/${s.id}/${path}`)
      return { kind: 'run', plan: res.prescription ?? null, run: res.runSession ?? s.runSession ?? null }
    }
    case 'mobility': {
      const res = await apiFetch<{ exercises?: Array<{ completed?: number | boolean; exercise?: { name: string } | null }> }>(`/api/sessions/${s.id}/mobility-workout`)
      return { kind: 'mobility', moves: (res.exercises ?? []).map(e => ({ name: e.exercise?.name ?? 'Move', completed: e.completed === 1 || e.completed === true })) }
    }
    case 'bag_work': {
      const res = await apiFetch<{ rounds?: Array<{ durationSec: number; restSec: number }> }>(`/api/sessions/${s.id}/bag-workout`)
      const rounds = res.rounds ?? []
      const sec = rounds.reduce((n, r) => n + r.durationSec + r.restSec, 0)
      return { kind: 'bag', rounds: rounds.length, plannedMin: sec > 0 ? Math.round(sec / 60) : null }
    }
    case 'skip_rope': {
      const res = await apiFetch<{ skipSession: { roundCount: number; roundDurSec: number } | null }>(`/api/sessions/${s.id}/skip-rope-workout`)
      return { kind: 'rope', rounds: res.skipSession?.roundCount ?? null, roundSec: res.skipSession?.roundDurSec ?? null }
    }
    case 'mt_class': {
      const res = await apiFetch<{ mtLog: { classType: string | null; focusSkill: string | null; durationMin: number | null } | null; plannedMin?: number | null }>(`/api/sessions/${s.id}/mt-class-workout`)
      return { kind: 'mt', plannedMin: res.plannedMin ?? null, durationMin: res.mtLog?.durationMin ?? null, classType: res.mtLog?.classType ?? null, focus: res.mtLog?.focusSkill ?? null }
    }
    case 'active_recovery': {
      const res = await apiFetch<{ recoverySession: { hipMobility: number; foamRolling: number } | null }>(`/api/sessions/${s.id}/recovery-workout`)
      const r = res.recoverySession
      return { kind: 'recovery', hip: r ? r.hipMobility === 1 : null, foam: r ? r.foamRolling === 1 : null }
    }
    default:
      return { kind: 'none' }
  }
}

/**
 * The planned length of a timed session (the run's prescription, the class,
 * the rounds): what a done headline compares against. Strength and
 * Foundation have no planned length, only the coach's rough planning
 * minutes, so their headline stays plain.
 */
function plannedMinutes(data: SummaryData | null): number | null {
  if (data?.kind === 'run' && data.plan?.targetDurSec) return Math.round(data.plan.targetDurSec / 60)
  if (data?.kind === 'mt' && data.plannedMin) return data.plannedMin
  if (data?.kind === 'bag' && data.plannedMin) return data.plannedMin
  if (data?.kind === 'rope' && data.rounds && data.roundSec) return Math.round((data.rounds * data.roundSec) / 60)
  return null
}

/** About how long a to-do takes: the plan's own numbers, else the coach's planning minutes. */
function aboutMinutes(s: DayBoardSession, data: SummaryData | null, weekNumber: number | null | undefined): number {
  return plannedMinutes(data) ?? estimatedMinutes({ type: s.type, notes: s.notes ?? null, estimatedMin: null }, s.blockType === 'block_zero' ? 'block_zero' : 'fighter', weekNumber ?? s.blockWeek ?? 1)
}

function isZone2(s: DayBoardSession, plan: RunPrescription | null): boolean {
  return s.type === 'foundation_run' || s.notes === 'zone2' || s.blockType === 'block_zero' || (plan?.z2CeilingBpm != null && s.notes !== 'progression')
}

function plain(label: string, text: string): DiffLine {
  return { label, parts: [{ text, lifted: false }], chip: null, band: null }
}

/** The to-do side: one line of prose and the plan lines. */
function planView(s: DayBoardSession, data: SummaryData | null, weekNumber: number | null | undefined): { prose: string[]; lines: DiffLine[] } {
  const prose: string[] = []
  const lines: DiffLine[] = []
  switch (data?.kind) {
    case 'strength':
      prose.push(...data.notes)
      for (const ex of data.exercises) if (ex.section !== 'warmup') lines.push(planLiftLine(ex))
      break
    case 'run': {
      const p = data.plan
      if (p?.targetDesc) prose.push(p.targetDesc)
      else prose.push(getSessionIntent(s.type))
      if (p?.targetDurSec) lines.push(plain('TIME', `${Math.round(p.targetDurSec / 60)} min`))
      if (p?.targetDistKm) lines.push(plain('DISTANCE', `${p.targetDistKm} km`))
      if (p?.z2CeilingBpm && isZone2(s, p)) lines.push(plain('HR CAP', `under ${p.z2CeilingBpm} bpm`))
      break
    }
    case 'mobility': {
      const level = foundationLevel(s.blockType === 'block_zero' ? weekNumber ?? null : null)
      prose.push(`Back block, then the neck and shoulder block. Level ${level}.`)
      if (data.moves.length > 0) lines.push(plain('MOVES', String(data.moves.length)))
      break
    }
    case 'bag':
      prose.push(getSessionIntent(s.type))
      if (data.rounds > 0) lines.push(plain('ROUNDS', String(data.rounds)))
      break
    case 'rope':
      prose.push(getSessionIntent(s.type))
      if (data.rounds && data.roundSec) lines.push(plain('ROUNDS', `${data.rounds} × ${Math.round(data.roundSec / 60)} min`))
      break
    case 'mt':
      prose.push(getSessionIntent(s.type))
      if (data.plannedMin) lines.push(plain('CLASS', `${data.plannedMin} min`))
      break
    default:
      prose.push(getSessionIntent(s.type))
  }
  if (lines.length === 0 && !(data?.kind === 'run' && data.plan?.targetDurSec)) {
    lines.push(plain('ABOUT', `${aboutMinutes(s, data, weekNumber)} min`))
  }
  return { prose, lines }
}

/** The done side: the headline and plan vs actual. */
function doneView(s: DayBoardSession, data: SummaryData | null): { head: DiffLine; lines: DiffLine[]; note: string | null } {
  const run = data?.kind === 'run' ? data.run ?? s.runSession ?? null : s.runSession ?? null
  const actual = actualMinutes(s) ?? (run?.durationSec ? Math.round(run.durationSec / 60) : null)
  const head = doneHeadline(actual, plannedMinutes(data), { rpe: s.rpe ?? null, from: run?.source === 'strava' ? 'Strava' : null })
  const lines: DiffLine[] = []
  let note: string | null = null
  switch (data?.kind) {
    case 'strength':
      lines.push(...strengthDiffLines(data.exercises))
      break
    case 'run':
      if (run) lines.push(...runDiffLines(run, data.plan, { zone2: isZone2(s, data.plan) }))
      break
    case 'mobility': {
      const total = data.moves.length
      const did = data.moves.filter(m => m.completed).length
      if (total > 0 && did > 0) {
        lines.push(did < total
          ? { label: 'MOVES', parts: [{ text: `${did}`, lifted: true }, { text: ` of ${total}`, lifted: false }], chip: `−${total - did}`, band: 'down' }
          : plain('MOVES', `${did} of ${total}`))
      }
      break
    }
    case 'bag':
      if (data.rounds > 0) lines.push(plain('ROUNDS', String(data.rounds)))
      break
    case 'rope':
      if (data.rounds && data.roundSec) lines.push(plain('ROUNDS', `${data.rounds} × ${Math.round(data.roundSec / 60)} min`))
      break
    case 'mt': {
      const cls = minutesLine('CLASS', data.durationMin, data.plannedMin)
      if (cls) lines.push(cls)
      if (data.classType) lines.push(plain('TYPE', data.classType.toUpperCase()))
      if (data.focus) note = `Focus: ${data.focus}`
      break
    }
    case 'recovery':
      if (data.hip != null) lines.push(plain('HIP MOBILITY', data.hip ? '✓' : '·'))
      if (data.foam != null) lines.push(plain('FOAM ROLLING', data.foam ? '✓' : '·'))
      break
  }
  return { head, lines, note }
}

function Chip({ line }: { line: DiffLine }) {
  if (!line.chip || !line.band) return null
  return <i className={`db-dv ${line.band === 'up' ? 'is-up' : 'is-dn'}`}>{line.chip}</i>
}

/** The parts, the lifted value, and its chip right after it ("52 min +7 min · RPE 7"). */
function Parts({ line }: { line: DiffLine }) {
  const at = line.parts.findIndex(p => p.lifted)
  const chipAt = at >= 0 ? at : line.parts.length - 1
  return (
    <>
      {line.parts.map((p, i) => (
        <span key={i}>
          {p.lifted ? <b className="db-chg">{p.text}</b> : p.text}
          {i === chipAt && <Chip line={line} />}
        </span>
      ))}
    </>
  )
}

function Line({ line }: { line: DiffLine }) {
  return (
    <div className={`db-lift${line.band === 'up' ? ' is-up' : line.band === 'down' ? ' is-dn' : ''}`}>
      <span>{line.label}</span>
      <span><Parts line={line} /></span>
    </div>
  )
}

export function SessionSummary({ session, weekNumber, onReplace, onSkip, actions }: SessionSummaryProps) {
  const key = `${session.id}:${session.status}`
  const [loaded, setLoaded] = useState<{ key: string; data: SummaryData | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadSummary(session)
      .then(data => { if (!cancelled) setLoaded({ key, data }) })
      .catch(() => { if (!cancelled) setLoaded({ key, data: null }) })
    return () => { cancelled = true }
    // The key covers the fields the fetch reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const status = rowStatus(session.status)
  const ready = loaded?.key === key
  const data = ready ? loaded.data : null
  const todo = status === 'todo'

  return (
    <div className="db-sum">
      {!ready ? (
        <p className="db-sum-p is-dim">Reading the plan.</p>
      ) : status === 'done' ? (
        (() => {
          const v = doneView(session, data)
          return (
            <>
              <p className={`db-sum-p${v.head.band === 'up' ? ' db-band is-up' : v.head.band === 'down' ? ' db-band is-dn' : ' is-done'}`}>
                <Parts line={v.head} />
              </p>
              {v.lines.length > 0 && <div className="db-lifts">{v.lines.map((l, i) => <Line key={`${l.label}-${i}`} line={l} />)}</div>}
              {v.note && <p className="db-sum-p is-dim">{v.note}</p>}
            </>
          )
        })()
      ) : (
        (() => {
          const v = planView(session, data, weekNumber)
          return (
            <>
              {v.prose.map((p, i) => <p key={i} className="db-sum-p">{p}</p>)}
              {v.lines.length > 0 && <div className="db-lifts">{v.lines.map((l, i) => <Line key={`${l.label}-${i}`} line={l} />)}</div>}
            </>
          )
        })()
      )}
      {((todo && (onReplace || onSkip)) || actions) && (
        <div className="db-minis">
          {todo && onReplace && <FlapButton label="REPLACE" primary size="xs" onClick={e => { e.stopPropagation(); onReplace() }} />}
          {todo && onSkip && <FlapButton label="SKIP" size="xs" onClick={e => { e.stopPropagation(); onSkip() }} />}
          {actions}
        </div>
      )}
    </div>
  )
}

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
  roundDiffLines,
  rowStatus,
  runDiffLines,
  strengthDiffLines,
  strengthWeekLine,
  easedOneSet,
  topLiftsLine,
  zone2PlanLine,
  runWalkPlanLine,
  runWalkShapeFor,
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
  /**
   * 'program' (page 33): the summary panel under the row, small REPLACE / SKIP.
   * 'today' (pages 20, 35): in the row, the intent and top lifts, then
   * full-width ENTER / REPLACE / SKIP (`actions`); a done one reads "effort 7".
   */
  variant?: 'program' | 'today'
  /** Today's buttons (ENTER / REPLACE / SKIP), full width under the lines. */
  actions?: ReactNode
  /**
   * A class finished today with "What you learned" skipped (page 49, if
   * skipped): the opened row's one small line, + What you learned, opens the box.
   */
  onLearned?: (mtLogId: string) => void
}

interface RunPrescription extends RunPlan {
  targetDesc?: string | null
  /** A Block Zero run-walk as prescribed (caps included). */
  runWalk?: { runSec: number; walkSec: number; rounds: number; warmupSec: number } | null
}

type SummaryData =
  | { kind: 'strength'; exercises: WorkoutExercise[]; notes: string[]; plannedMin: number | null }
  | { kind: 'run'; plan: RunPrescription | null; run: RunActuals | null }
  | { kind: 'mobility'; moves: Array<{ name: string; completed: boolean }>; plannedMin: number | null }
  | { kind: 'bag'; rounds: number; plannedMin: number | null; plannedSecs: number[]; roundSecs: number[] | null }
  | { kind: 'rope'; rounds: number | null; roundSec: number | null; plannedMin: number | null; roundSecs: number[] | null }
  | { kind: 'mt'; plannedMin: number | null; durationMin: number | null; classType: string | null; focus: string | null; mtLogId: string | null; learned: boolean }
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
      const res = await apiFetch<{ exercises?: WorkoutExercise[]; plannedMin?: number | null } & Record<string, unknown>>(done ? `/api/sessions/${s.id}/workout` : `/api/sessions/${s.id}/strength-preview`)
      return { kind: 'strength', exercises: res.exercises ?? [], notes: done ? [] : coachNotes(res), plannedMin: typeof res.plannedMin === 'number' ? res.plannedMin : null }
    }
    case 'running':
    case 'foundation_run': {
      const path = s.type === 'foundation_run' ? 'foundation-run-workout' : 'run-workout'
      const res = await apiFetch<{ runSession: RunActuals | null; prescription: RunPrescription | null }>(`/api/sessions/${s.id}/${path}`)
      return { kind: 'run', plan: res.prescription ?? null, run: res.runSession ?? s.runSession ?? null }
    }
    case 'mobility': {
      const res = await apiFetch<{ exercises?: Array<{ completed?: number | boolean; exercise?: { name: string } | null }>; plannedMin?: number | null }>(`/api/sessions/${s.id}/mobility-workout`)
      return { kind: 'mobility', moves: (res.exercises ?? []).map(e => ({ name: e.exercise?.name ?? 'Move', completed: e.completed === 1 || e.completed === true })), plannedMin: res.plannedMin ?? null }
    }
    case 'bag_work': {
      const res = await apiFetch<{ rounds?: Array<{ durationSec: number; restSec: number }>; plannedMin?: number | null; roundSecs?: number[] | null }>(`/api/sessions/${s.id}/bag-workout`)
      const rounds = res.rounds ?? []
      return { kind: 'bag', rounds: rounds.length, plannedMin: res.plannedMin ?? null, plannedSecs: rounds.map(r => r.durationSec), roundSecs: res.roundSecs ?? null }
    }
    case 'skip_rope': {
      const res = await apiFetch<{ skipSession: { roundCount: number; roundDurSec: number } | null; plannedMin?: number | null; roundSecs?: number[] | null }>(`/api/sessions/${s.id}/skip-rope-workout`)
      return { kind: 'rope', rounds: res.skipSession?.roundCount ?? null, roundSec: res.skipSession?.roundDurSec ?? null, plannedMin: res.plannedMin ?? null, roundSecs: res.roundSecs ?? null }
    }
    case 'mt_class': {
      const res = await apiFetch<{ mtLog: { id: string; classType: string | null; focusSkill: string | null; durationMin: number | null; learnedNote?: string | null } | null; plannedMin?: number | null }>(`/api/sessions/${s.id}/mt-class-workout`)
      return { kind: 'mt', plannedMin: res.plannedMin ?? null, durationMin: res.mtLog?.durationMin ?? null, classType: res.mtLog?.classType ?? null, focus: res.mtLog?.focusSkill ?? null, mtLogId: res.mtLog?.id ?? null, learned: Boolean(res.mtLog?.learnedNote) }
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
 * The planned length a done headline compares against (page 33's "+7 min"):
 * the run's prescription, the class, the rounds, and strength and Foundation
 * from their own sets and routine (the server's plannedMin).
 */
function plannedMinutes(data: SummaryData | null): number | null {
  if (data?.kind === 'run' && data.plan?.targetDurSec) return Math.round(data.plan.targetDurSec / 60)
  if (data?.kind === 'mt' && data.plannedMin) return data.plannedMin
  if ((data?.kind === 'bag' || data?.kind === 'rope' || data?.kind === 'strength' || data?.kind === 'mobility') && data.plannedMin) return data.plannedMin
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
  // Page 56 1A: a Block Zero run-walk opens to its rounds in one line, nothing else.
  if (s.type === 'foundation_run' && s.blockType === 'block_zero') {
    const rw = data?.kind === 'run' ? data.plan?.runWalk ?? null : null
    return { prose: [runWalkPlanLine(rw ?? runWalkShapeFor(s, weekNumber ?? s.blockWeek ?? 1))], lines: [] }
  }
  switch (data?.kind) {
    case 'strength': {
      const week = strengthWeekLine(s.blockType, weekNumber ?? s.blockWeek, easedOneSet(s.contextJson))
      if (week) prose.push(week)
      prose.push(...data.notes)
      if (prose.length === 0) prose.push(getSessionIntent(s.type))
      for (const ex of data.exercises) if (ex.section !== 'warmup') lines.push(planLiftLine(ex))
      break
    }
    case 'run': {
      const p = data.plan
      // Page 33: one line for an easy run ("Easy, conversational pace. Heart rate under 142, ...").
      if (isZone2(s, p)) { prose.push(zone2PlanLine(s.label, p?.z2CeilingBpm, p?.targetDurSec ? Math.round(p.targetDurSec / 60) : null)); break }
      if (p?.targetDesc) prose.push(p.targetDesc)
      else prose.push(getSessionIntent(s.type))
      if (p?.targetDurSec) lines.push(plain('TIME', `${Math.round(p.targetDurSec / 60)} min`))
      if (p?.targetDistKm) lines.push(plain('DISTANCE', `${p.targetDistKm} km`))
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
  if (lines.length === 0 && data?.kind !== 'run' && data?.kind !== 'mobility') {
    lines.push(plain('ABOUT', `${aboutMinutes(s, data, weekNumber)} min`))
  }
  return { prose, lines }
}

/** The done side: the headline and plan vs actual. */
function doneView(s: DayBoardSession, data: SummaryData | null, weekNumber: number | null | undefined, effortWord: 'RPE' | 'effort'): { lead: string | null; head: DiffLine; lines: DiffLine[]; note: string | null } {
  const run = data?.kind === 'run' ? data.run ?? s.runSession ?? null : s.runSession ?? null
  const actual = actualMinutes(s) ?? (run?.durationSec ? Math.round(run.durationSec / 60) : null)
  const head = doneHeadline(actual, plannedMinutes(data), { rpe: s.rpe ?? null, from: run?.source === 'strava' ? 'Strava' : null, effortWord })
  const lines: DiffLine[] = []
  let note: string | null = null
  let lead: string | null = null
  switch (data?.kind) {
    case 'strength':
      lines.push(...strengthDiffLines(data.exercises))
      break
    case 'run':
      if (run) lines.push(...runDiffLines(run, data.plan, { zone2: isZone2(s, data.plan) }))
      break
    case 'mobility': {
      // Page 33: the routine line first, then the done line; a move short of the plan gets its clay band.
      lead = `Back block, then the neck and shoulder block. Level ${foundationLevel(s.blockType === 'block_zero' ? weekNumber ?? null : null)}.`
      const total = data.moves.length
      const did = data.moves.filter(m => m.completed).length
      if (total > 0 && did > 0 && did < total) {
        lines.push({ label: 'MOVES', parts: [{ text: `${did}`, lifted: true }, { text: ` of ${total}`, lifted: false }], chip: `−${total - did}`, band: 'down' })
      }
      break
    }
    case 'bag':
      if (data.roundSecs && data.roundSecs.length > 0) lines.push(...roundDiffLines(data.roundSecs, data.plannedSecs))
      else if (data.rounds > 0) lines.push(plain('ROUNDS', String(data.rounds)))
      break
    case 'rope':
      if (data.roundSecs && data.roundSecs.length > 0) lines.push(...roundDiffLines(data.roundSecs, Array.from({ length: data.rounds ?? 0 }, () => data.roundSec ?? 0)))
      else if (data.rounds && data.roundSec) lines.push(plain('ROUNDS', `${data.rounds} × ${Math.round(data.roundSec / 60)} min`))
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
  return { lead, head, lines, note }
}

/** Page 33's quiet note under a done summary with bands (Program only; Today leaves it out, page 35). */
function bandNote(data: SummaryData | null, lines: DiffLine[]): string | null {
  if (!lines.some(l => l.band)) return null
  if (data?.kind === 'run' && lines.some(l => l.label === 'AVG HR' && l.band === 'down')) return "Heart rate over your Zone 2 cap shows clay: that's the miss on an easy day."
  return 'Teal went up, clay fell short. Plain lines went as planned.'
}

function Chip({ line }: { line: DiffLine }) {
  if (!line.chip || !line.band) return null
  return <i className={`db-dv ${line.band === 'up' ? 'is-up' : 'is-dn'}`}>{line.chip}</i>
}

/**
 * The parts with the lifted value and its chip (page 33): on the headline the
 * chip follows the lifted value ("52 min +7 min · RPE 7"); on a lift line it
 * closes the line ("2×7 · 115 −1 rep").
 */
function Parts({ line, chipAfterLifted = false }: { line: DiffLine; chipAfterLifted?: boolean }) {
  const at = chipAfterLifted ? line.parts.findIndex(p => p.lifted) : -1
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

export function SessionSummary({ session, weekNumber, onReplace, onSkip, variant = 'program', actions, onLearned }: SessionSummaryProps) {
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
  const today = variant === 'today'

  // Today, a session to do (page 20): the intent line, the top lifts, then ENTER / REPLACE / SKIP full width.
  if (today && status !== 'done') {
    const lifts = data?.kind === 'strength' ? topLiftsLine(data.exercises) : null
    return (
      <div className="db-today">
        <p className="db-today-p">{getSessionIntent(session.type)}</p>
        {lifts && <p className="db-today-p">{lifts}</p>}
        {actions && <div className="wm-btns">{actions}</div>}
      </div>
    )
  }

  return (
    <div className={today ? 'db-sumx' : 'db-sum'}>
      {!ready ? (
        <p className="db-sum-p is-dim">Reading the plan.</p>
      ) : status === 'done' ? (
        (() => {
          const v = doneView(session, data, weekNumber, today ? 'effort' : 'RPE')
          const note = today ? null : bandNote(data, [v.head, ...v.lines])
          return (
            <>
              {v.lead && <p className="db-sum-p">{v.lead}</p>}
              <p className={`db-sum-p is-done${v.head.band === 'up' ? ' db-band is-up' : v.head.band === 'down' ? ' db-band is-dn' : ''}`}>
                <Parts line={v.head} chipAfterLifted />
              </p>
              {v.lines.length > 0 && <div className="db-lifts">{v.lines.map((l, i) => <Line key={`${l.label}-${i}`} line={l} />)}</div>}
              {v.note && <p className="db-sum-p is-dim">{v.note}</p>}
              {note && <p className="db-dimnote">{note}</p>}
              {today && onLearned && data?.kind === 'mt' && data.mtLogId && !data.learned && (
                <p className="db-sum-p db-learned">
                  <button type="button" className="db-learned-lnk" onClick={e => { e.stopPropagation(); onLearned(data.mtLogId!) }}>+ What you learned</button>
                </p>
              )}
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
      {todo && (onReplace || onSkip) && (
        <div className="db-minis">
          {onReplace && <FlapButton label="REPLACE" primary size="xs" onClick={e => { e.stopPropagation(); onReplace() }} />}
          {onSkip && <FlapButton label="SKIP" size="xs" onClick={e => { e.stopPropagation(); onSkip() }} />}
        </div>
      )}
    </div>
  )
}

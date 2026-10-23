// What an opened session shows (page 73 §1b, approved 2026-10-22): its real
// lines, small, under the row, in the session summary's language. Strength:
// each lift with sets × reps · weight and ↑ / ↓ where it moved, then core and
// minutes. Run: minutes · HR cap, the shape, the weather at his hour. Bag:
// rounds × minutes · rest, the first combo. Foundation: its blocks and level.
// Class: its time and "easier morning after". Done: plan against what he did,
// ✓ and effort. A skip says so first; his reason closes a swap. Pure; the
// data is SessionSummary's (the per-type endpoints) and the row's own dose.

import { foundationLevel } from '../../lib/foundation'
import type { SummaryData } from '../dayboard/summaryData'
import { actualMinutes, continuousRunMin, liftLoad, plannedRowMinutes, rowStatus, runWalkShapeFor, shortLift, strengthDiffLines, type DayBoardSession, type WorkoutExercise } from '../dayboard/rowState'

export interface PlanLine {
  label: string
  value: string
  mark?: 'up' | 'down'
  /** A teal ✓ closes the value. */
  tick?: boolean
}

export interface LinesOpts {
  /** The block week (Foundation's level, a run-walk's shape). */
  weekNumber?: number | null
  /** "6 PM: 2° and rain": the weather at a run's hour (today only). */
  weather?: string | null
  /** A class's start ("7 PM"). */
  classTime?: string | null
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

/** The words for his reason on a row (the page 73 tiles, then the older codes). */
const REASON_WORD: Readonly<Record<string, string>> = {
  schedule: 'time', too_sore: 'body', sick: 'sick', injury: 'pain', variety: 'just because',
  tired: 'tired', rough_day: 'rough day', low_sleep: 'low on sleep', low_drive: 'low motivation', illness: 'body signal', class_time: "class time doesn't fit", other: 'other', coach_rest: 'rest day',
}

export function reasonWord(code: string | null | undefined): string | null {
  if (!code) return null
  return REASON_WORD[code] ?? code.replace(/_/g, ' ')
}

function parse(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {} } catch { return {} }
}

/** His reason on a session he swapped in (context_json.replaced.userSkipReason). */
export function swapReason(s: Pick<DayBoardSession, 'contextJson'>): string | null {
  const r = parse(s.contextJson).replaced as { userSkipReason?: unknown } | undefined
  return typeof r?.userSkipReason === 'string' ? r.userSkipReason : null
}

/** The row's own dose (sessions.dose_json), when it carries one. */
function doseOf(s: Pick<DayBoardSession, 'doseJson'>): { bag?: { rounds: number }; run?: { runSec: number; walkSec: number; rounds: number; totalSec: number; hrCeilingBpm: number; walkOnly: boolean } } | null {
  const d = parse(s.doseJson)
  return Object.keys(d).length ? d as never : null
}

function liftName(ex: WorkoutExercise): string {
  return shortLift(ex.label || ex.name || ex.exercise?.name || 'Lift').toUpperCase()
}

function strengthTodo(data: Extract<SummaryData, { kind: 'strength' }>): PlanLine[] {
  const out: PlanLine[] = []
  const core: string[] = []
  for (const ex of data.exercises) {
    if (ex.section === 'warmup') continue
    if (ex.section === 'core') { core.push(shortLift(ex.label || ex.name || ex.exercise?.name || '').toLowerCase()); continue }
    const sr = ex.prescription?.setsReps ?? ''
    const change = data.brainLifts?.find(l => l.exerciseId === ex.exerciseId)?.change
    const load = liftLoad(ex)
    out.push({ label: liftName(ex), value: `${sr}${sr ? ' · ' : ''}${/\d$/.test(load) ? `${load} lb` : load}`, ...(change === 'increase' ? { mark: 'up' as const } : change === 'decrease' ? { mark: 'down' as const } : {}) })
  }
  const min = data.plannedMin != null ? `~${data.plannedMin} min` : null
  if (core.length > 0) out.push({ label: 'CORE', value: [core.filter(Boolean).join(', '), min].filter(Boolean).join(' · ') })
  else if (min) out.push({ label: 'TIME', value: min })
  return out
}

function strengthDone(data: Extract<SummaryData, { kind: 'strength' }>): PlanLine[] {
  const main = data.exercises.filter(ex => ex.section !== 'warmup' && ex.section !== 'core')
  return strengthDiffLines(main).map((l, i) => {
    const text = l.parts.map(p => p.text).join('')
    const value = /\d$/.test(text) ? `${text} lb` : text
    return { label: liftName(main[i]), value, tick: true, ...(l.band === 'up' ? { mark: 'up' as const } : l.band === 'down' ? { mark: 'down' as const } : {}) }
  })
}

function runPlan(s: DayBoardSession, data: SummaryData | null, opts: LinesOpts): PlanLine[] {
  const plan = data?.kind === 'run' ? data.plan : null
  const dose = doseOf(s)?.run ?? null
  const cap = plan?.z2CeilingBpm ?? dose?.hrCeilingBpm ?? null
  const hr = cap ? ` · HR ≤${cap}` : ''
  const out: PlanLine[] = []
  const rw = plan?.runWalk ?? (dose && dose.rounds > 1 ? { runSec: dose.runSec, walkSec: dose.walkSec, rounds: dose.rounds, warmupSec: 0 } : null)
  if (dose?.walkOnly) out.push({ label: 'EASY', value: `walk or bike · ${Math.round(dose.totalSec / 60)} min` })
  else if (rw && rw.walkSec > 0) {
    const total = plan?.targetDurSec ? Math.round(plan.targetDurSec / 60) : dose ? Math.round(dose.totalSec / 60) : Math.round((rw.rounds * (rw.runSec + rw.walkSec) + rw.warmupSec) / 60)
    out.push({ label: 'RUN', value: `${total} min${hr}` }, { label: 'SHAPE', value: `${rw.rounds} × run ${mmss(rw.runSec)}, walk ${mmss(rw.walkSec)}` })
  } else {
    const min = plan?.targetDurSec ? Math.round(plan.targetDurSec / 60) : continuousRunMin(s) ?? (dose ? Math.round(dose.runSec / 60) : null)
    if (min == null && s.type === 'foundation_run' && s.blockType === 'block_zero') {
      const w = runWalkShapeFor(s, opts.weekNumber ?? s.blockWeek ?? 1)
      out.push({ label: 'RUN', value: `${Math.round((w.rounds * (w.runSec + w.walkSec) + w.warmupSec) / 60)} min${hr}` }, { label: 'SHAPE', value: `${w.rounds} × run ${mmss(w.runSec)}, walk ${mmss(w.walkSec)}` })
    } else {
      out.push({ label: 'RUN', value: `${min != null ? `${min} min` : 'easy'}${hr}` }, { label: 'SHAPE', value: 'one steady run' })
    }
  }
  if (opts.weather) out.push({ label: 'WEATHER', value: opts.weather })
  return out
}

/** The lines an opened row shows. */
export function planLines(s: DayBoardSession, data: SummaryData | null, opts: LinesOpts = {}): PlanLine[] {
  const status = rowStatus(s.status)
  const out: PlanLine[] = []
  if (status === 'skipped') out.push({ label: 'SKIPPED', value: reasonWord(s.skipReason) ?? 'no reason given' })
  const done = status === 'done'
  const min = actualMinutes(s)
  const effort = s.rpe != null ? ` · effort ${s.rpe}` : ''
  const doneLine = (lead: string | null) => out.push({ label: 'DONE', value: [lead, min != null ? `${min} min` : null].filter(Boolean).join(' · ') + effort })
  switch (s.type) {
    case 'strength':
      if (data?.kind === 'strength') out.push(...(done ? strengthDone(data) : strengthTodo(data)))
      if (done) doneLine(null)
      break
    case 'running':
    case 'foundation_run': {
      if (done) {
        const run = data?.kind === 'run' ? data.run ?? s.runSession ?? null : s.runSession ?? null
        const rm = run?.durationSec ? Math.round(run.durationSec / 60) : min
        out.push({ label: 'RUN', value: `${rm != null ? `${rm} min` : 'done'}${run?.avgHr ? ` · avg HR ${run.avgHr}` : ''}`, tick: true })
        const shape = data?.kind === 'run' && data.plan?.runWalk && data.plan.runWalk.walkSec > 0 ? 'run-walk' : 'one steady run'
        out.push({ label: 'DONE', value: `${shape}${effort}` })
      } else out.push(...runPlan(s, data, opts))
      break
    }
    case 'bag_work': {
      const bag = data?.kind === 'bag' ? data : null
      const rounds = bag && bag.rounds > 0 ? bag.rounds : doseOf(s)?.bag?.rounds ?? null
      const roundMin = bag && bag.plannedSecs.length > 0 ? Math.round(bag.plannedSecs[bag.plannedSecs.length - 1] / 60) : 3
      const rest = bag?.restSec != null ? Math.round(bag.restSec / 60) : 1
      if (rounds) out.push({ label: 'ROUNDS', value: `${rounds} × ${roundMin} min · ${rest} min rest`, tick: done })
      else out.push({ label: 'ABOUT', value: `~${bag?.plannedMin ?? plannedRowMinutes(s, opts.weekNumber)} min` })
      if (bag?.firstCombo) out.push({ label: 'FIRST', value: bag.firstCombo })
      if (done) doneLine(null)
      break
    }
    case 'skip_rope': {
      const rope = data?.kind === 'rope' ? data : null
      out.push({ label: 'ROUNDS', value: `${rope?.rounds ?? 5} × ${rope?.roundSec ? Math.round(rope.roundSec / 60) : 3} min · 1 min rest`, tick: done })
      if (done) doneLine(null)
      break
    }
    case 'mobility': {
      const level = foundationLevel(s.blockType === 'block_zero' ? opts.weekNumber ?? s.blockWeek ?? null : null)
      if (done) { out.push({ label: 'BLOCKS', value: 'back, neck and shoulder', tick: true }); doneLine(null) }
      else out.push({ label: 'BLOCKS', value: 'back, then neck and shoulder' }, { label: 'LEVEL', value: `${level} · ~${data?.kind === 'mobility' && data.plannedMin ? data.plannedMin : 12} min` })
      break
    }
    case 'mt_class': {
      const mt = data?.kind === 'mt' ? data : null
      const kind = mt?.classType?.toLowerCase() ?? (s.label && !/^mt class$/i.test(s.label.trim()) ? s.label.toLowerCase().replace(/^mt\s+/, '') : null)
      const when = opts.classTime ?? (s.timeSlot === 'pm' ? 'evening' : 'morning')
      if (done) { out.push({ label: 'CLASS', value: [mt?.durationMin ? `${mt.durationMin} min` : null, kind].filter(Boolean).join(' · ') || 'done', tick: true }); if (s.rpe != null) out.push({ label: 'DONE', value: `effort ${s.rpe}` }) }
      else out.push({ label: 'CLASS', value: [when, kind].filter(Boolean).join(' · ') }, { label: 'AFTER', value: 'easier morning after' })
      break
    }
    case 'active_recovery':
      if (done) doneLine(null)
      else out.push({ label: 'EASY', value: 'walk or bike · ~25 min' }, { label: 'THEN', value: 'hips and foam roller' })
      break
    default:
      if (done) doneLine(null)
  }
  const why = status !== 'skipped' ? reasonWord(swapReason(s)) : null
  if (why) out.push({ label: 'WHY', value: why })
  return out
}

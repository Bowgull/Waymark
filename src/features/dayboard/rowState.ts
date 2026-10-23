// The day board (design-decisions.md "Program · the day board", "The coach
// speaks"): what one row shows, pure. Program and Today share it.
//
// - A row is a to-do, done, skipped or missed session. Only a to-do row
//   swipes (REPLACE / SKIP); a done row shows what was actually done.
// - A row the coach changed carries the small rune by its detail (page 56
//   item 7: Dagaz teal, Algiz ember for a missed session); it replaces
//   page 36's brass edge and reason line. Tap the day for what changed.
// - A done summary lists plan vs actual: lines that differ get a band, teal
//   up or clay for a miss (heart rate over the Zone 2 cap is a miss), with a
//   chip (+5, −1 rep, +7 min, +4 over cap). Plain lines stay plain.
//
// No React, no fetch, relative imports only: the tests run it under node.

import { SESSION_ICON_NAME, sessionIconFor, type SessionIconKey } from '../../design/sessionIconKeys'
import { kgToLbs } from '../../lib/units'
import { getStrengthTemplate } from '../../lib/strengthTemplates'
import { getStrengthWeekTarget } from '../../lib/blockZero/strength'
import { estimatedMinutes } from '../../lib/coach/sessions'
import { plannedRowStrengthMinutes } from '../../lib/plannedLength'
import { doseJsonMinutes } from '../../lib/brain/doseMinutes'
import type { RuneState } from '../../lib/coach/changes'
import { getRunWalkWeek, runWalkTotalSec } from '../../lib/blockZero/running'
import { runWarmupSec } from '../../lib/foundation'

// ─── Inputs (the shapes the existing endpoints return) ─────────

export interface RunActuals {
  distanceKm?: number | null
  durationSec?: number | null
  plannedDurationSec?: number | null
  paceSecKm?: number | null
  avgHr?: number | null
  maxHr?: number | null
  source?: string | null
}

/** A session row as /api/weeks/current and /api/sessions/today return it. */
export interface DayBoardSession {
  id: string
  type: string
  status: string
  timeSlot: string | null
  label?: string | null
  notes?: string | null
  scheduledDate?: number | null
  startedAt?: number | null
  completedAt?: number | null
  durationSec?: number | null
  rpe?: number | null
  blockWeek?: number | null
  blockType?: string | null
  adjustmentId?: string | null
  contextJson?: string | null
  skipReason?: string | null
  /** Today attaches the run row (Strava or manual). */
  runSession?: RunActuals | null
  /** The coach's dose for the session (sessions.dose_json), when the row carries it. */
  doseJson?: string | null
}

// ─── Small helpers ─────────────────────────────────────────────

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** The minus sign on chips (−1 rep), not a hyphen. */
export const MINUS = '−'

export function dowOfEpochDay(epochDay: number): number {
  return new Date(epochDay * 86400000).getUTCDay()
}

export function slotOf(timeSlot: string | null | undefined): 'am' | 'pm' {
  return timeSlot === 'pm' ? 'pm' : 'am'
}

function signed(n: number, unit = ''): string {
  const body = `${Math.abs(n)}${unit}`
  return n > 0 ? `+${body}` : n < 0 ? `${MINUS}${body}` : body
}

function plural(n: number, one: string, many: string): string {
  return Math.abs(n) === 1 ? one : many
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** The icon for a session (Zone 2 dial vs run shoe for runs). */
export function iconFor(s: Pick<DayBoardSession, 'type' | 'notes'>): SessionIconKey {
  return sessionIconFor(s.type, s.type === 'running' ? s.notes ?? null : null)
}

/** The name on the row's flap: the approved names (Foundation, Reset, Zone 2). */
export function sessionDisplayName(s: Pick<DayBoardSession, 'type' | 'label' | 'notes'>): string {
  const label = s.label?.trim() || null
  if (s.type === 'strength') return label ?? 'Strength'
  // page 58: a raven's plan puts an easy bike (or walk) in a run's place.
  if (s.type === 'active_recovery' && label && /^easy (bike|walk)$/i.test(label)) return label
  // page 56: Block Zero's run-walk reads RUN-WALK on its row; a run its dose named (Easy Run, Easy
  // Walk or Bike) reads that name, the same as its ready board (audit #14).
  if (s.type === 'foundation_run' && label && /run-walk/i.test(label)) return label
  if ((s.type === 'foundation_run' || s.type === 'running') && label && /^(easy run|easy walk or bike|run-walk)$/i.test(label)) return label
  const key = iconFor(s)
  if (key === 'run') return label ?? 'Run'
  return SESSION_ICON_NAME[key]
}

/** The label as a detail word when it says more than the flap ("technical", "run-walk"). */
function labelDetail(s: Pick<DayBoardSession, 'type' | 'label' | 'notes'>): string | null {
  const label = s.label?.trim()
  if (!label || s.type === 'strength') return null
  const name = sessionDisplayName(s)
  if (label.toLowerCase() === name.toLowerCase()) return null
  if (iconFor(s) === 'run') return null
  // "MT Technique" reads "technique" under the MT CLASS flap
  return label.toLowerCase().replace(/^mt\s+/, '')
}

/** Minutes a done session took: its duration, else start to finish. */
export function actualMinutes(s: Pick<DayBoardSession, 'durationSec' | 'startedAt' | 'completedAt'>): number | null {
  if (s.durationSec != null && s.durationSec > 0) return Math.round(s.durationSec / 60)
  if (s.startedAt != null && s.completedAt != null && s.completedAt > s.startedAt) return Math.round((s.completedAt - s.startedAt) / 60)
  return null
}

const SKIP_WORDS: Record<string, string> = {
  too_sore: 'sore',
  tired: 'tired',
  injury: 'injury',
  schedule: 'time',
  sick: 'sick',
  low_drive: 'low motivation',
  low_sleep: 'low on sleep',
  illness: 'body signal',
  variety: 'changing it up',
  rough_day: 'rough day',
  other: 'other',
  class_time: "class time doesn't fit",
  coach_rest: 'rest day',
}

/** The raven's plan mark on a session (page 58, context_json.bodyPlan). */
export function bodyPlanOn(contextJson: string | null | undefined): { op: string; was: string; shapeWeek?: number } | null {
  const v = parseContext(contextJson).bodyPlan as { op?: unknown; was?: unknown; shapeWeek?: unknown } | undefined
  if (!v || typeof v.op !== 'string') return null
  return { op: v.op, was: typeof v.was === 'string' ? v.was : '', ...(typeof v.shapeWeek === 'number' ? { shapeWeek: v.shapeWeek } : {}) }
}

/**
 * Program's detail line for a session the raven's plan changed (page 58 4B):
 * "easy, 25 min · was run 4:00 × 5", "run 2:00, walk 1:00 × 7 · was 4:00 × 5".
 */
export function bodyPlanDetail(s: Pick<DayBoardSession, 'contextJson'>, weekNumber: number): string | null {
  const plan = bodyPlanOn(s.contextJson)
  if (!plan) return null
  const was = plan.was ? ` · was ${plan.was}` : ''
  if (plan.op === 'bike' || plan.op === 'reset') return `easy, 25 min${was}`
  if (plan.op === 'shape') { const w = runWalkShapeFor(s, weekNumber); return `run ${mmss(w.runSec)}, walk ${mmss(w.walkSec)} × ${w.rounds}${was}` }
  if (plan.op === 'technique') return 'technique only · no hard rounds'
  return null
}

function parseContext(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/**
 * Page 56's Program detail for a Block Zero run-walk: "4 rounds · run 3:30,
 * walk 1:00 · 23 min", the coach's rounds when it eased the session.
 */
export function runWalkDetail(session: Pick<DayBoardSession, 'contextJson' | 'doseJson'>, weekNumber: number): string {
  const easy = continuousRunMin(session)
  if (easy != null) return `easy run, no walk breaks · ${easy} min`
  const w = runWalkShapeFor(session, weekNumber)
  return `${w.rounds} rounds · run ${mmss(w.runSec)}, walk ${mmss(w.walkSec)} · ${Math.round(runWalkTotalSec(w) / 60)} min`
}

/**
 * A Block Zero run the coach planned as one continuous easy run (its dose:
 * one round, no walk): its minutes. Null for a run-walk or no dose on the row.
 */
export function continuousRunMin(session: Pick<DayBoardSession, 'doseJson'>): number | null {
  if (!session.doseJson) return null
  try {
    const r = (JSON.parse(session.doseJson) as { run?: { rounds?: number; walkSec?: number; runSec?: number; walkOnly?: boolean } }).run
    return r && !r.walkOnly && r.rounds === 1 && r.walkSec === 0 && (r.runSec ?? 0) > 0 ? Math.round((r.runSec as number) / 60) : null
  } catch {
    return null
  }
}

/** A Block Zero run-walk's shape for its week, with the coach's eased rounds. */
export function runWalkShapeFor(session: Pick<DayBoardSession, 'contextJson'>, weekNumber: number): { runSec: number; walkSec: number; rounds: number; warmupSec: number } {
  // A raven's plan brings the run back at an earlier week's shape (page 58: 2:00 / 1:00 × 7, then 3:30 × 5).
  const shapeWeek = bodyPlanOn(session.contextJson)?.shapeWeek
  const w = getRunWalkWeek(shapeWeek != null && shapeWeek < weekNumber ? shapeWeek : weekNumber)
  const ease = parseContext(session.contextJson).coachEase as { kind?: string; rounds?: number } | undefined
  const rounds = ease?.kind === 'rounds' && typeof ease.rounds === 'number' ? ease.rounds : w.rounds
  return { runSec: w.runSec, walkSec: w.walkSec, rounds, warmupSec: w.warmupSec }
}

/** Page 56 1A, the open run-walk row: "5 rounds: run 3:30, walk 1:00, after a 5 min walk. Easy, full sentences." */
export function runWalkPlanLine(w: { runSec: number; walkSec: number; rounds: number; warmupSec: number }): string {
  return `${w.rounds} ${w.rounds === 1 ? 'round' : 'rounds'}: run ${mmss(w.runSec)}, walk ${mmss(w.walkSec)}, after a ${Math.round(w.warmupSec / 60)} min walk. Easy, full sentences.`
}

// ─── Row state ──

export type RowStatus = 'todo' | 'done' | 'skipped' | 'missed'
export type RowVariant = RowStatus

export interface DayRowState {
  status: RowStatus
  variant: RowVariant
  /** Only a to-do row swipes (REPLACE / SKIP); done rows show what was done instead. */
  swipeable: boolean
  /** Started but not finished: still a to-do. */
  live: boolean
  slot: 'am' | 'pm'
  icon: SessionIconKey
  name: string
  /** One line under the name ("12 min · back and neck", "4 rounds · run 3:30, walk 1:00 · 23 min"). */
  detail: string
  /** The rune by the detail when the coach changed this session (page 56 item 7). */
  rune: RuneState | null
}

export interface RowContext {
  /** The plan line for a to-do; the caller knows the template. */
  planDetail?: string | null
  /** The coach change on this session, as a rune (GET /api/weeks/:monday/changes). */
  rune?: RuneState | null
}

export function rowStatus(status: string): RowStatus {
  if (status === 'completed') return 'done'
  if (status === 'skipped') return 'skipped'
  if (status === 'missed') return 'missed'
  return 'todo'
}

/** The one line under the name. */
export function rowDetail(session: DayBoardSession, status: RowStatus, opts: { planDetail?: string | null } = {}): string {
  const parts: string[] = []
  const extra = labelDetail(session)
  // page 33 / 36: the label word and the plan read as one ("run-walk 30 min"), then "· was X"
  const plan = [extra, opts.planDetail].filter(Boolean).join(' ')
  if (status === 'done') {
    // a done row keeps its plan line ("2×8 RPE 6-7", "12 min"); what was actually done is in
    // its summary. Without a plan line, the minutes it took.
    if (plan) return plan
    const min = actualMinutes(session)
    return min != null ? `${min} min` : 'done'
  }
  if (status === 'skipped') {
    const why = session.skipReason ? SKIP_WORDS[session.skipReason] ?? session.skipReason.replace(/_/g, ' ') : null
    return why ? `skipped: ${why}` : 'skipped'
  }
  if (status === 'missed') {
    const day = session.scheduledDate != null ? DAY_LONG[dowOfEpochDay(session.scheduledDate)] : null
    return day ? `missed ${day}` : 'missed'
  }
  if (plan) parts.push(plan)
  return parts.join(' · ')
}

export function dayRowState(session: DayBoardSession, ctx: RowContext = {}): DayRowState {
  const status = rowStatus(session.status)
  return {
    status,
    variant: status,
    swipeable: status === 'todo',
    live: session.status === 'in_progress',
    slot: slotOf(session.timeSlot),
    icon: iconFor(session),
    name: sessionDisplayName(session),
    detail: rowDetail(session, status, { planDetail: ctx.planDetail }),
    rune: status === 'skipped' ? null : ctx.rune ?? null,
  }
}

// ─── Done summary: plan vs actual ──────────────────────────────

export interface DiffPart {
  text: string
  /** The changed value: lifted (bolder, bigger, soft shadow). */
  lifted: boolean
}

export interface DiffLine {
  label: string
  parts: DiffPart[]
  /** +5, −1 rep, +7 min, +4 over cap. */
  chip: string | null
  band: 'up' | 'down' | null
}

function plainLine(label: string, text: string): DiffLine {
  return { label, parts: [{ text, lifted: false }], chip: null, band: null }
}

/** A set row from /api/sessions/:id/workout. */
export interface WorkoutSet {
  setNumber: number
  weightKg: number | null
  reps: number
  plannedWeightKg: number | null
  plannedReps: number | null
  isWarmup: number | boolean
  completedAt: number | null
}

/** An exercise from /api/sessions/:id/workout. */
export interface WorkoutExercise {
  exerciseId: string
  section?: string | null
  orderIndex?: number
  exercise?: { name: string } | null
  name?: string
  label?: string
  sets?: WorkoutSet[]
  prescription?: { prescribedWeightKg: number | null; setsReps: string } | null
}

function exerciseName(ex: WorkoutExercise): string {
  return (ex.label || ex.name || ex.exercise?.name || 'Lift').toUpperCase()
}

function loadText(kg: number | null | undefined): string {
  return kg != null && kg > 0 ? String(kgToLbs(kg)) : 'BW'
}

/** A to-do lift line: "2×8 · 135" (lbs; BW when unloaded). */
export function planLiftLine(ex: WorkoutExercise): DiffLine {
  const sr = ex.prescription?.setsReps ?? ''
  return plainLine(exerciseName(ex), `${sr}${sr ? ' · ' : ''}${loadText(ex.prescription?.prescribedWeightKg)}`)
}

/**
 * One line per lift: what was done vs the plan. Sets short of the plan are a
 * miss (−1 set); then the load (+5 / −5 lbs); then reps per set (−1 rep).
 * Lifts with no logged sets are shown as planned, unbanded. Warm-ups skip.
 */
export function strengthDiffLines(exercises: ReadonlyArray<WorkoutExercise>): DiffLine[] {
  const lines: DiffLine[] = []
  for (const ex of exercises) {
    if (ex.section === 'warmup') continue
    const working = (ex.sets ?? []).filter(s => !s.isWarmup)
    if (working.length === 0) {
      lines.push(planLiftLine(ex))
      continue
    }
    const plannedSets = working.length
    const plannedReps = working[0].plannedReps ?? working[0].reps
    const plannedKg = working[working.length - 1].plannedWeightKg ?? working[working.length - 1].weightKg
    const done = working.filter(s => s.completedAt != null)
    if (done.length === 0) {
      lines.push(plainLine(exerciseName(ex), `${plannedSets}×${plannedReps} · ${loadText(plannedKg)}`))
      continue
    }
    const reps = Math.min(...done.map(s => s.reps))
    const topKg = Math.max(...done.map(s => s.weightKg ?? 0))
    const setDiff = done.length - plannedSets
    const loadDiff = plannedKg != null && plannedKg > 0 && topKg > 0 ? kgToLbs(topKg) - kgToLbs(plannedKg) : 0
    const repDiff = reps - plannedReps
    const setsReps = `${done.length}×${reps}`
    const load = loadText(topKg > 0 ? topKg : plannedKg)
    let chip: string | null = null
    let band: DiffLine['band'] = null
    let lift: 'sets' | 'load' | null = null
    if (setDiff < 0) {
      chip = `${signed(setDiff)} ${plural(setDiff, 'set', 'sets')}`
      band = 'down'
      lift = 'sets'
    } else if (loadDiff !== 0) {
      chip = signed(loadDiff)
      band = loadDiff > 0 ? 'up' : 'down'
      lift = 'load'
    } else if (repDiff !== 0) {
      chip = `${signed(repDiff)} ${plural(repDiff, 'rep', 'reps')}`
      band = repDiff > 0 ? 'up' : 'down'
      lift = 'sets'
    } else if (setDiff > 0) {
      chip = `${signed(setDiff)} ${plural(setDiff, 'set', 'sets')}`
      band = 'up'
      lift = 'sets'
    }
    lines.push({
      label: exerciseName(ex),
      parts: [
        { text: setsReps, lifted: lift === 'sets' },
        { text: ' · ', lifted: false },
        { text: load, lifted: lift === 'load' },
      ],
      chip,
      band,
    })
  }
  return lines
}

/** The headline of a done summary: "Done · 52 min (+7 min) · RPE 7 · from Strava". */
export function doneHeadline(actualMin: number | null, plannedMin: number | null, extras: { rpe?: number | null; from?: string | null; effortWord?: 'RPE' | 'effort' } = {}): DiffLine {
  const parts: DiffPart[] = [{ text: 'Done', lifted: false }]
  let chip: string | null = null
  let band: DiffLine['band'] = null
  if (actualMin != null) {
    const diff = plannedMin != null && plannedMin > 0 ? actualMin - plannedMin : 0
    // Within a minute is as planned.
    const changed = Math.abs(diff) >= 2
    parts.push({ text: ' · ', lifted: false }, { text: `${actualMin} min`, lifted: changed })
    if (changed) {
      chip = signed(diff, ' min')
      band = diff > 0 ? 'up' : 'down'
    }
  }
  const tail: string[] = []
  if (extras.rpe != null) tail.push(`${extras.effortWord ?? 'RPE'} ${extras.rpe}`)
  if (extras.from) tail.push(`from ${extras.from}`)
  if (tail.length) parts.push({ text: ` · ${tail.join(' · ')}`, lifted: false })
  return { label: '', parts, chip, band }
}

export interface RunPlan {
  targetDurSec?: number | null
  targetDistKm?: number | null
  /** The Zone 2 heart-rate cap. */
  z2CeilingBpm?: number | null
}

export function formatPace(secKm: number): string {
  const m = Math.floor(secKm / 60)
  const s = Math.round(secKm % 60)
  return `${m}:${String(s).padStart(2, '0')} /km`
}

/**
 * A done run's readouts: distance vs plan (teal further, clay short), pace
 * plain, average heart rate over the Zone 2 cap is the miss on an easy day
 * ("+4 over cap"), max heart rate plain.
 */
export function runDiffLines(run: RunActuals, plan: RunPlan | null | undefined, opts: { zone2: boolean }): DiffLine[] {
  const lines: DiffLine[] = []
  if (run.distanceKm != null && run.distanceKm > 0) {
    const km = round1(run.distanceKm)
    const target = plan?.targetDistKm != null && plan.targetDistKm > 0 ? plan.targetDistKm : null
    const diff = target != null ? round1(km - target) : 0
    if (diff !== 0 && Math.abs(diff) >= 0.2) {
      lines.push({ label: 'DISTANCE', parts: [{ text: String(km), lifted: true }, { text: ' km', lifted: false }], chip: signed(diff, ' km'), band: diff > 0 ? 'up' : 'down' })
    } else {
      lines.push(plainLine('DISTANCE', `${km} km`))
    }
  }
  if (run.paceSecKm != null && run.paceSecKm > 0) lines.push(plainLine('PACE', formatPace(run.paceSecKm)))
  if (run.avgHr != null && run.avgHr > 0) {
    const cap = opts.zone2 ? plan?.z2CeilingBpm ?? null : null
    const over = cap != null ? run.avgHr - cap : 0
    if (over > 0) {
      lines.push({ label: 'AVG HR', parts: [{ text: String(run.avgHr), lifted: true }, { text: ' bpm', lifted: false }], chip: `+${over} over cap`, band: 'down' })
    } else {
      lines.push(plainLine('AVG HR', `${run.avgHr} bpm`))
    }
  }
  if (run.maxHr != null && run.maxHr > 0) lines.push(plainLine('MAX HR', `${run.maxHr} bpm`))
  return lines
}

/** A plan vs actual minutes line (MT class, rope): "+7 min" / "−5 min". */
export function minutesLine(label: string, actualMin: number | null, plannedMin: number | null): DiffLine | null {
  if (actualMin == null) return null
  const diff = plannedMin != null && plannedMin > 0 ? actualMin - plannedMin : 0
  if (Math.abs(diff) >= 2) return { label, parts: [{ text: `${actualMin} min`, lifted: true }], chip: signed(diff, ' min'), band: diff > 0 ? 'up' : 'down' }
  return plainLine(label, `${actualMin} min`)
}

// ─── Planned lines (pages 20, 33) ──────────────────────────────

const NUM_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const word = (n: number) => NUM_WORDS[n] ?? String(n)

/**
 * About how long a to-do takes, for the row's "~45min" (page 20): strength
 * from its template's sets and rests, everything else from the plan's own
 * numbers (run-walk week, Foundation's routine).
 */
export function plannedRowMinutes(s: Pick<DayBoardSession, 'type' | 'notes' | 'label' | 'scheduledDate' | 'blockWeek' | 'blockType'> & { contextJson?: string | null; doseJson?: string | null }, weekNumber?: number | null): number {
  // Page 73: the coach's dose when the row carries one (the same minutes its lines and the coach picks show).
  const fromDose = doseJsonMinutes(s)
  if (fromDose != null) return fromDose
  const kind = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
  const week = s.blockWeek ?? weekNumber ?? 1
  if (s.type === 'strength' && s.scheduledDate != null) {
    const t = getStrengthTemplate(dowOfEpochDay(s.scheduledDate), week, kind, s.label ?? null)
    const min = plannedRowStrengthMinutes(t.exercises, { oneSetLess: easedOneSet(s.contextJson) })
    if (min != null) return min
  }
  // A run-walk carries no block week: the week's own shape, with eased rounds (X3: ~28 in week 4).
  // With its dynamic warm-up (~6.5 min), as the dose's minutes count it.
  if (s.type === 'foundation_run' && kind === 'block_zero') return Math.round((runWalkTotalSec(runWalkShapeFor(s, weekNumber ?? week)) + runWarmupSec()) / 60)
  return estimatedMinutes({ type: s.type, notes: s.notes ?? null, estimatedMin: null }, kind, weekNumber ?? week)
}

/** A coach ease on the session that takes a set off each main lift (page 56: "one set less"). */
export function easedOneSet(contextJson: string | null | undefined): boolean {
  const ease = parseContext(contextJson).coachEase as { kind?: string } | undefined
  return ease?.kind === 'reduce' || ease?.kind === 'one_set'
}

/**
 * Program's strength plan detail: "2×8, RPE 6-7"; one set fewer when the coach
 * eased it (e2e minor 13: an eased 1×8 read 2×8).
 */
export function strengthPlanDetail(label: string, contextJson: string | null | undefined): string {
  if (!easedOneSet(contextJson)) return label
  return label.replace(/^(\d+)×/, (_m, n: string) => `${Math.max(1, Number(n) - 1)}×`)
}

/** Page 33's to-do strength line: "Week 3: two sets of eight, about three left in the tank." (Block Zero). Eased: one set fewer. */
export function strengthWeekLine(blockType: string | null | undefined, week: number | null | undefined, eased = false): string | null {
  if (blockType !== 'block_zero' || week == null || week < 1) return null
  const t = getStrengthWeekTarget(week)
  const left = Math.max(0, 10 - t.rpe[0])
  const sets = eased ? Math.max(1, t.mainSets - 1) : t.mainSets
  return `Week ${week}: ${word(sets)} ${sets === 1 ? 'set' : 'sets'} of ${word(t.reps)}, about ${word(left)} left in the tank.`
}

/**
 * "Front Squat" → "Front squat", "Bench Press" → "Bench press" (one case for
 * every lift, m14), "Romanian Deadlift" → "RDL" (the coach screens' short
 * names). Short capitals (DB, EZ) stay.
 */
export function shortLift(name: string): string {
  if (/romanian deadlift/i.test(name)) return 'RDL'
  return name.split(' ').map((w, i) => (/^[A-Z]{2,3}$/.test(w) ? w : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ')
}

/** Page 20's top lifts on Today: "Front squat 2×135lbs · RDL 2×115lbs" (main lifts: sets × load). */
export function topLiftsLine(exercises: ReadonlyArray<WorkoutExercise>): string | null {
  const parts = exercises
    .filter(ex => ex.section === 'main')
    .map(ex => {
      const sets = Number((ex.prescription?.setsReps ?? '').split('×')[0]) || null
      const kg = ex.prescription?.prescribedWeightKg
      if (!sets || kg == null || kg <= 0) return null
      return `${shortLift(ex.label || ex.name || ex.exercise?.name || 'Lift')} ${sets}×${kgToLbs(kg)}lbs`
    })
    .filter((x): x is string => x != null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Page 33's to-do Zone 2 line: "Easy, conversational pace. Heart rate under 142, nasal breathing. Run-walk, 35 min." */
export function zone2PlanLine(label: string | null | undefined, capBpm: number | null | undefined, minutes: number | null | undefined): string {
  const parts = ['Easy, conversational pace.']
  parts.push(capBpm ? `Heart rate under ${capBpm}, nasal breathing.` : 'Nasal breathing.')
  if (minutes) parts.push(`${label?.trim() || 'Zone 2'}, ${minutes} min.`)
  return parts.join(' ')
}

/**
 * Bag work and rope, done: one line per round as it went ("ROUND 3 · 2:10"),
 * clay with the seconds short when a round ended early (−0:50), and a clay
 * ROUNDS line when fewer rounds were done than planned. Plain when as planned.
 */
export function roundDiffLines(roundSecs: ReadonlyArray<number>, plannedSecs: ReadonlyArray<number>): DiffLine[] {
  const lines: DiffLine[] = []
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
  if (plannedSecs.length > 0 && roundSecs.length < plannedSecs.length) {
    const short = plannedSecs.length - roundSecs.length
    lines.push({ label: 'ROUNDS', parts: [{ text: String(roundSecs.length), lifted: true }, { text: ` of ${plannedSecs.length}`, lifted: false }], chip: `${MINUS}${short}`, band: 'down' })
  }
  roundSecs.forEach((sec, i) => {
    const plan = plannedSecs[i] ?? null
    const short = plan != null ? plan - sec : 0
    if (short >= 10) lines.push({ label: `ROUND ${i + 1}`, parts: [{ text: mmss(sec), lifted: true }], chip: `${MINUS}${mmss(short)}`, band: 'down' })
    else lines.push(plainLine(`ROUND ${i + 1}`, mmss(sec)))
  })
  return lines
}

/**
 * Page 56 1C: once he swaps a session, only the swap shows. The session it
 * replaced (skipped, named in the swap's context_json.replaced) leaves the
 * day board and the strip; undoing the swap brings it back. A plain SKIP
 * stays, struck.
 */
export function withoutReplaced<T extends { id: string; status: string; contextJson?: string | null }>(list: ReadonlyArray<T>): T[] {
  const gone = new Set<string>()
  for (const s of list) {
    const r = parseContext(s.contextJson).replaced as { originalSessionId?: unknown } | undefined
    if (r && typeof r.originalSessionId === 'string') gone.add(r.originalSessionId)
  }
  return list.filter(s => !(s.status === 'skipped' && gone.has(s.id)))
}

/** The rows' identity as last drawn: each session's row key, and the keys in order. */
export interface RowSlots {
  keyOf: ReadonlyMap<string, string>
  order: ReadonlyArray<string>
}

export const NO_ROW_SLOTS: RowSlots = { keyOf: new Map(), order: [] }

/**
 * Page 73's motion, "a swap, undo or redo: the row's flap letters flip". A
 * swap's replacement (context_json.replaced.originalSessionId) takes the row
 * of the session it replaced, and an UNDO gives it back, so the row stays
 * where it was and only its name flips. Rows already drawn keep their order;
 * new ones follow in the list's own order. Pure: `prev` is what was drawn.
 */
export function slotRows<T extends { id: string; contextJson?: string | null }>(list: ReadonlyArray<T>, prev: RowSlots): { list: T[]; keyOf: (s: T) => string; next: RowSlots } {
  const keyOf = new Map(prev.keyOf)
  const used = new Set<string>()
  const keys = new Map<string, string>()
  for (const s of list) {
    const r = parseContext(s.contextJson).replaced as { originalSessionId?: unknown } | undefined
    const orig = r && typeof r.originalSessionId === 'string' ? r.originalSessionId : null
    let key = keyOf.get(s.id) ?? (orig ? keyOf.get(orig) ?? orig : s.id)
    // Both on the board at once (never after a swap lands): the second gets its own row.
    if (used.has(key)) key = s.id
    else {
      keyOf.set(s.id, key)
      if (orig && !keyOf.has(orig)) keyOf.set(orig, key)
    }
    used.add(key)
    keys.set(s.id, key)
  }
  const at = new Map(prev.order.map((k, i) => [k, i]))
  const sorted = list.map((s, i) => ({ s, i, was: at.get(keys.get(s.id) as string) }))
  // Drawn rows keep their places among themselves; new rows keep the list's places.
  const old = sorted.filter(x => x.was != null).sort((a, b) => (a.was as number) - (b.was as number))
  const out = sorted.map(x => (x.was != null ? (old.shift() as typeof x) : x)).map(x => x.s)
  return { list: out, keyOf: (s: T) => keys.get(s.id) ?? s.id, next: { keyOf, order: out.map(s => keys.get(s.id) as string) } }
}

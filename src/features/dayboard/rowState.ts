// The day board (design-decisions.md "Program · the day board", "The coach
// speaks"): what one row shows, pure. Program and Today share it.
//
// - A row is a to-do, done, skipped or missed session. Only a to-do row
//   swipes (REPLACE / SKIP); a done row shows what was actually done.
// - A changed row (the coach eased, swapped or moved it) gets a brass edge,
//   "was X" in its detail and one brass reason line.
// - A missed session's ask sits in a row with flap chips (SUN AM / DROP IT).
// - A done summary lists plan vs actual: lines that differ get a band, teal
//   up or clay for a miss (heart rate over the Zone 2 cap is a miss), with a
//   chip (+5, −1 rep, +7 min, +4 over cap). Plain lines stay plain.
//
// No React, no fetch, relative imports only: the tests run it under node.

import { SESSION_ICON_NAME, sessionIconFor, type SessionIconKey } from '../../design/sessionIconKeys'
import { kgToLbs } from '../../lib/units'

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
}

/** One change from the week's prepared plan (weekly pass v2 `changes`). */
export interface WeekChangeLike {
  sessionId: string | null
  reason: string
  was?: string | null
  now?: string | null
  source?: string
}

/** A row of GET /api/adjustments?weekPlanId= (options and detail parsed by the server). */
export interface AdjustmentLike {
  id: string
  adjustmentType: string
  status: string
  reason: string
  sessionType?: string
  action?: string
  targetSessionId?: string | null
  auto?: number | boolean | null
  options?: unknown
  detail?: Record<string, unknown> | null
  createdAt?: number
}

/** MissedOption (src/lib/coach/missed.ts) as the server stores it. */
export type MissedOptionLike =
  | { kind: 'drop' }
  | { kind: 'move'; epochDay: number; date?: string; timeSlot: 'am' | 'pm' }
  | { kind: 'swap'; type: string; label: string; notes?: string | null; epochDay: number; date?: string; timeSlot: 'am' | 'pm' }

// ─── Small helpers ─────────────────────────────────────────────

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
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
  return label.toLowerCase()
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
  other: 'other',
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

// ─── Row state ─────────────────────────────────────────────────

export type RowStatus = 'todo' | 'done' | 'skipped' | 'missed'
/** What the row looks like: an ask beats a change beats the plain status. */
export type RowVariant = RowStatus | 'changed' | 'ask'

export interface AskChip {
  /** The flap word: SUN AM, WALK SAT PM, DROP IT. */
  label: string
  tone: 'gold' | 'ink'
  /** What tapping it sends. */
  request: { kind: 'accept'; option: number } | { kind: 'reject' }
}

export interface RowAsk {
  adjustmentId: string
  question: string
  chips: AskChip[]
}

export interface DayRowState {
  status: RowStatus
  variant: RowVariant
  /** Only a to-do row swipes (REPLACE / SKIP); done rows show actuals instead. */
  swipeable: boolean
  /** Started but not finished: still a to-do. */
  live: boolean
  slot: 'am' | 'pm'
  icon: SessionIconKey
  name: string
  /** One line under the name ("12 min · RPE 3", "1×8 RPE 6 · was 2×8"). */
  detail: string
  /** "was X" when the coach changed it. */
  was: string | null
  /** The brass reason line on a changed row. */
  reason: string | null
  ask: RowAsk | null
}

export interface RowContext {
  changes?: ReadonlyArray<WeekChangeLike>
  adjustments?: ReadonlyArray<AdjustmentLike>
  /** The plan line for a to-do ("2×8 RPE 6-7", "~35 min"); the caller knows the template. */
  planDetail?: string | null
}

export function rowStatus(status: string): RowStatus {
  if (status === 'completed') return 'done'
  if (status === 'skipped') return 'skipped'
  if (status === 'missed') return 'missed'
  return 'todo'
}

/** Why and what-it-was for a changed session, newest source first. */
export function changeFor(session: DayBoardSession, ctx: RowContext): { reason: string; was: string | null } | null {
  const adjustments = ctx.adjustments ?? []
  // A small change the coach applied on its own (felt hard, an ease): auto = 1, accepted.
  const auto = adjustments
    .filter(a => a.targetSessionId === session.id && a.status === 'accepted' && (a.auto === 1 || a.auto === true))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
  if (auto) {
    const note = typeof auto.detail?.note === 'string' ? auto.detail.note : null
    const was = typeof auto.detail?.was === 'string' ? auto.detail.was : null
    return { reason: note || auto.reason, was }
  }
  // The coach created or moved this session through an accepted adjustment.
  if (session.adjustmentId) {
    const adj = adjustments.find(a => a.id === session.adjustmentId && a.status === 'accepted')
    if (adj) {
      if (adj.adjustmentType === 'missed_session') {
        const missedDay = typeof adj.detail?.missedDay === 'number' ? adj.detail.missedDay : null
        return { reason: missedDay != null ? `Fit in after ${DAY_LONG[dowOfEpochDay(missedDay)]}'s was missed.` : 'Fit in after a missed session.', was: null }
      }
      const movedFrom = parseContext(session.contextJson).movedFrom as { epochDay?: number; timeSlot?: string } | undefined
      const was = movedFrom?.epochDay != null ? `${DAY3[dowOfEpochDay(movedFrom.epochDay)]} ${slotOf(movedFrom.timeSlot).toUpperCase()}` : null
      return { reason: adj.reason, was }
    }
  }
  // The week's prepared changes (weekly pass v2), placement shuffles left out.
  const change = (ctx.changes ?? []).find(c => c.sessionId === session.id && c.source !== 'placement')
  if (change) return { reason: change.reason, was: change.was ?? null }
  return null
}

/** The open missed-session ask about this session, as chips. */
export function askFor(session: DayBoardSession, ctx: RowContext): RowAsk | null {
  const adj = (ctx.adjustments ?? []).find(a => a.adjustmentType === 'missed_session' && a.status === 'proposed' && a.targetSessionId === session.id)
  if (!adj) return null
  const day = session.scheduledDate != null ? DAY_LONG[dowOfEpochDay(session.scheduledDate)] : null
  return {
    adjustmentId: adj.id,
    question: day ? `You missed ${day}'s ${sessionDisplayName(session)}. Fit it in?` : `You missed ${sessionDisplayName(session)}. Fit it in?`,
    chips: missedAskChips(Array.isArray(adj.options) ? (adj.options as MissedOptionLike[]) : []),
  }
}

/**
 * MissedOption -> chips: a move is its day and slot (SUN AM), a swap names
 * the easier session too (WALK SAT PM), and DROP IT comes last (it rejects:
 * the server's "let it go"). Each accept chip carries its option index.
 */
export function missedAskChips(options: ReadonlyArray<MissedOptionLike>): AskChip[] {
  const chips: AskChip[] = []
  options.forEach((o, i) => {
    if (o.kind === 'move') chips.push({ label: `${DAY3[dowOfEpochDay(o.epochDay)]} ${o.timeSlot.toUpperCase()}`, tone: 'gold', request: { kind: 'accept', option: i } })
    else if (o.kind === 'swap') chips.push({ label: `${o.label.toUpperCase()} ${DAY3[dowOfEpochDay(o.epochDay)]} ${o.timeSlot.toUpperCase()}`, tone: 'gold', request: { kind: 'accept', option: i } })
  })
  chips.push({ label: 'DROP IT', tone: 'ink', request: { kind: 'reject' } })
  return chips
}

/** The request a chip sends: POST /api/adjustments/:id/accept {option, today}, or /reject. */
export function askRequest(adjustmentId: string, chip: AskChip, todayIso: string): { path: string; body: Record<string, unknown> | null } {
  return chip.request.kind === 'accept'
    ? { path: `/api/adjustments/${adjustmentId}/accept`, body: { option: chip.request.option, today: todayIso } }
    : { path: `/api/adjustments/${adjustmentId}/reject`, body: null }
}

/** The one line under the name. */
export function rowDetail(session: DayBoardSession, status: RowStatus, opts: { planDetail?: string | null; was?: string | null } = {}): string {
  const parts: string[] = []
  const extra = labelDetail(session)
  if (status === 'done') {
    const km = session.runSession?.distanceKm
    if (km != null && km > 0) parts.push(`${round1(km)} km`)
    const min = actualMinutes(session)
    if (min != null) parts.push(`${min} min`)
    if (session.rpe != null) parts.push(`RPE ${session.rpe}`)
    if (parts.length === 0) parts.push('done')
    return parts.join(' · ')
  }
  if (status === 'skipped') {
    const why = session.skipReason ? SKIP_WORDS[session.skipReason] ?? session.skipReason.replace(/_/g, ' ') : null
    return why ? `skipped: ${why}` : 'skipped'
  }
  if (status === 'missed') {
    const day = session.scheduledDate != null ? DAY_LONG[dowOfEpochDay(session.scheduledDate)] : null
    return day ? `missed ${day}` : 'missed'
  }
  if (extra) parts.push(extra)
  if (opts.planDetail) parts.push(opts.planDetail)
  if (opts.was) parts.push(`was ${opts.was}`)
  return parts.join(' · ')
}

export function dayRowState(session: DayBoardSession, ctx: RowContext = {}): DayRowState {
  const status = rowStatus(session.status)
  const ask = status === 'missed' ? askFor(session, ctx) : null
  const change = status === 'todo' || status === 'done' ? changeFor(session, ctx) : null
  const was = status === 'todo' ? change?.was ?? null : null
  const variant: RowVariant = ask ? 'ask' : change && status === 'todo' ? 'changed' : status
  return {
    status,
    variant,
    swipeable: status === 'todo',
    live: session.status === 'in_progress',
    slot: slotOf(session.timeSlot),
    icon: iconFor(session),
    name: sessionDisplayName(session),
    detail: rowDetail(session, status, { planDetail: ctx.planDetail, was }),
    was,
    reason: change && status === 'todo' ? change.reason : null,
    ask,
  }
}

/**
 * Where each open ask shows: on today's board when today is in the shown
 * week (the athlete answers it today), else on the missed session's own day.
 */
export function askDay(session: Pick<DayBoardSession, 'scheduledDate'>, todayEpochDay: number, weekDays: ReadonlyArray<number>): number | null {
  if (weekDays.includes(todayEpochDay)) return todayEpochDay
  return session.scheduledDate ?? null
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
export function doneHeadline(actualMin: number | null, plannedMin: number | null, extras: { rpe?: number | null; from?: string | null } = {}): DiffLine {
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
  if (extras.rpe != null) tail.push(`RPE ${extras.rpe}`)
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

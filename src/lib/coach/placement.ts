// Placement checks for every session change: add (ad hoc, accepted coach
// change), move, and replace. Block Zero and Fighter. Pure: the caller loads
// the week around the change and passes it in.
//
// Rules, in order:
// - Known session types only. No past days. A move stays in its own week.
// - Back red flags (F17) stop loading. An injury flag keeps hard work off that region.
// - Block Zero Sunday is rest (Foundation only).
// - Ease and load-flag days get no hard sessions; the eased version is offered (R10, R5).
// - No two hard sessions on one day (F6, F14).
// - Heavy-leg strength sits 24 h or more from sparring/hard muay thai and long runs (F6).
// - One strength session a day; Block Zero never has strength days back to back.
// - One run a day. Single run <= 110% of the 30-day longest; weekly run time
//   <= 130% of last week (F11). A run over a cap is shortened when there is room.
// - Muay thai ramp and weekly cap. The ramp counts from the first class after
//   the last 14+ day class gap (R12).
// - Weekly planned load can't pass the plan's load: missed work is not crammed (F14).
// Refusals carry a code, one line in the house voice, and safe alternatives:
// other days this week that pass, and easier swaps that pass.

import {
  RESTART_WEEKLY_SEC,
  WEEKLY_RUN_CAP_RATIO,
  classTypeFromLabel,
  evaluateClassRequest,
  isBlockZeroRestDay,
  mtRampWeek,
  singleRunCap,
} from '../blockZero'
import { FOUNDATION_LABEL } from '../foundation'
import {
  DAY_NAMES,
  KEY_TYPES,
  KNOWN_SESSION_TYPES,
  RECOVERY_TYPES,
  RUN_TYPES,
  dowOf,
  estimatedMinutes,
  hoursBetween,
  isHard,
  isHeavyLegs,
  isLegInterference,
  isoOf,
  mondayOf,
  plannedLoad,
  sessionName,
  type BlockKind,
  type SessionLike,
  type TimeSlot,
} from './sessions'

export type ChangeKind = 'add' | 'move' | 'replace'

export interface SessionChange {
  kind: ChangeKind
  type: string
  label?: string | null
  /** Run category for 'running' ('zone2' | 'progression'). */
  notes?: string | null
  epochDay: number
  timeSlot: TimeSlot
  estimatedMin?: number | null
  /** move: the session moving. replace: the session replaced. */
  sessionId?: string | null
  /** move: the day it moves from. Bounds the move to that week. */
  fromEpochDay?: number | null
}

export interface InjuryFlagLike {
  region: string
  redFlag: boolean
  reason: string
}

export interface PlacementContext {
  blockType: BlockKind
  /** Training week of the change's week. */
  weekNumber: number
  todayEpochDay: number
  /** Sessions in the change's week plus a day either side. */
  sessions: SessionLike[]
  /** Check-ins say ease today (R10). */
  readinessEase: boolean
  /** Weekly load flag this week (R5). */
  loadFlag: boolean
  easeReason: string | null
  /** Other days flagged easy (e.g. a coach ease). */
  easeDays?: number[]
  run: { longestLast30Sec: number | null; lastWeekRunSec: number; thisWeekRunSec: number }
  mt: { weeksSinceRampStart: number | null; profileCap: number | null }
  /** The plan's load for the week (template). Null skips the cramming check. */
  planWeekLoad: number | null
  injury?: InjuryFlagLike | null
}

export type PlacementCode =
  | 'unknown_type'
  | 'past_day'
  | 'other_week'
  | 'red_flag'
  | 'injury_flag'
  | 'rest_day'
  | 'ease_day'
  | 'load_flag'
  | 'stacked_hard'
  | 'legs_24h'
  | 'strength_same_day'
  | 'strength_back_to_back'
  | 'strength_order'
  | 'run_same_day'
  | 'run_single_cap'
  | 'run_weekly_cap'
  | 'mt_ramp'
  | 'mt_cap'
  | 'over_plan'

export type SafeAlternative =
  | { kind: 'day'; epochDay: number; date: string; timeSlot: TimeSlot }
  | { kind: 'swap'; type: string; label: string; notes?: string | null; epochDay: number; date: string; timeSlot: TimeSlot }

export type PlacementResult =
  | { ok: true; change: SessionChange; notes: string[] }
  | { ok: false; code: PlacementCode; reason: string; safeAlternatives: SafeAlternative[] }

const LIVE = new Set(['planned', 'in_progress', 'completed'])
const MIN_USEFUL_RUN_SEC = 10 * 60
/** Load tolerance before a change counts as cramming. */
const PLAN_LOAD_TOLERANCE = 1.05
const MAX_DAY_ALTERNATIVES = 6

const LOWER_BODY = /back|spine|lumbar|hip|groin|knee|ankle|foot|shin|calf|achilles|hamstring|quad|leg/i
const UPPER_BODY = /shoulder|neck|elbow|wrist|hand|finger|knuckle|rib|chest/i

/** Does a session load the flagged region? Foundation and recovery never count. */
export function touchesRegion(type: string, region: string): boolean {
  if (RECOVERY_TYPES.has(type)) return false
  if (type === 'strength' || type === 'mt_class' || type === 'bag_work') return true
  if (RUN_TYPES.has(type) || type === 'skip_rope') return LOWER_BODY.test(region)
  return false
}

export function isLowerBodyRegion(region: string): boolean {
  return LOWER_BODY.test(region)
}

export function isUpperBodyRegion(region: string): boolean {
  return UPPER_BODY.test(region)
}

function label(c: Pick<SessionChange, 'type' | 'label' | 'notes'>): string {
  return sessionName(c)
}

function weekBounds(epochDay: number): [number, number] {
  const m = mondayOf(epochDay)
  return [m, m + 6]
}

/** Easier sessions to offer instead, most like the original first. */
export function easierOptions(c: Pick<SessionChange, 'type' | 'label' | 'notes'>, blockType: BlockKind): Array<{ type: string; label: string; notes?: string | null }> {
  const walk = { type: 'active_recovery', label: 'Easy Walk or Bike' }
  switch (c.type) {
    case 'strength': return [walk, { type: 'mobility', label: FOUNDATION_LABEL }]
    case 'mt_class': return classTypeFromLabel(c.label) === 'technical' ? [walk] : [{ type: 'mt_class', label: 'MT Technique' }, walk]
    case 'bag_work': return [{ type: 'skip_rope', label: 'Easy Rope' }, walk]
    case 'running':
      if (c.notes === 'progression') {
        return blockType === 'block_zero'
          ? [{ type: 'foundation_run', label: 'Run-Walk' }, walk]
          : [{ type: 'running', label: 'Zone 2', notes: 'zone2' }, walk]
      }
      return [walk]
    case 'foundation_run':
    case 'skip_rope':
      return [walk]
    default:
      return []
  }
}

type Refusal = { code: PlacementCode; reason: string }

function refuse(code: PlacementCode, reason: string): Refusal {
  return { code, reason }
}

/** The rules alone, without alternatives. */
function evaluate(change: SessionChange, ctx: PlacementContext): { refusal: Refusal } | { change: SessionChange; notes: string[] } {
  const notes: string[] = []
  let next: SessionChange = { ...change }
  const day = change.epochDay
  const dow = dowOf(day)
  const name = label(change)

  if (!KNOWN_SESSION_TYPES.has(change.type)) return { refusal: refuse('unknown_type', 'Unknown session type. Nothing added.') }
  if (day < ctx.todayEpochDay) return { refusal: refuse('past_day', 'That day has passed. Pick today or later.') }
  if (change.kind === 'move' && change.fromEpochDay != null) {
    const [from] = weekBounds(change.fromEpochDay)
    if (mondayOf(day) !== from) return { refusal: refuse('other_week', 'A session moves inside its own week. Missed work is not carried over.') }
  }

  const [weekStart, weekEnd] = weekBounds(day)
  const others = ctx.sessions.filter(s => (s.id == null || s.id !== change.sessionId) && LIVE.has(s.status))
  const sameDay = others.filter(s => s.epochDay === day)
  const inWeek = others.filter(s => s.epochDay >= weekStart && s.epochDay <= weekEnd)
  const key = KEY_TYPES.has(change.type)
  const hard = isHard(change)

  // F17, F16: flags from injury skips and back notes.
  if (ctx.injury?.redFlag && key) return { refusal: refuse('red_flag', ctx.injury.reason) }
  if (ctx.injury && key && touchesRegion(change.type, ctx.injury.region) && (hard || RUN_TYPES.has(change.type))) {
    return { refusal: refuse('injury_flag', `${ctx.injury.reason} No ${name.toLowerCase()} on it for now.`) }
  }

  if (ctx.blockType === 'block_zero' && key && isBlockZeroRestDay(ctx.weekNumber, dow)) {
    return { refusal: refuse('rest_day', 'Sunday is the rest day. Foundation only.') }
  }

  // R10 / R5: an ease day takes the eased version, never added hard work.
  const easeDay = (ctx.readinessEase && day === ctx.todayEpochDay) || (ctx.easeDays ?? []).includes(day)
  const loadFlagHere = ctx.loadFlag && mondayOf(day) === mondayOf(ctx.todayEpochDay)
  if (key && (easeDay || loadFlagHere)) {
    return {
      refusal: refuse(easeDay ? 'ease_day' : 'load_flag', easeDay
        ? `${ctx.easeReason ?? 'Check-ins say ease today.'} No hard sessions added.`.replace(/\.\s*\./g, '.')
        : 'Load is past the guide this week. No hard sessions added.'),
    }
  }

  if (hard) {
    const other = sameDay.find(s => isHard(s))
    if (other) return { refusal: refuse('stacked_hard', `${DAY_NAMES[dow]} already has ${label(other).toLowerCase()}. One hard session a day.`) }
  }

  // F6: heavy legs 24 h away from sparring / hard MT and long runs.
  if (isHeavyLegs(change, ctx.blockType)) {
    const clash = others.find(s => isLegInterference(s) && hoursBetween(s, change) < 24)
    if (clash) return { refusal: refuse('legs_24h', `Heavy legs need 24 hours from ${label(clash).toLowerCase()} on ${DAY_NAMES[dowOf(clash.epochDay)]}.`) }
  }
  if (isLegInterference(change)) {
    const clash = others.find(s => isHeavyLegs(s, ctx.blockType) && hoursBetween(s, change) < 24)
    if (clash) return { refusal: refuse('legs_24h', `${name} needs 24 hours from the heavy leg day on ${DAY_NAMES[dowOf(clash.epochDay)]}.`) }
  }

  if (change.type === 'strength') {
    if (sameDay.some(s => s.type === 'strength')) return { refusal: refuse('strength_same_day', 'One strength session a day.') }
    if (ctx.blockType === 'block_zero' && others.some(s => s.type === 'strength' && Math.abs(s.epochDay - day) === 1)) {
      return { refusal: refuse('strength_back_to_back', 'No strength days back to back. Legs and back need the day between.') }
    }
    // R15: strength first on a shared day.
    if (ctx.blockType === 'block_zero' && sameDay.some(s => RUN_TYPES.has(s.type) && (s.status === 'completed' || s.timeSlot === 'am'))) {
      return { refusal: refuse('strength_order', 'Strength comes before running on a shared day.') }
    }
  }

  if (RUN_TYPES.has(change.type)) {
    if (sameDay.some(s => RUN_TYPES.has(s.type))) return { refusal: refuse('run_same_day', 'One run a day.') }
    const strength = sameDay.find(s => s.type === 'strength' && s.status !== 'completed')
    if (ctx.blockType === 'block_zero' && strength) {
      if (strength.timeSlot === 'pm') return { refusal: refuse('strength_order', 'Strength comes before running on a shared day.') }
      if (next.timeSlot !== 'pm') {
        next = { ...next, timeSlot: 'pm' }
        notes.push('Strength comes first. The run goes after.')
      }
    }

    if (change.kind !== 'move') {
      const plannedSec = estimatedMinutes(change, ctx.blockType, ctx.weekNumber) * 60
      // F11: single run cap.
      const single = singleRunCap(plannedSec, ctx.run.longestLast30Sec)
      let capSec = single.capSec
      let capCode: PlacementCode = 'run_single_cap'
      let capReason = single.reason ?? 'Capped at 110% of your longest run in 30 days.'
      // F11: weekly cap, counting what is done and what is still planned.
      const allowance = ctx.run.lastWeekRunSec > 0 ? Math.floor(ctx.run.lastWeekRunSec * WEEKLY_RUN_CAP_RATIO) : RESTART_WEEKLY_SEC
      const stillPlanned = inWeek
        .filter(s => RUN_TYPES.has(s.type) && s.status !== 'completed' && s.epochDay >= ctx.todayEpochDay)
        .reduce((n, s) => n + estimatedMinutes(s, ctx.blockType, ctx.weekNumber) * 60, 0)
      const room = allowance - ctx.run.thisWeekRunSec - stillPlanned
      if (room < capSec) {
        capSec = Math.max(0, room)
        capCode = 'run_weekly_cap'
        capReason = ctx.run.lastWeekRunSec > 0 ? 'Run time this week stays within 30% of last week.' : 'No running last week. This week stays at week-1 volume.'
      }
      if (plannedSec > capSec) {
        if (capSec < MIN_USEFUL_RUN_SEC) return { refusal: refuse(capCode, capReason) }
        const min = Math.floor(capSec / 60)
        next = { ...next, estimatedMin: min }
        notes.push(`${capReason} ${min} min.`)
      }
    }
  }

  if (change.type === 'mt_class') {
    const wanted = classTypeFromLabel(change.label)
    const classesThisWeek = inWeek.filter(s => s.type === 'mt_class').length
    const rampWeek = mtRampWeek(ctx.mt.weeksSinceRampStart)
    const ramping = ctx.blockType === 'block_zero' || rampWeek <= 2
    if (ramping) {
      const decision = evaluateClassRequest({
        classType: wanted,
        weeksSinceFirstClass: ctx.mt.weeksSinceRampStart,
        classesThisWeek: change.kind === 'move' ? Math.max(0, classesThisWeek) : classesThisWeek,
        profileCap: ctx.mt.profileCap,
      })
      if (!decision.allowed) {
        const reason = ctx.blockType === 'block_zero' ? decision.reason : decision.reason.replace('in Block Zero', 'in the first 2 weeks back').replace('No hard sparring in Block Zero.', 'No sparring in the first 2 weeks back.')
        return { refusal: refuse(decision.suggestedType ? 'mt_ramp' : 'mt_cap', reason) }
      }
    } else {
      const cap = ctx.mt.profileCap != null && ctx.mt.profileCap >= 0 ? ctx.mt.profileCap : 3
      if (change.kind !== 'move' && classesThisWeek >= cap) {
        return { refusal: refuse('mt_cap', `That makes ${classesThisWeek + 1} classes this week. The cap is ${cap}.`) }
      }
    }
  }

  // F14: no cramming. Added load can't take the week past the plan.
  const exempt = RECOVERY_TYPES.has(change.type) || (ctx.blockType === 'block_zero' && change.type === 'mt_class')
  if (change.kind !== 'move' && !exempt && ctx.planWeekLoad != null && ctx.planWeekLoad > 0) {
    const current = inWeek.reduce((n, s) => n + plannedLoad(s, ctx.blockType, ctx.weekNumber), 0)
    const added = plannedLoad(next, ctx.blockType, ctx.weekNumber)
    if (current + added > ctx.planWeekLoad * PLAN_LOAD_TOLERANCE) {
      return { refusal: refuse('over_plan', 'That takes the week past its planned load. Missed work is not made up.') }
    }
  }

  return { change: next, notes }
}

/**
 * Check one session change. On a refusal, the safe alternatives: other days
 * and slots this week that pass every rule, then easier swaps that pass.
 */
export function checkSessionChange(change: SessionChange, ctx: PlacementContext, opts: { alternatives?: boolean } = {}): PlacementResult {
  const result = evaluate(change, ctx)
  if ('change' in result) return { ok: true, change: result.change, notes: result.notes }
  const { code, reason } = result.refusal
  if (opts.alternatives === false || code === 'unknown_type' || code === 'red_flag') {
    return { ok: false, code, reason, safeAlternatives: [] }
  }
  return { ok: false, code, reason, safeAlternatives: safeAlternatives(change, ctx) }
}

/** Days this week (today on) and easier swaps that pass the rules. */
export function safeAlternatives(change: SessionChange, ctx: PlacementContext): SafeAlternative[] {
  const out: SafeAlternative[] = []
  const anchor = change.kind === 'move' && change.fromEpochDay != null ? change.fromEpochDay : change.epochDay
  const weekStart = mondayOf(Math.max(anchor, change.epochDay < ctx.todayEpochDay ? ctx.todayEpochDay : anchor))
  const first = Math.max(weekStart, ctx.todayEpochDay)
  for (let d = first; d <= weekStart + 6 && out.length < MAX_DAY_ALTERNATIVES; d++) {
    for (const slot of ['am', 'pm'] as const) {
      if (d === change.epochDay && slot === change.timeSlot) continue
      const r = evaluate({ ...change, epochDay: d, timeSlot: slot }, ctx)
      if ('change' in r) {
        out.push({ kind: 'day', epochDay: d, date: isoOf(d), timeSlot: r.change.timeSlot })
        break
      }
    }
  }
  const swapDay = change.epochDay >= ctx.todayEpochDay ? change.epochDay : first
  if (swapDay <= weekStart + 6) {
    for (const opt of easierOptions(change, ctx.blockType)) {
      if (opt.type === change.type && (opt.label ?? '') === (change.label ?? '') && (opt.notes ?? null) === (change.notes ?? null)) continue
      const r = evaluate({ ...change, ...opt, estimatedMin: null, epochDay: swapDay, kind: change.kind === 'move' ? 'replace' : change.kind }, ctx)
      if ('change' in r) out.push({ kind: 'swap', type: opt.type, label: opt.label, ...(opt.notes ? { notes: opt.notes } : {}), epochDay: swapDay, date: isoOf(swapDay), timeSlot: r.change.timeSlot })
    }
  }
  return out
}

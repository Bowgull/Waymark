// "I want a ___ day" (Part C, owner-approved 2026-10-19). For each row of the
// Add Session board the coach decides, before the board shows it, which of
// four forms the change takes, and the board only offers what will pass:
// 1. Pull forward: strength on a non-strength day brings the next planned
//    strength session of the week here; what was planned today takes its slot.
// 2. Replace: when adding would stack hard days or pass the week's load, the
//    session becomes a swap for today's planned one ("bag instead of the run").
// 3. Add: the week has room and every check passes.
// 4. Not today: one line, the rule's own reason.
// Every form is checked by the same placement rules as the routes. Pure.

import { strengthDayFor, type StrengthDay } from '../blockZero/weekPlan'
import { checkSessionChange, type PlacementCode, type PlacementContext, type SessionChange } from './placement'
import { DAY_NAMES, KEY_TYPES, RECOVERY_TYPES, dowOf, mondayOf, sessionName, type SessionLike, type TimeSlot } from './sessions'

export interface PickOption {
  type: string
  label?: string | null
  /** Run category for 'running'. */
  notes?: string | null
  timeSlot: TimeSlot
}

export type PickAction =
  | { kind: 'add'; label: string | null; timeSlot: TimeSlot }
  | { kind: 'pull_forward'; sessionId: string; fromEpochDay: number; label: string | null; timeSlot: TimeSlot; displaced: Array<{ sessionId: string; name: string }> }
  | { kind: 'replace'; sessionId: string; label: string | null; timeSlot: TimeSlot; replacing: string }
  | { kind: 'refused'; code: PlacementCode | 'nothing_to_pull'; reason: string }

export interface PickResult {
  action: PickAction
  /** One line for the row, house voice. Null for a plain add. */
  line: string | null
}

const LIVE = new Set(['planned', 'in_progress', 'completed'])
/** Refusals a swap for today's planned session can answer. */
const REPLACEABLE: ReadonlySet<string> = new Set(['over_plan', 'stacked_hard', 'run_same_day', 'strength_order', 'run_weekly_cap', 'legs_24h'])

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Run-Walk" -> "run-walk", "Strength B" -> "strength B": a name mid-sentence. */
function lower(name: string): string {
  return name.toLowerCase().replace(/ ([abc])$/, (_, l: string) => ` ${l.toUpperCase()}`)
}

/**
 * The Block Zero strength letter for an added session (D8): in the lead-in,
 * the weekday's own; otherwise the letter not yet live this week, else the
 * weekday's. Never a letter already planned or done this week when one is free.
 */
export function strengthLetterFor(day: number, week: SessionLike[], leadIn: boolean): StrengthDay {
  const own = strengthDayFor(dowOf(day))
  if (leadIn) return own
  const used = new Set(week.filter(s => s.type === 'strength' && LIVE.has(s.status)).map(s => s.label?.match(/Strength ([ABC])\b/)?.[1]).filter(Boolean))
  if (!used.has(own)) return own
  return (['A', 'B', 'C'] as const).find(l => !used.has(l)) ?? own
}

function withSessions(ctx: PlacementContext, sessions: SessionLike[]): PlacementContext {
  return { ...ctx, sessions }
}

/** The next planned strength session later this week. */
function nextPlannedStrength(day: number, ctx: PlacementContext): SessionLike | null {
  const sunday = mondayOf(day) + 6
  return ctx.sessions
    .filter(s => s.type === 'strength' && s.status === 'planned' && s.id != null && s.epochDay > day && s.epochDay <= sunday)
    .sort((a, b) => a.epochDay - b.epochDay)[0] ?? null
}

/**
 * Pull forward: the strength session moves to `day`; today's planned key
 * sessions move to its old day. Both moves are checked, each against the
 * week as it would be after the other.
 */
function tryPullForward(day: number, slot: TimeSlot, ctx: PlacementContext): PickResult | null {
  const next = nextPlannedStrength(day, ctx)
  if (!next || next.id == null) return null
  const displaced = ctx.sessions.filter(s => s.epochDay === day && s.status === 'planned' && s.id != null && KEY_TYPES.has(s.type))
  // Work already done or under way today stays where it is: nothing swaps with it.
  const started = ctx.sessions.find(s => s.epochDay === day && KEY_TYPES.has(s.type) && (s.status === 'completed' || s.status === 'in_progress'))
  if (started) {
    const why = `${sessionName(started)} is ${started.status === 'completed' ? 'done' : 'under way'} today. ${sessionName(next)} stays on ${DAY_NAMES[dowOf(next.epochDay)]}.`
    return { action: { kind: 'refused', code: 'stacked_hard', reason: why }, line: why }
  }
  const moved = (list: SessionLike[]) => list.map(s => {
    if (s.id === next.id) return { ...s, epochDay: day, timeSlot: slot }
    if (displaced.some(d => d.id === s.id)) return { ...s, epochDay: next.epochDay }
    return s
  })
  const after = moved(ctx.sessions)
  const strengthMove: SessionChange = { kind: 'move', type: 'strength', label: next.label, notes: next.notes, epochDay: day, timeSlot: slot, sessionId: next.id, fromEpochDay: next.epochDay }
  // Each check leaves the moving session out of its own day, so the week after both moves serves both.
  const check = checkSessionChange(strengthMove, withSessions(ctx, after), { alternatives: false })
  if (!check.ok) return { action: { kind: 'refused', code: check.code, reason: check.reason }, line: check.reason }
  for (const d of displaced) {
    const back: SessionChange = { kind: 'move', type: d.type, label: d.label, notes: d.notes, epochDay: next.epochDay, timeSlot: d.timeSlot, sessionId: d.id, fromEpochDay: day }
    const r = checkSessionChange(back, withSessions(ctx, after), { alternatives: false })
    if (!r.ok) return { action: { kind: 'refused', code: r.code, reason: r.reason }, line: r.reason }
  }
  const name = sessionName(next)
  const from = DAY_FULL[dowOf(next.epochDay)]
  const swapped = displaced.length > 0 ? ` ${displaced.map(sessionName).join(' and ')} moves to ${from}.` : ''
  return {
    action: { kind: 'pull_forward', sessionId: next.id, fromEpochDay: next.epochDay, label: next.label ?? null, timeSlot: check.change.timeSlot, displaced: displaced.map(d => ({ sessionId: d.id as string, name: sessionName(d) })) },
    line: `${from}'s ${name} comes here.${swapped}`,
  }
}

/** Replace today's planned session with the picked one, when the rules allow it. */
function tryReplace(opt: PickOption, label: string | null, day: number, ctx: PlacementContext): PickResult | null {
  const planned = ctx.sessions
    .filter(s => s.epochDay === day && s.status === 'planned' && s.id != null && KEY_TYPES.has(s.type) && s.type !== opt.type)
    .sort((a, b) => (a.timeSlot === opt.timeSlot ? -1 : 1) - (b.timeSlot === opt.timeSlot ? -1 : 1))
  for (const p of planned) {
    const r = checkSessionChange({ kind: 'replace', type: opt.type, label, notes: opt.notes ?? null, epochDay: day, timeSlot: opt.timeSlot, sessionId: p.id }, ctx, { alternatives: false })
    if (r.ok) {
      const name = sessionName(p)
      return { action: { kind: 'replace', sessionId: p.id as string, label, timeSlot: r.change.timeSlot, replacing: name }, line: `Instead of today's ${lower(name)}.` }
    }
  }
  return null
}

/**
 * What picking `opt` on `day` would do. `ctx` is the placement context for
 * that day (the week plus a day either side, block and week, readiness).
 */
export function pickDayOption(opt: PickOption, day: number, ctx: PlacementContext): PickResult {
  const blockZero = ctx.blockType === 'block_zero'
  const weekSessions = ctx.sessions.filter(s => s.epochDay >= mondayOf(day) && s.epochDay <= mondayOf(day) + 6)
  const label = opt.type === 'strength' && blockZero
    ? `Strength ${strengthLetterFor(day, weekSessions, ctx.leadIn === true)}`
    : opt.label ?? null

  // Strength on a non-strength day: the week's next planned strength comes here.
  if (opt.type === 'strength' && !ctx.sessions.some(s => s.epochDay === day && s.type === 'strength' && LIVE.has(s.status))) {
    const next = nextPlannedStrength(day, ctx)
    if (next) {
      const pulled = tryPullForward(day, opt.timeSlot, ctx)
      if (pulled) return pulled
      return { action: { kind: 'refused', code: 'nothing_to_pull', reason: `${sessionName(next)} stays on ${DAY_NAMES[dowOf(next.epochDay)]}.` }, line: `${sessionName(next)} stays on ${DAY_NAMES[dowOf(next.epochDay)]}.` }
    }
  }

  const add = checkSessionChange({ kind: 'add', type: opt.type, label, notes: opt.notes ?? null, epochDay: day, timeSlot: opt.timeSlot }, ctx, { alternatives: false })
  if (add.ok) return { action: { kind: 'add', label, timeSlot: add.change.timeSlot }, line: add.notes[0] ?? null }

  // Adding would stack or pass the plan: offer it as a swap for today's session.
  if (REPLACEABLE.has(add.code) && !RECOVERY_TYPES.has(opt.type)) {
    const swap = tryReplace(opt, label, day, ctx)
    if (swap) return swap
  }
  return { action: { kind: 'refused', code: add.code, reason: add.reason }, line: add.reason }
}

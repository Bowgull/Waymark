// A pick on the Add Session board (page 56, approved 2026-10-19: "+ Add
// session always adds"). Nothing is refused or greyed out; the coach then
// rebalances the rest of the week (rebalance.ts) and marks what it changed.
// Strength on a day with no lifting brings the week's remaining session that
// is lightest on the legs after yesterday here (R10), and what was planned
// today takes its old day. Pure.

import { strengthDayFor, type StrengthDay } from '../blockZero/weekPlan'
import type { PlacementContext } from './placement'
import { KEY_TYPES, dowOf, isHeavyLegs, mondayOf, sessionName, type SessionLike, type TimeSlot } from './sessions'

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

export interface PickResult {
  action: PickAction
}

const LIVE = new Set(['planned', 'in_progress', 'completed'])

/**
 * The squat or hinge day (A or B; Fighter: every lift). C's lunge counts as
 * heavy legs before a hard run (rebuild Phase 2) but is still the lightest
 * lift the day after A or B.
 */
function squatOrHinge(s: Pick<SessionLike, 'type' | 'label'>, blockType: PlacementContext['blockType']): boolean {
  return isHeavyLegs(s, blockType) && !(blockType === 'block_zero' && /Strength C\b/.test(s.label ?? ''))
}

/** Yesterday loaded the legs (A or B, done or still planned). */
function heavyYesterday(day: number, week: ReadonlyArray<SessionLike>, blockType: PlacementContext['blockType']): boolean {
  return week.some(s => s.epochDay === day - 1 && LIVE.has(s.status) && squatOrHinge(s, blockType))
}

/**
 * The Block Zero strength letter for an added session (D8, R10): in the
 * lead-in, the weekday's own; otherwise C when yesterday loaded the legs and C
 * is still free, else the weekday's own when free, else the first letter not
 * yet live this week.
 */
export function strengthLetterFor(day: number, week: SessionLike[], leadIn: boolean): StrengthDay {
  const own = strengthDayFor(dowOf(day))
  if (leadIn) return own
  const used = new Set(week.filter(s => s.type === 'strength' && LIVE.has(s.status)).map(s => s.label?.match(/Strength ([ABC])\b/)?.[1]).filter(Boolean))
  if (!used.has('C') && heavyYesterday(day, week, 'block_zero')) return 'C'
  if (!used.has(own)) return own
  return (['A', 'B', 'C'] as const).find(l => !used.has(l)) ?? own
}

/**
 * R10: the strength session that comes forward: the week's remaining one
 * lightest on the legs after yesterday (C after A or B), else the next by date.
 */
export function strengthToPull(day: number, ctx: PlacementContext): SessionLike | null {
  const sunday = mondayOf(day) + 6
  const later = ctx.sessions
    .filter(s => s.type === 'strength' && s.status === 'planned' && s.id != null && s.epochDay > day && s.epochDay <= sunday)
    .sort((a, b) => a.epochDay - b.epochDay)
  if (later.length === 0) return null
  if (heavyYesterday(day, ctx.sessions, ctx.blockType)) {
    const light = later.find(s => !squatOrHinge(s, ctx.blockType))
    if (light) return light
  }
  return later[0]
}

/**
 * What picking `opt` on `day` does: always an add, or (strength on a day with
 * no lifting, nothing under way today) the week's next strength pulled here.
 */
export function pickDayOption(opt: PickOption, day: number, ctx: PlacementContext): PickResult {
  const blockZero = ctx.blockType === 'block_zero'
  const weekSessions = ctx.sessions.filter(s => s.epochDay >= mondayOf(day) && s.epochDay <= mondayOf(day) + 6)
  const label = opt.type === 'strength' && blockZero
    ? `Strength ${strengthLetterFor(day, weekSessions, ctx.leadIn === true)}`
    : opt.label ?? null

  if (opt.type === 'strength' && !ctx.leadIn && !ctx.sessions.some(s => s.epochDay === day && s.type === 'strength' && LIVE.has(s.status))) {
    const next = strengthToPull(day, ctx)
    // Work already done or under way today stays: the strength is simply added.
    const started = ctx.sessions.some(s => s.epochDay === day && KEY_TYPES.has(s.type) && (s.status === 'completed' || s.status === 'in_progress'))
    if (next && next.id != null && !started) {
      const displaced = ctx.sessions.filter(s => s.epochDay === day && s.status === 'planned' && s.id != null && KEY_TYPES.has(s.type))
      return {
        action: {
          kind: 'pull_forward',
          sessionId: next.id,
          fromEpochDay: next.epochDay,
          label: next.label ?? null,
          timeSlot: opt.timeSlot,
          displaced: displaced.map(d => ({ sessionId: d.id as string, name: sessionName(d) })),
        },
      }
    }
  }
  return { action: { kind: 'add', label, timeSlot: opt.timeSlot } }
}

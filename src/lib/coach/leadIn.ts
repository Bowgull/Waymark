// Block Zero lead-in (Part B, owner-approved 2026-10-19). Week 1 always
// starts on a Monday. A start on any other day leads in to that Monday:
// - Days before the start get no sessions, ever (any block).
// - Lead-in days get Foundation, plus an easy run-walk on Tue/Thu/Sat.
// - Lead-in sessions are optional: no missed asks, no week-1 completion or
//   gate consistency, no week count, no "felt easier" reads. They do count
//   for session load and the check-in baseline.
// - Strength picked in the lead-in is an intro session (2 x 8 @ RPE 5-6),
//   at most 2, never back to back, never Sunday. Bag: at most 2, 4 rounds.
// Pure: callers pass the block start and the training week.

import { getLeadInDayTemplate } from '../blockZero/weekPlan'
import { getDayTemplate, type TemplateSession } from '../weeklyTemplate'
import { anchorMondayFor } from './weekCounter'
import { dowOf, type BlockKind } from './sessions'

/** Intro strength sessions, and bag sessions, the lead-in takes (each). */
export const LEAD_IN_MAX_SESSIONS = 2

/** First day that counts for completion, the gate and missed asks: week 1's Monday (Block Zero) or the start. */
export function countsFromDay(blockType: BlockKind, startDay: number): number {
  return blockType === 'block_zero' ? anchorMondayFor(startDay, 'block_zero') : startDay
}

/**
 * Optional work (Part B): a day before week 1's Monday in Block Zero (the
 * lead-in, and before the start), or before the start in any block. A miss
 * there makes no question and doesn't count against consistency.
 */
export function optionalDay(blockType: BlockKind, startDay: number, day: number): boolean {
  return day < countsFromDay(blockType, startDay)
}

/**
 * Stored start for a block begun on the athlete's local day: noon UTC of that
 * date, so floor(startedAt / 86400) is the local day in every time zone of
 * the Americas (D4). A Wednesday-evening start stays Wednesday.
 */
export function startedAtForLocalDay(localDay: number): number {
  return localDay * 86400 + 12 * 3600
}

/** Block Zero lead-in day: from the start day up to week 1's Monday. */
export function inLeadIn(blockType: BlockKind, startDay: number, day: number): boolean {
  return blockType === 'block_zero' && day >= startDay && day < anchorMondayFor(startDay, 'block_zero')
}

export interface PlannedDay {
  sessions: TemplateSession[]
  leadIn: boolean
  beforeStart: boolean
}

/**
 * The template sessions a day gets: none before the start; the lead-in day in
 * a Block Zero lead-in; else the block's day template for the training week.
 */
export function planDayTemplate(input: { blockType: BlockKind; startDay: number; epochDay: number; weekNumber: number; mtDays: Set<number> }): PlannedDay {
  if (input.epochDay < input.startDay) return { sessions: [], leadIn: false, beforeStart: true }
  const dow = dowOf(input.epochDay)
  if (inLeadIn(input.blockType, input.startDay, input.epochDay)) {
    return { sessions: getLeadInDayTemplate(dow), leadIn: true, beforeStart: false }
  }
  return { sessions: getDayTemplate(input.blockType, input.weekNumber, dow, input.mtDays), leadIn: false, beforeStart: false }
}

/** context_json stamp for a lead-in session. */
export const LEAD_IN_CONTEXT = { leadIn: true } as const

export function isLeadInContext(contextJson: string | null | undefined): boolean {
  if (!contextJson) return false
  try { return (JSON.parse(contextJson) as { leadIn?: unknown }).leadIn === true } catch { return false }
}

/**
 * A mid-week Block Zero start has two plans numbered week 1: the lead-in
 * (its sessions stamped leadIn) and the real week 1 from the next Monday.
 * Plans come newest first; the newest plan of the asked kind wins (a paused
 * block can repeat a week number). An empty plan is not a lead-in.
 */
export function pickWeekPlan<P>(plans: ReadonlyArray<{ plan: P; contexts: ReadonlyArray<string | null | undefined> }>, leadIn: boolean): P | null {
  for (const p of plans) {
    if (p.contexts.some(isLeadInContext) === leadIn) return p.plan
  }
  return null
}

// The block's first days. Coach brain P2 (coach-brain.md §7, approved
// 2026-10-20) removed the Block Zero lead-in: the start day is day 1 whatever
// the weekday, and its calendar week is week 1. Days before the start get no
// sessions, ever (any block). In a Block Zero that starts mid-week the first
// days follow the week's order from the start day (Strength A first, the most
// reliable session), Sunday staying rest. Older rows stamped leadIn read as
// ordinary sessions. Pure: callers pass the block start and the training week.

import { getBlockZeroWeekTemplate } from '../blockZero/weekPlan'
import { getDayTemplate, type TemplateSession } from '../weeklyTemplate'
import { anchorMondayFor } from './weekCounter'
import { dowOf, mondayOf, type BlockKind } from './sessions'

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

/** Block Zero lead-in day: there is none since coach brain P2 (kept for older callers). */
export function inLeadIn(_blockType: BlockKind, _startDay: number, _day: number): boolean {
  void _blockType; void _startDay; void _day
  return false
}

export interface PlannedDay {
  sessions: TemplateSession[]
  leadIn: boolean
  beforeStart: boolean
}

/**
 * The start week of a Block Zero begun after Monday: day N after the start
 * takes the week's Nth training day (Mon A, Tue run, Wed B, ...), Sunday rest.
 * Null for any other day.
 */
export function startWeekDay(startDay: number, epochDay: number, weekNumber: number): TemplateSession[] | null {
  if (mondayOf(epochDay) !== mondayOf(startDay) || dowOf(startDay) === 1 || epochDay < startDay) return null
  const week = getBlockZeroWeekTemplate(weekNumber)
  if (dowOf(epochDay) === 0) return week[0] ?? []
  let n = 0
  for (let d = startDay; d < epochDay; d++) if (dowOf(d) !== 0) n++
  return week[Math.min(6, 1 + n)] ?? []
}

/**
 * The template sessions a day gets: none before the start; else the block's
 * day template for the training week (Block Zero's start week from day 1).
 */
export function planDayTemplate(input: { blockType: BlockKind; startDay: number; epochDay: number; weekNumber: number; mtDays: Set<number> }): PlannedDay {
  if (input.epochDay < input.startDay) return { sessions: [], leadIn: false, beforeStart: true }
  const dow = dowOf(input.epochDay)
  const first = input.blockType === 'block_zero' ? startWeekDay(input.startDay, input.epochDay, input.weekNumber) : null
  return { sessions: first ?? getDayTemplate(input.blockType, input.weekNumber, dow, input.mtDays), leadIn: false, beforeStart: false }
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

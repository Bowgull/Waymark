// Pausable training week. The block calendar runs on Monday-Sunday weeks and
// only advances through weeks the athlete trained, so a holiday or a sick week
// doesn't move them further into the program (F12, F13; program for exposure,
// not the calendar). Pure: callers pass completed key-session days.
//
// - Week 1 is the block's first Monday-Sunday week. Block Zero: the week of the
//   start day, whatever the weekday (coach brain P2: no lead-in). Fighter keeps
//   the older rule: Monday-Wednesday count their own week, Thursday-Sunday lead in.
// - A past week with no completed key session is paused.
// - The week a 7+ day gap began is paused too when under half its key sessions
//   were done, so the athlete resumes at the week they left.
// - Block Zero restarts at week 1 after a gap of 4+ weeks (mini Block Zero).
// - This week counts once a key session is done in it; later weeks are
//   assumed trained (the future can't be paused yet).
// Fighter wave semantics are unchanged: the wave reads the uncapped week.

import { GAP_PAUSE_DAYS, RESTART_GAP_DAYS } from './gap'
import { dowOf, mondayOf, type BlockKind } from './sessions'

export interface TrainingWeekInput {
  blockType: BlockKind
  /** Epoch day the block started. */
  startDay: number
  totalWeeks: number
  /** Epoch days of completed key sessions, one entry per session. */
  completedKeyDays: number[]
  /** Day being planned. */
  day: number
  /** Today, for which weeks are past. */
  todayDay: number
  /** Planned key sessions in a normal week, for the half-done rule. */
  plannedKeyPerWeek: number
}

export interface TrainingWeek {
  /** Training week, 1..totalWeeks. */
  week: number
  /** Uncapped training week (Fighter wave). */
  rawWeek: number
  /** Monday of the day's calendar week. */
  monday: number
  /** Monday the count starts from (block anchor, or a Block Zero restart). */
  anchorMonday: number
  /** Past weeks skipped by the count. */
  pausedWeeks: number
  /** Block Zero restarted after a 4+ week gap. */
  restarted: boolean
  /**
   * Block Zero: the day sits before week 1's Monday (the lead-in, or before
   * the start). Lead-in work is optional: no asks, no completion count, no
   * week count. Always false for Fighter.
   */
  leadIn: boolean
}

/**
 * Week 1's Monday. Block Zero: a Monday start is its own week 1, any other
 * day leads in to the next Monday. Fighter: Mon-Wed starts count their own
 * week; Thu-Sun starts lead into the next.
 */
export function anchorMondayFor(startDay: number, blockType: BlockKind = 'fighter'): number {
  const dow = dowOf(startDay)
  // Block Zero (coach brain P2): no lead-in. The start day is day 1 and its calendar week is week 1.
  if (blockType === 'block_zero') return mondayOf(startDay)
  const lateStart = dow === 0 || dow >= 4
  return mondayOf(startDay) + (lateStart ? 7 : 0)
}

/** Block Zero: is this day in the lead-in (start day up to week 1's Monday)? */
export function isLeadInDay(startDay: number, day: number): boolean {
  return day >= startDay && day < anchorMondayFor(startDay, 'block_zero')
}

interface Gap { lastDay: number; returnDay: number | null; days: number }

function gaps(days: number[], todayDay: number): Gap[] {
  const out: Gap[] = []
  for (let i = 1; i < days.length; i++) {
    const g = days[i] - days[i - 1] - 1
    if (g >= GAP_PAUSE_DAYS) out.push({ lastDay: days[i - 1], returnDay: days[i], days: g })
  }
  if (days.length > 0) {
    const open = todayDay - days[days.length - 1] - 1
    if (open >= GAP_PAUSE_DAYS) out.push({ lastDay: days[days.length - 1], returnDay: null, days: open })
  }
  return out
}

export function trainingWeek(input: TrainingWeekInput): TrainingWeek {
  const monday = mondayOf(input.day)
  const todayMonday = mondayOf(input.todayDay)
  const days = [...input.completedKeyDays].filter(d => d <= input.todayDay).sort((a, b) => a - b)
  const distinct = [...new Set(days)]
  const blockAnchor = anchorMondayFor(input.startDay, input.blockType)
  const half = Math.max(1, Math.ceil(input.plannedKeyPerWeek / 2))

  // Block Zero: a 4+ week gap inside the block restarts the count.
  let anchor = blockAnchor
  let restarted = false
  const allGaps = gaps(distinct, input.todayDay)
  if (input.blockType === 'block_zero') {
    for (const g of allGaps) {
      if (g.days < RESTART_GAP_DAYS || g.lastDay < input.startDay - 1) continue
      const back = mondayOf(g.returnDay ?? input.todayDay)
      if (back <= monday && back > anchor) {
        anchor = back
        restarted = true
      }
    }
  }

  const leftWeeks = new Set(allGaps.map(g => mondayOf(g.lastDay)))
  const countIn = (w: number) => days.filter(d => d >= w && d <= w + 6).length

  let active = 0
  let paused = 0
  for (let w = anchor; w < monday; w += 7) {
    // This week counts once something is done in it; later weeks are assumed
    // trained. A week planned ahead is never numbered past an empty week.
    if (w > todayMonday || (w === todayMonday && countIn(w) > 0)) { active++; continue }
    if (w === todayMonday) { paused++; continue }
    const n = countIn(w)
    const leftHalfDone = leftWeeks.has(w) && n < half
    if (n === 0 || leftHalfDone) paused++
    else active++
  }

  const rawWeek = monday < anchor ? 1 : active + 1
  return {
    week: Math.min(Math.max(rawWeek, 1), Math.max(1, input.totalWeeks)),
    rawWeek,
    monday,
    anchorMonday: anchor,
    pausedWeeks: paused,
    restarted,
    leadIn: input.blockType === 'block_zero' && input.day < blockAnchor,
  }
}

// Choosing the Block Zero start day (page 64, approved 2026-10-20). START
// BLOCK ZERO opens a board of seven days (TODAY, TOMORROW, the next five by
// name); until the chosen day, Today and Program show a waiting board with a
// countdown and CHANGE DAY; the start day's morning gets one line on top.
//
// The block is stored at once with its start in the future (noon UTC of the
// local day, D4). It is the running block, but nothing is planned before its
// start (planDayTemplate, generateDaySessions), and the week counter
// (weekCounter.ts) applies from the chosen day: week 1 starts that day.
// Pure, so the tests run under node.

import { dowOf } from './sessions'

/** Days on the board: today and the next six. */
export const START_DAY_CHOICES = 7

const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const dateOf = (day: number) => new Date(day * 86400000)
/** "Tue". */
export const dayName = (day: number) => DAY3[dowOf(day)]
/** "Mon 26 Oct". */
export const dayDate = (day: number) => `${dayName(day)} ${dateOf(day).getUTCDate()} ${MON3[dateOf(day).getUTCMonth()]}`

/** A start can be today or one of the next six days. */
export function isChoosableStart(startDay: number, todayDay: number): boolean {
  return Number.isInteger(startDay) && startDay >= todayDay && startDay < todayDay + START_DAY_CHOICES
}

/** The block's start is still ahead: nothing is planned yet (the waiting board). */
export function isPendingStart(startDay: number | null | undefined, todayDay: number): boolean {
  return startDay != null && startDay > todayDay
}

/** A block's start day from its stored start (noon UTC of the local day). */
export function startDayOf(startedAt: number | null | undefined): number | null {
  return startedAt == null ? null : Math.floor(startedAt / 86400)
}

export interface StartTile {
  day: number
  /** The flap: TODAY, TOMORROW, then THU, FRI, ... */
  key: string
  /** Under the flap: "Tue 20" for the first two, the date alone after. */
  date: string
}

/** The seven tiles: TODAY and TOMORROW (two wide), then five days by name. */
export function startTiles(todayDay: number): StartTile[] {
  return Array.from({ length: START_DAY_CHOICES }, (_, i) => {
    const day = todayDay + i
    const n = dateOf(day).getUTCDate()
    if (i === 0) return { day, key: 'TODAY', date: `${dayName(day)} ${n}` }
    if (i === 1) return { day, key: 'TOMORROW', date: `${dayName(day)} ${n}` }
    return { day, key: dayName(day).toUpperCase(), date: String(n) }
  })
}

/**
 * What the start means, after "Starts <day>.": week 1 starts that day,
 * whatever the weekday (coach brain P2: no lead-in).
 */
export function startMeaning(_startDay: number, _opts: { optional?: boolean } = {}): string {
  void _startDay; void _opts
  return 'Week 1 starts that day.'
}

/** The waiting board's line (page 64 2A): what the start means, without "all optional". */
export function waitLine(startDay: number): string {
  return startMeaning(startDay, { optional: false })
}

/** The board's plain line: "Starts" + the day in bold + what it means. */
export function startLine(startDay: number, todayDay: number): { lead: string; day: string; rest: string } {
  const day = dowOf(startDay) === 1 ? dayDate(startDay) : startDay === todayDay ? 'today' : dayName(startDay)
  return { lead: 'Starts ', day, rest: `. ${startMeaning(startDay)}` }
}

/** The waiting board's gold flap: STARTS THU. */
export function startsFlap(startDay: number): string {
  return `STARTS ${dayName(startDay).toUpperCase()}`
}

/** The countdown flap: TOMORROW, else IN 3 DAYS. */
export function countdownFlap(startDay: number, todayDay: number): string {
  const n = startDay - todayDay
  return n <= 1 ? 'TOMORROW' : `IN ${n} DAYS`
}

/**
 * The start day's morning only: one line on top of the day. Null on any other day.
 * No fixed block length since coach brain P2: the coach decides when he is ready.
 */
export function dayOneLine(startDay: number | null | undefined, todayDay: number, _sessionsToday: number): { flap: string; line: string } | null {
  void _sessionsToday
  if (startDay == null || startDay !== todayDay) return null
  return { flap: 'BLOCK ZERO · DAY 1', line: 'Day 1. Light today: the coach learns you from here.' }
}

/** The start's first week holds no lead-in any more (coach brain P2). Kept for callers. */
export function startHasLeadIn(_startDay: number): boolean {
  void _startDay
  return false
}

/** The preview's label under the waiting board: "Tomorrow", else "Starts Thu". */
export function startPreviewLabel(startDay: number, todayDay: number): string {
  return startDay - todayDay <= 1 ? 'Tomorrow' : `Starts ${dayName(startDay)}`
}

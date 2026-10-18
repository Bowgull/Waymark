// Session load (R5, Foster 2001): session RPE x minutes, for every session
// including muay thai. Week-over-week change is a soft guide (aim <= 10-15%),
// never a hard stop (R5; R6 says ACWR bands are not gates).

export const WEEKLY_LOAD_SOFT_CAP = 0.15

export interface LoadEntry {
  epochDay: number
  rpe: number | null
  minutes: number | null
}

/** sRPE-load in arbitrary units. Null when either input is missing. */
export function sessionLoad(rpe: number | null, minutes: number | null): number | null {
  if (rpe == null || minutes == null || rpe < 0 || minutes < 0) return null
  return rpe * minutes
}

/**
 * Weekly load totals for `weeks` consecutive 7-day windows starting at
 * `startEpochDay`. Entries without RPE or minutes add nothing.
 */
export function weeklyLoadTotals(entries: LoadEntry[], startEpochDay: number, weeks: number): number[] {
  const totals = Array.from({ length: Math.max(0, weeks) }, () => 0)
  for (const e of entries) {
    const idx = Math.floor((e.epochDay - startEpochDay) / 7)
    if (idx < 0 || idx >= totals.length) continue
    totals[idx] += sessionLoad(e.rpe, e.minutes) ?? 0
  }
  return totals
}

/** Fractional change (0.2 = +20%). Null when last week was zero. */
export function weekOverWeekChange(prevWeek: number, thisWeek: number): number | null {
  if (prevWeek <= 0) return null
  return (thisWeek - prevWeek) / prevWeek
}

export interface LoadFlag {
  change: number | null
  flagged: boolean
  reason: string | null
}

/**
 * Soft flag when load rises more than 15% week over week, or any load lands
 * after a zero week (a return from a gap). Feeds auto-ease; never blocks.
 */
export function weeklyLoadFlag(prevWeek: number, thisWeek: number): LoadFlag {
  const change = weekOverWeekChange(prevWeek, thisWeek)
  if (change == null) {
    if (thisWeek > 0 && prevWeek <= 0) {
      return { change: null, flagged: true, reason: 'Load is back after a week off.' }
    }
    return { change: null, flagged: false, reason: null }
  }
  if (change > WEEKLY_LOAD_SOFT_CAP) {
    return { change, flagged: true, reason: `Load is up ${Math.round(change * 100)}% on last week.` }
  }
  return { change, flagged: false, reason: null }
}

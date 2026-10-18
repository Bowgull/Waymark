// The Block Zero program view (Phase C, direction 6): the six-week strip
// (Test · Build x4 · Retest) with "you are here", the week's theme and the
// class cap line. The glade that grows above it belongs to the world (step 2).
// Pure; the class caps come from the server's ramp rules (muayThai.ts).

import { BLOCK_ZERO_BASE_WEEKS } from '@/lib/blockZero/weeks'

export interface StripWeek {
  week: number
  /** One letter on the flap: T, B, R, or + for an extension week. */
  letter: string
  name: string
  state: 'done' | 'now' | 'ahead'
}

export function weekName(week: number): string {
  if (week === 1) return 'TEST'
  if (week < BLOCK_ZERO_BASE_WEEKS) return 'BUILD'
  if (week === BLOCK_ZERO_BASE_WEEKS) return 'RETEST'
  return 'EXTRA'
}

/** Six weeks, plus any extension weeks the gate added. */
export function stripWeeks(currentWeek: number, totalWeeks: number): StripWeek[] {
  const n = Math.max(BLOCK_ZERO_BASE_WEEKS, totalWeeks)
  return Array.from({ length: n }, (_, i) => {
    const week = i + 1
    const name = weekName(week)
    return {
      week,
      letter: name === 'EXTRA' ? '+' : name.charAt(0),
      name,
      state: week < currentWeek ? 'done' : week === currentWeek ? 'now' : 'ahead',
    }
  })
}

/** One line per week: what the week is for (plan section 2). */
export function weekLine(week: number): string {
  if (week === 1) return 'Test week. Everything light. The point is real starting numbers.'
  if (week === 2) return 'Build. Two hard sets per lift, about three left in the tank.'
  if (week === 3) return 'Build. One estimated-max check on the main lifts re-anchors the loads.'
  if (week < BLOCK_ZERO_BASE_WEEKS) return 'Build. Loads go up only when the top set feels easier.'
  if (week === BLOCK_ZERO_BASE_WEEKS) return 'Consolidate. Volume down, intensity held. Retest, then the gate.'
  return 'Extra week. Training holds at week-5 levels.'
}

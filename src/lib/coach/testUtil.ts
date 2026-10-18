// Shared helpers for the coach tests. Not imported by app code.

import type { PlacementContext } from './placement'
import type { SessionLike } from './sessions'

export function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

/** A Monday epoch day (2024-10-07). */
export const MON = 20003

let n = 0
export function s(type: string, epochDay: number, extra: Partial<SessionLike> = {}): SessionLike {
  n++
  return { id: `s${n}`, type, epochDay, timeSlot: 'am', status: 'planned', label: null, notes: null, ...extra }
}

export function ctx(over: Partial<PlacementContext> = {}): PlacementContext {
  return {
    blockType: 'fighter',
    weekNumber: 3,
    todayEpochDay: MON,
    sessions: [],
    readinessEase: false,
    loadFlag: false,
    easeReason: null,
    easeDays: [],
    run: { longestLast30Sec: 40 * 60, lastWeekRunSec: 120 * 60, thisWeekRunSec: 0 },
    mt: { weeksSinceRampStart: 6, profileCap: null },
    planWeekLoad: null,
    injury: null,
    ...over,
  }
}

// Silent session rollover. Any planned session whose scheduled date is
// before today (in the caller's local timezone) gets flipped to 'missed'.
// This is the foundation of adaptive coaching: the app has to know what
// actually happened (or didn't) before it can reshape the plan.
//
// Design choices:
//  - Lazy, not cron. We call this at the top of read paths that care (today
//    list, week view, coaching context). Cheap: one indexed query + small
//    batch update.
//  - "Missed" is distinct from "skipped". Skipped is a conscious user action;
//    missed is the system's acknowledgement that the day passed untouched.
//    For adherence math they both count against completion. For coaching
//    voice the distinction lets the model hedge ("noted" for skipped,
//    deload-aware framing for missed).
//  - Never surface "missed" in UI tags or warnings. Silent — the coach reads
//    it as a signal and reshapes the plan; the user just sees a smart plan.

import { and, eq, lt } from 'drizzle-orm'
import { sessions } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

/**
 * Flip any `planned` sessions with scheduledDate < todayEpochDay to 'missed'.
 * Idempotent. Returns the number of rows updated.
 *
 * Callers must pass todayEpochDay in the user's local timezone (derived from
 * the request's date query param or via isoToEpochDay(getTodayISO()) on the
 * client-facing route). Epoch-day is UTC-anchored, but we always compare to
 * a locally-derived today, so late-evening sessions still get a full day to
 * be completed.
 */
export async function rolloverStaleSessions(
  db: DB,
  todayEpochDay: number,
): Promise<number> {
  const result = await db
    .update(sessions)
    .set({ status: 'missed' })
    .where(
      and(
        eq(sessions.status, 'planned'),
        lt(sessions.scheduledDate, todayEpochDay),
      ),
    )
  // Drizzle's D1 result shape varies; we don't rely on rowcount for logic,
  // just surface it for logs when available.
  const changes = (result as unknown as { meta?: { changes?: number } })?.meta?.changes
  return typeof changes === 'number' ? changes : 0
}

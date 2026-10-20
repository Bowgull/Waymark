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
//  - No "missed" tags or warnings in the UI. A missed key session becomes one
//    pending question with safe options (server/coachData createMissedAsks;
//    plan: "ask me each time"), never a scolding and never a reschedule.

import { and, eq, inArray, lt } from 'drizzle-orm'
import { sessions, strengthSessionExercises, strengthSets } from '../db/schema'
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
  await closeStaleInProgress(db, todayEpochDay)
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

/**
 * Same rollover, returning the ids that flipped so the coach can ask about
 * each missed session. Same local-day rule: only days before todayEpochDay.
 */
export async function rolloverStaleSessionIds(
  db: DB,
  todayEpochDay: number,
): Promise<string[]> {
  await closeStaleInProgress(db, todayEpochDay)
  const stale = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.status, 'planned'), lt(sessions.scheduledDate, todayEpochDay)))
  const ids = stale.map(s => s.id)
  for (let i = 0; i < ids.length; i += 50) {
    await db.update(sessions).set({ status: 'missed' })
      .where(and(eq(sessions.status, 'planned'), inArray(sessions.id, ids.slice(i, i + 50))))
  }
  return ids
}

/** A session started (or with a set logged) this recently is still being trained, whatever its day. */
export const LIVE_GRACE_SEC = 6 * 3600

/** context_json stamp on a session closed by the rollover with what was logged. */
export const PARTIAL_CONTEXT_KEY = 'partial'

/**
 * Josh, 2026-10-19: a session left in progress whose day has passed is done
 * (partial) with what was logged. Not missed: no Algiz, no missed fix, and
 * its logged sets count as real work. The finish time is the last logged set,
 * else the start. Returns the ids closed.
 */
export async function closeStaleInProgress(db: DB, todayEpochDay: number, nowSec = Math.floor(Date.now() / 1000)): Promise<string[]> {
  const stale = await db.select().from(sessions)
    .where(and(eq(sessions.status, 'in_progress'), lt(sessions.scheduledDate, todayEpochDay)))
  const closed: string[] = []
  for (const s of stale) {
    const sets = s.type === 'strength'
      ? await db.select({ at: strengthSets.completedAt }).from(strengthSets)
        .innerJoin(strengthSessionExercises, eq(strengthSets.sessionExerciseId, strengthSessionExercises.id))
        .where(eq(strengthSessionExercises.sessionId, s.id))
      : []
    const lastSet = sets.reduce<number | null>((m, r) => (r.at != null && (m == null || r.at > m) ? r.at : m), null)
    // M7 (page 61): a session still going past midnight stays open. Only one quiet for
    // LIVE_GRACE_SEC (its last set, else its start) is closed.
    const lastActive = Math.max(lastSet ?? 0, s.startedAt ?? 0)
    if (lastActive > 0 && lastActive <= nowSec && nowSec - lastActive < LIVE_GRACE_SEC) continue
    closed.push(s.id)
    const completedAt = lastSet ?? s.startedAt ?? ((s.scheduledDate as number) + 1) * 86400 - 1
    let ctx: Record<string, unknown> = {}
    try { ctx = s.contextJson ? JSON.parse(s.contextJson) as Record<string, unknown> : {} } catch { ctx = {} }
    ctx[PARTIAL_CONTEXT_KEY] = { closedBy: 'rollover', loggedSets: sets.filter(r => r.at != null).length }
    await db.update(sessions).set({
      status: 'completed',
      completedAt,
      durationSec: s.startedAt != null && completedAt >= s.startedAt ? completedAt - s.startedAt : s.durationSec,
      contextJson: JSON.stringify(ctx),
    }).where(and(eq(sessions.id, s.id), eq(sessions.status, 'in_progress')))
  }
  return closed
}

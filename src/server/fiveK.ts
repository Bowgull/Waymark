// The 5K tests and the line after a run (page 76, approved 2026-10-23).
//
// The 5K test contract (Ledger reads it):
//   A finished test is its run_sessions row: run_type '5k_test' and
//   five_k_sec, the time for the 5 km in seconds (the warm-up and cool-down
//   are not in it). Its day is its session's scheduled_date (epoch day).
//   fiveKTests(db) lists them oldest first: [{ day, sec, sessionId }].
//   GET /api/five-k-tests returns { goalSec: 1320, tests: [...] }.
//   GOAL_5K_SEC (lib/brain/hardRuns.ts) is the goal, 22:00.
//
// postRunFacts: what the one line after SAVE RUN (and on the done run) is
// made from: the run, and the last outside run at about the same heart rate.

import { and, eq, isNotNull, lt } from 'drizzle-orm'
import { runSessions, sessions } from '../db/schema'
import type { createDB } from '../db/client'
import { FIVE_K_RUN_TYPE, type HardPlan } from '../lib/brain/hardRuns'
import { sameHrPace, type PostRunFacts } from '../lib/postRun'
import { BASE_INCLINE } from '../lib/runSpeed'

type DB = ReturnType<typeof createDB>
type RunRow = typeof runSessions.$inferSelect

export interface FiveKTest {
  /** The test's day (epoch day, its session's scheduled date). */
  day: number
  /** The 5 km's time, seconds. */
  sec: number
  sessionId: string
}

/** Every finished 5K test, oldest first. */
export async function fiveKTests(db: DB): Promise<FiveKTest[]> {
  const rows = await db.select({ day: sessions.scheduledDate, sec: runSessions.fiveKSec, sessionId: runSessions.sessionId, status: sessions.status })
    .from(runSessions)
    .innerJoin(sessions, eq(runSessions.sessionId, sessions.id))
    .where(and(eq(runSessions.runType, FIVE_K_RUN_TYPE), isNotNull(runSessions.fiveKSec)))
  return rows
    .filter(r => r.day != null && r.sec != null && r.sec > 0 && r.status !== 'skipped')
    .map(r => ({ day: r.day as number, sec: r.sec as number, sessionId: r.sessionId }))
    .sort((a, b) => a.day - b.day)
}

/** The speed a treadmill run was planned at, from its session's dose (the main piece of a hard run, else the easy speed). */
function plannedKmh(doseJson: string | null | undefined): number | null {
  if (!doseJson) return null
  try {
    const run = (JSON.parse(doseJson) as { run?: { hard?: HardPlan; easyKmh?: number } }).run
    if (run?.hard) return run.hard.pieces.find(p => p.kind === 'hard' || p.kind === 'steady' || p.kind === 'test')?.kmh ?? null
    return typeof run?.easyKmh === 'number' ? run.easyKmh : null
  } catch {
    return null
  }
}

/** The line's facts for a saved run (null when the run has no time yet). */
export async function postRunFacts(db: DB, run: RunRow | undefined | null): Promise<PostRunFacts | null> {
  if (!run || !run.durationSec) return null
  const [s] = await db.select({ day: sessions.scheduledDate, doseJson: sessions.doseJson }).from(sessions).where(eq(sessions.id, run.sessionId))
  const day = s?.day ?? Math.floor(Date.now() / 86400000)
  const outdoor = run.isIndoor !== 1
  if (!outdoor) {
    const typed = run.distanceKm && run.distanceKm > 0 ? (run.distanceKm / run.durationSec) * 3600 : null
    return { outdoor, distanceKm: run.distanceKm, durationSec: run.durationSec, avgHr: run.avgHr, kmh: typed != null ? Math.round(typed * 10) / 10 : plannedKmh(s?.doseJson), incline: BASE_INCLINE, sameHrPaceSecKm: null, first: false }
  }
  const earlier = (await db.select({ id: runSessions.id, avgHr: runSessions.avgHr, distanceKm: runSessions.distanceKm, durationSec: runSessions.durationSec, isIndoor: runSessions.isIndoor, day: sessions.scheduledDate })
    .from(runSessions)
    .innerJoin(sessions, eq(runSessions.sessionId, sessions.id))
    .where(and(isNotNull(runSessions.durationSec), lt(sessions.scheduledDate, day + 1))))
    .filter(r => r.id !== run.id && r.day != null)
    .map(r => ({ ...r, day: r.day as number }))
  const cmp = sameHrPace({ avgHr: run.avgHr }, earlier)
  return { outdoor, distanceKm: run.distanceKm, durationSec: run.durationSec, avgHr: run.avgHr, kmh: null, incline: null, sameHrPaceSecKm: cmp.pace, first: cmp.first }
}

// DISCARD (page 74, approved 2026-10-22): the × held 3 s, then the small ember
// DISCARD. The session goes back to planned and nothing of it is kept for the
// coach: the rows its start created (the sets, the rounds, the run, the holds)
// and anything logged into them are removed, so the next ENTER starts it fresh,
// exactly as an unstarted session. A finished session is never discarded here.

import { and, eq, gte, inArray } from 'drizzle-orm'

import type { createDB } from '../db/client'
import {
  activeRecoverySessions, bagWorkRoundCombos, bagWorkRounds, blockTests, comboPerformance, mtClassLogs,
  postureSessionExercises, runSessions, runSplits, sessions, skipRopeSessions, strengthSessionExercises, strengthSets,
} from '../db/schema'
import { e1rmTestKey } from '../lib/blockZero'

type DB = ReturnType<typeof createDB>

export type DiscardResult =
  | { ok: true; status: 'discarded' | 'noop' }
  | { ok: false; status: 'not_found' | 'completed' }

export async function discardSession(db: DB, sessionId: string): Promise<DiscardResult> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return { ok: false, status: 'not_found' }
  if (session.status === 'completed') return { ok: false, status: 'completed' }
  if (session.status !== 'in_progress') return { ok: true, status: 'noop' }

  // Strength: the sets (and a Block Zero check set's e1RM, written when it was logged).
  const sse = await db.select({ id: strengthSessionExercises.id, exerciseId: strengthSessionExercises.exerciseId }).from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, sessionId))
  if (sse.length > 0) {
    if (session.blockType === 'block_zero' && session.startedAt != null) {
      await db.delete(blockTests).where(and(
        eq(blockTests.source, 'auto'),
        eq(blockTests.week, session.blockWeek ?? 1),
        inArray(blockTests.testKey, sse.map(e => e1rmTestKey(e.exerciseId))),
        gte(blockTests.recordedAt, session.startedAt),
      ))
    }
    await db.delete(strengthSets).where(inArray(strengthSets.sessionExerciseId, sse.map(e => e.id)))
    await db.delete(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, sessionId))
  }

  // Bag work: ratings, the rounds' combos, the rounds.
  const rounds = await db.select({ id: bagWorkRounds.id }).from(bagWorkRounds).where(eq(bagWorkRounds.sessionId, sessionId))
  await db.delete(comboPerformance).where(eq(comboPerformance.sessionId, sessionId))
  if (rounds.length > 0) {
    await db.delete(bagWorkRoundCombos).where(inArray(bagWorkRoundCombos.roundId, rounds.map(r => r.id)))
    await db.delete(bagWorkRounds).where(eq(bagWorkRounds.sessionId, sessionId))
  }

  // Runs: the splits and the run.
  const runs = await db.select({ id: runSessions.id }).from(runSessions).where(eq(runSessions.sessionId, sessionId))
  if (runs.length > 0) {
    await db.delete(runSplits).where(inArray(runSplits.runSessionId, runs.map(r => r.id)))
    await db.delete(runSessions).where(eq(runSessions.sessionId, sessionId))
  }

  // Holds, rope, Reset, class.
  await db.delete(postureSessionExercises).where(eq(postureSessionExercises.sessionId, sessionId))
  await db.delete(skipRopeSessions).where(eq(skipRopeSessions.sessionId, sessionId))
  await db.delete(activeRecoverySessions).where(eq(activeRecoverySessions.sessionId, sessionId))
  await db.delete(mtClassLogs).where(eq(mtClassLogs.sessionId, sessionId))

  await db.update(sessions).set({ status: 'planned', startedAt: null, completedAt: null, durationSec: null, rpe: null, difficulty: null }).where(eq(sessions.id, sessionId))
  return { ok: true, status: 'discarded' }
}

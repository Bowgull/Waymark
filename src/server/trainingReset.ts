// Fresh-start wipe of all collected training data. Exercises, combos, settings,
// profile and training maxes survive; combo stats are reset to zero.
// Runs as one D1 batch so a failure can't leave the history half-cleared.
// Order follows the foreign keys: children before parents, and sessions
// (sessions.adjustment_id -> week_adjustments) before week_adjustments, so a
// fresh start works after any replace. Stored idempotency replies go too:
// they describe rows that no longer exist. Strava dismissals stay.

import { activeRecoverySessions, idempotencyKeys, bagWorkRoundCombos, bagWorkRounds, blockTests, bodyAlerts, bodyMetrics, coachingOutputs, comboPerformance, combos, dailyLogs, journalEntries, mtClassLogs, postureSessionExercises, runningPlanWeeks, runSessions, runSplits, sessions, skipRopeSessions, strengthSessionExercises, strengthSets, trainingBlocks, weekAdjustments, weekPlans, weeklyJournals } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

export async function clearCollectedTrainingData(db: DB) {
  await db.batch([
    db.delete(strengthSets),
    db.delete(comboPerformance),
    db.delete(bagWorkRoundCombos),
    db.delete(bagWorkRounds),
    db.delete(strengthSessionExercises),
    db.delete(runSplits),
    db.delete(runSessions),
    db.delete(postureSessionExercises),
    db.delete(skipRopeSessions),
    db.delete(activeRecoverySessions),
    db.delete(mtClassLogs),
    db.delete(coachingOutputs),
    db.delete(sessions),
    db.delete(weekAdjustments),
    db.delete(weekPlans),
    db.delete(runningPlanWeeks),
    db.delete(blockTests),
    db.delete(trainingBlocks),
    db.delete(dailyLogs),
    db.delete(weeklyJournals),
    db.delete(journalEntries),
    db.delete(bodyMetrics),
    db.delete(bodyAlerts),
    db.delete(idempotencyKeys),
    db.update(combos).set({ isFavourite: 0, masteryScore: 0, timesSharp: 0 }),
  ])
}

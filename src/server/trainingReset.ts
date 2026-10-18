// Fresh-start wipe of all collected training data. Exercises, combos, settings,
// profile and training maxes survive; combo stats are reset to zero.
// Runs as one D1 batch so a failure can't leave the history half-cleared.

import { activeRecoverySessions, bagWorkRoundCombos, bagWorkRounds, blockTests, bodyMetrics, coachingOutputs, comboPerformance, combos, dailyLogs, journalEntries, mtClassLogs, postureSessionExercises, runningPlanWeeks, runSessions, runSplits, sessions, skipRopeSessions, strengthSessionExercises, strengthSets, trainingBlocks, weekAdjustments, weekPlans, weeklyJournals } from '../db/schema'
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
    db.delete(weekAdjustments),
    db.delete(sessions),
    db.delete(weekPlans),
    db.delete(runningPlanWeeks),
    db.delete(blockTests),
    db.delete(trainingBlocks),
    db.delete(dailyLogs),
    db.delete(weeklyJournals),
    db.delete(journalEntries),
    db.delete(bodyMetrics),
    db.update(combos).set({ isFavourite: 0, masteryScore: 0, timesSharp: 0 }),
  ])
}

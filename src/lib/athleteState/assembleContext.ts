// Phase 1 of the Athlete-State pass (docs/ATHLETE_STATE_SPEC.md §2).
// One builder that merges the previously-siloed slices into a single recent-window
// snapshot. This is the input the Phase 2 reasoning pass consumes; assembling it
// here is what lets the signals finally compound.

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import {
  comboPerformance, dailyLogs, exercises, runSessions,
  sessions, trainingMaxes, weekPlans,
} from '../../db/schema'
import type { createDB } from '../../db/client'
import { computeLiftVerdict, loadLiftTrendData, TREND_WINDOW_DAYS } from './liftTrends'
import { loadLatestAthleteState } from './store'
import type { AthleteContext } from './types'
import { computeBlockAdherence, deriveGuidance, serializeAdherenceForPrompt } from '../adherence'
import { computeHrSnapshot, loadProfileMaxHrForHr, loadRecentRunsForHr, serializeHrForPrompt } from '../hrAnalysis'
import { getLatestBodyweightKg } from '../bodyMetrics'

type DB = ReturnType<typeof createDB>

function epochDayOfSession(s: { scheduledDate: number | null; completedAt: number | null; createdAt: number }): number {
  if (s.scheduledDate != null) return s.scheduledDate
  return Math.floor((s.completedAt ?? s.createdAt) / 86400)
}

async function currentWeekPlanId(db: DB, weekStart: number, weekEnd: number): Promise<string | null> {
  const rows = await db
    .select({ weekPlanId: sessions.weekPlanId })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, weekStart), lte(sessions.scheduledDate, weekEnd)))
  const found = rows.find(s => s.weekPlanId)
  if (found?.weekPlanId) return found.weekPlanId
  const [wp] = await db.select({ id: weekPlans.id }).from(weekPlans).orderBy(desc(weekPlans.createdAt)).limit(1)
  return wp?.id ?? null
}

async function buildAdherenceBlock(db: DB, weekStart: number, weekEnd: number, todayEpochDay: number): Promise<string | null> {
  const weekPlanId = await currentWeekPlanId(db, weekStart, weekEnd)
  if (!weekPlanId) return null
  const [wp] = await db.select({ blockId: weekPlans.blockId }).from(weekPlans).where(eq(weekPlans.id, weekPlanId))
  if (!wp) return null
  const adherence = await computeBlockAdherence(db, wp.blockId, todayEpochDay)
  return serializeAdherenceForPrompt(adherence, deriveGuidance(adherence)) || null
}

export async function assembleAthleteContext(db: DB, todayEpochDay: number): Promise<AthleteContext> {
  const todayDow = new Date(todayEpochDay * 86400000).getUTCDay()
  const weekStart = todayEpochDay - todayDow
  const weekEnd = weekStart + 6
  const windowStart = todayEpochDay - TREND_WINDOW_DAYS

  // Strength trends (rich) → LiftContext
  const liftDetails = await loadLiftTrendData(db, todayEpochDay)
  const lifts = liftDetails.map(d => {
    const v = computeLiftVerdict(d.points)
    return {
      exerciseId: d.exerciseId,
      exerciseName: d.exerciseName,
      direction: v.direction,
      verdict: v.verdict,
      loadFactor: v.loadFactor,
      sessions: d.points.map(p => ({ epochDay: p.epochDay, signal: p.signal })),
    }
  })

  // Completed sessions in window → effort, notes (session-sourced), run dates
  const recentSessions = await db
    .select()
    .from(sessions)
    .where(and(
      eq(sessions.status, 'completed'),
      gte(sessions.scheduledDate, windowStart),
      lte(sessions.scheduledDate, todayEpochDay),
    ))
  const sessionDayById = new Map(recentSessions.map(s => [s.id, epochDayOfSession(s)]))

  const effort = recentSessions
    .filter(s => s.rpe != null || s.difficulty != null)
    .map(s => ({ epochDay: epochDayOfSession(s), type: s.type, rpe: s.rpe ?? null, difficulty: s.difficulty ?? null }))
    .sort((a, b) => b.epochDay - a.epochDay)

  // Wellness in window
  const logs = await db
    .select()
    .from(dailyLogs)
    .where(and(gte(dailyLogs.logDate, windowStart), lte(dailyLogs.logDate, todayEpochDay)))
  const wellness = logs
    .map(l => ({ epochDay: l.logDate, sleepHours: l.sleepHours, soreness: l.soreness, alcoholScale: l.alcoholScale }))
    .sort((a, b) => b.epochDay - a.epochDay)

  // Notes corpus: session notes + daily-log notes
  const notes = [
    ...recentSessions
      .filter(s => s.notes && s.notes.trim().length > 0)
      .map(s => ({ epochDay: epochDayOfSession(s), source: 'session' as const, text: s.notes!.trim() })),
    ...logs
      .filter(l => l.notes && l.notes.trim().length > 0)
      .map(l => ({ epochDay: l.logDate, source: 'daily_log' as const, text: l.notes!.trim() })),
  ].sort((a, b) => b.epochDay - a.epochDay)

  // Run quality
  const runRows = await db.select().from(runSessions)
  const runs = runRows
    .map(r => ({ row: r, epochDay: sessionDayById.get(r.sessionId) }))
    .filter((x): x is { row: typeof x.row; epochDay: number } => x.epochDay != null)
    .map(({ row, epochDay }) => ({
      epochDay,
      completionStatus: row.completionStatus,
      paceSecKm: row.paceSecKm,
      avgHr: row.avgHr,
      maxHr: row.maxHr,
      shortReason: row.shortReason,
    }))
    .sort((a, b) => b.epochDay - a.epochDay)

  // Combo ratings (bag), by their own createdAt
  const comboRows = await db
    .select({ rating: comboPerformance.rating, createdAt: comboPerformance.createdAt })
    .from(comboPerformance)
    .where(gte(comboPerformance.createdAt, windowStart * 86400))
  const comboRatings = comboRows
    .map(c => ({ epochDay: Math.floor(c.createdAt / 86400), rating: c.rating }))
    .sort((a, b) => b.epochDay - a.epochDay)

  // Adherence + HR blocks (reuse existing serializers)
  const adherenceBlock = await buildAdherenceBlock(db, weekStart, weekEnd, todayEpochDay)
  const recentRuns = await loadRecentRunsForHr(db, todayEpochDay)
  const maxHr = await loadProfileMaxHrForHr(db)
  const hrBlock = serializeHrForPrompt(computeHrSnapshot(recentRuns, todayEpochDay, { maxHr }))

  // Bodyweight + training maxes
  const bodyweightKg = await getLatestBodyweightKg(db)
  const tmRows = await db
    .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
    .from(trainingMaxes)
    .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id))
  const trainingMaxesOut = tmRows.map(t => ({ exerciseName: t.name, weightKg: t.weightKg }))

  const priorState = await loadLatestAthleteState(db)

  return {
    todayEpochDay,
    todayDow,
    weekStart,
    weekEnd,
    lifts,
    effort,
    wellness,
    notes,
    runs,
    adherenceBlock,
    hrBlock,
    comboRatings,
    bodyweightKg,
    trainingMaxes: trainingMaxesOut,
    priorState,
  }
}

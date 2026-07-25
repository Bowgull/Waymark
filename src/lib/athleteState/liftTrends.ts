// Phase 0 of the Athlete-State pass (see docs/ATHLETE_STATE_SPEC.md).
//
// Replaces the amnesiac `loadRecentStrengthReality`, which adjusted the next
// prescription off a single most-recent set reading per exercise. That produced
// the "some sets adjust, others don't" behaviour: a one-off short session would
// yank the weight, while a real downward trend could be masked by one good set.
//
// Here we look at the TREND across the recent window and only move load when the
// signal is consistent. The verdict + clamped loadFactor are deterministic; the
// later Opus pass (Phase 2) replaces this with reasoning, but keeps this as the
// guardrail floor.

import { and, eq } from 'drizzle-orm'
import { exercises, sessions, strengthSessionExercises, strengthSets } from '../../db/schema'
import type { createDB } from '../../db/client'

type DB = ReturnType<typeof createDB>

export const TREND_WINDOW_DAYS = 21
export const TREND_MAX_SESSIONS = 6
// Need at least this many sessions of an exercise before we move load at all.
// One session is a data point, not a trend.
export const MIN_SESSIONS_TO_ADJUST = 2
export const LOAD_FACTOR_MIN = 0.85
export const LOAD_FACTOR_MAX = 1.05
const DELOAD_FACTOR = 0.9
const PUSH_FACTOR = 1.05

export type LiftDirection = 'progressing' | 'stalling' | 'regressing' | 'insufficient_data'
export type LiftVerdict = 'push' | 'hold' | 'deload'
export type SessionSignal = 'short' | 'normal' | 'over'

export interface LiftVerdictResult {
  direction: LiftDirection
  verdict: LiftVerdict
  loadFactor: number
}

// Per-completed-session reduction of an exercise: how the working sets landed
// relative to what was prescribed. Newest first when passed to computeLiftVerdict.
export interface ExerciseSessionPoint {
  epochDay: number
  signal: SessionSignal
  bandColor: string | null
}

const STATUS_SCORE: Record<string, number> = {
  rep_shortfall: -2,
  lighter: -1,
  normal: 0,
  heavier: 1,
  rep_surplus: 2,
}

export function clampLoadFactor(factor: number): number {
  return Math.min(LOAD_FACTOR_MAX, Math.max(LOAD_FACTOR_MIN, factor))
}

// Collapse a session's working-set statuses into one signal.
export function sessionSignalFromStatuses(statuses: Array<string | null>): SessionSignal {
  if (statuses.length === 0) return 'normal'
  const sum = statuses.reduce((acc, s) => acc + (s ? STATUS_SCORE[s] ?? 0 : 0), 0)
  const avg = sum / statuses.length
  if (avg <= -1) return 'short'
  if (avg >= 1) return 'over'
  return 'normal'
}

// Pure trend rule. `points` newest-first. Only moves load on a consistent signal
// across 2+ sessions, so a single off day holds instead of yanking the weight.
export function computeLiftVerdict(points: ExerciseSessionPoint[]): LiftVerdictResult {
  const recent = points.slice(0, TREND_MAX_SESSIONS)
  if (recent.length < MIN_SESSIONS_TO_ADJUST) {
    return { direction: 'insufficient_data', verdict: 'hold', loadFactor: 1.0 }
  }
  const window = recent.slice(0, 3)
  const shorts = window.filter(p => p.signal === 'short').length
  const overs = window.filter(p => p.signal === 'over').length

  if (shorts >= 2 && overs === 0) {
    return { direction: 'regressing', verdict: 'deload', loadFactor: clampLoadFactor(DELOAD_FACTOR) }
  }
  if (overs >= 2 && shorts === 0) {
    return { direction: 'progressing', verdict: 'push', loadFactor: clampLoadFactor(PUSH_FACTOR) }
  }
  return { direction: 'stalling', verdict: 'hold', loadFactor: 1.0 }
}

// Rich per-lift detail over the recent window: exercise name + per-session points
// (newest first). Shared by the prescription nudge and the athlete-state assembler.
export interface LiftTrendDetail {
  exerciseId: string
  exerciseName: string
  points: ExerciseSessionPoint[]
}

export async function loadLiftTrendData(
  db: DB,
  todayEpochDay: number,
): Promise<LiftTrendDetail[]> {
  const windowStart = todayEpochDay - TREND_WINDOW_DAYS

  const [completedSessions, allExercises, allSets, exerciseRows] = await Promise.all([
    db
      .select()
      .from(sessions)
      .where(and(eq(sessions.status, 'completed'), eq(sessions.type, 'strength'))),
    db.select().from(strengthSessionExercises),
    db.select().from(strengthSets),
    db.select({ id: exercises.id, name: exercises.name }).from(exercises),
  ])

  const sessionById = new Map(completedSessions.map(s => [s.id, s]))
  const exerciseBySseId = new Map(allExercises.map(e => [e.id, e]))
  const nameById = new Map(exerciseRows.map(e => [e.id, e.name]))

  // exerciseId -> sessionId -> { epochDay, statuses[], lastBand }
  const byExercise = new Map<string, Map<string, { epochDay: number; statuses: Array<string | null>; bandColor: string | null }>>()

  for (const set of allSets) {
    if (set.isWarmup === 1) continue
    const sse = exerciseBySseId.get(set.sessionExerciseId)
    if (!sse) continue
    const session = sessionById.get(sse.sessionId)
    if (!session) continue
    const epochDay = Math.floor((session.completedAt ?? session.createdAt) / 86400)
    if (epochDay < windowStart) continue

    let perSession = byExercise.get(sse.exerciseId)
    if (!perSession) {
      perSession = new Map()
      byExercise.set(sse.exerciseId, perSession)
    }
    const entry = perSession.get(sse.sessionId) ?? { epochDay, statuses: [], bandColor: null }
    entry.statuses.push(set.inferredStatus)
    if (set.bandColor) entry.bandColor = set.bandColor
    perSession.set(sse.sessionId, entry)
  }

  const details: LiftTrendDetail[] = []
  for (const [exerciseId, perSession] of byExercise) {
    const points: ExerciseSessionPoint[] = Array.from(perSession.values())
      .sort((a, b) => b.epochDay - a.epochDay)
      .map(e => ({ epochDay: e.epochDay, signal: sessionSignalFromStatuses(e.statuses), bandColor: e.bandColor }))
    details.push({ exerciseId, exerciseName: nameById.get(exerciseId) ?? exerciseId, points })
  }
  return details
}

// Thin verdict map used by the prescription nudge: per exerciseId, the trend
// verdict + the most recent actual band color (anchors band adjustments).
export async function loadLiftTrends(
  db: DB,
  todayEpochDay: number,
): Promise<Map<string, LiftVerdictResult & { bandColor: string | null }>> {
  const details = await loadLiftTrendData(db, todayEpochDay)
  const result = new Map<string, LiftVerdictResult & { bandColor: string | null }>()
  for (const d of details) {
    const verdict = computeLiftVerdict(d.points)
    result.set(d.exerciseId, { ...verdict, bandColor: d.points[0]?.bandColor ?? null })
  }
  return result
}

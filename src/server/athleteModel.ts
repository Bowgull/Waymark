// Coach brain P1: the athlete model's server side (coach-brain.md §4, §13.5).
// Loads the logged events from D1, scoped to the active block (the live model
// starts from scratch at the block start; Josh, 2026-10-20), builds the model
// with the pure lib/brain/athleteModel.ts and writes athlete_estimates. The
// nightly job calls refreshAthleteModel. Shadow only in P1: nothing reads the
// rows to decide a session or a dose.

import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import {
  athleteEstimates, bagWorkRounds, blockTests, bodyAlerts, comboPerformance, dailyLogs, exercises, journalEntries, mtClassLogs,
  runSessions, runSplits, sessions, strengthSessionExercises, strengthSets, trainingMaxes, userProfile, weekAdjustments, weekPlans,
} from '../db/schema'
import type { createDB } from '../db/client'
import { buildAthleteModel, modelRows, modelSummary } from '../lib/brain/athleteModel'
import type { AthleteModel, ModelEvents, ModelMove } from '../lib/brain/types'
import { loadEquipment } from '../lib/strengthLoads'
import { getRunWalkWeek } from '../lib/blockZero/running'
import { TALK_TEST_KEY } from '../lib/blockZero/talkTest'
import { getActiveBlock } from './blockZeroData'
import { blockStartDay } from './coachData'
import { FALLBACK_TIME_ZONE, athleteTimeZone, localDayIn, localMinuteIn } from './timeZone'

type DB = ReturnType<typeof createDB>

/** Local minute of day (0-1439) of a unix-seconds time, in the athlete's zone (default: the fallback). */
export function localMinuteOf(unixSec: number, tz: string = FALLBACK_TIME_ZONE): number {
  return localMinuteIn(unixSec, tz)
}

/** Local epoch day of a unix-seconds time, in the athlete's zone. */
export function localDayOf(unixSec: number, tz: string = FALLBACK_TIME_ZONE): number {
  return localDayIn(unixSec, tz)
}

/** Rounds worked from context_json.roundSecs (seconds per round; a round under 20 s was not worked). */
function roundsDoneOf(contextJson: string | null): number | null {
  const secs = parse<{ roundSecs?: unknown }>(contextJson, {}).roundSecs
  if (!Array.isArray(secs) || secs.length === 0) return null
  return secs.filter(x => typeof x === 'number' && x >= 20).length
}

function parse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

/** Where the live model starts: the active block's start day. No active block: nothing is learned yet. */
export async function modelFromDay(db: DB, today: number): Promise<number> {
  const block = await getActiveBlock(db)
  return block ? blockStartDay(block) : today + 1
}

/** Everything the model reads, logged on or after `fromDay` and up to `today`. */
export async function loadModelEvents(db: DB, fromDay: number, today: number): Promise<ModelEvents> {
  const [profile] = await db.select().from(userProfile).limit(1)
  const tz = await athleteTimeZone(db)
  const inRange = and(gte(sessions.scheduledDate, fromDay), lte(sessions.scheduledDate, today))
  const sess = await db.select().from(sessions).where(inRange)
  const sessionIds = new Set(sess.map(s => s.id))
  const dayOf = new Map(sess.map(s => [s.id, s.scheduledDate as number]))

  const exRows = await db.select({ id: exercises.id, equipment: exercises.equipment }).from(exercises)
  const equipment = new Map(exRows.map(e => [e.id, loadEquipment(e.equipment)]))
  const setRows = await db.select({
    sessionId: strengthSessionExercises.sessionId, exerciseId: strengthSessionExercises.exerciseId, section: strengthSessionExercises.section,
    setNumber: strengthSets.setNumber, weightKg: strengthSets.weightKg, reps: strengthSets.reps, plannedWeightKg: strengthSets.plannedWeightKg,
    plannedReps: strengthSets.plannedReps, rir: strengthSets.rir, isWarmup: strengthSets.isWarmup, completedAt: strengthSets.completedAt,
  }).from(strengthSets)
    .innerJoin(strengthSessionExercises, eq(strengthSessionExercises.id, strengthSets.sessionExerciseId))
    .innerJoin(sessions, eq(sessions.id, strengthSessionExercises.sessionId))
    .where(inRange)

  const runRows = await db.select({ run: runSessions, weekNumber: weekPlans.weekNumber }).from(runSessions)
    .innerJoin(sessions, eq(sessions.id, runSessions.sessionId))
    .leftJoin(weekPlans, eq(weekPlans.id, sessions.weekPlanId))
    .where(inRange)
  const runIds = runRows.map(r => r.run.id)
  const splits = runIds.length ? await db.select().from(runSplits).where(inArray(runSplits.runSessionId, runIds)) : []

  const bagIds = sess.filter(s => s.type === 'bag_work').map(s => s.id)
  const rounds = bagIds.length ? await db.select({ sessionId: bagWorkRounds.sessionId, id: bagWorkRounds.id }).from(bagWorkRounds).where(inArray(bagWorkRounds.sessionId, bagIds)) : []
  const ratings = bagIds.length ? await db.select().from(comboPerformance).where(inArray(comboPerformance.sessionId, bagIds)) : []
  const classIds = sess.filter(s => s.type === 'mt_class').map(s => s.id)
  const classLogs = classIds.length ? await db.select().from(mtClassLogs).where(inArray(mtClassLogs.sessionId, classIds)) : []

  const logs = await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, fromDay), lte(dailyLogs.logDate, today)))
  const journal = await db.select().from(journalEntries).where(and(gte(journalEntries.date, fromDay), lte(journalEntries.date, today)))
  const tests = await db.select().from(blockTests).where(eq(blockTests.testKey, TALK_TEST_KEY))
  const tms = await db.select().from(trainingMaxes)
  const alerts = await db.select({ region: bodyAlerts.region, stage: bodyAlerts.stage }).from(bodyAlerts).where(isNull(bodyAlerts.clearedAt))
  const mine = await db.select().from(weekAdjustments).where(and(eq(weekAdjustments.actor, 'you'), inArray(weekAdjustments.kind, ['move', 'pull_forward']), isNull(weekAdjustments.undoneAt)))

  const moves: ModelMove[] = []
  for (const w of mine) {
    const from = parse<{ sessions?: Array<{ f?: { scheduledDate?: number } }> }>(w.beforeJson, {}).sessions?.[0]?.f?.scheduledDate
    const to = parse<{ sessions?: Array<{ f?: { scheduledDate?: number } }> }>(w.afterJson, {}).sessions?.[0]?.f?.scheduledDate
    if (from != null && to != null && from !== to) moves.push({ fromDay: from, toDay: to, type: w.sessionType })
  }

  return {
    profile: {
      dob: profile?.dob ?? null,
      maxHr: profile?.maxHr ?? null,
      backSensitive: /back/i.test(profile?.injuries ?? '') || /back/i.test(profile?.postureIssues ?? ''),
    },
    sessions: sess.map(s => ({
      id: s.id, type: s.type, status: s.status, day: s.scheduledDate as number,
      slot: s.timeSlot === 'pm' ? 'pm' : s.timeSlot === 'am' ? 'am' : null,
      startMin: s.startedAt != null ? localMinuteOf(s.startedAt, tz) : null,
      durationSec: s.durationSec, rpe: s.rpe, skipReason: s.skipReason, source: s.source, blockType: s.blockType, notes: s.notes,
    })),
    sets: setRows.map(r => ({
      sessionId: r.sessionId, day: dayOf.get(r.sessionId) as number, exerciseId: r.exerciseId, section: r.section, setNumber: r.setNumber,
      weightKg: r.weightKg, reps: r.reps, plannedWeightKg: r.plannedWeightKg, plannedReps: r.plannedReps, rir: r.rir,
      isWarmup: r.isWarmup === 1, logged: r.completedAt != null, equipment: equipment.get(r.exerciseId) ?? 'none',
    })),
    runs: runRows.map(({ run: r, weekNumber }) => {
      const s = sess.find(x => x.id === r.sessionId)
      const runWalk = s?.type === 'foundation_run' && s.blockType === 'block_zero'
      // The coach brain's dose (P2): the piece it prescribed and the rung it aimed at.
      const dosed = (() => { try { const d = JSON.parse(s?.doseJson ?? 'null') as { run?: { runSec?: number; rungSec?: number; walkOnly?: boolean } } | null; return d?.run && !d.run.walkOnly ? { runSec: d.run.runSec ?? null, rungSec: d.run.rungSec ?? null } : null } catch { return null } })()
      return {
        sessionId: r.sessionId, day: dayOf.get(r.sessionId) as number, type: s?.type ?? 'running',
        durationSec: r.durationSec, plannedDurationSec: r.plannedDurationSec, distanceKm: r.distanceKm, avgHr: r.avgHr, maxHr: r.maxHr,
        splits: splits.filter(sp => sp.runSessionId === r.id).sort((a, b) => a.kmIndex - b.kmIndex).map(sp => ({ durationSec: sp.durationSec, avgHr: sp.avgHr })),
        isIndoor: r.isIndoor === 1, completionStatus: r.completionStatus, shortReason: r.shortReason, rpe: s?.rpe ?? null,
        // A Block Zero run-walk's piece is its week's run interval; any other run is one piece.
        pieceSec: runWalk ? dosed?.runSec ?? getRunWalkWeek(Math.max(1, weekNumber ?? 1)).runSec : null,
        rungSec: runWalk ? dosed?.rungSec ?? null : null,
      }
    }),
    talkTests: tests.map(t => ({ day: localDayOf(t.recordedAt, tz), bpm: t.value })).filter(t => t.day >= fromDay && t.day <= today),
    bag: sess.filter(s => s.type === 'bag_work').map(s => {
      const mineRatings = ratings.filter(r => r.sessionId === s.id)
      return {
        sessionId: s.id, day: s.scheduledDate as number, status: s.status,
        roundsPlanned: rounds.filter(r => r.sessionId === s.id).length,
        roundsRated: mineRatings.length ? new Set(mineRatings.map(r => r.roundId)).size : null,
        // Rounds he actually worked (the finish's seconds per round), rated or not, and why he ended early.
        roundsDone: roundsDoneOf(s.contextJson),
        endReason: parse<{ endReason?: string }>(s.contextJson, {}).endReason ?? null,
        ratings: mineRatings.map(r => r.rating), rpe: s.rpe, skipReason: s.skipReason,
      }
    }),
    checkIns: logs.map(l => ({ day: l.logDate, sleepHours: l.sleepHours, sleepQuality: l.sleepQuality, energy: l.energy, soreness: l.soreness, stress: l.stress, mood: l.mood, backToday: l.backToday })),
    notes: [
      ...logs.filter(l => l.notes).map(l => ({ day: l.logDate, text: l.notes as string, source: 'check_in' as const })),
      ...logs.filter(l => l.backNotes).map(l => ({ day: l.logDate, text: l.backNotes as string, source: 'back' as const })),
      ...sess.filter(s => s.notes && s.status === 'completed').map(s => ({ day: s.scheduledDate as number, text: s.notes as string, source: 'session' as const })),
      ...journal.map(j => ({ day: j.date, text: j.content, source: 'journal' as const })),
    ],
    moves: moves.filter(m => m.fromDay >= fromDay),
    classLogs: classLogs.filter(l => sessionIds.has(l.sessionId)).map(l => ({ sessionId: l.sessionId, day: dayOf.get(l.sessionId) as number, learned: !!l.learnedNote })),
    trainingMaxes: tms.map(t => ({ exerciseId: t.exerciseId, weightKg: t.weightKg, day: localDayOf(t.updatedAt, tz) })),
    openBodyAlerts: alerts,
  }
}

/**
 * The nightly step: rebuild the model from the active block's events, aged to
 * `today`, and replace the athlete_estimates rows. Returns the model.
 */
export async function refreshAthleteModel(db: DB, today: number, nowSec: number): Promise<AthleteModel> {
  const fromDay = await modelFromDay(db, today)
  const events = await loadModelEvents(db, fromDay, today)
  const model = buildAthleteModel(events, today, { fromDay })
  const rows = modelRows(model)
  const existing = await db.select({ id: athleteEstimates.id, kind: athleteEstimates.kind, key: athleteEstimates.key }).from(athleteEstimates)
  const idOf = new Map(existing.map(e => [`${e.kind}|${e.key}`, e.id]))
  const keep = new Set(rows.map(r => `${r.kind}|${r.key}`))
  // About 20 small rows a night: plain writes (no batch, so the test database runs the same code).
  for (const r of rows) {
    const values = { kind: r.kind, key: r.key, valueJson: r.valueJson, state: r.state, n: r.n, uncertainty: r.uncertainty, modelVersion: model.version, asOfDay: today, updatedAt: nowSec }
    const id = idOf.get(`${r.kind}|${r.key}`)
    if (id) await db.update(athleteEstimates).set(values).where(eq(athleteEstimates.id, id))
    else await db.insert(athleteEstimates).values({ id: crypto.randomUUID(), ...values })
  }
  const stale = existing.filter(e => !keep.has(`${e.kind}|${e.key}`)).map(e => e.id)
  if (stale.length) await db.delete(athleteEstimates).where(inArray(athleteEstimates.id, stale))
  return model
}

/** The stored estimates, read back (for the replay harness and tests). */
export async function readAthleteEstimates(db: DB) {
  return db.select().from(athleteEstimates)
}

export { modelSummary }

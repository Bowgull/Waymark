// Block Zero data access: the DB reads and writes the rules module needs.
// Rules stay pure in lib/blockZero; this file only loads rows and applies the
// results (readiness, auto-ease, RIR loads, back swaps, MT class checks, tests).

import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { blockTests, dailyLogs, mtClassLogs, sessions, strengthSessionExercises, strengthSets, trainingBlocks, userProfile, weekPlans } from '../db/schema'
import {
  backFriendlyVariation,
  blockZeroWorkingLoad,
  checkInFromDailyLog,
  checkSetE1rm,
  e1rmTestKey,
  easeSession,
  evaluateClassRequest,
  getStrengthWeekTarget,
  mainLiftHardSets,
  readinessReport,
  rollingLoadRead,
  type ClassDecision,
  type EasedSession,
  type LoadEntry,
  type LoggedWorkingSet,
  type ReadinessReport,
  type WorkingLoad,
} from '../lib/blockZero'
import type { StrengthTemplate, TemplateSet } from '../lib/strengthTemplates'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const DAY_SEC = 86400

export function todayEpochDayUtc(): number {
  return Math.floor(Date.now() / 1000 / DAY_SEC)
}

export async function getActiveBlock(db: DB) {
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
  return block ?? null
}

export async function getActiveBlockZero(db: DB) {
  const block = await getActiveBlock(db)
  return block?.blockType === 'block_zero' ? block : null
}

function blockStartDay(block: { startedAt: number | null; createdAt: number }): number {
  return Math.floor((block.startedAt ?? block.createdAt) / DAY_SEC)
}

// ─── Readiness (R10) and load (R5) ─────────────────────────────

/**
 * sRPE load entries (session RPE x minutes) for completed sessions in a day
 * range. MT classes use the logged class minutes, not the app timer.
 */
export async function loadSessionLoadEntries(db: DB, fromDay: number, toDay: number): Promise<LoadEntry[]> {
  const rows = await db
    .select({
      id: sessions.id,
      type: sessions.type,
      scheduledDate: sessions.scheduledDate,
      rpe: sessions.rpe,
      durationSec: sessions.durationSec,
      classMin: mtClassLogs.durationMin,
    })
    .from(sessions)
    .leftJoin(mtClassLogs, eq(mtClassLogs.sessionId, sessions.id))
    .where(and(eq(sessions.status, 'completed'), gte(sessions.scheduledDate, fromDay), lte(sessions.scheduledDate, toDay)))
  return rows.map(r => ({
    epochDay: r.scheduledDate as number,
    rpe: r.rpe,
    minutes: r.type === 'mt_class' && r.classMin != null
      ? r.classMin
      : r.durationSec != null ? Math.round(r.durationSec / 60) : null,
  }))
}

/** Readiness for one day: check-ins vs the 7-day mean, plus the rolling load flag inside Block Zero. */
export async function readinessFor(db: DB, epochDay: number): Promise<ReadinessReport & { blockZero: boolean }> {
  const logs = await db.select().from(dailyLogs)
    .where(and(gte(dailyLogs.logDate, epochDay - 14), lte(dailyLogs.logDate, epochDay)))
  const block = await getActiveBlockZero(db)
  const load = block
    ? rollingLoadRead(await loadSessionLoadEntries(db, epochDay - 14, epochDay - 1), epochDay, blockStartDay(block))
    : null
  return { ...readinessReport(logs.map(checkInFromDailyLog), epochDay, load), blockZero: block != null }
}

/** Auto-ease one planned session when today's read says so (Block Zero only). */
export function easeForReadiness(report: ReadinessReport, planned: Parameters<typeof easeSession>[0]): EasedSession {
  return easeSession(planned, {
    readinessEase: report.readinessEase,
    readinessReason: report.readinessEase ? report.reason : null,
    loadFlag: report.load?.flagged ?? false,
    loadReason: report.load?.reason ?? null,
  })
}

// ─── Block Zero strength plan ──────────────────────────────────

export interface BlockZeroStrengthPlan {
  template: StrengthTemplate
  /** RIR-based working load per main exercise id. Missing = TM x % fallback. */
  loads: Map<string, WorkingLoad>
  autoEase: { eased: boolean; reason: string | null }
  swaps: Array<{ from: string; to: string; reason: string }>
  backToday: number | null
}

/** Main-lift working sets per exercise this block, before a given session. */
async function loadMainSetHistory(db: DB, blockStart: number, excludeSessionId: string, exerciseIds: string[]): Promise<Map<string, LoggedWorkingSet[]>> {
  const out = new Map<string, LoggedWorkingSet[]>()
  if (exerciseIds.length === 0) return out
  const rows = await db
    .select({
      exerciseId: strengthSessionExercises.exerciseId,
      weightKg: strengthSets.weightKg,
      reps: strengthSets.reps,
      plannedReps: strengthSets.plannedReps,
      rir: strengthSets.rir,
      completedAt: strengthSets.completedAt,
      setNumber: strengthSets.setNumber,
      sessionId: sessions.id,
    })
    .from(strengthSets)
    .innerJoin(strengthSessionExercises, eq(strengthSets.sessionExerciseId, strengthSessionExercises.id))
    .innerJoin(sessions, eq(strengthSessionExercises.sessionId, sessions.id))
    .where(and(
      eq(sessions.blockType, 'block_zero'),
      gte(sessions.scheduledDate, blockStart),
      ne(sessions.id, excludeSessionId),
      eq(strengthSessionExercises.section, 'main'),
      eq(strengthSets.isWarmup, 0),
      inArray(strengthSessionExercises.exerciseId, exerciseIds),
    ))
  for (const r of rows) {
    const list = out.get(r.exerciseId) ?? []
    list.push({ weightKg: r.weightKg, reps: r.reps, plannedReps: r.plannedReps, rir: r.rir, completedAt: r.completedAt, setNumber: r.setNumber, sessionId: r.sessionId })
    out.set(r.exerciseId, list)
  }
  return out
}

/**
 * Adjust a Block Zero strength template for today: back-friendly swaps when
 * "back today" is 2 or less, auto-ease when readiness or load say so (one set
 * fewer, no check set, RPE 6 cap), and RIR-based working loads per main lift.
 * Pure on the template it is given; reads check-ins, history and readiness.
 */
export async function planBlockZeroStrength(
  db: DB,
  session: { id: string; scheduledDate: number | null; blockWeek: number | null; label: string | null; timeSlot: string | null },
  template: StrengthTemplate,
): Promise<BlockZeroStrengthPlan> {
  const epochDay = session.scheduledDate ?? todayEpochDayUtc()
  const target = getStrengthWeekTarget(session.blockWeek ?? 1)
  const report = await readinessFor(db, epochDay)
  const [log] = await db.select({ backToday: dailyLogs.backToday }).from(dailyLogs).where(eq(dailyLogs.logDate, epochDay))
  const backToday = log?.backToday ?? null

  const eased = easeForReadiness(report, {
    type: 'strength',
    label: session.label ?? template.label,
    timeSlot: session.timeSlot === 'pm' ? 'pm' : 'am',
    estimatedMin: 60,
    sets: mainLiftHardSets(target),
    rpe: target.rpe,
  })
  const easedSets = eased.eased ? eased.session.sets ?? target.mainSets : null
  const easedRpe = eased.eased ? eased.session.rpe ?? target.rpe : null

  const swaps: BlockZeroStrengthPlan['swaps'] = []
  const exercises = template.exercises.map(tex => {
    if (tex.section !== 'main') return tex
    let next = tex
    const pick = backFriendlyVariation(tex.exerciseId, backToday)
    if (pick.swapped && pick.reason) {
      swaps.push({ from: tex.exerciseId, to: pick.exerciseId, reason: pick.reason })
      next = { ...next, exerciseId: pick.exerciseId, label: pick.label ?? next.label, notes: `${pick.reason} ${next.notes ?? ''}`.trim() }
    }
    if (easedSets != null && easedRpe != null) {
      // Eased: the e1RM check (RPE 8) waits, working sets drop to the eased count.
      const working = next.sets.filter((s: TemplateSet) => !s.isWarmup && s.loadMultiplier == null)
      const warm = next.sets.filter((s: TemplateSet) => s.isWarmup)
      next = {
        ...next,
        sets: [...warm, ...working.slice(0, Math.max(1, Math.min(easedSets, working.length)))],
        notes: `${eased.reason ?? ''} ${next.notes ?? ''}`.trim(),
      }
    }
    return next
  })

  const mainIds = [...new Set(exercises.filter(e => e.section === 'main').map(e => e.exerciseId))]
  const block = await getActiveBlockZero(db)
  const history = await loadMainSetHistory(db, block ? blockStartDay(block) : epochDay - 56, session.id, mainIds)
  const loads = new Map<string, WorkingLoad>()
  for (const id of mainIds) {
    const load = blockZeroWorkingLoad({
      exerciseId: id,
      history: history.get(id) ?? [],
      target: { reps: target.reps, rpe: easedRpe ?? target.rpe },
      eased: eased.eased,
    })
    if (load) loads.set(id, load)
  }

  return {
    template: { ...template, exercises },
    loads,
    autoEase: { eased: eased.eased, reason: eased.reason },
    swaps,
    backToday,
  }
}

/** Working-set weight from a plan load, check sets scaled (~1.1x) and rounded to 0.5 kg. */
export function planSetWeightKg(load: WorkingLoad, set: TemplateSet): number {
  return Math.round(load.weightKg * (set.loadMultiplier ?? 1) * 2) / 2
}

// ─── Test results ──────────────────────────────────────────────

export async function upsertBlockTest(db: DB, row: {
  blockId: string
  week: number
  testKey: string
  value: number
  unit: string
  notes: string | null
  source: 'manual' | 'auto'
  recordedAt: number
}) {
  await db.insert(blockTests)
    .values({ id: crypto.randomUUID(), ...row })
    .onConflictDoUpdate({
      target: [blockTests.blockId, blockTests.week, blockTests.testKey],
      set: { value: row.value, unit: row.unit, notes: row.notes, source: row.source, recordedAt: row.recordedAt },
    })
  const [saved] = await db.select().from(blockTests).where(and(
    eq(blockTests.blockId, row.blockId), eq(blockTests.week, row.week), eq(blockTests.testKey, row.testKey),
  ))
  return saved
}

export async function listBlockTests(db: DB, blockId: string, week?: number) {
  const where = week != null
    ? and(eq(blockTests.blockId, blockId), eq(blockTests.week, week))
    : eq(blockTests.blockId, blockId)
  return db.select().from(blockTests).where(where).orderBy(asc(blockTests.week), asc(blockTests.testKey))
}

/** The block a session belongs to: its week plan's block, else the active block. */
async function blockIdForSession(db: DB, weekPlanId: string | null): Promise<string | null> {
  if (weekPlanId) {
    const [wp] = await db.select({ blockId: weekPlans.blockId }).from(weekPlans).where(eq(weekPlans.id, weekPlanId))
    if (wp) return wp.blockId
  }
  return (await getActiveBlockZero(db))?.id ?? null
}

/**
 * After a set is logged: a Block Zero week-3/6 check set with weight, reps
 * <= 10 and RIR writes 'e1rm:<exerciseId>' for that block and week (R4).
 * Returns the saved row, or null when the set doesn't qualify.
 */
export async function recordCheckSetE1rm(db: DB, setId: string) {
  const [row] = await db
    .select({
      set: strengthSets,
      exerciseId: strengthSessionExercises.exerciseId,
      section: strengthSessionExercises.section,
      blockType: sessions.blockType,
      blockWeek: sessions.blockWeek,
      weekPlanId: sessions.weekPlanId,
    })
    .from(strengthSets)
    .innerJoin(strengthSessionExercises, eq(strengthSets.sessionExerciseId, strengthSessionExercises.id))
    .innerJoin(sessions, eq(strengthSessionExercises.sessionId, sessions.id))
    .where(eq(strengthSets.id, setId))
  if (!row || row.blockType !== 'block_zero' || row.set.completedAt == null) return null
  const week = row.blockWeek ?? 1
  const e1rm = checkSetE1rm({
    week,
    section: row.section,
    isWarmup: row.set.isWarmup === 1,
    plannedReps: row.set.plannedReps,
    weightKg: row.set.weightKg,
    reps: row.set.reps,
    rir: row.set.rir,
  })
  if (e1rm == null) return null
  const blockId = await blockIdForSession(db, row.weekPlanId)
  if (!blockId) return null
  return upsertBlockTest(db, {
    blockId,
    week,
    testKey: e1rmTestKey(row.exerciseId),
    value: e1rm,
    unit: 'kg',
    notes: `${row.set.weightKg} kg x ${row.set.reps}, ${row.set.rir === 3 ? '3+' : row.set.rir} left`,
    source: 'auto',
    recordedAt: Math.floor(Date.now() / 1000),
  })
}

/** Latest talk-test HR this block (week-1 test, R9), for the run-walk ceiling. */
export async function talkTestBpm(db: DB): Promise<number | null> {
  const block = await getActiveBlockZero(db)
  if (!block) return null
  const rows = await db.select().from(blockTests)
    .where(and(eq(blockTests.blockId, block.id), eq(blockTests.testKey, 'talk_test_hr')))
  const latest = rows.sort((a, b) => b.week - a.week)[0]
  return latest?.value ?? null
}

// ─── Muay thai class checks (R12) ──────────────────────────────

/**
 * Rules check for logging a class type while Block Zero is active. Ramp week
 * counts from the first class this block; the cap counts the other classes
 * started or done in the same Monday-Sunday week. Null when not Block Zero.
 */
export async function checkMtClassForBlockZero(db: DB, sessionId: string, classType: string): Promise<ClassDecision | null> {
  const block = await getActiveBlockZero(db)
  if (!block) return null
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!session) return null
  const day = session.scheduledDate ?? todayEpochDayUtc()
  const dow = new Date(day * DAY_SEC * 1000).getUTCDay()
  const monday = day - ((dow + 6) % 7)

  const classes = await db.select({ id: sessions.id, scheduledDate: sessions.scheduledDate, status: sessions.status })
    .from(sessions)
    .where(and(eq(sessions.type, 'mt_class'), gte(sessions.scheduledDate, blockStartDay(block)), lte(sessions.scheduledDate, monday + 6)))
  const others = classes.filter(c => c.id !== sessionId && c.scheduledDate != null && (c.status === 'completed' || c.status === 'in_progress'))
  const before = others.filter(c => (c.scheduledDate as number) <= day).map(c => c.scheduledDate as number)
  const firstDay = before.length > 0 ? Math.min(...before) : null
  const classesThisWeek = others.filter(c => (c.scheduledDate as number) >= monday && (c.scheduledDate as number) <= monday + 6).length

  const [profile] = await db.select({ cap: userProfile.mtCapPerWeek }).from(userProfile).where(eq(userProfile.id, 'default'))
  return evaluateClassRequest({
    classType,
    weeksSinceFirstClass: firstDay == null ? null : Math.floor((day - firstDay) / 7),
    classesThisWeek,
    profileCap: profile?.cap ?? null,
  })
}

// ─── End gate inputs ───────────────────────────────────────────

export async function loadBackScores(db: DB, fromDay: number, toDay: number) {
  const rows = await db.select({ epochDay: dailyLogs.logDate, backToday: dailyLogs.backToday }).from(dailyLogs)
    .where(and(gte(dailyLogs.logDate, fromDay), lte(dailyLogs.logDate, toDay)))
  return rows
}

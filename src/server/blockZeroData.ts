// Block Zero data access: the DB reads and writes the rules module needs.
// Rules stay pure in lib/blockZero; this file only loads rows and applies the
// results (readiness, auto-ease, RIR loads, back swaps, MT class checks, tests).

import { and, asc, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm'
import { blockTests, dailyLogs, exercises, mtClassLogs, runSessions, sessions, strengthSessionExercises, strengthSets, trainingBlocks, userProfile, weekPlans } from '../db/schema'
import {
  BLOCK_ZERO_BASE_WEEKS,
  ageFromDob,
  backFriendlyVariation,
  backTrend,
  calibrationCeilingKg,
  e1rmsFromTests,
  hasWeek1Tests,
  hrCeiling,
  latestRirTopSet,
  retestCeilingKg,
  testDeltas,
  week1LiftBaselines,
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
  type AiContextLift,
  type BlockZeroAiContextInput,
  type BlockZeroGuardContext,
  type ClassDecision,
  type EasedSession,
  type GuardSession,
  type LiftBaseline,
  type LoadEntry,
  type RunHistory,
  type TestDelta,
  type WorkupSet,
  type LoggedWorkingSet,
  type ReadinessReport,
  type WorkingLoad,
} from '../lib/blockZero'
import type { StrengthTemplate, TemplateSet } from '../lib/strengthTemplates'
import { mtRampStartDay, scaleLoadKg, scaleSets, type CoachEase, type ReturnContext } from '../lib/coach'
import type { InjuryAction } from '../lib/coach/injury'
import { trainingWeekFor } from './coachData'
import { zone2CeilingBpm } from '../lib/hrAnalysis'
import { mondayOf } from '../lib/dates'
import type { createDB } from '../db/client'
import { lbText } from '../lib/units'
import { loadEquipment, snapForChangeKg } from '../lib/strengthLoads'

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
      // Logged sets only: pre-filled sets the athlete never lifted don't set loads.
      isNotNull(strengthSets.completedAt),
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
/** What the coach rules add on top of readiness: the return ramp, an applied coach ease, an injury flag. */
export interface CoachStrengthInputs {
  returnCtx?: ReturnContext | null
  coachEase?: CoachEase | null
  injury?: { action: InjuryAction; note: string | null } | null
}

export async function planBlockZeroStrength(
  db: DB,
  session: { id: string; scheduledDate: number | null; blockWeek: number | null; label: string | null; timeSlot: string | null },
  template: StrengthTemplate,
  coach: CoachStrengthInputs = {},
): Promise<BlockZeroStrengthPlan> {
  const epochDay = session.scheduledDate ?? todayEpochDayUtc()
  const target = getStrengthWeekTarget(session.blockWeek ?? 1)
  const report = await readinessFor(db, epochDay)
  const [log] = await db.select({ backToday: dailyLogs.backToday }).from(dailyLogs).where(eq(dailyLogs.logDate, epochDay))
  const injuryAction = coach.injury?.action ?? 'none'
  // An injury flag on the back reads as "back today" 1: the back-friendly lifts.
  const backToday = injuryAction === 'back_swap' ? Math.min(log?.backToday ?? 1, 1) : log?.backToday ?? null

  const planned = {
    type: 'strength',
    label: session.label ?? template.label,
    timeSlot: (session.timeSlot === 'pm' ? 'pm' : 'am') as 'am' | 'pm',
    estimatedMin: 60,
    sets: mainLiftHardSets(target),
    rpe: target.rpe,
  }
  // Readiness first; an injury flag or an applied coach ease also eases (same shape).
  let eased = easeForReadiness(report, planned)
  const extraWhy = injuryAction === 'ease' || injuryAction === 'back_swap' ? coach.injury?.note ?? null : coach.coachEase?.reason ?? null
  if (!eased.eased && extraWhy) {
    eased = { ...easeSession(planned, { readinessEase: true, readinessReason: extraWhy }), reason: extraWhy }
  }
  // F12/F13: the return ramp trims sets on top of any ease.
  const ramp = coach.returnCtx?.active ? coach.returnCtx : null
  let easedSets = eased.eased ? eased.session.sets ?? target.mainSets : null
  const easedRpe = eased.eased ? eased.session.rpe ?? target.rpe : null
  if (ramp) easedSets = scaleSets(easedSets ?? mainLiftHardSets(target), ramp.volumeFactor)

  const swaps: BlockZeroStrengthPlan['swaps'] = []
  const exercises = template.exercises.map(tex => {
    if (tex.section !== 'main') return tex
    let next = tex
    const pick = backFriendlyVariation(tex.exerciseId, backToday)
    if (pick.swapped && pick.reason) {
      swaps.push({ from: tex.exerciseId, to: pick.exerciseId, reason: pick.reason })
      next = { ...next, exerciseId: pick.exerciseId, label: pick.label ?? next.label, notes: `${pick.reason} ${next.notes ?? ''}`.trim() }
    }
    if (easedSets != null) {
      // Eased or ramping: the e1RM check (RPE 8) waits, working sets drop to the eased count.
      const working = next.sets.filter((s: TemplateSet) => !s.isWarmup && s.loadMultiplier == null)
      const warm = next.sets.filter((s: TemplateSet) => s.isWarmup)
      const why = [eased.eased ? eased.reason : null, ramp?.reason ?? null].filter(Boolean).join(' ')
      next = {
        ...next,
        sets: [...warm, ...working.slice(0, Math.max(1, Math.min(easedSets, working.length)))],
        notes: `${why} ${next.notes ?? ''}`.trim(),
      }
    }
    return next
  })

  const mainIds = [...new Set(exercises.filter(e => e.section === 'main').map(e => e.exerciseId))]
  const block = await getActiveBlockZero(db)
  const history = await loadMainSetHistory(db, block ? blockStartDay(block) : epochDay - 56, session.id, mainIds)
  const loads = new Map<string, WorkingLoad>()
  for (const id of mainIds) {
    const hist = history.get(id) ?? []
    const load = blockZeroWorkingLoad({
      exerciseId: id,
      history: hist,
      target: { reps: target.reps, rpe: easedRpe ?? target.rpe },
      eased: eased.eased || ramp != null,
    })
    if (load && ramp) {
      // F12/F13: after a gap the last top set is scaled down, never pushed.
      const top = latestRirTopSet(hist, target.reps)
      const from = top?.weightKg ?? load.weightKg
      loads.set(id, { weightKg: Math.min(load.weightKg, scaleLoadKg(from, ramp.loadFactor)), source: 'rir', change: 'decrease', reason: ramp.reason ?? 'Back from a break. Load down.', fromKg: from })
    } else if (load) {
      loads.set(id, load)
    }
  }

  return {
    template: { ...template, exercises },
    loads,
    autoEase: { eased: eased.eased || ramp != null, reason: [eased.reason, ramp?.reason].filter(Boolean).join(' ') || null },
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
    notes: `${row.set.weightKg != null ? lbText(row.set.weightKg) : 'bodyweight'} x ${row.set.reps}, ${row.set.rir === 3 ? '3+' : row.set.rir} left`,
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
 * counts from the first class after the last 14+ day class gap; the cap counts the other classes
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

  // The ramp counts from the first class after the last 14+ day class gap, not the first class ever.
  const classes = await db.select({ id: sessions.id, scheduledDate: sessions.scheduledDate, status: sessions.status })
    .from(sessions)
    .where(and(eq(sessions.type, 'mt_class'), gte(sessions.scheduledDate, day - 180), lte(sessions.scheduledDate, monday + 6)))
  const others = classes.filter(c => c.id !== sessionId && c.scheduledDate != null && (c.status === 'completed' || c.status === 'in_progress'))
  const before = others.filter(c => (c.scheduledDate as number) <= day).map(c => c.scheduledDate as number)
  const firstDay = mtRampStartDay(before, day)
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

// ─── AI guardrail context (Phase D) ────────────────────────────

/** Training week a day falls in, 1..totalWeeks, paused through gaps (lib/coach/weekCounter). */
export async function blockWeekFor(db: DB, block: typeof trainingBlocks.$inferSelect, epochDay: number): Promise<number> {
  return (await trainingWeekFor(db, block, epochDay, epochDay)).week
}


/** Run history the R7 / R8 caps read, relative to a day (Monday-Sunday weeks). */
export async function loadRunHistory(db: DB, epochDay: number): Promise<Required<RunHistory>> {
  const monday = mondayOf(epochDay)
  const rows = await db
    .select({ scheduledDate: sessions.scheduledDate, durationSec: runSessions.durationSec })
    .from(runSessions)
    .innerJoin(sessions, eq(runSessions.sessionId, sessions.id))
    .where(and(eq(sessions.status, 'completed'), gte(sessions.scheduledDate, Math.min(epochDay - 30, monday - 7)), lte(sessions.scheduledDate, monday + 6)))
  const done = rows.filter(r => r.scheduledDate != null).map(r => ({ day: r.scheduledDate as number, sec: r.durationSec ?? 0 }))
  return {
    longestLast30Sec: done.filter(r => r.day >= epochDay - 30 && r.day <= epochDay).reduce((m, r) => Math.max(m, r.sec), 0) || null,
    lastWeekRunSec: done.filter(r => r.day >= monday - 7 && r.day < monday).reduce((n, r) => n + r.sec, 0),
    thisWeekRunSec: done.filter(r => r.day >= monday && r.day < epochDay).reduce((n, r) => n + r.sec, 0),
  }
}

/** Ramp inputs for the class rules: ramp start (after the last 14+ day class gap), classes this week, profile cap. */
export async function loadMtRamp(db: DB, epochDay: number) {
  const monday = mondayOf(epochDay)
  const classes = await db.select({ scheduledDate: sessions.scheduledDate, status: sessions.status })
    .from(sessions)
    .where(and(eq(sessions.type, 'mt_class'), gte(sessions.scheduledDate, epochDay - 180), lte(sessions.scheduledDate, monday + 6)))
  const live = classes.filter(c => c.scheduledDate != null && (c.status === 'completed' || c.status === 'in_progress' || c.status === 'planned'))
  const done = live.filter(c => c.status !== 'planned' && (c.scheduledDate as number) <= epochDay).map(c => c.scheduledDate as number)
  const first = mtRampStartDay(done, epochDay)
  const [profile] = await db.select({ cap: userProfile.mtCapPerWeek }).from(userProfile).where(eq(userProfile.id, 'default'))
  return {
    weeksSinceFirstClass: first == null ? null : Math.floor((epochDay - first) / 7),
    classesThisWeek: live.filter(c => (c.scheduledDate as number) >= monday && (c.scheduledDate as number) <= monday + 6).length,
    profileCap: profile?.cap ?? null,
  }
}

/**
 * Everything the guardrails need to judge a mid-week change in Block Zero:
 * the sessions around today, readiness and load, run history and the class
 * ramp. Null when the active block isn't Block Zero.
 */
export async function loadBlockZeroGuardContext(db: DB, todayEpochDay: number): Promise<BlockZeroGuardContext | null> {
  const block = await getActiveBlockZero(db)
  if (!block) return null
  const rows = await db.select({ id: sessions.id, type: sessions.type, scheduledDate: sessions.scheduledDate, timeSlot: sessions.timeSlot, status: sessions.status, label: sessions.label })
    .from(sessions)
    .where(and(gte(sessions.scheduledDate, todayEpochDay - 8), lte(sessions.scheduledDate, todayEpochDay + 8)))
  const around: GuardSession[] = rows.filter(r => r.scheduledDate != null).map(r => ({
    id: r.id,
    type: r.type,
    epochDay: r.scheduledDate as number,
    timeSlot: r.timeSlot === 'pm' ? 'pm' : 'am',
    status: r.status,
    label: r.label,
  }))
  const report = await readinessFor(db, todayEpochDay)
  return {
    weekNumber: await blockWeekFor(db, block, todayEpochDay),
    todayEpochDay,
    sessions: around,
    readinessEase: report.readinessEase,
    loadFlag: report.load?.flagged ?? false,
    easeReason: report.reason,
    run: await loadRunHistory(db, todayEpochDay),
    mt: await loadMtRamp(db, todayEpochDay),
  }
}

/** Main working sets this block, all lifts, with names. Optionally one set of block weeks. */
async function loadBlockMainSets(db: DB, blockStart: number, weeks?: number[]): Promise<Array<WorkupSet & { name: string; equipment: string | null }>> {
  const filters = [
    eq(sessions.blockType, 'block_zero'),
    gte(sessions.scheduledDate, blockStart),
    eq(strengthSessionExercises.section, 'main'),
    eq(strengthSets.isWarmup, 0),
    isNotNull(strengthSets.completedAt),
  ]
  if (weeks) filters.push(inArray(sessions.blockWeek, weeks))
  return db
    .select({
      exerciseId: strengthSessionExercises.exerciseId,
      name: exercises.name,
      equipment: exercises.equipment,
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
    .innerJoin(exercises, eq(strengthSessionExercises.exerciseId, exercises.id))
    .where(and(...filters))
}

/**
 * Inputs for the compact Block Zero context (lib/blockZero/aiContext).
 * Training data only. Null when the active block isn't Block Zero.
 */
export async function loadBlockZeroAiContext(db: DB, todayEpochDay: number, weekNumber?: number): Promise<BlockZeroAiContextInput | null> {
  const block = await getActiveBlockZero(db)
  if (!block) return null
  const start = blockStartDay(block)
  const week = weekNumber ?? await blockWeekFor(db, block, todayEpochDay)
  const target = getStrengthWeekTarget(week)
  const report = await readinessFor(db, todayEpochDay)

  const byLift = new Map<string, { name: string; equipment: string | null; sets: LoggedWorkingSet[] }>()
  for (const s of await loadBlockMainSets(db, start)) {
    const entry = byLift.get(s.exerciseId) ?? { name: s.name, equipment: s.equipment, sets: [] }
    entry.sets.push(s)
    byLift.set(s.exerciseId, entry)
  }
  const lifts: Array<{ lift: AiContextLift; at: number }> = []
  for (const [exerciseId, { name, equipment, sets: history }] of byLift) {
    const top = latestRirTopSet(history, target.reps)
    if (!top || top.weightKg == null || top.rir == null) continue
    const next = blockZeroWorkingLoad({ exerciseId, history, target, eased: report.ease })
    // The next load as the app prescribes it: snapped to what can be loaded (lb plates).
    const nextKg = next ? snapForChangeKg(next.weightKg, loadEquipment(equipment), next.change, next.fromKg) : null
    lifts.push({
      lift: { name, topSet: { weightKg: top.weightKg, reps: top.reps, rir: top.rir }, next: next && nextKg != null ? { weightKg: nextKg, change: next.change } : null },
      at: top.completedAt ?? 0,
    })
  }
  lifts.sort((a, b) => b.at - a.at)

  const backRows = await loadBackScores(db, start, todayEpochDay)
  const backByDay = new Map(backRows.map(r => [r.epochDay, r.backToday]))

  const [profile] = await db.select({ maxHr: userProfile.maxHr, dob: userProfile.dob }).from(userProfile).where(eq(userProfile.id, 'default'))
  const ceiling = hrCeiling({
    talkTestBpm: await talkTestBpm(db),
    measuredMaxHr: profile?.maxHr ?? null,
    ageYears: ageFromDob(profile?.dob ?? null, todayEpochDay),
    defaultBpm: zone2CeilingBpm(null),
  })
  const run = await loadRunHistory(db, todayEpochDay)

  return {
    weekNumber: week,
    totalWeeks: block.totalWeeks,
    readiness: { checkedIn: report.checkedIn, items: report.items, readinessEase: report.readinessEase, reason: report.reason },
    load: report.load ? { last7: report.load.last7, prev7: report.load.prev7, change: report.load.change, flagged: report.load.flagged, applies: report.load.applies } : null,
    lifts: lifts.map(l => l.lift),
    backScores: Array.from({ length: 7 }, (_, i) => backByDay.get(todayEpochDay - 6 + i) ?? null),
    backTrend: backTrend(backRows, start, todayEpochDay),
    run: { longestLast30Sec: run.longestLast30Sec, lastWeekRunSec: run.lastWeekRunSec },
    hrCeilingBpm: ceiling.bpm,
    mt: await loadMtRamp(db, todayEpochDay),
  }
}

// ─── Test data for the assessment and transition ───────────────

export interface BlockTestData {
  rows: Array<{ week: number; testKey: string; value: number; unit: string }>
  baselines: Map<string, LiftBaseline>
  names: Map<string, string>
  /** Any week-1 result logged: from then on only test-backed maxes are saved. */
  testsExist: boolean
  /** Week-1 ceiling per lift: 90% of the week-1 e1RM. */
  ceilings: Map<string, number>
}

/** Week-1 test rows plus the logged week-1 work-up, for one block. */
export async function loadBlockTestData(db: DB, blockId: string): Promise<BlockTestData> {
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  const rows = await db.select({ week: blockTests.week, testKey: blockTests.testKey, value: blockTests.value, unit: blockTests.unit })
    .from(blockTests).where(eq(blockTests.blockId, blockId))
  const workups = block ? await loadBlockMainSets(db, blockStartDay(block), [1]) : []
  const baselines = week1LiftBaselines(rows, workups)
  const names = new Map((await db.select({ id: exercises.id, name: exercises.name }).from(exercises)).map(e => [e.id, e.name]))
  const ceilings = new Map([...baselines.values()].map(b => [b.exerciseId, calibrationCeilingKg(b)]))
  return { rows, baselines, names, testsExist: hasWeek1Tests(rows, baselines), ceilings }
}

/** Week 1 vs retest deltas and retest ceilings for the transition prompt. */
export function transitionTestSummary(data: BlockTestData, retestE1rms: Map<string, number>): {
  deltas: TestDelta[]
  ceilings: Array<{ exerciseId: string; name: string; retestE1rmKg: number; ceilingKg: number; adjustCeilingKg: number }>
} {
  const e1rms = new Map([...retestE1rms, ...e1rmsFromTests(data.rows, w => w >= BLOCK_ZERO_BASE_WEEKS)])
  return {
    deltas: testDeltas(data.rows, data.baselines, e1rms, data.names),
    ceilings: [...e1rms].map(([exerciseId, e1rm]) => ({
      exerciseId,
      name: data.names.get(exerciseId) ?? exerciseId,
      retestE1rmKg: e1rm,
      ceilingKg: retestCeilingKg(e1rm, 'proceed'),
      adjustCeilingKg: retestCeilingKg(e1rm, 'adjust'),
    })),
  }
}

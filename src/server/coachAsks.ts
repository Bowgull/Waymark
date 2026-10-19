// The coach's asks and small automatic changes (adaptive coach, plan §2-§6).
// Rules stay pure in lib/coach; this file loads rows, stores the results in
// week_adjustments and applies an answer:
//   ramp_up       a push, asked at most once a week (coach/rampUp)
//   make_regular  an added session made part of the plan (coach/makeRegular)
//   tm_update     new training maxes at a block end or retest (coach/tm)
//   felt_hard     automatic: the next similar session eases (coach/feltHard)
// Asks: status 'proposed', reason = the question, options_json = the choices,
// source_data = the full reasoning. Auto changes: status 'accepted', auto = 1,
// reason = the note, source_data.note / was / now. Reject changes nothing.

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, sessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, weekAdjustments, weekPlans } from '../db/schema'
import type { createDB } from '../db/client'
import {
  blockZeroEffortTarget,
  coachEaseFrom,
  feltHardEase,
  inLeadIn,
  noEasierReadFor,
  skipReasonEase,
  fighterTmDecision,
  makeRegularAsk,
  makeRegularCandidates,
  mergeContext,
  mondayOf,
  plannedLoad,
  rampUpAsk,
  summarizeEffort,
  tmAcceptValues,
  tmProposal,
  withCoachEase,
  checkSessionChange,
  easeDetail,
  easeBody,
  sessionName,
  MAKE_REGULAR_COOLDOWN_DAYS,
  RAMP_LOAD_ALLOWANCE,
  type AddedSession,
  type BlockWorkingSet,
  type EffortRead,
  type MakeRegularOption,
  type RampUpOption,
  type SessionChange,
  type TmDecision,
  type TmProposalLift,
} from '../lib/coach'
import { checkInFromDailyLog, evaluateReadiness, liftRegion } from '../lib/blockZero'
import { getStrengthTemplate, getWeekPercentage } from '../lib/strengthTemplates'
import { loadLiftTrends } from '../lib/athleteState/liftTrends'
import { isLoggedWorkSet } from '../lib/loggedSets'
import { getActiveBlock, readinessFor } from './blockZeroData'
import {
  addTemplateExtra,
  blockKind,
  blockStartDay,
  loadInjuryFlag,
  loadPlacementContext,
  mtClassDays,
  resolveWeekPlan,
  returnContextFor,
  toSessionLike,
  trainingWeekFor,
  weekStamps,
} from './coachData'

type DB = ReturnType<typeof createDB>
type Block = typeof trainingBlocks.$inferSelect
type AdjustmentRow = typeof weekAdjustments.$inferSelect

const DAY_SEC = 86400

/** Noon UTC on a day: the day has begun everywhere in the Americas. */
export function expirySec(expiresOnDay: number): number {
  return expiresOnDay * DAY_SEC + 12 * 3600
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/** The week plan rows for a day's calendar week (created when missing). */
export async function weekPlanForDay(db: DB, block: Block, day: number, todayDay: number, nowSec: number): Promise<string> {
  const tw = await trainingWeekFor(db, block, day, todayDay)
  return (await resolveWeekPlan(db, block.id, weekStamps(block, tw).weekNumber, mondayOf(day), nowSec)) as string
}

export interface AutoChangeInput {
  weekPlanId: string
  adjustmentType: string
  sessionType: string
  action: string
  reason: string
  targetSessionId?: string | null
  targetEpochDay?: number | null
  timeSlot?: string | null
  was?: string | null
  now?: string | null
  /** The Coach board line on Today (page 36): a bold lead ("Strength C eased") and the rest after it. */
  lead?: string | null
  body?: string | null
  detail?: Record<string, unknown>
  nowSec: number
}

export async function recordAutoChange(db: DB, c: AutoChangeInput): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(weekAdjustments).values({
    id,
    weekPlanId: c.weekPlanId,
    adjustmentType: c.adjustmentType,
    sessionType: c.sessionType,
    action: c.action,
    reason: c.reason,
    targetDay: c.targetEpochDay != null ? new Date(c.targetEpochDay * DAY_SEC * 1000).getUTCDay() : null,
    targetTimeSlot: c.timeSlot ?? null,
    sourceData: JSON.stringify({ note: c.reason, was: c.was ?? null, now: c.now ?? null, lead: c.lead ?? null, body: c.body ?? null, targetEpochDay: c.targetEpochDay ?? null, ...(c.detail ?? {}) }),
    status: 'accepted',
    auto: 1,
    targetSessionId: c.targetSessionId ?? null,
    createdAt: c.nowSec,
  })
  return id
}

export interface AskInput {
  weekPlanId: string
  adjustmentType: 'ramp_up' | 'make_regular' | 'tm_update'
  sessionType: string
  action: string
  question: string
  options: unknown[]
  detail: Record<string, unknown>
  expiresOnDay: number
  targetSessionId?: string | null
  nowSec: number
}

export async function recordAsk(db: DB, a: AskInput): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(weekAdjustments).values({
    id,
    weekPlanId: a.weekPlanId,
    adjustmentType: a.adjustmentType,
    sessionType: a.sessionType,
    action: a.action,
    reason: a.question,
    sourceData: JSON.stringify(a.detail),
    status: 'proposed',
    targetSessionId: a.targetSessionId ?? null,
    optionsJson: JSON.stringify(a.options),
    expiresAt: expirySec(a.expiresOnDay),
    createdAt: a.nowSec,
  })
  return id
}

// ─── Effort reads ──────────────────────────────────────────────

/** Completed sessions in a day range with session RPE and mean RIR on logged main working sets. */
export async function loadEffortReads(db: DB, fromDay: number, toDay: number): Promise<Array<EffortRead & { id: string; timeSlot: string | null; status: string; scheduledDate: number }>> {
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.status, 'completed'), gte(sessions.scheduledDate, fromDay), lte(sessions.scheduledDate, toDay)))
  const strengthIds = rows.filter(r => r.type === 'strength').map(r => r.id)
  const rirBySession = new Map<string, number[]>()
  if (strengthIds.length > 0) {
    const sets = await db.select({ sessionId: strengthSessionExercises.sessionId, rir: strengthSets.rir, completedAt: strengthSets.completedAt, isWarmup: strengthSets.isWarmup, section: strengthSessionExercises.section })
      .from(strengthSets)
      .innerJoin(strengthSessionExercises, eq(strengthSets.sessionExerciseId, strengthSessionExercises.id))
      .where(inArray(strengthSessionExercises.sessionId, strengthIds))
    for (const s of sets) {
      if (s.section !== 'main' || s.rir == null || !isLoggedWorkSet(s)) continue
      rirBySession.set(s.sessionId, [...(rirBySession.get(s.sessionId) ?? []), s.rir])
    }
  }
  // D5: Block Zero strength reads its own week's band; lead-in and week 1 never read "easier".
  const block = await getActiveBlock(db)
  const bzStart = block?.blockType === 'block_zero' ? blockStartDay(block) : null
  const planIds = [...new Set(rows.map(r => r.weekPlanId).filter((id): id is string => id != null))]
  const planWeek = new Map(planIds.length > 0 ? (await db.select({ id: weekPlans.id, weekNumber: weekPlans.weekNumber }).from(weekPlans).where(inArray(weekPlans.id, planIds))).map(p => [p.id, p.weekNumber]) : [])
  return rows.filter(r => r.scheduledDate != null).map(r => {
    const rirs = rirBySession.get(r.id)
    const leadIn = bzStart != null && r.blockType === 'block_zero' && inLeadIn('block_zero', bzStart, r.scheduledDate as number)
    const weekNumber = r.weekPlanId ? planWeek.get(r.weekPlanId) ?? null : null
    const bz = { type: r.type, blockType: r.blockType, blockWeek: r.blockWeek, leadIn, weekNumber }
    return {
      target: blockZeroEffortTarget(bz),
      noEasierRead: noEasierReadFor(bz),
      id: r.id,
      sessionId: r.id,
      epochDay: r.scheduledDate as number,
      scheduledDate: r.scheduledDate as number,
      type: r.type,
      label: r.label,
      // sessions.notes holds the run category for runs only.
      notes: r.type === 'running' ? r.notes : null,
      rpe: r.rpe,
      rir: rirs && rirs.length > 0 ? Math.round((rirs.reduce((a, b) => a + b, 0) / rirs.length) * 10) / 10 : null,
      source: r.source,
      timeSlot: r.timeSlot,
      status: r.status,
    }
  })
}

// ─── How a session felt -> ease the next similar one (auto) ──

/**
 * For sessions done in the last 2 days: way harder than target, or soreness
 * 4+ on the next morning's check-in, eases the next similar planned session.
 * Idempotent: one ease per source session.
 */
export async function applyFeltHard(db: DB, todayDay: number, nowSec: number): Promise<number> {
  const block = await getActiveBlock(db)
  if (!block) return 0
  const done = await loadEffortReads(db, todayDay - 2, todayDay)
  if (done.length === 0) return 0
  const prior = await db.select({ sourceData: weekAdjustments.sourceData }).from(weekAdjustments)
    .where(and(eq(weekAdjustments.adjustmentType, 'felt_hard'), gte(weekAdjustments.createdAt, (todayDay - 14) * DAY_SEC)))
  const handled = new Set(prior.map(p => parseJson<{ fromSessionId?: string }>(p.sourceData, {}).fromSessionId).filter(Boolean))
  const logs = await db.select({ logDate: dailyLogs.logDate, soreness: dailyLogs.soreness }).from(dailyLogs)
    .where(and(gte(dailyLogs.logDate, todayDay - 2), lte(dailyLogs.logDate, todayDay + 1)))
  const soreBy = new Map(logs.map(l => [l.logDate, l.soreness]))
  const upcomingRows = await db.select().from(sessions)
    .where(and(eq(sessions.status, 'planned'), gte(sessions.scheduledDate, todayDay), lte(sessions.scheduledDate, todayDay + 8)))
  const upcoming = upcomingRows.filter(r => r.scheduledDate != null).map(r => ({ ...toSessionLike(r), id: r.id, eased: coachEaseFrom(r.contextJson) != null }))
  let n = 0
  for (const d of done) {
    if (handled.has(d.id)) continue
    const result = feltHardEase({ done: d, nextMorningSoreness: soreBy.get(d.epochDay + 1) ?? null, upcoming, todayEpochDay: todayDay, nowSec })
    if (!result) continue
    const target = upcomingRows.find(r => r.id === result.targetSessionId)
    if (!target) continue
    await db.update(sessions).set({ contextJson: withCoachEase(target.contextJson, result.ease) }).where(eq(sessions.id, target.id))
    const u = upcoming.find(x => x.id === target.id)
    if (u) u.eased = true
    const detail = easeDetail(result.ease.kind, target)
    await recordAutoChange(db, {
      weekPlanId: target.weekPlanId ?? await weekPlanForDay(db, block, result.targetEpochDay, todayDay, nowSec),
      adjustmentType: 'felt_hard',
      sessionType: target.type,
      action: 'ease',
      reason: result.ease.reason,
      targetSessionId: target.id,
      targetEpochDay: result.targetEpochDay,
      timeSlot: target.timeSlot,
      was: detail.was,
      now: detail.now,
      lead: `${sessionName(toSessionLike(target))} eased`,
      body: easeBody(detail.now, result.ease.reason),
      detail: { fromSessionId: result.fromSessionId, cause: result.cause, rpe: d.rpe, rir: d.rir, soreness: soreBy.get(d.epochDay + 1) ?? null },
      nowSec,
    })
    n++
  }
  return n
}

/**
 * A "sick" or "tired" skip eases the next planned session in 3 days (D11,
 * soft rule), with a one-line reason, the same way felt-hard does.
 */
export async function applySkipEase(db: DB, sessionId: string, todayDay: number, nowSec: number): Promise<boolean> {
  const block = await getActiveBlock(db)
  if (!block) return false
  const [skipped] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!skipped || skipped.status !== 'skipped' || skipped.scheduledDate == null) return false
  const from = Math.max(todayDay, skipped.scheduledDate)
  const upcomingRows = await db.select().from(sessions)
    .where(and(eq(sessions.status, 'planned'), gte(sessions.scheduledDate, todayDay), lte(sessions.scheduledDate, from + 3)))
  const upcoming = upcomingRows.filter(r => r.scheduledDate != null).map(r => ({ ...toSessionLike(r), id: r.id, eased: coachEaseFrom(r.contextJson) != null }))
  const result = skipReasonEase({ skipped: { sessionId, epochDay: skipped.scheduledDate, skipReason: skipped.skipReason }, upcoming, todayEpochDay: todayDay, nowSec })
  if (!result) return false
  const target = upcomingRows.find(r => r.id === result.targetSessionId)
  if (!target) return false
  await db.update(sessions).set({ contextJson: withCoachEase(target.contextJson, result.ease) }).where(eq(sessions.id, target.id))
  const detail = easeDetail(result.ease.kind, target)
  await recordAutoChange(db, {
    weekPlanId: target.weekPlanId ?? await weekPlanForDay(db, block, result.targetEpochDay, todayDay, nowSec),
    adjustmentType: 'felt_hard',
    sessionType: target.type,
    action: 'ease',
    reason: result.ease.reason,
    targetSessionId: target.id,
    targetEpochDay: result.targetEpochDay,
    timeSlot: target.timeSlot,
    was: detail.was,
    now: detail.now,
    lead: `${sessionName(toSessionLike(target))} eased`,
    body: easeBody(detail.now, result.ease.reason),
    detail: { fromSessionId: sessionId, cause: 'skip', skipReason: skipped.skipReason },
    nowSec,
  })
  return true
}

// ─── Ramp-up ask (at most one a week) ─────────────────────────

/** Main lifts of a Fighter strength session and today's working loads (TM x wave). */
async function mainLiftLoads(db: DB, session: { scheduledDate: number | null; blockWeek: number | null; label: string | null }) {
  const day = session.scheduledDate ?? 0
  const template = getStrengthTemplate(new Date(day * DAY_SEC * 1000).getUTCDay(), session.blockWeek ?? 1, 'fighter', session.label)
  const pct = getWeekPercentage(session.blockWeek ?? 1, 'fighter')
  const tms = new Map((await db.select().from(trainingMaxes)).map(t => [t.exerciseId, t.weightKg]))
  const names = new Map((await db.select({ id: exercises.id, name: exercises.name }).from(exercises)).map(e => [e.id, e.name]))
  return template.exercises
    .filter(e => e.section === 'main' && tms.has(e.exerciseId))
    .map(e => ({ exerciseId: e.exerciseId, name: names.get(e.exerciseId) ?? e.label, workingKg: Math.round((tms.get(e.exerciseId) as number) * pct * 100) / 100 }))
}

/**
 * The next strength day's main lifts and planned working sets, for the +1 SET
 * line ("Squat and RDL, 3×8"): the template's main section, short names.
 */
export async function nextStrengthPlan(db: DB, session: { scheduledDate: number | null; blockWeek: number | null; label: string | null }, kind: 'fighter' | 'block_zero'): Promise<{ names: string[]; sets: number; reps: number } | null> {
  const day = session.scheduledDate ?? 0
  const template = getStrengthTemplate(new Date(day * DAY_SEC * 1000).getUTCDay(), session.blockWeek ?? 1, kind, session.label)
  const main = template.exercises.filter(e => e.section === 'main')
  if (main.length === 0) return null
  const names = new Map((await db.select({ id: exercises.id, name: exercises.name }).from(exercises)).map(e => [e.id, e.name]))
  const work = main[0].sets.filter(st => !st.isWarmup && (st.loadMultiplier ?? 1) === 1)
  const reps = work.find(st => st.targetReps > 0)?.targetReps ?? 0
  return { names: main.map(e => shortLiftName(names.get(e.exerciseId) ?? e.label)), sets: work.length, reps }
}

/** "Front Squat" → "Front squat" (the main squat, as the owner names it), "Romanian Deadlift" → "RDL": the short names the coach screens use. */
export function shortLiftName(name: string): string {
  const n = name.trim()
  if (/romanian deadlift/i.test(n)) return 'RDL'
  if (/^front squat$/i.test(n)) return 'Front squat'
  return n
}

/** The ramp-up rule for today. Creates at most one ask a calendar week. */
export async function maybeRampUpAsk(db: DB, todayDay: number, nowSec: number): Promise<string | null> {
  const block = await getActiveBlock(db)
  if (!block) return null
  const monday = mondayOf(todayDay)
  const [already] = await db.select({ id: weekAdjustments.id }).from(weekAdjustments)
    .where(and(eq(weekAdjustments.adjustmentType, 'ramp_up'), gte(weekAdjustments.createdAt, monday * DAY_SEC))).limit(1)
  const logs = await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, todayDay - 21), lte(dailyLogs.logDate, todayDay)))
  const readiness = evaluateReadiness(logs.map(checkInFromDailyLog))
  const effort = summarizeEffort(await loadEffortReads(db, todayDay - 7, todayDay))
  const trends = await loadLiftTrends(db, todayDay)
  const liftPush = [...trends.values()].some(t => t.verdict === 'push')
  const report = await readinessFor(db, todayDay)
  const ctx = await loadPlacementContext(db, todayDay, todayDay)
  const ret = await returnContextFor(db, todayDay)
  const injury = await loadInjuryFlag(db, todayDay)
  const easeToday = report.ease || (ctx.easeDays ?? []).includes(todayDay)
  const kind = blockKind(block.blockType)
  const upcomingRows = await db.select().from(sessions)
    .where(and(eq(sessions.status, 'planned'), gte(sessions.scheduledDate, todayDay), lte(sessions.scheduledDate, monday + 6)))
  const upcoming = upcomingRows.filter(r => r.scheduledDate != null).map(r => ({ ...toSessionLike(r), id: r.id }))
  const nextStrength = upcomingRows.filter(r => r.type === 'strength').sort((a, b) => (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0))[0]
  const mainLifts = kind === 'fighter' && nextStrength ? (await mainLiftLoads(db, nextStrength)).map(l => ({ ...l, name: shortLiftName(l.name) })) : []
  const strengthPlan = nextStrength ? await nextStrengthPlan(db, nextStrength, kind) : null
  const signals = { todayEpochDay: todayDay, readiness, effort, liftPush, easeToday, noPush: ret.active || ret.noPush || injury != null, askedThisWeek: already != null }
  const ask = rampUpAsk(signals, { ctx, upcoming, blockType: kind, weekNumber: ctx.weekNumber, liftPush, classDays: await mtClassDays(db), mainLifts, nextStrength: strengthPlan })
  if (!ask) return null
  return recordAsk(db, {
    weekPlanId: await weekPlanForDay(db, block, todayDay, todayDay, nowSec),
    adjustmentType: 'ramp_up',
    sessionType: ask.defaultOption.kind === 'add' ? ask.defaultOption.type : 'strength',
    action: ask.defaultOption.kind === 'add' ? 'add' : 'push',
    question: ask.question,
    options: ask.options,
    detail: { why: ask.why, proof: ask.proof, decline: ask.decline, defaultOption: ask.defaultOption, effort, liftPush, readinessDays: readiness.slice(-3).map(d => ({ epochDay: d.epochDay, fresh: d.fresh, better: d.betterItems })) },
    expiresOnDay: ask.expiresOnDay,
    targetSessionId: 'sessionId' in ask.defaultOption ? ask.defaultOption.sessionId : null,
    nowSec,
  })
}

// ─── Added sessions -> make it regular (weekly pass) ─────────

/**
 * Types added (and done well) 2+ weeks running get one ask per pass, placed
 * against next week. A type asked about in the last 4 weeks is not asked again.
 */
export async function maybeMakeRegularAsk(db: DB, block: Block, nextMonday: number, todayDay: number, nowSec: number): Promise<string | null> {
  const fromDay = nextMonday - 14
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.source, 'ad_hoc'), gte(sessions.scheduledDate, fromDay), lte(sessions.scheduledDate, nextMonday - 1)))
  if (rows.length === 0) return null
  const efforts = new Map((await loadEffortReads(db, fromDay, nextMonday - 1)).map(e => [e.id, e]))
  const logs = await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, fromDay - 10), lte(dailyLogs.logDate, nextMonday)))
  const flagged = new Set(evaluateReadiness(logs.map(checkInFromDailyLog)).filter(d => d.flagged).map(d => d.epochDay))
  const soreBy = new Map(logs.map(l => [l.logDate, l.soreness]))
  const adds: AddedSession[] = rows.filter(r => r.scheduledDate != null).map(r => ({
    type: r.type, label: r.label, notes: r.type === 'running' ? r.notes : null,
    epochDay: r.scheduledDate as number, timeSlot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status,
    rpe: r.rpe, rir: efforts.get(r.id)?.rir ?? null,
    readinessOff: flagged.has(r.scheduledDate as number) || flagged.has((r.scheduledDate as number) + 1),
    nextMorningSoreness: soreBy.get((r.scheduledDate as number) + 1) ?? null,
  }))
  const candidates = makeRegularCandidates(adds, nextMonday - 7)
  if (candidates.length === 0) return null
  const recent = await db.select({ sessionType: weekAdjustments.sessionType }).from(weekAdjustments)
    .where(and(eq(weekAdjustments.adjustmentType, 'make_regular'), gte(weekAdjustments.createdAt, (todayDay - MAKE_REGULAR_COOLDOWN_DAYS) * DAY_SEC)))
  const askedTypes = new Set(recent.map(r => r.sessionType))
  const ctx = await loadPlacementContext(db, nextMonday, todayDay)
  // The block's week number for each Monday it ran (the proof tiles: WK 2 ✓ · WK 3 ✓).
  const weekNo = new Map<number, number>()
  for (const c of candidates) for (const m of c.mondays) if (!weekNo.has(m)) weekNo.set(m, (await trainingWeekFor(db, block, m, todayDay)).week)
  for (const c of candidates) {
    if (askedTypes.has(c.type)) continue
    const ask = makeRegularAsk(c, ctx, nextMonday, m => weekNo.get(m) ?? null)
    if (!ask) continue
    return recordAsk(db, {
      weekPlanId: await weekPlanForDay(db, block, nextMonday, todayDay, nowSec),
      adjustmentType: 'make_regular',
      sessionType: c.type,
      action: 'add',
      question: ask.question,
      options: ask.options,
      detail: { why: ask.why, proof: ask.proof, candidate: c, defaultOption: ask.defaultOption },
      expiresOnDay: ask.expiresOnDay,
      nowSec,
    })
  }
  return null
}

// ─── Training max proposal (block end / retest) ───────────────

/** The rule decisions for every Fighter training max, from the block's logged main sets. */
export async function computeFighterTmDecisions(db: DB, block: Block): Promise<{ decisions: TmDecision[]; names: Map<string, string> }> {
  const allExercises = await db.select().from(exercises)
  const exMap = new Map(allExercises.map(e => [e.id, e]))
  const blockWeekPlans = await db.select().from(weekPlans).where(eq(weekPlans.blockId, block.id))
  const planWeek = new Map(blockWeekPlans.map(wp => [wp.id, wp.weekNumber]))
  const blockStrengthSessions = blockWeekPlans.length > 0
    ? (await db.select().from(sessions).where(inArray(sessions.weekPlanId, [...planWeek.keys()])))
      .filter(s => s.status === 'completed' && s.type === 'strength')
    : []
  const setsByLift = new Map<string, BlockWorkingSet[]>()
  for (const session of blockStrengthSessions) {
    const sexes = await db.select().from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, session.id))
    for (const se of sexes) {
      if (se.section !== 'main') continue
      const sets = await db.select().from(strengthSets).where(eq(strengthSets.sessionExerciseId, se.id))
      const list = setsByLift.get(se.exerciseId) ?? []
      // Logged working sets only: a set never lifted can't make a block "clean".
      for (const s of sets.filter(isLoggedWorkSet)) {
        list.push({ week: planWeek.get(session.weekPlanId ?? '') ?? 1, weightKg: s.weightKg, reps: s.reps, plannedWeightKg: s.plannedWeightKg, plannedReps: s.plannedReps })
      }
      setsByLift.set(se.exerciseId, list)
    }
  }
  const decisions: TmDecision[] = []
  const names = new Map<string, string>()
  for (const tm of await db.select().from(trainingMaxes)) {
    const ex = exMap.get(tm.exerciseId)
    if (!ex) continue
    names.set(tm.exerciseId, ex.name)
    const lowerByMuscle = ex.muscleGroups?.includes('quads') || ex.muscleGroups?.includes('glutes') || ex.muscleGroups?.includes('hamstrings')
    const region = liftRegion(tm.exerciseId) === 'lower' || lowerByMuscle ? 'lower' : 'upper'
    decisions.push(fighterTmDecision({ exerciseId: tm.exerciseId, currentTmKg: tm.weightKg, region, sets: setsByLift.get(tm.exerciseId) ?? [] }))
  }
  return { decisions, names }
}

export interface TmProposalResult {
  adjustmentId: string | null
  decisions: TmDecision[]
  idempotent: boolean
}

/**
 * Propose new training maxes for a Fighter block once per block and training
 * week (coaching_outputs kind 'tm_progression', the same key as before).
 * Nothing is written to training_maxes until the athlete approves.
 */
export async function proposeTmUpdate(db: DB, block: Block, todayDay: number, nowSec: number): Promise<TmProposalResult> {
  const week = (await trainingWeekFor(db, block, todayDay, todayDay)).week
  const key = `${block.id}:w${week}`
  const [done] = await db.select().from(coachingOutputs)
    .where(and(eq(coachingOutputs.kind, 'tm_progression'), eq(coachingOutputs.inputHash, key)))
  if (done) {
    const stored = parseJson<{ adjustmentId?: string | null; decisions?: TmDecision[] }>(done.outputJson, {})
    return { adjustmentId: stored.adjustmentId ?? null, decisions: stored.decisions ?? [], idempotent: true }
  }
  const { decisions, names } = await computeFighterTmDecisions(db, block)
  const proposal = tmProposal(decisions, names)
  let adjustmentId: string | null = null
  if (proposal) {
    adjustmentId = await recordAsk(db, {
      weekPlanId: await weekPlanForDay(db, block, todayDay, todayDay, nowSec),
      adjustmentType: 'tm_update',
      sessionType: 'strength',
      action: 'update_tm',
      question: proposal.question,
      options: proposal.options,
      detail: { lifts: proposal.lifts, holds: proposal.holds, decline: proposal.decline, week, blockName: block.name },
      // Two weeks to answer: long enough to see the next block start.
      expiresOnDay: mondayOf(todayDay) + 14,
      nowSec,
    })
  }
  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'tm_progression',
    model: 'rules',
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: key,
    outputJson: JSON.stringify({ adjustmentId, decisions, week }),
    tokensIn: 0,
    tokensOut: 0,
    cachedTokensIn: 0,
    createdAt: nowSec,
  })
  return { adjustmentId, decisions, idempotent: false }
}

// ─── Answering an ask ─────────────────────────────────────────

export interface AskAnswer {
  option?: number
  /** make_regular ANOTHER DAY: index into that option's safeSlots. */
  slot?: number
  /** tm_update: per-lift values in kg, clamped to the rule bounds. */
  values?: Record<string, number>
  today?: string
}

export type AskResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400 | 404 | 409; body: Record<string, unknown> }

async function resolveAsk(db: DB, adj: AdjustmentRow, nowSec: number, resolution: Record<string, unknown>) {
  const source = parseJson<Record<string, unknown>>(adj.sourceData, {})
  await db.update(weekAdjustments).set({ status: 'accepted', resolvedAt: nowSec, sourceData: JSON.stringify({ ...source, resolution }) }).where(eq(weekAdjustments.id, adj.id))
}

async function addCoachSession(db: DB, change: SessionChange, todayDay: number, nowSec: number, adjustmentId: string, context: Record<string, unknown>, ctxOverride?: { planWeekLoadFactor?: number; planWeekLoadAdd?: number }): Promise<AskResult> {
  const block = await getActiveBlock(db)
  const base = await loadPlacementContext(db, change.epochDay, todayDay)
  const ctx = base.planWeekLoad != null && ctxOverride
    ? { ...base, planWeekLoad: base.planWeekLoad * (ctxOverride.planWeekLoadFactor ?? 1) + (ctxOverride.planWeekLoadAdd ?? 0) }
    : base
  const check = checkSessionChange(change, ctx)
  if (!check.ok) return { ok: false, status: 409, body: { error: check.reason, code: check.code, reason: check.reason, safeAlternatives: check.safeAlternatives } }
  const tw = block ? await trainingWeekFor(db, block, change.epochDay, todayDay) : null
  const stamps = block && tw ? weekStamps(block, tw) : null
  const id = crypto.randomUUID()
  await db.insert(sessions).values({
    id,
    type: change.type,
    label: change.label ?? null,
    weekPlanId: block && stamps ? await resolveWeekPlan(db, block.id, stamps.weekNumber, mondayOf(change.epochDay), nowSec) : null,
    scheduledDate: change.epochDay,
    timeSlot: check.change.timeSlot,
    blockWeek: change.type === 'strength' ? stamps?.strengthWeek ?? null : null,
    blockType: block?.blockType ?? 'fighter',
    status: 'planned',
    notes: change.type === 'running' ? change.notes ?? null : null,
    adjustmentId,
    source: 'coach',
    contextJson: JSON.stringify(context),
    createdAt: nowSec,
  })
  const [created] = await db.select().from(sessions).where(eq(sessions.id, id))
  return { ok: true, body: { session: created } }
}

export interface CoachPush {
  kind: 'extra_set' | 'load_step'
  factor?: number
  reason: string
  at: number
}

/** Read an accepted push back from a session's context_json. */
export function coachPushFrom(contextJson: string | null | undefined): CoachPush | null {
  const p = parseJson<{ coachPush?: CoachPush }>(contextJson, {}).coachPush
  if (!p || (p.kind !== 'extra_set' && p.kind !== 'load_step') || typeof p.reason !== 'string') return null
  return p
}

async function acceptRampUp(db: DB, adj: AdjustmentRow, answer: AskAnswer, todayDay: number, nowSec: number): Promise<AskResult> {
  const options = parseJson<RampUpOption[]>(adj.optionsJson, [])
  const choice = options[answer.option ?? 0]
  if (!choice) return { ok: false, status: 400, body: { error: 'No such option.' } }
  const reason = `You said yes to a push. ${choice.label}.`
  if (choice.kind === 'add') {
    const r = await addCoachSession(db, { kind: 'add', type: choice.type, label: choice.sessionLabel, notes: choice.notes ?? null, epochDay: choice.epochDay, timeSlot: choice.timeSlot }, todayDay, nowSec, adj.id,
      { coachNote: { reason, at: nowSec, source: 'ramp_up' } }, { planWeekLoadFactor: RAMP_LOAD_ALLOWANCE / 1.05 })
    if (!r.ok) return r
    await resolveAsk(db, adj, nowSec, { option: answer.option ?? 0, id: choice.id, sessionId: (r.body.session as { id: string }).id })
    return { ok: true, body: { adjustment: { ...adj, status: 'accepted' }, session: r.body.session, resolution: choice } }
  }
  const [target] = await db.select().from(sessions).where(eq(sessions.id, choice.sessionId))
  if (!target || target.status !== 'planned') return { ok: false, status: 409, body: { error: 'That session is no longer planned. Nothing changes.', code: 'not_planned', reason: 'That session is no longer planned. Nothing changes.', safeAlternatives: [] } }
  if (coachEaseFrom(target.contextJson)) return { ok: false, status: 409, body: { error: 'That day is an easy day now. Nothing changes.', code: 'ease_day', reason: 'That day is an easy day now. Nothing changes.', safeAlternatives: [] } }
  const push: CoachPush = { kind: choice.kind, ...(choice.kind === 'load_step' ? { factor: choice.factor } : {}), reason, at: nowSec }
  await db.update(sessions).set({ contextJson: mergeContext(target.contextJson, { coachPush: push }) }).where(eq(sessions.id, target.id))
  await resolveAsk(db, adj, nowSec, { option: answer.option ?? 0, id: choice.id, sessionId: target.id })
  const [updated] = await db.select().from(sessions).where(eq(sessions.id, target.id))
  return { ok: true, body: { adjustment: { ...adj, status: 'accepted' }, session: updated, resolution: choice } }
}

async function acceptMakeRegular(db: DB, adj: AdjustmentRow, answer: AskAnswer, todayDay: number, nowSec: number): Promise<AskResult> {
  const options = parseJson<MakeRegularOption[]>(adj.optionsJson, [])
  const choice = options[answer.option ?? 0]
  if (!choice) return { ok: false, status: 400, body: { error: 'No such option.' } }
  if (choice.kind === 'keep_extra') {
    await resolveAsk(db, adj, nowSec, { option: answer.option ?? 0, id: choice.id })
    return { ok: true, body: { adjustment: { ...adj, status: 'accepted' }, resolution: choice } }
  }
  const slot = choice.id === 'usual' ? choice.slot : choice.safeSlots[answer.slot ?? 0]
  if (!slot) return { ok: false, status: 400, body: { error: 'Pick a day.' } }
  const block = await getActiveBlock(db)
  if (!block) return { ok: false, status: 404, body: { error: 'No active block.' } }
  // The first one lands next week (or later this week when that day is still ahead).
  const first = slot.epochDay >= todayDay ? slot.epochDay : mondayOf(todayDay) + 7 + ((slot.dayOfWeek + 6) % 7)
  const reason = `${choice.label}. You made it part of the plan.`
  const [existing] = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.scheduledDate, first), eq(sessions.type, choice.type), inArray(sessions.status, ['planned', 'in_progress', 'completed']))).limit(1)
  let created: unknown = null
  if (!existing) {
    // It joins the plan, so the week's planned load grows by it.
    const kindNow = blockKind(block.blockType)
    const add = plannedLoad({ type: choice.type, label: choice.sessionLabel, notes: choice.notes, estimatedMin: null }, kindNow, (await trainingWeekFor(db, block, first, todayDay)).week)
    const r = await addCoachSession(db, { kind: 'add', type: choice.type, label: choice.sessionLabel, notes: choice.notes, epochDay: first, timeSlot: slot.timeSlot }, todayDay, nowSec, adj.id, { coachNote: { reason, at: nowSec, source: 'make_regular' } }, { planWeekLoadAdd: add })
    if (!r.ok) return r
    created = r.body.session
  }
  await addTemplateExtra(db, { blockId: block.id, type: choice.type, label: choice.sessionLabel, notes: choice.notes, dayOfWeek: slot.dayOfWeek, timeSlot: slot.timeSlot, addedAt: nowSec }, nowSec)
  await resolveAsk(db, adj, nowSec, { option: answer.option ?? 0, id: choice.id, slot })
  return { ok: true, body: { adjustment: { ...adj, status: 'accepted' }, session: created, resolution: { ...choice, slot } } }
}

async function acceptTmUpdate(db: DB, adj: AdjustmentRow, answer: AskAnswer, nowSec: number): Promise<AskResult> {
  const source = parseJson<{ lifts?: TmProposalLift[] }>(adj.sourceData, {})
  const lifts = source.lifts ?? []
  if (lifts.length === 0) return { ok: false, status: 400, body: { error: 'Nothing to approve.' } }
  const writes = tmAcceptValues(lifts, answer.values)
  const current = new Map((await db.select().from(trainingMaxes)).map(t => [t.exerciseId, t.weightKg]))
  const applied: Array<{ exerciseId: string; fromKg: number | null; toKg: number; clamped: boolean }> = []
  for (const w of writes) {
    await db.update(trainingMaxes).set({ weightKg: w.weightKg, updatedAt: nowSec }).where(eq(trainingMaxes.exerciseId, w.exerciseId))
    applied.push({ exerciseId: w.exerciseId, fromKg: current.get(w.exerciseId) ?? null, toKg: w.weightKg, clamped: w.clamped })
  }
  await resolveAsk(db, adj, nowSec, { option: 0, id: 'approve', applied })
  return { ok: true, body: { adjustment: { ...adj, status: 'accepted' }, applied } }
}

/** Accept one of the adaptive coach's asks. Null when the ask kind is not one of these. */
export async function acceptCoachAsk(db: DB, adj: AdjustmentRow, answer: AskAnswer, todayDay: number, nowSec: number): Promise<AskResult | null> {
  switch (adj.adjustmentType) {
    case 'ramp_up': return acceptRampUp(db, adj, answer, todayDay, nowSec)
    case 'make_regular': return acceptMakeRegular(db, adj, answer, todayDay, nowSec)
    case 'tm_update': return acceptTmUpdate(db, adj, answer, nowSec)
    default: return null
  }
}

/** Latest proposals and their full reasoning, newest first (for the coach screens). */
export async function openAsks(db: DB, nowSec: number) {
  const rows = await db.select().from(weekAdjustments).where(eq(weekAdjustments.status, 'proposed')).orderBy(desc(weekAdjustments.createdAt))
  return rows.filter(r => r.expiresAt == null || r.expiresAt > nowSec)
}

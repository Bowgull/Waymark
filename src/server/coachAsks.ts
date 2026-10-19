// The coach's own changes beyond the rebalance (adaptive coach, plan §2-§6),
// applied, never asked (page 56, approved 2026-10-19: "the coach never asks,
// even for big changes"). Each one is a change record with its rune and
// UNDO until the session starts (server/changes.ts):
//   felt_hard     how a session felt: the next similar one eases (coach/feltHard)
//   ramp_up       a fresh streak: one push this week, at most (coach/rampUp)
//   make_regular  a session added 2+ weeks running joins the plan (coach/makeRegular)
//   tm            new training maxes at a Fighter wave end (coach/tm)
// Rules stay pure in lib/coach; this file loads rows and applies the result.

import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { coachingOutputs, dailyLogs, exercises, sessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, weekAdjustments, weekPlans } from '../db/schema'
import type { createDB } from '../db/client'
import {
  applyContext,
  blockZeroEffortTarget,
  coachEaseFrom,
  easeFor,
  feltHardEase,
  fighterTmDecision,
  inLeadIn,
  makeRegularAsk,
  makeRegularCandidates,
  mondayOf,
  nameToken,
  noEasierReadFor,
  rampUpAsk,
  sessionName,
  slotStart,
  summarizeEffort,
  tmProposal,
  withCoachEase,
  MAKE_REGULAR_COOLDOWN_DAYS,
  type AddedSession,
  type BlockWorkingSet,
  type EffortRead,
  type TmDecision,
} from '../lib/coach'
import { checkInFromDailyLog, evaluateReadiness, liftRegion } from '../lib/blockZero'
import { getStrengthTemplate, getWeekPercentage } from '../lib/strengthTemplates'
import { loadLiftTrends } from '../lib/athleteState/liftTrends'
import { isLoggedWorkSet } from '../lib/loggedSets'
import { kgToLbs } from '../lib/units'
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
import { loadHeld, pmStart, recordChanges, snap } from './changes'

type DB = ReturnType<typeof createDB>
type Block = typeof trainingBlocks.$inferSelect

const DAY_SEC = 86400
const HOLD_LINE = 'The coach leaves it as you set it this week.'

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/** The week plan rows for a day's calendar week (created when missing). */
export async function weekPlanForDay(db: DB, block: Block, day: number, todayDay: number, nowSec: number): Promise<string> {
  const tw = await trainingWeekFor(db, block, day, todayDay)
  return (await resolveWeekPlan(db, block.id, weekStamps(block, tw).weekNumber, mondayOf(day), nowSec)) as string
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

// ─── How a session felt -> ease the next similar one ─────────

/**
 * For sessions done in the last 2 days: way harder than target, or soreness
 * 4+ on the next morning's check-in, eases the next similar planned session.
 * Idempotent: one ease per source session. Held sessions are left alone.
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
  const held = new Set([...(await loadHeld(db, todayDay)), ...(await loadHeld(db, todayDay + 7))])
  const upcomingRows = (await db.select().from(sessions)
    .where(and(eq(sessions.status, 'planned'), gte(sessions.scheduledDate, todayDay), lte(sessions.scheduledDate, todayDay + 8))))
    .filter(r => !held.has(r.id))
  const upcoming = upcomingRows.filter(r => r.scheduledDate != null).map(r => ({ ...toSessionLike(r), id: r.id, eased: coachEaseFrom(r.contextJson) != null }))
  const pm = await pmStart(db)
  const kind = blockKind(block.blockType)
  let n = 0
  for (const d of done) {
    if (handled.has(d.id)) continue
    const result = feltHardEase({ done: d, nextMorningSoreness: soreBy.get(d.epochDay + 1) ?? null, upcoming, todayEpochDay: todayDay, nowSec })
    if (!result) continue
    const target = upcomingRows.find(r => r.id === result.targetSessionId)
    if (!target || target.scheduledDate == null) continue
    const week = (await trainingWeekFor(db, block, target.scheduledDate, todayDay)).week
    const words = easeFor({ ...toSessionLike(target), id: target.id }, { blockType: kind, weekNumber: week })
    const before = snap(target, [], ['coachEase'])
    const ctxJson = withCoachEase(target.contextJson, result.ease)
    await db.update(sessions).set({ contextJson: ctxJson }).where(eq(sessions.id, target.id))
    const u = upcoming.find(x => x.id === target.id)
    if (u) u.eased = true
    const name = sessionName(toSessionLike(target))
    const walk = result.ease.kind === 'run_to_walk'
    await recordChanges(db, [{
      setId: crypto.randomUUID(), actor: 'coach', kind: 'ease', targetSessionId: target.id, sessionType: target.type,
      adjustmentType: 'felt_hard',
      before: { show: walk ? name.toUpperCase() : words?.show.before ?? 'AS PLANNED', ...(words?.show.logBefore ? { logShow: words.show.logBefore } : {}), day: target.scheduledDate, sessions: [before] },
      after: { show: walk ? 'EASY WALK' : words?.show.after ?? 'EASIER', day: target.scheduledDate, sessions: [snap({ ...target, contextJson: ctxJson }, [], ['coachEase'])], put: { line: `${nameToken(name, target.scheduledDate)} is back as planned.`, dim: HOLD_LINE } },
      why: result.ease.reason,
      detail: walk ? 'An easy walk or bike instead.' : target.type === 'strength' ? 'One set less, about 10% lighter.' : null,
      undoUntil: slotStart(target.scheduledDate, target.timeSlot, pm),
      extraSource: { fromSessionId: result.fromSessionId, cause: result.cause, rpe: d.rpe, rir: d.rir, soreness: soreBy.get(d.epochDay + 1) ?? null },
    }], nowSec)
    n++
  }
  return n
}

// ─── Ramp-up: one push a week, applied ──────────────────────

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

export interface CoachPush {
  kind: 'extra_set' | 'load_step'
  factor?: number
  reason: string
  at: number
}

/** Read a push back from a session's context_json. */
export function coachPushFrom(contextJson: string | null | undefined): CoachPush | null {
  const p = parseJson<{ coachPush?: CoachPush }>(contextJson, {}).coachPush
  if (!p || (p.kind !== 'extra_set' && p.kind !== 'load_step') || typeof p.reason !== 'string') return null
  return p
}

/**
 * The ramp-up rule for today: at most one push a calendar week, applied with
 * its rune and UNDO (page 56: the coach never asks). Returns the change id.
 */
export async function maybeRampUp(db: DB, todayDay: number, nowSec: number): Promise<string | null> {
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
  const held = await loadHeld(db, todayDay)
  const upcomingRows = (await db.select().from(sessions)
    .where(and(eq(sessions.status, 'planned'), gte(sessions.scheduledDate, todayDay), lte(sessions.scheduledDate, monday + 6))))
    .filter(r => !held.has(r.id))
  const upcoming = upcomingRows.filter(r => r.scheduledDate != null).map(r => ({ ...toSessionLike(r), id: r.id }))
  const nextStrength = upcomingRows.filter(r => r.type === 'strength').sort((a, b) => (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0))[0]
  const mainLifts = kind === 'fighter' && nextStrength ? (await mainLiftLoads(db, nextStrength)).map(l => ({ ...l, name: shortLiftName(l.name) })) : []
  const strengthPlan = nextStrength ? await nextStrengthPlan(db, nextStrength, kind) : null
  const signals = { todayEpochDay: todayDay, readiness, effort, liftPush, easeToday, noPush: ret.active || ret.noPush || injury != null, askedThisWeek: already != null }
  const ask = rampUpAsk(signals, { ctx, upcoming, blockType: kind, weekNumber: ctx.weekNumber, liftPush, classDays: await mtClassDays(db), mainLifts, nextStrength: strengthPlan })
  if (!ask) return null
  const choice = ask.defaultOption
  const pm = await pmStart(db)
  const setId = crypto.randomUUID()
  const why = `${ask.why} ${choice.title.charAt(0)}${choice.title.slice(1).toLowerCase()}: ${choice.detail}.`.replace(/\.\./g, '.')
  if (choice.kind === 'add') {
    const tw = await trainingWeekFor(db, block, choice.epochDay, todayDay)
    const stamps = weekStamps(block, tw)
    const id = crypto.randomUUID()
    await db.insert(sessions).values({
      id, type: choice.type, label: choice.sessionLabel,
      weekPlanId: await resolveWeekPlan(db, block.id, stamps.weekNumber, mondayOf(choice.epochDay), nowSec),
      scheduledDate: choice.epochDay, timeSlot: choice.timeSlot,
      blockWeek: choice.type === 'strength' ? stamps.strengthWeek : null, blockType: block.blockType,
      status: 'planned', notes: choice.type === 'running' ? choice.notes ?? null : null, source: 'coach',
      contextJson: JSON.stringify({ coachNote: { reason: why, at: nowSec, source: 'ramp_up' } }), createdAt: nowSec,
    })
    const [ids] = await recordChanges(db, [{
      setId, actor: 'coach', kind: 'push', targetSessionId: id, sessionType: choice.type, adjustmentType: 'ramp_up',
      before: { show: 'AS PLANNED', day: choice.epochDay, sessions: [] },
      after: { show: `+ ${choice.title}`, day: choice.epochDay, sessions: [], created: [id], put: { line: 'The week is back as planned.', dim: HOLD_LINE } },
      why, detail: null, undoUntil: slotStart(choice.epochDay, choice.timeSlot, pm),
    }], nowSec)
    return ids ?? null
  }
  const target = upcomingRows.find(r => r.id === choice.sessionId)
  if (!target || target.scheduledDate == null || coachEaseFrom(target.contextJson)) return null
  const push: CoachPush = { kind: choice.kind, ...(choice.kind === 'load_step' ? { factor: choice.factor } : {}), reason: why, at: nowSec }
  const before = snap(target, [], ['coachPush'])
  const ctxJson = applyContext(target.contextJson, { coachPush: push })
  await db.update(sessions).set({ contextJson: ctxJson }).where(eq(sessions.id, target.id))
  const name = sessionName(toSessionLike(target))
  const [id] = await recordChanges(db, [{
    setId, actor: 'coach', kind: 'push', targetSessionId: target.id, sessionType: target.type, adjustmentType: 'ramp_up',
    before: { show: 'AS PLANNED', day: target.scheduledDate, sessions: [before] },
    after: { show: choice.title, day: target.scheduledDate, sessions: [snap({ ...target, contextJson: ctxJson }, [], ['coachPush'])], put: { line: `${nameToken(name, target.scheduledDate)} is back as planned.`, dim: HOLD_LINE } },
    why, detail: choice.kind === 'load_step' ? choice.lifts.map(l => `${shortLiftName(l.name)} ${kgToLbs(l.toKg)}, not ${kgToLbs(l.fromKg)}`).join('. ') + '.' : null,
    undoUntil: slotStart(target.scheduledDate, target.timeSlot, pm),
  }], nowSec)
  return id ?? null
}

// ─── Added sessions -> made part of the plan, applied ────────

/**
 * Types added (and done well) 2+ weeks running join the plan at their usual
 * slot from next week, with a rune and UNDO (one per pass; a type made
 * regular or undone in the last 4 weeks is left alone).
 */
export async function maybeMakeRegular(db: DB, block: Block, nextMonday: number, todayDay: number, nowSec: number): Promise<string | null> {
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
  const done = new Set(recent.map(r => r.sessionType))
  const ctx = await loadPlacementContext(db, nextMonday, todayDay)
  const weekNo = new Map<number, number>()
  for (const c of candidates) for (const m of c.mondays) if (!weekNo.has(m)) weekNo.set(m, (await trainingWeekFor(db, block, m, todayDay)).week)
  const pm = await pmStart(db)
  for (const c of candidates) {
    if (done.has(c.type)) continue
    const ask = makeRegularAsk(c, ctx, nextMonday, m => weekNo.get(m) ?? null)
    const choice = ask?.defaultOption
    if (!ask || !choice || choice.kind !== 'make_regular' || choice.id !== 'usual') continue
    const slot = choice.slot
    const first = slot.epochDay >= todayDay ? slot.epochDay : mondayOf(todayDay) + 7 + ((slot.dayOfWeek + 6) % 7)
    const tw = await trainingWeekFor(db, block, first, todayDay)
    const stamps = weekStamps(block, tw)
    const id = crypto.randomUUID()
    const why = `${ask.why} ${choice.label}, from ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][slot.dayOfWeek]}.`
    await db.insert(sessions).values({
      id, type: choice.type, label: choice.sessionLabel,
      weekPlanId: await resolveWeekPlan(db, block.id, stamps.weekNumber, mondayOf(first), nowSec),
      scheduledDate: first, timeSlot: slot.timeSlot,
      blockWeek: choice.type === 'strength' ? stamps.strengthWeek : null, blockType: block.blockType,
      status: 'planned', notes: choice.type === 'running' ? choice.notes : null, source: 'coach',
      contextJson: JSON.stringify({ coachNote: { reason: why, at: nowSec, source: 'make_regular' } }), createdAt: nowSec,
    })
    const extra = { blockId: block.id, type: choice.type, dayOfWeek: slot.dayOfWeek, timeSlot: slot.timeSlot }
    await addTemplateExtra(db, { ...extra, label: choice.sessionLabel, notes: choice.notes, addedAt: nowSec }, nowSec)
    const [changeId] = await recordChanges(db, [{
      setId: crypto.randomUUID(), actor: 'coach', kind: 'make_regular', targetSessionId: id, sessionType: choice.type, adjustmentType: 'make_regular',
      before: { show: 'ADDED BY YOU', day: first, sessions: [], effects: [{ kind: 'template_extra', extra, present: false }] },
      after: { show: choice.title, day: first, sessions: [], created: [id], effects: [{ kind: 'template_extra', extra, present: true }], put: { line: 'Not part of the plan. Add it yourself when you want it.', dim: 'The coach leaves it out this week.' } },
      why, detail: null, undoUntil: slotStart(first, slot.timeSlot, pm),
    }], nowSec)
    return changeId ?? null
  }
  return null
}

// ─── Training maxes at a wave end, applied ──────────────────

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

export interface TmUpdateResult {
  changeId: string | null
  decisions: TmDecision[]
  idempotent: boolean
}

/**
 * New training maxes for a Fighter block, once per block and training week
 * (coaching_outputs kind 'tm_progression'), applied with a rune and UNDO
 * until the next strength session starts. Lifts move only within the rules.
 */
export async function applyTmUpdate(db: DB, block: Block, todayDay: number, nowSec: number): Promise<TmUpdateResult> {
  const week = (await trainingWeekFor(db, block, todayDay, todayDay)).week
  const key = `${block.id}:w${week}`
  const [done] = await db.select().from(coachingOutputs)
    .where(and(eq(coachingOutputs.kind, 'tm_progression'), eq(coachingOutputs.inputHash, key)))
  if (done) {
    const stored = parseJson<{ changeId?: string | null; decisions?: TmDecision[] }>(done.outputJson, {})
    return { changeId: stored.changeId ?? null, decisions: stored.decisions ?? [], idempotent: true }
  }
  const { decisions, names } = await computeFighterTmDecisions(db, block)
  const proposal = tmProposal(decisions, names)
  let changeId: string | null = null
  if (proposal) {
    for (const l of proposal.lifts) await db.update(trainingMaxes).set({ weightKg: l.proposedKg, updatedAt: nowSec }).where(eq(trainingMaxes.exerciseId, l.exerciseId))
    const next = (await db.select().from(sessions).where(and(eq(sessions.type, 'strength'), eq(sessions.status, 'planned'), gte(sessions.scheduledDate, todayDay))))
      .sort((a, b) => (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0))[0]
    const day = next?.scheduledDate ?? todayDay
    const lifts = proposal.lifts.map(l => `${shortLiftName(l.name)} ${kgToLbs(l.proposedKg)}, not ${kgToLbs(l.currentKg)}`).join('. ')
    const [id] = await recordChanges(db, [{
      setId: crypto.randomUUID(), actor: 'coach', kind: 'tm', targetSessionId: next?.id ?? null, sessionType: 'strength', adjustmentType: 'tm_update',
      before: { show: 'OLD MAXES', day, sessions: [], effects: [{ kind: 'tm', lifts: proposal.lifts.map(l => ({ exerciseId: l.exerciseId, kg: l.currentKg })) }] },
      after: { show: 'NEW MAXES', day, sessions: [], ...(next ? { watch: [next.id] } : {}), effects: [{ kind: 'tm', lifts: proposal.lifts.map(l => ({ exerciseId: l.exerciseId, kg: l.proposedKg })) }], put: { line: 'Your maxes are as they were.', dim: 'The coach leaves them this block.' } },
      why: `The wave is done and these lifts moved cleanly. New maxes: ${lifts}.`,
      detail: proposal.holds.length > 0 ? `${proposal.holds.map(h => h.name).join(', ')} hold: ${proposal.holds[0].reason}` : null,
      undoUntil: next ? slotStart(day, next.timeSlot, await pmStart(db)) : null,
    }], nowSec)
    changeId = id ?? null
  }
  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'tm_progression',
    model: 'rules',
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: key,
    outputJson: JSON.stringify({ changeId, decisions, week }),
    tokensIn: 0,
    tokensOut: 0,
    cachedTokensIn: 0,
    createdAt: nowSec,
  })
  return { changeId, decisions, idempotent: false }
}

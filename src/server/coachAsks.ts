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
  blockZeroEffortTarget,
  fighterTmDecision,
  inLeadIn,
  makeRegularAsk,
  makeRegularCandidates,
  mondayOf,
  noEasierReadFor,
  slotStart,
  tmProposal,
  MAKE_REGULAR_COOLDOWN_DAYS,
  type AddedSession,
  type BlockWorkingSet,
  type EffortRead,
  type TmDecision,
} from '../lib/coach'
import { checkInFromDailyLog, evaluateReadiness, liftRegion } from '../lib/blockZero'
import { isLoggedWorkSet } from '../lib/loggedSets'
import { kgToLbs } from '../lib/units'
import { getActiveBlock,} from './blockZeroData'
import {
  addTemplateExtra,
  blockStartDay,
  loadPlacementContext,
  resolveWeekPlan,
  trainingWeekFor,
  weekStamps,
} from './coachData'
import {  pmStart, recordChanges,} from './changes'

type DB = ReturnType<typeof createDB>
type Block = typeof trainingBlocks.$inferSelect

const DAY_SEC = 86400

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

/** A lift name short enough for a flap ("RDL"). */
export function shortLiftName(name: string): string {
  const n = name.trim()
  if (/romanian deadlift/i.test(n)) return 'RDL'
  if (/^front squat$/i.test(n)) return 'Front squat'
  return n
}

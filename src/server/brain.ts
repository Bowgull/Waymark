// Coach brain P2 on the server (coach-brain.md §3 steps 1, 2 and 4 without the
// AI; §5.1 timing; §13.2): the rules-only brain.
//
// - doseFor: today's dose for one session, from the athlete model and its
//   uncertainty, under the readiness ceiling (lib/brain/doses.ts). Stored on
//   the session (sessions.dose_json) and read back by every start route and
//   preview, so what Today shows is what starts. One computation for every
//   kind of session; no multiplying factors.
// - runBrainNight: the NIGHTLY re-plan, the only one. Skipped when nothing
//   was logged and the app wasn't opened in the last 2 days. It makes sure
//   the week's sessions exist (one creation path, coachData.generateDaySessions),
//   solves the rest of the week (lib/brain/outline.ts: at most 2 changes, each
//   a change row with its rune and UNDO), then writes the doses.
// - capToday: the morning check-in can only CAP today's dose (AMBER or RED,
//   rules only, never another day). A cap that changes what he sees is a
//   change row with UNDO; UNDO holds the session for the week.
// His own changes (add, replace, skip, move) apply at once; this night's pass
// absorbs them.

import { and, desc, eq, gte, inArray, isNull, lt, lte } from 'drizzle-orm'
import { bodyAlerts, dailyLogs, exercises, runSessions, sessions, settings, trainingMaxes, userProfile, type sessions as SessionsTable } from '../db/schema'
import type { createDB } from '../db/client'
import { buildAthleteModel, modelSummary } from '../lib/brain/athleteModel'
import { bagDose, runDose, strengthDose, tweakBag, tweakRun, tweakStrength, CEILING, LEVELS, levelAbove, type BagDose, type DoseCtx, type Level, type RunDose, type StrengthDose, type Tweak } from '../lib/brain/doses'
import { score as outlineScore, solveOutline, violations as outlineViolations, type OutlineChange, type OutlineIn, type OutlineSession } from '../lib/brain/outline'
import { athleteSignals } from '../lib/brain/signals'
import { arbitrate, DAILY_CALL_CAP, DAY_KEYS, doseWords, MAX_WEEK_ACTIONS, packetFacts, rulesDecision, type AiWeekAction, type Candidate, type DecisionPacket, type FinalDecision, type SolverChange, type TweakRange, type WeekScorer, type WeekSession } from '../lib/brain/decision'
import { callDecision, existingDecision, inputHash, loadRecentNotes, overCap, spendToday, storeDecision, type CallOutcome } from './coachDecision'
import { lowerState, readinessState, STATE_RANK, type ReadinessState } from '../lib/brain/readiness'
import type { AthleteModel, ModelCheckIn, ModelEvents } from '../lib/brain/types'
import { KEY_TYPES } from '../lib/keyTypes'
import { getRunWalkWeek, type WeeklyRunContext } from '../lib/blockZero'
import { applyContext, coachEaseFrom, injuryActionFor, isoOf, mondayOf, runAllowanceBaseSec, slotStart, withMergedLifts, type InjuryFlag } from '../lib/coach'
import { getStrengthTemplate, getWaveLoadingSetsReps, getWeekPercentage } from '../lib/strengthTemplates'
import { loadEquipment, type LoadEquipment } from '../lib/strengthLoads'
import { loadEasyHrCeiling } from '../lib/hrAnalysis'
import { RUNNING_PLAN_TEMPLATE, ZONE2_PRESCRIPTION } from '../lib/runningPlanTemplate'
import { getActiveBlock } from './blockZeroData'
import { blockKind, blockStartDay, bodyPlanMark, dayHasPlan, generateDaySessions, loadInjuryFlag, resolveWeekPlan, trainingWeekFor, weekStamps } from './coachData'
import { loadModelEvents, modelFromDay } from './athleteModel'
import { emptyState, loadHeld, loadWeekChanges, pmStart, recordChanges, snap, type NewChange } from './changes'

type DB = ReturnType<typeof createDB>
type SessionRow = typeof SessionsTable.$inferSelect

export const DOSE_VERSION = 1

/** What dose_json holds. */
export interface StoredDose {
  v: number
  sessionId: string
  day: number
  type: string
  /** The inputs the dose depends on beyond the model: recomputed when any changes. */
  stamp: string
  state: ReadinessState
  stateWhy: string | null
  level: Level
  strength?: StrengthDose
  run?: RunDose
  bag?: BagDose
  /** The model as the rules read it (the replay and P3 read this). */
  facts: { u: number | null; modelState: string | null }
  why: string[]
  at: number
  /** The night's decision for this day (coach brain P3): its level, tweak and why. */
  decision?: DoseDecision
}

/** What the nightly decision chose for a session today (coach_decisions row id). */
export interface DoseDecision {
  id: string | null
  day: number
  level: Level
  tweak: Tweak
  why: string | null
  from: 'ai' | 'rules'
}

/** A morning cap on a session (context_json.brainCap): the check-in's state. UNDO removes it. */
export interface BrainCap { state: ReadinessState; why: string | null; at: number }

export function brainCapFrom(contextJson: string | null | undefined): BrainCap | null {
  if (!contextJson) return null
  try {
    const c = (JSON.parse(contextJson) as { brainCap?: BrainCap }).brainCap
    return c && typeof c.state === 'string' ? c : null
  } catch { return null }
}

export function parseDose(json: string | null | undefined): StoredDose | null {
  if (!json) return null
  try {
    const d = JSON.parse(json) as StoredDose
    return d && d.v === DOSE_VERSION ? d : null
  } catch { return null }
}

// ─── Inputs (step 1: the facts) ──────────────────────────────

export interface BrainInputs {
  today: number
  model: AthleteModel
  events: ModelEvents
  checkIns: ModelCheckIn[]
  notesByDay: Map<number, string>
  sickDays: Set<number>
  backByDay: Map<number, number | null>
  openPlans: Array<{ region: string }>
  tmKg: Record<string, number>
  equipment: Record<string, LoadEquipment>
}

export async function loadBrainInputs(db: DB, today: number): Promise<BrainInputs> {
  const fromDay = await modelFromDay(db, today)
  const events = await loadModelEvents(db, Math.min(fromDay, today), today)
  const model = buildAthleteModel(events, today, { fromDay: Math.min(fromDay, today) })
  // Check-ins for readiness: the 40 days before, whatever the block (the baseline is his).
  const logs = await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, today - 40), lte(dailyLogs.logDate, today + 7)))
  const checkIns: ModelCheckIn[] = logs.map(l => ({ day: l.logDate, sleepHours: l.sleepHours, sleepQuality: l.sleepQuality, energy: l.energy, soreness: l.soreness, stress: l.stress, mood: l.mood, backToday: l.backToday }))
  const sick = await db.select({ day: sessions.scheduledDate, reason: sessions.skipReason }).from(sessions)
    .where(and(eq(sessions.status, 'skipped'), gte(sessions.scheduledDate, today - 2), lte(sessions.scheduledDate, today + 7)))
  const alerts = await db.select({ region: bodyAlerts.region, appliedOn: bodyAlerts.appliedOn }).from(bodyAlerts).where(isNull(bodyAlerts.clearedAt))
  const tms = await db.select().from(trainingMaxes)
  const exRows = await db.select({ id: exercises.id, equipment: exercises.equipment }).from(exercises)
  return {
    today,
    model,
    events,
    checkIns,
    notesByDay: new Map(logs.filter(l => l.notes).map(l => [l.logDate, l.notes as string])),
    sickDays: new Set(sick.filter(s => s.day != null && (s.reason === 'sick' || s.reason === 'illness')).map(s => s.day as number)),
    backByDay: new Map(logs.map(l => [l.logDate, l.backToday])),
    openPlans: alerts.filter(a => a.appliedOn != null).map(a => ({ region: a.region })),
    tmKg: Object.fromEntries(tms.map(t => [t.exerciseId, t.weightKg])),
    equipment: Object.fromEntries(exRows.map(e => [e.id, loadEquipment(e.equipment)])),
  }
}

/**
 * The night's ceiling for `day`: yesterday's state (FRESH may push; AMBER or
 * RED yesterday is AMBER today until the morning says otherwise). Days ahead
 * are GREEN.
 */
export function nightState(inp: BrainInputs, day: number): { state: ReadinessState; why: string | null } {
  if (day > inp.today) return { state: 'GREEN', why: null }
  const opts = (d: number) => ({ sickSkip: inp.sickDays.has(d) || inp.sickDays.has(d - 1), notes: inp.notesByDay.get(d) ?? null })
  const y = readinessState(inp.checkIns, day - 1, opts(day - 1))
  if (!y.checkedIn) return { state: y.state === 'AMBER' ? 'AMBER' : 'GREEN', why: y.why }
  return { state: y.state === 'RED' ? 'AMBER' : y.state, why: y.why }
}

/** The morning's own read for `day`, when he has checked in. */
export function morningState(inp: BrainInputs, day: number): { state: ReadinessState; why: string | null } | null {
  const r = readinessState(inp.checkIns, day, { sickSkip: inp.sickDays.has(day), notes: inp.notesByDay.get(day) ?? null })
  return r.checkedIn || inp.sickDays.has(day) ? { state: r.state, why: r.why } : null
}

// ─── One session's dose (step 2: options, limits, the rules' pick) ─

/** Main lifts as the template (plus any missed session's merged lifts) has them. */
function templateFor(s: Pick<SessionRow, 'scheduledDate' | 'blockWeek' | 'blockType' | 'label' | 'contextJson'>) {
  const day = s.scheduledDate ?? 0
  const kind = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
  const week = s.blockWeek ?? 1
  return withMergedLifts(getStrengthTemplate(new Date(day * 86400000).getUTCDay(), week, kind, s.label), s.contextJson, week, kind)
}

/** Run guards (R7 single run, R8 weekly), relative to a session's day; the session itself left out. */
export async function loadRunGuardInputs(db: DB, sessionId: string | null, weekPlanId: string | null, epochDay: number): Promise<{ longestLast30Sec: number; weekly: WeeklyRunContext }> {
  const monday = mondayOf(epochDay)
  const historyStart = Math.min(epochDay - 30, monday - 14)
  const done = await db
    .select({ sessionId: sessions.id, scheduledDate: sessions.scheduledDate, durationSec: runSessions.durationSec })
    .from(runSessions)
    .innerJoin(sessions, eq(runSessions.sessionId, sessions.id))
    .where(and(eq(sessions.status, 'completed'), gte(sessions.scheduledDate, historyStart), lte(sessions.scheduledDate, monday + 6)))
  const others = done.filter(r => r.sessionId !== sessionId && r.scheduledDate != null)
  const longestLast30Sec = others.filter(r => r.scheduledDate! >= epochDay - 30 && r.scheduledDate! <= epochDay).reduce((m, r) => Math.max(m, r.durationSec ?? 0), 0)
  const weekSec = (from: number) => others.filter(r => r.scheduledDate! >= from && r.scheduledDate! < from + 7).reduce((sum, r) => sum + (r.durationSec ?? 0), 0)
  const lastWeekRunSec = runAllowanceBaseSec(weekSec(monday - 7), weekSec(monday - 14))
  const thisWeekSoFarSec = others.filter(r => r.scheduledDate! >= monday && r.scheduledDate! <= monday + 6).reduce((sum, r) => sum + (r.durationSec ?? 0), 0)
  const upcoming = await db.select({ id: sessions.id, type: sessions.type, status: sessions.status, weekPlanId: sessions.weekPlanId })
    .from(sessions).where(and(gte(sessions.scheduledDate, epochDay), lte(sessions.scheduledDate, monday + 6)))
  const laterRuns = upcoming.filter(s => s.id !== sessionId && (weekPlanId == null || s.weekPlanId === weekPlanId) && (s.type === 'foundation_run' || s.type === 'running') && (s.status === 'planned' || s.status === 'in_progress'))
  return { longestLast30Sec, weekly: { lastWeekRunSec, thisWeekSoFarSec, sessionsLeftThisWeek: laterRuns.length + 1 } }
}

/** Earlier run doses: the last one's running seconds and whether a run already went up this calendar week. */
async function runDoseHistory(db: DB, s: Pick<SessionRow, 'id' | 'scheduledDate'>): Promise<{ lastRunSec: number | null; riseThisWeek: boolean }> {
  const day = s.scheduledDate ?? 0
  const rows = await db.select({ id: sessions.id, day: sessions.scheduledDate, doseJson: sessions.doseJson, status: sessions.status }).from(sessions)
    .where(and(inArray(sessions.type, ['foundation_run', 'running']), gte(sessions.scheduledDate, day - 21), lt(sessions.scheduledDate, day)))
  const doses = rows.filter(r => r.id !== s.id && (r.status === 'completed' || r.status === 'in_progress'))
    .map(r => ({ day: r.day as number, sec: parseDose(r.doseJson)?.run?.runTotalSec ?? null }))
    .filter((r): r is { day: number; sec: number } => r.sec != null)
    .sort((a, b) => a.day - b.day)
  const last = doses[doses.length - 1] ?? null
  const monday = mondayOf(day)
  let rise = false
  for (let i = 1; i < doses.length; i++) if (doses[i].day >= monday && doses[i].sec > doses[i - 1].sec) rise = true
  return { lastRunSec: last?.sec ?? null, riseThisWeek: rise }
}

/** Strength sessions this week (before this one) that stepped a lift up. */
async function steppedThisWeek(db: DB, s: Pick<SessionRow, 'id' | 'scheduledDate'>): Promise<string[]> {
  const day = s.scheduledDate ?? 0
  const rows = await db.select({ id: sessions.id, doseJson: sessions.doseJson, status: sessions.status }).from(sessions)
    .where(and(eq(sessions.type, 'strength'), gte(sessions.scheduledDate, mondayOf(day)), lt(sessions.scheduledDate, day)))
  return rows.filter(r => r.id !== s.id && r.status !== 'skipped' && r.status !== 'missed')
    .flatMap(r => (parseDose(r.doseJson)?.strength?.lifts ?? []).filter(l => l.change === 'increase').map(l => l.exerciseId))
}

/** The last similar session felt 2+ over its target (RPE 9+), or the next morning was sore (4+). */
async function lastFeltHard(db: DB, s: Pick<SessionRow, 'id' | 'type' | 'scheduledDate'>, inp: BrainInputs): Promise<string | null> {
  const day = s.scheduledDate ?? 0
  const rows = await db.select({ id: sessions.id, day: sessions.scheduledDate, rpe: sessions.rpe }).from(sessions)
    .where(and(eq(sessions.type, s.type), eq(sessions.status, 'completed'), gte(sessions.scheduledDate, day - 10), lt(sessions.scheduledDate, day)))
  const last = rows.filter(r => r.id !== s.id && r.day != null).sort((a, b) => (b.day as number) - (a.day as number))[0]
  if (!last) return null
  const target = s.type === 'strength' ? 7 : 5
  if (last.rpe != null && last.rpe >= target + 2) return `Last time felt like a ${last.rpe}.`
  const next = inp.checkIns.find(c => c.day === (last.day as number) + 1)
  if (next?.soreness != null && next.soreness >= 4) return `Soreness ${next.soreness} the morning after last time.`
  return null
}

function injuryFrom(s: Pick<SessionRow, 'type' | 'contextJson'>, flag: InjuryFlag | null) {
  const a = injuryActionFor(s.type, flag)
  // A raven plan's one-set ease on this session (bodyWatch writes it as coachEase, source injury).
  const raven = coachEaseFrom(s.contextJson)
  return { action: a, ravenOneSet: raven?.source === 'injury' && raven.kind === 'one_set' ? raven.reason : null }
}

/**
 * Compute a session's dose now. Null for sessions with no dose to set
 * (Foundation, Reset, a class: a class is a fixed hour the gym runs).
 */
export interface ComputeOpts {
  /** The decision to apply (null: none; omitted: the one stored on the session for its day). */
  decision?: DoseDecision | null
  /** A level cap without a decision (the candidates the rules offer). */
  levelCap?: Level | null
}

/** The decision stored on a session for its own day, if any. */
export function storedDecision(s: Pick<SessionRow, 'doseJson' | 'scheduledDate'>): DoseDecision | null {
  const d = parseDose(s.doseJson)?.decision
  return d && d.day === s.scheduledDate ? d : null
}

export async function computeDose(db: DB, s: SessionRow, today: number, inp?: BrainInputs, opts: ComputeOpts = {}): Promise<StoredDose | null> {
  const inputs = inp ?? await loadBrainInputs(db, today)
  const dose = await computeRulesDose(db, s, today, inputs, opts)
  if (!dose) return null
  const dec = opts.decision !== undefined ? opts.decision : storedDecision(s)
  if (!dec) return dose
  // A rough morning that lowered the ceiling under the decision's level: its own why leads.
  const cap = brainCapFrom(s.contextJson)
  const capLowered = cap != null && levelAbove(dec.level, CEILING[cap.state]) && STATE_RANK[cap.state] < STATE_RANK[nightState(inputs, s.scheduledDate ?? today).state]
  return withDecision(dose, dec, inputs, capLowered)
}

/** The decision's tweak and why on a dose already capped at its level. */
function withDecision(d: StoredDose, dec: DoseDecision, inp: BrainInputs, capLowered: boolean): StoredDose {
  const out: StoredDose = { ...d, decision: dec }
  if (out.strength) out.strength = tweakStrength(out.strength, dec.tweak, inp.equipment)
  if (out.run) out.run = tweakRun(out.run, dec.tweak)
  if (out.bag) out.bag = tweakBag(out.bag, dec.tweak)
  out.level = out.strength?.level ?? out.run?.level ?? out.bag?.level ?? out.level
  if (dec.from === 'ai' && dec.why && !capLowered) out.why = [dec.why]
  return out
}

async function computeRulesDose(db: DB, s: SessionRow, today: number, inp: BrainInputs | undefined, opts: ComputeOpts): Promise<StoredDose | null> {
  if (!KEY_TYPES.has(s.type) || s.type === 'mt_class' || s.type === 'skip_rope') return null
  const day = s.scheduledDate ?? today
  const inputs = inp ?? await loadBrainInputs(db, today)
  const night = nightState(inputs, day)
  const cap = brainCapFrom(s.contextJson)
  const effective = cap && STATE_RANK[cap.state] < STATE_RANK[night.state] ? { state: cap.state, why: cap.why } : night
  const dec = opts.decision !== undefined ? opts.decision : storedDecision(s)
  const levelCap = opts.levelCap ?? dec?.level ?? null
  const flag = await loadInjuryFlag(db, day)
  const inj = injuryFrom(s, flag)
  const backToday = inj.action.action === 'back_swap' ? 1 : (inputs.backByDay.get(day) ?? null)
  const plan = bodyPlanMark(s.contextJson)
  const ctx: DoseCtx = { day, state: effective.state, stateWhy: effective.why, model: inputs.model, backToday: plan?.op === 'back' ? 1 : backToday, openPlans: inputs.openPlans, levelCap }
  const base = {
    v: DOSE_VERSION, sessionId: s.id, day, type: s.type, state: effective.state, stateWhy: effective.why,
    stamp: doseStamp(s, cap, ctx.backToday), at: Math.floor(Date.now() / 1000),
  }

  if (s.type === 'strength') {
    const t = templateFor(s)
    const kind = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
    const main = t.exercises.filter(e => e.section === 'main').map(e => ({ exerciseId: e.exerciseId, label: e.label, reps: e.sets.find(x => !x.isWarmup && x.loadMultiplier == null)?.targetReps ?? 8, notes: e.notes ?? null }))
    let fighter: { loadKg: Record<string, number | null>; sets: number; reps: number } | null = null
    if (kind === 'fighter') {
      const pct = getWeekPercentage(s.blockWeek ?? 1, 'fighter')
      const wave = getWaveLoadingSetsReps(s.blockWeek ?? 1, 'fighter')
      fighter = { loadKg: Object.fromEntries(main.map(m => [m.exerciseId, inputs.tmKg[m.exerciseId] != null ? Math.round(inputs.tmKg[m.exerciseId] * pct * 100) / 100 : null])), sets: wave.sets, reps: wave.reps }
    }
    // An injury flag or the raven's one-set plan: one set less, never more than HOLD (a limit, not a stack).
    const limitWhy = inj.action.action === 'ease' || inj.action.action === 'back_swap' ? inj.action.note : inj.ravenOneSet
    const dose = strengthDose(limitWhy ? { ...ctx, state: lowerState(ctx.state, 'AMBER'), stateWhy: limitWhy } : ctx, {
      kind, main, fighter, tmKg: inputs.tmKg, equipment: inputs.equipment,
      steppedThisWeek: await steppedThisWeek(db, s), lastFeltHard: await lastFeltHard(db, s, inputs),
    })
    const u = dose.lifts.length ? Math.round((dose.lifts.reduce((n, l) => n + l.u, 0) / dose.lifts.length) * 100) / 100 : null
    return { ...base, level: dose.level, strength: dose, facts: { u, modelState: dose.lifts[0]?.state ?? null }, why: dose.why }
  }

  if (s.type === 'foundation_run' || s.type === 'running') {
    const guards = await loadRunGuardInputs(db, s.id, s.weekPlanId, day)
    const ceiling = await loadEasyHrCeiling(db, day)
    const hist = await runDoseHistory(db, s)
    const runWalk = s.type === 'foundation_run' && s.blockType === 'block_zero'
    const bike = inj.action.action === 'walk_or_bike' ? { label: 'Easy bike', why: inj.action.note ?? 'Easy bike today.' } : null
    let plannedSec: number | null = null
    if (!runWalk) {
      if (s.type === 'foundation_run' || s.notes === 'zone2') plannedSec = ZONE2_PRESCRIPTION.targetDurSec
      else plannedSec = RUNNING_PLAN_TEMPLATE.find(r => r.weekNumber === (s.blockWeek ?? 1))?.targetDurSec ?? ZONE2_PRESCRIPTION.targetDurSec
    }
    const dose = runDose(ctx, {
      kind: runWalk ? 'run_walk' : 'continuous', longestLast30Sec: guards.longestLast30Sec || null, weekly: guards.weekly, hrCeilingBpm: ceiling.bpm,
      maxRungSec: plan?.shapeWeek != null ? getRunWalkWeek(plan.shapeWeek).runSec : null, bike, plannedSec,
      lastRunSec: hist.lastRunSec, riseThisWeek: hist.riseThisWeek,
    })
    return { ...base, level: dose.level, run: dose, facts: { u: inputs.model.run.u, modelState: inputs.model.run.state }, why: dose.why }
  }

  if (s.type === 'bag_work') {
    const early = s.blockType === 'block_zero'
    const dose = bagDose(ctx, { maxRounds: early ? 6 : 8, injuryWhy: inj.action.action === 'technical' ? inj.action.note : null })
    return { ...base, level: dose.level, bag: dose, facts: { u: inputs.model.bag.u, modelState: inputs.model.bag.state }, why: dose.why }
  }
  return null
}

function doseStamp(s: Pick<SessionRow, 'type' | 'label' | 'scheduledDate' | 'contextJson'>, cap: BrainCap | null, backToday: number | null): string {
  const plan = bodyPlanMark(s.contextJson)
  const ease = coachEaseFrom(s.contextJson)
  return JSON.stringify([s.type, s.label, s.scheduledDate, cap?.state ?? null, backToday, plan?.op ?? null, plan?.shapeWeek ?? null, ease?.source === 'injury' ? ease.kind : null])
}

/**
 * The session's dose: the stored one when its inputs still match, else
 * computed now and stored. Every start route and preview reads this.
 */
export async function doseFor(db: DB, s: SessionRow, today: number): Promise<StoredDose | null> {
  if (!KEY_TYPES.has(s.type) || s.type === 'mt_class' || s.type === 'skip_rope') return null
  const stored = parseDose(s.doseJson)
  if (stored && s.status !== 'planned') return stored
  if (stored) {
    const inp = await loadBrainInputs(db, today)
    const day = s.scheduledDate ?? today
    const cap = brainCapFrom(s.contextJson)
    const flag = await loadInjuryFlag(db, day)
    const backToday = injuryActionFor(s.type, flag).action === 'back_swap' ? 1 : (inp.backByDay.get(day) ?? null)
    const back = bodyPlanMark(s.contextJson)?.op === 'back' ? 1 : backToday
    if (stored.stamp === doseStamp(s, cap, back) && stored.day === day) return stored
    const fresh = await computeDose(db, s, today, inp)
    if (fresh) await db.update(sessions).set({ doseJson: JSON.stringify(fresh) }).where(eq(sessions.id, s.id))
    return fresh
  }
  const fresh = await computeDose(db, s, today)
  if (fresh) await db.update(sessions).set({ doseJson: JSON.stringify(fresh) }).where(eq(sessions.id, s.id))
  return fresh
}

/** Write doses for every planned key session in [from, to]. */
export async function refreshDoses(db: DB, from: number, to: number, today: number, inp?: BrainInputs): Promise<number> {
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, to), eq(sessions.status, 'planned')))
  const inputs = inp ?? await loadBrainInputs(db, today)
  let n = 0
  for (const s of rows) {
    const d = await computeDose(db, s, today, inputs)
    if (!d) continue
    await db.update(sessions).set({ doseJson: JSON.stringify(d) }).where(eq(sessions.id, s.id))
    n++
  }
  return n
}

// ─── The morning cap (rules only, today only) ─────────────────

const SHOW: Record<string, string> = { strength: 'STRENGTH', foundation_run: 'RUN-WALK', running: 'RUN', bag_work: 'BAG WORK' }

function capShow(d: StoredDose): string {
  if (d.run?.walkOnly) return 'EASY WALK'
  if (d.level === 'RECOVER') return 'RECOVER'
  if (d.strength) return 'ONE SET LESS'
  if (d.run) return 'ONE ROUND LESS'
  return 'EASIER'
}

/**
 * The check-in for `day` is in: today's planned sessions get their doses
 * again (a back day swaps lifts), and a morning read lower than the night's
 * ceiling caps them. Never another day, never an AI call, never a push.
 * Returns the change rows written.
 */
export async function capToday(db: DB, day: number, nowSec: number): Promise<number> {
  const inp = await loadBrainInputs(db, day)
  const night = nightState(inp, day)
  const morning = morningState(inp, day)
  const capped = morning != null && STATE_RANK[morning.state] < STATE_RANK[night.state] ? morning : null
  const rows = (await db.select().from(sessions).where(and(eq(sessions.scheduledDate, day), eq(sessions.status, 'planned')))).filter(s => KEY_TYPES.has(s.type))
  const held = await loadHeld(db, day)
  const pm = await pmStart(db)
  const records: NewChange[] = []
  for (const s of rows) {
    const before = parseDose(s.doseJson)
    let ctxJson = s.contextJson
    if (capped && !held.has(s.id) && s.type !== 'mt_class') ctxJson = applyContext(s.contextJson, { brainCap: { state: capped.state, why: capped.why, at: nowSec } satisfies BrainCap })
    const next = { ...s, contextJson: ctxJson }
    const dose = await computeDose(db, next, day, inp)
    await db.update(sessions).set({ contextJson: ctxJson, ...(dose ? { doseJson: JSON.stringify(dose) } : {}) }).where(eq(sessions.id, s.id))
    // A rune when the cap changed what he sees (AMBER or RED); a FRESH → GREEN cap only takes the push off, quietly.
    if (capped && ctxJson !== s.contextJson && dose && (capped.state === 'AMBER' || capped.state === 'RED') && changedFrom(before, dose)) {
      const setId = crypto.randomUUID()
      records.push({
        setId, actor: 'check_in', kind: 'ease', targetSessionId: s.id, sessionType: s.type,
        before: { show: 'AS PLANNED', day, sessions: [snap(s, [], ['brainCap'])] },
        after: { show: capShow(dose), day, sessions: [snap(next, [], ['brainCap'])], put: { line: `${SHOW[s.type] ?? s.type} is back as planned.`, dim: 'The coach leaves it as you set it today.' } },
        why: capped.why ?? 'A rough morning. Easier today.', detail: dose.why.filter(w => w !== capped.why)[0] ?? null,
        undoUntil: slotStart(day, s.timeSlot, pm), extraSource: { rule: 'morning_cap', state: capped.state },
      })
    }
  }
  return (await recordChanges(db, records, nowSec)).length
}

function changedFrom(a: StoredDose | null, b: StoredDose): boolean {
  if (!a) return true
  if (a.strength && b.strength) return a.strength.sets !== b.strength.sets || a.strength.lifts.some((l, i) => l.weightKg !== b.strength!.lifts[i]?.weightKg || l.exerciseId !== b.strength!.lifts[i]?.exerciseId)
  if (a.run && b.run) return a.run.runTotalSec !== b.run.runTotalSec || a.run.walkOnly !== b.run.walkOnly
  if (a.bag && b.bag) return a.bag.rounds !== b.bag.rounds
  return a.level !== b.level
}

// ─── The nightly pass ────────────────────────────────────────

/** The last day with anything from him: a check-in, a session started or done, a skip, an app open. */
export async function lastActiveDay(db: DB): Promise<number | null> {
  const [log] = await db.select({ d: dailyLogs.logDate }).from(dailyLogs).orderBy(desc(dailyLogs.logDate)).limit(1)
  // A rest day the coach set is not something he did.
  const acts = (await db.select({ day: sessions.scheduledDate, status: sessions.status, skipReason: sessions.skipReason }).from(sessions)
    .where(inArray(sessions.status, ['completed', 'in_progress', 'skipped']))).filter(a => a.skipReason !== 'coach_rest')
  const [st] = await db.select({ seen: settings.coachSeenAt }).from(settings)
  const days = [log?.d ?? null, ...acts.map(a => a.day), st?.seen != null ? Math.floor(st.seen / 86400) : null].filter((d): d is number => d != null)
  return days.length ? Math.max(...days) : null
}

export interface NightResult {
  ran: boolean
  reason?: string
  changes: number
  doses: number
  summary?: string[]
  /** Where the night's decision came from (agree / ai / rules / fallback / offline / capped / quiet). */
  decision?: string
}

/** Session rows of a week as the outline reads them. */
function outlineRows(rows: SessionRow[], today: number, held: Set<string>, mine: Set<string>): OutlineSession[] {
  return rows.filter(r => r.scheduledDate != null).map(r => ({
    id: r.id, type: r.type, label: r.label, day: r.scheduledDate as number, slot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status, source: r.source,
    locked: r.status !== 'planned' || (r.scheduledDate as number) < today || held.has(r.id) || mine.has(r.id) || r.source === 'ad_hoc' || r.source === 'replace',
  }))
}

/** Sessions he moved or added himself this week: the coach leaves them where he put them. */
async function hisSessions(db: DB, monday: number): Promise<Set<string>> {
  const list = await loadWeekChanges(db, monday)
  const out = new Set<string>()
  for (const { change } of list) {
    if (change.actor !== 'you' || change.undoneAt != null) continue
    if (change.targetSessionId) out.add(change.targetSessionId)
    for (const id of change.after.created ?? []) out.add(id)
  }
  return out
}

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const NAME: Record<string, string> = { strength: 'Strength', foundation_run: 'Run-Walk', running: 'Run', bag_work: 'Bag Work', mt_class: 'MT Class', skip_rope: 'Skip Rope' }

/** Apply the outline's changes: each a coach change row with its rune and UNDO. */
async function applyOutline(db: DB, changes: OutlineChange[], rows: SessionRow[], blockId: string, nowSec: number, classTime = '18:30'): Promise<number> {
  if (changes.length === 0) return 0
  const pm = await pmStart(db)
  const setId = crypto.randomUUID()
  const records: NewChange[] = []
  for (const c of changes) {
    if (c.kind === 'add') {
      const block = await getActiveBlock(db)
      if (!block || block.id !== blockId) continue
      const tw = await trainingWeekFor(db, block, c.day, Math.floor(nowSec / 86400))
      const weekPlanId = await resolveWeekPlan(db, block.id, weekStamps(block, tw).weekNumber, mondayOf(c.day), nowSec)
      const id = crypto.randomUUID()
      await db.insert(sessions).values({ id, type: 'mt_class', label: 'MT Class', weekPlanId, scheduledDate: c.day, timeSlot: 'pm', blockWeek: null, blockType: block.blockType, status: 'planned', notes: null, source: 'coach', contextJson: JSON.stringify({ suggested: { at: nowSec, time: classTime } }), createdAt: nowSec })
      records.push({
        setId, actor: 'coach', kind: 'add', targetSessionId: id, sessionType: 'mt_class', weekPlanId,
        before: emptyState(c.day), after: { ...emptyState(c.day, '+ MT CLASS'), created: [id], put: { line: 'The class is off the week.', dim: 'The coach leaves this week as it is.' } },
        why: c.why, detail: 'A class is an hour of hard work; what is taught is the gym\'s call. Skip or replace it like anything else.', undoUntil: slotStart(c.day, 'pm', classTime), extraSource: { rule: 'class_night', time: classTime },
      })
    } else if (c.kind === 'move') {
      const s = rows.find(r => r.id === c.sessionId)
      if (!s || s.status !== 'planned' || s.scheduledDate == null) continue
      const before = snap(s, ['scheduledDate', 'timeSlot'], ['movedFrom'])
      const contextJson = applyContext(s.contextJson, { movedFrom: { epochDay: s.scheduledDate, timeSlot: s.timeSlot } })
      await db.update(sessions).set({ scheduledDate: c.day, timeSlot: c.slot, contextJson }).where(eq(sessions.id, s.id))
      const next = { ...s, scheduledDate: c.day, timeSlot: c.slot, contextJson }
      records.push({
        setId, actor: 'coach', kind: 'move', targetSessionId: s.id, sessionType: s.type,
        before: { show: `${DAY3[new Date(s.scheduledDate * 86400000).getUTCDay()]} ${(s.timeSlot ?? 'am').toUpperCase()}`, day: s.scheduledDate, sessions: [before] },
        after: { show: `${DAY3[new Date(c.day * 86400000).getUTCDay()]} ${c.slot.toUpperCase()}`, day: c.day, sessions: [snap(next, ['scheduledDate', 'timeSlot'], ['movedFrom'])], put: { line: `${s.label ?? NAME[s.type] ?? s.type} is back where it was.`, dim: 'The coach leaves it as you set it this week.' } },
        why: c.why, undoUntil: slotStart(Math.min(c.day, s.scheduledDate), c.slot, pm), extraSource: { rule: 'outline' },
      })
    } else if (c.kind === 'rest') {
      const s = rows.find(r => r.id === c.sessionId)
      if (!s || s.status !== 'planned' || s.scheduledDate == null) continue
      const before = snap(s, ['status', 'skipReason'])
      await db.update(sessions).set({ status: 'skipped', skipReason: 'coach_rest' }).where(eq(sessions.id, s.id))
      records.push({
        setId, actor: 'coach', kind: 'skip', targetSessionId: s.id, sessionType: s.type,
        before: { show: (s.label ?? NAME[s.type] ?? s.type).toUpperCase(), day: s.scheduledDate, sessions: [before] },
        after: { show: 'REST', day: s.scheduledDate, sessions: [{ id: s.id, f: { status: 'skipped', skipReason: 'coach_rest' } }], put: { line: `${s.label ?? NAME[s.type] ?? s.type} is back on.`, dim: 'The coach leaves it as you set it this week.' } },
        why: c.why, detail: 'Nothing is made up later.', undoUntil: slotStart(s.scheduledDate, s.timeSlot, pm), extraSource: { rule: 'rest_day' },
      })
    }
  }
  return (await recordChanges(db, records, nowSec)).length
}

/** A second rest day is due: RED, soreness 4+ two mornings running, or 5+ training days running with energy falling. */
export async function restDueFor(db: DB, inp: BrainInputs, today: number): Promise<string | null> {
  const y = readinessState(inp.checkIns, today - 1)
  if (y.state === 'RED') return y.why ?? 'Two rough mornings running. A rest day.'
  const s1 = inp.checkIns.find(c => c.day === today - 1)?.soreness
  const s2 = inp.checkIns.find(c => c.day === today - 2)?.soreness
  if (s1 != null && s2 != null && s1 >= 4 && s2 >= 4) return `Soreness ${s2} then ${s1}. A rest day.`
  const done = await db.select({ day: sessions.scheduledDate }).from(sessions)
    .where(and(eq(sessions.status, 'completed'), inArray(sessions.type, [...KEY_TYPES]), gte(sessions.scheduledDate, today - 6), lt(sessions.scheduledDate, today)))
  const trained = new Set(done.map(d => d.day))
  let run = 0
  for (let d = today - 1; d >= today - 6 && trained.has(d); d--) run++
  const e = [today - 3, today - 2, today - 1].map(d => inp.checkIns.find(c => c.day === d)?.energy)
  if (run >= 5 && e.every(x => x != null) && (e[0] as number) > (e[1] as number) && (e[1] as number) > (e[2] as number)) return `${run} training days running and energy falling. A rest day.`
  return null
}

/**
 * The nightly re-plan for `today` (the athlete's local day). Skipped when
 * nothing was logged and the app wasn't opened in the last 2 days.
 *
 * This week: the solver proposes the week's changes, the rules work out each
 * of today's sessions' candidates, and the AI makes the call inside them
 * (decideNight). Next week (from Saturday): the solver alone.
 */
export async function runBrainNight(db: DB, today: number, nowSec: number, opts: { used?: number; apiKey?: string } = {}): Promise<NightResult> {
  const block = await getActiveBlock(db)
  if (!block) return { ran: false, reason: 'no active block', changes: 0, doses: 0 }
  const last = await lastActiveDay(db)
  const start = blockStartDay(block)
  if (start < today - 2 && (last == null || last < today - 2)) return { ran: false, reason: 'inactive', changes: 0, doses: 0 }

  // The week's sessions exist (one path), and next week's from Saturday.
  const monday = mondayOf(today)
  const weeks = [monday, ...(today >= monday + 5 ? [monday + 7] : [])]
  for (const w of weeks) for (let d = w; d <= w + 6; d++) {
    if (d < today && w === monday) continue
    if (await dayHasPlan(db, block.id, d)) continue
    await generateDaySessions(db, d, today, nowSec)
  }

  const inp = await loadBrainInputs(db, today)
  const kind = blockKind(block.blockType)
  const [profile] = await db.select({ cap: userProfile.mtCapPerWeek }).from(userProfile).where(eq(userProfile.id, 'default'))
  // Class nights: the days he set in Settings win; none set, the coach suggests from any night but Sunday.
  const [st] = await db.select({ mt: settings.mtClassDays }).from(settings).limit(1)
  const setDays = (st?.mt ?? '').split(',').filter(Boolean).map(Number).filter(d => d >= 0 && d <= 6)
  const classNights = setDays.length > 0 ? setDays : [1, 2, 3, 4, 5, 6]
  // Class time: 6:30 PM until his logged class starts say otherwise. Nothing to set.
  const classMin = inp.model.adherence.usualStart.mt_class?.minute ?? 18 * 60 + 30
  const classTime = `${Math.floor(classMin / 60)}:${String(classMin % 60).padStart(2, '0')}`
  const restDue = await restDueFor(db, inp, today)
  // At most 2 visible coach changes a night, missed-session records written tonight included.
  let budget = Math.max(0, MAX_WEEK_ACTIONS - (opts.used ?? 0))
  let changes = 0
  let decision: NightDecision | null = null
  for (const w of weeks) {
    const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, w - 1), lte(sessions.scheduledDate, w + 7)))
    const held = await loadHeld(db, w)
    const mine = await hisSessions(db, w)
    const weekChanges = await loadWeekChanges(db, w)
    const suggested = (await db.select({ status: sessions.status, day: sessions.scheduledDate }).from(sessions)
      .where(and(eq(sessions.type, 'mt_class'), eq(sessions.source, 'coach'), lt(sessions.scheduledDate, today), gte(sessions.scheduledDate, today - 28))))
      .sort((x, y) => (y.day ?? 0) - (x.day ?? 0)).slice(0, 2)
    const classPaused = suggested.length === 2 && suggested.every(x => x.status !== 'completed') && w <= mondayOf(suggested[0].day ?? 0) + 7
    const classHeld = weekChanges.some(({ change }) => change.actor !== 'you' && change.kind === 'add' && change.sessionType === 'mt_class' && change.undoneAt != null)
    const outlineIn: OutlineIn = {
      today, monday: w, blockType: kind, blockStart: start, sessions: outlineRows(rows, today, held, mine), classNights,
      classCap: profile?.cap ?? null, classHeld, classPaused, model: inp.model, state: nightState(inp, today).state, restDue: w === monday ? restDue : null,
    }
    const result = solveOutline(outlineIn)
    let chosen = result.changes.slice(0, budget)
    if (w === monday) {
      decision = await decideNight(db, { today, nowSec, inp, rows, held, mine, outlineIn, solver: result, solverChanges: chosen, budget, apiKey: opts.apiKey ?? '', lastActive: last, weekChanges })
      chosen = decision.outline
    }
    chosen = chosen.slice(0, budget)
    const n = await applyOutline(db, chosen, rows, block.id, nowSec, classTime)
    budget -= chosen.length
    changes += n
  }
  // Today's sessions get the decision's pick (when still planned and still today), then every dose for the week.
  if (decision) {
    const todayRows = await db.select().from(sessions).where(and(eq(sessions.scheduledDate, today), eq(sessions.status, 'planned')))
    const fresh = await loadBrainInputs(db, today)
    for (const pick of decision.final.today) {
      const s = todayRows.find(r => r.id === pick.sessionId)
      if (!s) continue
      const dec: DoseDecision = { id: decision.id, day: today, level: pick.level, tweak: pick.tweak, why: pick.why, from: pick.from }
      const dose = await computeDose(db, s, today, fresh, { decision: dec })
      if (dose) await db.update(sessions).set({ doseJson: JSON.stringify(dose) }).where(eq(sessions.id, s.id))
    }
  }
  const doses = await refreshDoses(db, today, today + 6, today, await loadBrainInputs(db, today))
  console.log(`[brain] night ${isoOf(today)}: changes=${changes} doses=${doses} decision=${decision?.final.source ?? 'none'} run=${inp.model.run.state} u=${inp.model.run.u}`)
  return { ran: true, changes, doses, summary: modelSummary(inp.model), decision: decision?.final.source }
}

// ─── The decision (coach brain P3: §5.3 the call, §5.4 check and arbitrate) ─

export interface NightDecision {
  id: string
  final: FinalDecision
  /** The week changes to apply tonight, with their why lines. */
  outline: OutlineChange[]
  packet: DecisionPacket
  call: CallOutcome | null
}

interface DecideIn {
  today: number
  nowSec: number
  inp: BrainInputs
  rows: SessionRow[]
  held: Set<string>
  mine: Set<string>
  outlineIn: OutlineIn
  solver: ReturnType<typeof solveOutline>
  solverChanges: OutlineChange[]
  budget: number
  apiKey: string
  lastActive: number | null
  weekChanges: Awaited<ReturnType<typeof loadWeekChanges>>
}

const DOSED = new Set(['strength', 'foundation_run', 'running', 'bag_work'])
const ZERO_RANGE: TweakRange = { setsDelta: [0, 0], loadStep: [0, 0], roundsDelta: [0, 0] }
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function rangeFor(d: StoredDose, inp: BrainInputs): TweakRange {
  if (d.level === 'RECOVER' || d.level === 'REST') return ZERO_RANGE
  if (d.strength) {
    const sets = d.strength.lifts.some(l => l.sets > (l.workUp ? 2 : 1))
    const load = d.strength.lifts.some(l => !l.workUp && l.weightKg != null && l.weightKg > 0 && (inp.equipment[l.exerciseId] ?? 'none') !== 'none')
    return { setsDelta: [sets ? -1 : 0, 0], loadStep: [load ? -1 : 0, 0], roundsDelta: [0, 0] }
  }
  if (d.run) return { setsDelta: [0, 0], loadStep: [0, 0], roundsDelta: [!d.run.walkOnly && (d.run.rounds > 2 || d.run.rounds <= 1) ? -1 : 0, 0] }
  if (d.bag) return { setsDelta: [0, 0], loadStep: [0, 0], roundsDelta: [d.bag.rounds > 1 ? -1 : 0, 0] }
  return ZERO_RANGE
}

function tweaked(d: StoredDose, t: Tweak, inp: BrainInputs): StoredDose {
  const x: StoredDose = { ...d }
  if (x.strength) x.strength = tweakStrength(x.strength, t, inp.equipment)
  if (x.run) x.run = tweakRun(x.run, t)
  if (x.bag) x.bag = tweakBag(x.bag, t)
  x.level = x.strength?.level ?? x.run?.level ?? x.bag?.level ?? x.level
  return x
}

function tweakedWords(d: StoredDose, range: TweakRange, inp: BrainInputs): Candidate['tweaked'] {
  const out: NonNullable<Candidate['tweaked']> = {}
  const words = (t: Tweak) => doseWords(tweaked(d, t, inp))
  if (range.setsDelta[0] < 0) out.setsDelta = words({ setsDelta: -1, loadStep: 0, roundsDelta: 0 })
  if (range.loadStep[0] < 0) out.loadStep = words({ setsDelta: 0, loadStep: -1, roundsDelta: 0 })
  if (range.roundsDelta[0] < 0) out.roundsDelta = words({ setsDelta: 0, loadStep: 0, roundsDelta: -1 })
  if (range.setsDelta[0] < 0 && range.loadStep[0] < 0) out.setsDelta = `${out.setsDelta} | both: ${words({ setsDelta: -1, loadStep: -1, roundsDelta: 0 })}`
  return Object.keys(out).length ? out : undefined
}

/** Today's candidates for one session: every level from RECOVER up to the rules' own pick (§5.2). */
async function candidatesFor(db: DB, s: SessionRow, n: number, today: number, inp: BrainInputs): Promise<{ rules: StoredDose; list: Candidate[] } | null> {
  const rules = await computeDose(db, s, today, inp, { decision: null })
  if (!rules) return null
  const list: Candidate[] = []
  const seen = new Set<string>()
  const push = (d: StoredDose, isRules: boolean) => {
    const words = doseWords(d)
    const id = `c${n}.${d.level.toLowerCase()}`
    // The same dose under another level name is not another option.
    const body = words.slice(words.indexOf(':') + 1)
    if (seen.has(body) || list.some(c => c.id === id)) return
    seen.add(body)
    const range = rangeFor(d, inp)
    list.push({ id, sessionId: s.id, sessionType: s.type, level: d.level, rules: isRules, dose: words, range, tweaked: tweakedWords(d, range, inp) })
  }
  push(rules, true)
  for (const level of [...LEVELS].reverse()) {
    if (level === 'REST' || !levelAbove(rules.level, level)) continue
    const d = await computeDose(db, s, today, inp, { decision: null, levelCap: level })
    if (d && levelAbove(rules.level, d.level)) push(d, false)
  }
  list.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
  return { rules, list }
}

const slotRank = (s: Pick<SessionRow, 'timeSlot'>) => (s.timeSlot === 'pm' ? 1 : 0)
const dayKey = (d: number) => DAY_KEYS[new Date(d * 86400000).getUTCDay()]

/**
 * The night's decision: candidates and the week from the rules, the AI's
 * call (only when something is new since yesterday, under the daily spend
 * cap), verify, arbitrate, one coach_decisions row. A retried night reuses
 * the night's decision and makes no second set of changes.
 */
export async function decideNight(db: DB, x: DecideIn): Promise<NightDecision> {
  const { today, inp } = x
  const monday = mondayOf(today)
  const sunday = monday + 6
  const todays = x.rows.filter(r => r.scheduledDate === today && r.status === 'planned' && DOSED.has(r.type)).sort((a, b) => slotRank(a) - slotRank(b) || a.id.localeCompare(b.id))
  const candidates: Candidate[] = []
  const rulesWhy: string[] = []
  for (let i = 0; i < todays.length; i++) {
    const c = await candidatesFor(db, todays[i], i + 1, today, inp)
    if (!c) continue
    candidates.push(...c.list)
    for (const w of c.rules.why) if (!rulesWhy.includes(w)) rulesWhy.push(w)
  }
  const weekRows = x.rows.filter(r => r.scheduledDate != null && r.scheduledDate >= monday && r.scheduledDate <= sunday && KEY_TYPES.has(r.type))
    .sort((a, b) => (a.scheduledDate as number) - (b.scheduledDate as number) || slotRank(a) - slotRank(b) || a.id.localeCompare(b.id))
  const free = (r: SessionRow) => r.status === 'planned' && (r.scheduledDate as number) >= today && !x.held.has(r.id) && !x.mine.has(r.id) && r.source !== 'ad_hoc' && r.source !== 'replace'
  const weekSessions: WeekSession[] = weekRows.map((r, i) => ({
    ref: `s${i + 1}`, sessionId: r.id, type: r.type, name: r.label ?? NAME[r.type] ?? r.type, day: dayKey(r.scheduledDate as number), epochDay: r.scheduledDate as number,
    slot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status, movable: free(r) && r.type !== 'mt_class', restable: free(r),
  }))
  const refOf = (id: string) => weekSessions.find(w => w.sessionId === id)?.ref ?? null
  const solver: SolverChange[] = x.solverChanges.map((c, i) => ({
    ref: `w${i + 1}`, kind: c.kind, session: c.kind === 'add' ? null : refOf(c.sessionId),
    to: c.kind === 'add' ? { day: dayKey(c.day), slot: 'pm' } : c.kind === 'move' ? { day: dayKey(c.day), slot: c.slot } : null, why: c.why,
  }))
  const facts = packetFacts(athleteSignals(inp.model, inp.events, today).filter(f => !f.id.startsWith('f.note.')))
  const night = nightState(inp, today)
  facts.unshift({ id: 'f.state', value: night.state })
  const notes = await loadRecentNotes(db, today)
  const packet: DecisionPacket = {
    v: 1,
    today: { iso: isoOf(today), day: dayKey(today) },
    state: { state: night.state, why: night.why },
    facts, notes, candidates,
    week: { sessions: weekSessions, days: Array.from({ length: sunday - today + 1 }, (_, i) => dayKey(today + i)), solver, budget: x.budget },
    rulesWhy,
    recentChanges: x.weekChanges.slice(-8).map(({ change }) => ({ day: isoOf(change.after.day), actor: change.actor, kind: change.kind, session: NAME[change.sessionType] ?? change.sessionType, why: change.why, undone: change.undoneAt != null })),
  }
  const hash = await inputHash(packet)

  // A retried night: the same picks for today, no second set of week changes.
  const prior = await existingDecision(db, today)
  if (prior) return { id: prior.id, final: { ...prior.final, week: { from: 'solver', actions: [], solverRefs: [], why: {} } }, outline: [], packet, call: null }

  const rules = rulesDecision(packet, 'rules')
  let final: FinalDecision
  let call: CallOutcome | null = null
  // The AI only when there is something new from him since the last night (§15 item 3).
  const newInfo = x.lastActive != null && x.lastActive >= today - 1
  const spent = await spendToday(db, x.nowSec)
  if (!newInfo) final = rulesDecision(packet, 'quiet')
  else if (overCap(spent)) final = rulesDecision(packet, 'capped')
  else {
    call = await callDecision(x.apiKey, packet, Math.max(0, DAILY_CALL_CAP - spent.calls))
    if (call.verified?.decision) final = arbitrate(packet, call.verified.decision, weekScorer(x, weekSessions))
    else final = rulesDecision(packet, call.offline && call.errors.length === 0 ? 'offline' : 'fallback')
  }
  const id = crypto.randomUUID()
  await storeDecision(db, { id, day: today, nowSec: x.nowSec, inputHash: hash, packet, rules, final, call })
  return { id, final, outline: outlineFrom(final, x, weekSessions), packet, call }
}

/** The AI's week actions as outline changes (its why, else a plain line with no numbers). */
function actionChanges(actions: AiWeekAction[], why: Record<string, string>, x: DecideIn, weekSessions: WeekSession[]): OutlineChange[] {
  const out: OutlineChange[] = []
  for (const a of actions) {
    const w = weekSessions.find(s => s.ref === a.ref)
    const r = w ? x.rows.find(q => q.id === w.sessionId) : undefined
    if (!w || !r || r.scheduledDate == null) continue
    const name = r.label ?? NAME[r.type] ?? r.type
    if (a.action === 'rest') {
      out.push({ kind: 'rest', sessionId: r.id, type: r.type, label: r.label, day: r.scheduledDate, why: why[a.ref] || `${name} comes off this week.` })
    } else if (a.toDay && a.toSlot) {
      const day = x.today + ((DAY_KEYS.indexOf(a.toDay) - new Date(x.today * 86400000).getUTCDay() + 7) % 7)
      out.push({ kind: 'move', sessionId: r.id, type: r.type, label: r.label, fromDay: r.scheduledDate, fromSlot: r.timeSlot === 'pm' ? 'pm' : 'am', day, slot: a.toSlot, why: why[a.ref] || `${name} moves to ${DAY_FULL[DAY_KEYS.indexOf(a.toDay)]}.` })
    }
  }
  return out
}

function outlineFrom(final: FinalDecision, x: DecideIn, weekSessions: WeekSession[]): OutlineChange[] {
  if (final.week.from === 'ai') return actionChanges(final.week.actions, final.week.why, x, weekSessions)
  return x.solverChanges.map((c, i) => ({ ...c, why: final.week.why[`w${i + 1}`] || c.why }))
}

/** Scores the AI's week plan with the solver's own score and limits. */
function weekScorer(x: DecideIn, weekSessions: WeekSession[]): WeekScorer {
  const inp = x.outlineIn
  return {
    best: x.solver.after,
    base: x.solver.before,
    baseViolations: x.solver.violationsBefore.length,
    scoreOf(actions) {
      const changes = actionChanges(actions, {}, x, weekSessions)
      const after = inp.sessions.map(s => {
        const c = changes.find(q => 'sessionId' in q && q.sessionId === s.id)
        if (c?.kind === 'rest') return { ...s, status: 'skipped' }
        if (c?.kind === 'move') return { ...s, day: c.day, slot: c.slot }
        return s
      })
      return { score: outlineScore({ sessions: after, changes }, inp), violations: outlineViolations(after, inp.blockType, inp.monday).length }
    },
  }
}

/** The ceiling as a level, for screens and the replay. */
export function ceilingOf(state: ReadinessState): Level {
  return CEILING[state]
}


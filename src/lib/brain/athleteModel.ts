// Coach brain P1: the athlete model (coach-brain.md §4, Josh's additions §6.2).
//
// Pure and deterministic: buildAthleteModel folds every logged event in day
// order through one update per area, then ages the result to `today`. A
// nightly rebuild from the whole history is the same as updating on each
// event, and the first run is the one-time backfill (June rows enter as GUESS
// because of their age). P1 changes no decision or dose; P2 reads this.
//
// Areas: each main lift (e1RM, working weight, RIR bias, what he actually did),
// the run (talk-test line, U, drift, rung, longest run, easy pace), the bag,
// MT classes (tolerance, class-day fit), recovery baselines and responses,
// the back, and when he trains (Beta per slot, usual start, rest days, schedule
// skips). Each carries a Confidence (state, n, last day, u) from uncertainty.ts.
//
// Schedule reasons ("time", "schedule") are kept apart everywhere: a session
// skipped or cut short for time is an adherence / schedule fact, never an
// effort or recovery sign (Josh, 2026-10-20).

import { KEY_TYPES } from '../keyTypes'
import { snapLoadKg } from '../strengthLoads'
import { RIR_THREE_PLUS_AS } from '../blockZero/strength'
import { LINE_DEFAULT_AGE, LINE_KNOWN_TOLERANCE_BPM, RUN_WALK_WEEKS, easyHrLine } from '../blockZero/running'
import { isScheduleReason } from './types'
import type {
  AdherenceEstimate, AthleteModel, BackEstimate, BagEstimate, BetaCell, ClassEstimate, ClassDay, EstimateRow, EstimateState,
  LiftEstimate, LiftExposure, ModelCheckIn, ModelEvents, ModelSet, RecoveryEstimate, RecoveryItemBaseline,
  RunEstimate, RunObservation, SlotCellKey,
} from './types'
import { betaCell, cellState, clamp, confidence, round, rungDecay, stateFromU, strengthDecay } from './uncertainty'
import { CONTINUOUS_FROM_SEC, SEED_U, seededU, type HistorySeed, type SeededLift } from './history'
import { buildLevels, buildLoad, buildOwnEases, domainOf, sessionLoads, type LevelInputs } from './loadLevels'

export const MODEL_VERSION = 2

// ─── Notes flags (code's read; the AI reads notes in P3) ─────

export type NoteFlag = 'calf_shin' | 'wrist' | 'back' | 'sick'

const FLAG_PATTERNS: ReadonlyArray<[NoteFlag, RegExp]> = [
  ['calf_shin', /\b(calf|calves|shins?|achilles)\b/i],
  ['wrist', /\bwrists?\b/i],
  ['back', /\b(lower[- ]?back|sciatica?|(sore|tight|stiff|achy|bad) back|back (pain|is sore|sore|tight|stiff|ach\w*|hurts?|hurting|tweak\w*))\b/i],
  ['sick', /\b(sick|flu|fever|covid|a cold|ill)\b/i],
]

export function noteFlags(text: string | null | undefined): NoteFlag[] {
  if (!text) return []
  return FLAG_PATTERNS.filter(([, re]) => re.test(text)).map(([f]) => f)
}

/** Flags per local day from every note source (back notes always flag the back). */
export function flagsByDay(events: Pick<ModelEvents, 'notes'>): Map<number, Set<NoteFlag>> {
  const out = new Map<number, Set<NoteFlag>>()
  for (const n of events.notes) {
    const flags = noteFlags(n.text)
    if (n.source === 'back' && n.text.trim()) flags.push('back')
    if (flags.length === 0) continue
    const set = out.get(n.day) ?? new Set<NoteFlag>()
    flags.forEach(f => set.add(f))
    out.set(n.day, set)
  }
  return out
}

const flaggedNear = (flags: Map<number, Set<NoteFlag>>, day: number, flag: NoteFlag) =>
  (flags.get(day)?.has(flag) ?? false) || (flags.get(day + 1)?.has(flag) ?? false)

// ─── Small helpers ───────────────────────────────────────────

/** An early end he said was hard (felt rough, pain): the only early end that eases. */
export function isHardEnd(reason: string | null | undefined): boolean {
  return reason === 'rough' || reason === 'pain'
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
function sd(xs: number[]): number | null {
  const m = mean(xs)
  if (m == null || xs.length < 2) return null
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}
const dowOf = (day: number) => ((day % 7) + 11) % 7 // epoch day 0 was a Thursday (4)
/** Standard normal CDF (Abramowitz-Stegun 7.1.26), for U from an average HR. */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}
/** Weighted mean of the last 3 values, newest first (0.5 / 0.3 / 0.2, renormalised). */
function last3(values: Array<number | null>): number | null {
  const w = [0.5, 0.3, 0.2]
  const xs = values.filter((v): v is number => v != null).slice(-3).reverse()
  if (xs.length === 0) return null
  let s = 0
  let ws = 0
  xs.forEach((v, i) => { s += v * w[i]; ws += w[i] })
  return s / ws
}

// ─── Lifts ───────────────────────────────────────────────────

/** The default target the working weight is quoted for: Block Zero's sets of 8 at RIR 2. */
export const DEFAULT_TARGET = { reps: 8, rir: 2 } as const
export const E1RM_MAX_REPS = 10
export const E1RM_MAX_RIR = 3
export const E1RM_ALPHA = 0.3
export const E1RM_SESSION_CAP = 0.03
export const BIAS_STEP = 0.25
export const BIAS_MAX = 1.5
/** KNOWN: ≥3 RIR sessions in 21 days with last-set e1RMs within ±5%. */
export const LIFT_KNOWN_SESSIONS = 3
export const LIFT_KNOWN_WINDOW = 21
export const LIFT_KNOWN_SPREAD = 0.05

const rirValue = (rir: number) => (rir >= E1RM_MAX_RIR ? RIR_THREE_PLUS_AS : rir)

/** e1RM of one set: w × (1 + (reps + RIR + bias)/30). Only sets of ≤10 reps with RIR ≤3 (3 = "3+") count. */
export function setE1rm(weightKg: number | null, reps: number, rir: number | null, bias: number): number | null {
  if (weightKg == null || !(weightKg > 0) || rir == null || rir < 0 || rir > E1RM_MAX_RIR || reps < 1 || reps > E1RM_MAX_REPS) return null
  return weightKg * (1 + (reps + rirValue(rir) + bias) / 30)
}

/** Working weight for target reps × target (reported) RIR, from an e1RM and his bias. */
export function workingWeight(e1rmKg: number, reps: number, rir: number, bias: number, equipment: ModelSet['equipment']): number {
  const raw = e1rmKg / (1 + (reps + rir + bias) / 30)
  return round(snapLoadKg(raw, equipment, { direction: 'nearest' }), 2)
}

/**
 * Bias evidence from one session's sets, in order: a set that came in short of
 * what the previous set's reported RIR predicted (or short of plan with 2+ said
 * to be left) is a miss (he has less in reserve than he says); RIR 0 followed by
 * the same reps again at the same weight is a surplus. ±0.25 a session.
 */
export function biasStep(sets: Array<Pick<ModelSet, 'weightKg' | 'reps' | 'plannedReps' | 'rir'>>): number {
  let miss = 0
  let surplus = 0
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]
    if (s.rir != null && s.plannedReps != null && s.reps < s.plannedReps && s.rir >= 2) miss++
    if (i === 0) continue
    const p = sets[i - 1]
    if (p.rir == null || p.weightKg == null || s.weightKg == null || s.weightKg < p.weightKg * 0.98) continue
    const predicted = Math.min(s.plannedReps ?? p.reps, p.reps + Math.floor(rirValue(p.rir)) - 1)
    if (p.rir >= 1 && s.reps < predicted) miss++
    else if (p.rir === 0 && s.reps >= p.reps) surplus++
  }
  return miss > surplus ? -BIAS_STEP : surplus > miss ? BIAS_STEP : 0
}

interface LiftState {
  exerciseId: string
  equipment: ModelSet['equipment']
  e1rm: number | null
  bias: number
  lastE1rmDay: number | null
  lastSetValues: Array<{ day: number; e1rm: number }>
  exposures: LiftExposure[]
}

/** One exposure (one session's sets of one lift) folded into the lift's state. */
export function updateLift(state: LiftState, sets: ModelSet[]): void {
  const work = sets.filter(s => !s.isWarmup).sort((a, b) => a.setNumber - b.setNumber)
  const logged = work.filter(s => s.logged)
  if (logged.length === 0) return
  const day = logged[0].day
  const weights = logged.map(s => s.weightKg ?? 0).filter(w => w > 0)
  const topKg = weights.length ? Math.max(...weights) : null
  const planned = work.map(s => s.plannedWeightKg ?? 0).filter(w => w > 0)
  const plannedKg = planned.length ? Math.max(...planned) : null
  const lowered = logged.some(s => s.weightKg != null && s.weightKg > 0 && s.plannedWeightKg != null && s.plannedWeightKg > 0 && s.weightKg < s.plannedWeightKg - 0.5)
  const shortSets = logged.filter(s => s.plannedReps != null && s.reps < s.plannedReps)
  const incomplete = shortSets.length > 0 || work.length > logged.length
  // Short on reps while saying 2+ were left: his reporting gap (the bias below learns it), not a missed rep.
  const claimedShort = incomplete && work.length === logged.length && shortSets.every(s => s.rir != null && s.rir >= 2)
  const rirs = logged.map(s => s.rir).filter((r): r is number => r != null)
  const atTop = logged.filter(s => topKg != null && s.weightKg === topKg)
  const raised = topKg != null && plannedKg != null && topKg > plannedKg + 0.5
    && atTop.every(s => s.reps >= (s.plannedReps ?? s.reps) && (s.rir == null || s.rir >= 1))
  const lastSet = logged[logged.length - 1]

  state.bias = clamp(state.bias + biasStep(logged), -BIAS_MAX, BIAS_MAX)
  const withE1rm = logged.map(s => setE1rm(s.weightKg, s.reps, s.rir, state.bias))
  let idx = withE1rm.length - 1
  while (idx >= 0 && withE1rm[idx] == null) idx--
  const x = idx >= 0 ? withE1rm[idx] : null
  if (x != null) {
    let prev = state.e1rm
    if (prev != null && state.lastE1rmDay != null) prev *= strengthDecay(day - state.lastE1rmDay)
    if (prev == null) state.e1rm = x
    else {
      const ewma = prev + E1RM_ALPHA * (x - prev)
      state.e1rm = clamp(ewma, prev * (1 - E1RM_SESSION_CAP), prev * (1 + E1RM_SESSION_CAP))
    }
    state.lastE1rmDay = day
    state.lastSetValues.push({ day, e1rm: x })
  }
  state.exposures.push({
    day, topKg, plannedKg, lastRir: lastSet.rir, lowered, raised, incomplete, claimedShort, e1rmKg: x == null ? null : round(x, 1),
    workSets: logged.length, allReps: shortSets.length === 0, minRir: rirs.length ? Math.min(...rirs) : null,
  })
}

function finishLift(state: LiftState, today: number, tmKg: number | null, seeded: boolean = false): LiftEstimate {
  const rirExposures = state.lastSetValues.length
  const last = state.exposures[state.exposures.length - 1] ?? null
  let evidence: EstimateState = 'GUESS'
  if (rirExposures > 0) {
    const lastDay = state.lastSetValues[rirExposures - 1].day
    const recent = state.lastSetValues.filter(v => v.day >= lastDay - LIFT_KNOWN_WINDOW).slice(-LIFT_KNOWN_SESSIONS)
    const m = mean(recent.map(v => v.e1rm)) ?? 0
    const tight = recent.length >= LIFT_KNOWN_SESSIONS && recent.every(v => Math.abs(v.e1rm - m) <= m * LIFT_KNOWN_SPREAD)
    evidence = tight ? 'KNOWN' : 'LEARNING'
  }
  // Started from his history: his own sessions in the block never make it more careful than the start was.
  if (seeded && evidence === 'GUESS' && state.exposures.length > 0) evidence = 'LEARNING'
  let conf = confidence(evidence, rirExposures, seeded ? (state.lastE1rmDay ?? last?.day ?? null) : state.lastE1rmDay, today)
  if (seeded && evidence !== 'KNOWN') {
    const u = Math.min(conf.u, seededU({ fromDay: state.lastE1rmDay ?? last?.day ?? today, u: SEED_U }, today))
    conf = { ...conf, u, state: stateFromU(u) }
  }
  const e1rm = state.e1rm != null && state.lastE1rmDay != null ? state.e1rm * strengthDecay(today - state.lastE1rmDay) : null
  let workingKg: number | null = null
  let workingSource: LiftEstimate['workingSource'] = null
  if (e1rm != null) {
    workingKg = workingWeight(e1rm, DEFAULT_TARGET.reps, DEFAULT_TARGET.rir, state.bias, state.equipment)
    workingSource = 'e1rm'
  } else if (last?.topKg != null) {
    // No RIR yet: the next exposure starts from the weight he actually used (§6.2), decayed after a gap.
    workingKg = round(snapLoadKg(last.topKg * strengthDecay(today - last.day), state.equipment, { direction: 'down' }), 2)
    workingSource = 'used'
  } else if (tmKg != null) {
    workingKg = workingWeight(tmKg / 0.9, DEFAULT_TARGET.reps, DEFAULT_TARGET.rir, 0, state.equipment)
    workingSource = 'training_max'
  }
  let easeStreak = 0
  for (let i = state.exposures.length - 1; i >= 0; i--) {
    const e = state.exposures[i]
    if (e.lowered || (e.incomplete && !e.claimedShort) || (e.lastRir != null && e.lastRir <= DEFAULT_TARGET.rir - 1)) easeStreak++
    else break
  }
  const sdv = sd(state.lastSetValues.slice(-5).map(v => v.e1rm))
  return {
    ...conf,
    exerciseId: state.exerciseId,
    e1rmKg: e1rm == null ? null : round(e1rm, 1),
    e1rmSdKg: sdv == null ? null : round(sdv, 1),
    workingKg,
    workingSource,
    rirBias: state.bias,
    equipment: state.equipment,
    rirExposures,
    exposures: state.exposures.length,
    last,
    recent: state.exposures.slice(-3),
    easeStreak,
  }
}

/** A lift with no exposure in the block yet, started from his history (history.ts). */
function seededLift(s: SeededLift, seed: HistorySeed, today: number): LiftEstimate {
  const u = seededU(seed, today)
  return {
    evidence: 'LEARNING', state: stateFromU(u), n: 0, lastDay: null, u,
    exerciseId: s.exerciseId, e1rmKg: null, e1rmSdKg: null, workingKg: s.workingKg, workingSource: 'history',
    seed: { lastKg: s.lastKg, lastDay: s.lastDay, daysOff: seed.fromDay - s.lastDay, discount: seed.discount },
    rirBias: 0, equipment: s.equipment, rirExposures: 0, exposures: 0, last: null, recent: [], easeStreak: 0,
  }
}

function buildLifts(events: ModelEvents, today: number, sink?: Array<{ exerciseId: string; exposure: LiftExposure }>, seed?: HistorySeed | null): Record<string, LiftEstimate> {
  const main = events.sets.filter(s => s.section === 'main' && s.day <= today)
  const byExposure = new Map<string, ModelSet[]>()
  for (const s of main) {
    const k = `${s.exerciseId}|${s.sessionId}`
    byExposure.set(k, [...(byExposure.get(k) ?? []), s])
  }
  const states = new Map<string, LiftState>()
  const exposures = [...byExposure.values()].sort((a, b) => a[0].day - b[0].day || a[0].sessionId.localeCompare(b[0].sessionId))
  for (const sets of exposures) {
    const id = sets[0].exerciseId
    const st = states.get(id) ?? { exerciseId: id, equipment: sets[0].equipment, e1rm: null, bias: 0, lastE1rmDay: null, lastSetValues: [], exposures: [] }
    states.set(id, st)
    updateLift(st, sets)
  }
  if (sink) for (const st of states.values()) for (const e of st.exposures) sink.push({ exerciseId: st.exerciseId, exposure: e })
  const tms = new Map(events.trainingMaxes.map(t => [t.exerciseId, t.weightKg]))
  const out: Record<string, LiftEstimate> = {}
  for (const [id, st] of states) {
    if (st.exposures.length === 0) continue
    out[id] = finishLift(st, today, tms.get(id) ?? null, seed?.lifts[id] != null)
  }
  // No exposure in the block yet: his history's weight, less the time off.
  if (seed && today >= seed.fromDay) for (const [id, s] of Object.entries(seed.lifts)) if (!out[id]) out[id] = seededLift(s, seed, today)
  for (const [id, tm] of tms) {
    if (out[id]) continue
    out[id] = finishLift({ exerciseId: id, equipment: 'barbell', e1rm: null, bias: 0, lastE1rmDay: null, lastSetValues: [], exposures: [] }, today, tm)
  }
  return out
}

// ─── Run ─────────────────────────────────────────────────────

/** Prior line: 0.78 × Tanaka HRmax (a rule of thumb, UNVERIFIED in the doc). */
export const LINE_PRIOR_FRACTION = 0.78
export const DEFAULT_AGE = LINE_DEFAULT_AGE
/** Assumed spread of HR around its average during a run, for U from an average (bpm). */
export const HR_SPREAD_BPM = 6
export const LINE_KNOWN_TOLERANCE = LINE_KNOWN_TOLERANCE_BPM
export const RUN_KNOWN_HR_RUNS = 3
export const RECHECK_DAYS = 21
/** The run-walk ladder's run pieces (sec): the rung steps back one of these. */
export const RUNG_LADDER: readonly number[] = [...new Set(RUN_WALK_WEEKS.map(w => w.runSec))].sort((a, b) => a - b)
export const RUNG_PRIOR_SEC = RUNG_LADDER[0]
/** A logged run under this (a Strava stub) or over this (a typo) carries no duration. */
const MIN_RUN_SEC = 120
const MAX_RUN_SEC = 4 * 3600

export function linePrior(dob: string | null, today: number, maxHr: number | null = null): number {
  // His measured max HR from the profile first, else his age (birth date): nothing new to ask.
  return easyHrLine({ tests: [], day: today, dob, maxHr }).bpm
}

/** Share of running time under the line: splits when there are, else from the average HR. */
export function runUnderLine(run: { splits: Array<{ durationSec: number; avgHr: number | null }>; avgHr: number | null; maxHr?: number | null }, lineBpm: number): { u: number | null; source: RunObservation['uSource'] } {
  // The strap's max never went over the line: all of the running sat under it.
  if (run.maxHr != null && run.maxHr > 0 && run.maxHr <= lineBpm && run.avgHr != null) return { u: 1, source: 'max' }
  const hr = run.splits.filter(s => s.avgHr != null && s.durationSec > 0)
  if (hr.length >= 2) {
    const total = hr.reduce((a, s) => a + s.durationSec, 0)
    const under = hr.filter(s => (s.avgHr as number) <= lineBpm).reduce((a, s) => a + s.durationSec, 0)
    return { u: round(under / total), source: 'splits' }
  }
  if (run.avgHr != null && run.avgHr > 0) return { u: round(phi((lineBpm - run.avgHr) / HR_SPREAD_BPM)), source: 'avg' }
  return { u: null, source: 'none' }
}

/** HR drift: second-half split HR minus first-half (time-weighted), the first split dropped as warm-up when there are 3+. */
export function runDrift(splits: Array<{ durationSec: number; avgHr: number | null }>): number | null {
  let hr = splits.filter(s => s.avgHr != null && s.durationSec > 0)
  if (hr.length >= 3) hr = hr.slice(1)
  if (hr.length < 2) return null
  const half = Math.floor(hr.length / 2)
  const wm = (xs: typeof hr) => xs.reduce((a, s) => a + (s.avgHr as number) * s.durationSec, 0) / xs.reduce((a, s) => a + s.durationSec, 0)
  return Math.round(wm(hr.slice(hr.length - half)) - wm(hr.slice(0, half)))
}

function ladderBelow(sec: number): number {
  const below = RUNG_LADDER.filter(r => r < sec)
  return below.length ? below[below.length - 1] : RUNG_PRIOR_SEC
}

/** A struggle on a continuous run: the next one is 20% shorter (to the minute), never under 10 min; a run-walk piece drops a rung. */
export function rungAfterStruggle(pieceSec: number): number {
  if (pieceSec >= CONTINUOUS_FROM_SEC) return Math.max(CONTINUOUS_FROM_SEC, Math.round((pieceSec * 0.8) / 60) * 60)
  return ladderBelow(pieceSec)
}

function buildRun(events: ModelEvents, today: number, flags: Map<number, Set<NoteFlag>>, sink?: RunObservation[], seed?: HistorySeed | null): RunEstimate {
  const prior = linePrior(events.profile.dob, today, events.profile.maxHr)
  const tests = events.talkTests.filter(t => t.day <= today).sort((a, b) => a.day - b.day)
  // The one HR-line calculation (blockZero/running easyHrLine), as the dose and the AI context read it.
  const lineOn = (day: number): { bpm: number; source: 'talk_test' | 'prior' } => {
    const line = easyHrLine({ tests, day, dob: events.profile.dob, maxHr: events.profile.maxHr })
    return { bpm: line.bpm, source: line.source === 'talk_test' ? 'talk_test' : 'prior' }
  }
  const runs = events.runs.filter(r => r.day <= today).sort((a, b) => a.day - b.day)
  const rpeBySession = new Map(events.sessions.map(s => [s.id, s.rpe]))
  const recent: RunObservation[] = []
  // His history before the block (history.ts): the rung starts there, and decays from the block start.
  const seedRun = seed && today >= seed.fromDay ? seed.run : null
  let rung = seedRun?.rungSec ?? RUNG_PRIOR_SEC
  let rungUpDay: number | null = null
  let lastRunDay: number | null = null
  const decayFrom = () => lastRunDay ?? (seedRun ? (seed as HistorySeed).fromDay : null)
  const paces: number[] = []
  for (const r of runs) {
    const dur = r.durationSec != null && r.durationSec >= MIN_RUN_SEC && r.durationSec <= MAX_RUN_SEC ? r.durationSec : null
    const stub = r.durationSec != null && r.durationSec < MIN_RUN_SEC && r.splits.length < 2
    // An easy walk or bike in a run's place (walk-only dose): no running, so no rung, struggle or decay from it.
    if (stub || r.walkOnly) continue
    const line = lineOn(r.day).bpm
    const { u, source } = runUnderLine(r, line)
    const drift = runDrift(r.splits)
    const rpe = r.rpe ?? rpeBySession.get(r.sessionId) ?? null
    const cutShort = r.completionStatus === 'shortened' || r.completionStatus === 'partial'
      || (dur != null && r.plannedDurationSec != null && r.plannedDurationSec > 0 && dur < 0.8 * r.plannedDurationSec)
    const scheduleCut = cutShort && isScheduleReason(r.shortReason)
    const calfShin = flaggedNear(flags, r.day, 'calf_shin')
    const tooFast = u != null && u < 0.7
    const tooSlow = u != null && u >= 0.95 && r.avgHr != null && r.avgHr <= line - 10 && rpe != null && rpe <= 4
    // Cut short counts as a struggle only when he said so (felt rough, pain). The reason is an
    // optional tap: skipped, "no time" or "other" is neutral (HOLD), never an ease (Josh, 2026-10-21).
    const struggled = tooFast || (rpe != null && rpe >= 7) || (drift != null && drift >= 10) || calfShin || (cutShort && isHardEnd(r.shortReason))
    const handled = !struggled && !cutShort && ((u != null && u >= 0.85 && (rpe == null || rpe <= 5)) || (u == null && rpe != null && rpe <= 5))
    // A continuous run's piece is what he actually ran of it.
    const piece = r.pieceSec != null && r.pieceSec >= CONTINUOUS_FROM_SEC && dur != null ? Math.min(r.pieceSec, dur) : (r.pieceSec ?? dur)
    const from = decayFrom()
    if (from != null) rung = rungDecay(rung, r.day - from, RUNG_PRIOR_SEC)
    // Handled at the rung the coach's dose aimed at (P2): that rung is his, even when
    // uncertainty trimmed the piece a little. A struggle drops one rung below the piece
    // (a continuous run: 20% shorter).
    const aimed = r.rungSec != null && r.rungSec > 0 ? (r.rungSec >= CONTINUOUS_FROM_SEC && dur != null ? Math.min(r.rungSec, dur) : r.rungSec) : null
    const reached = aimed != null ? Math.max(piece ?? 0, aimed) : piece
    if (reached != null && handled && reached > rung) { rung = reached; rungUpDay = r.day }
    if (piece != null && struggled) rung = Math.min(rung, rungAfterStruggle(piece))
    lastRunDay = r.day
    if (u != null && u >= 0.85 && dur != null && r.distanceKm != null && r.distanceKm > 0.5) paces.push(dur / r.distanceKm)
    recent.push({
      day: r.day, sessionId: r.sessionId, durationSec: dur, pieceSec: piece, u, uSource: source, driftBpm: drift, avgHr: r.avgHr, rpe,
      hasHr: r.avgHr != null || r.splits.some(s => s.avgHr != null), isIndoor: r.isIndoor, cutShort, scheduleCut, tooFast, tooSlow, handled, struggled,
    })
  }
  if (sink) sink.push(...recent)
  const withHr = recent.filter(o => o.hasHr)
  const line = lineOn(today)
  const lastTwo = tests.slice(-2)
  const lineKnown = lastTwo.length === 2 && Math.abs(lastTwo[0].bpm - lastTwo[1].bpm) <= LINE_KNOWN_TOLERANCE
  const evidence: EstimateState = lineKnown && withHr.length >= RUN_KNOWN_HR_RUNS ? 'KNOWN' : tests.length > 0 || recent.length > 0 || seedRun ? 'LEARNING' : 'GUESS'
  const lastTest = tests[tests.length - 1]?.day ?? null
  const lastDay = Math.max(lastRunDay ?? -Infinity, lastTest ?? -Infinity)
  const lastRunHadHr = recent.length ? recent[recent.length - 1].hasHr : null
  // No HR on the last run: effort and finishing only, so it moves more cautiously (§6.2).
  let conf = confidence(evidence, recent.length, Number.isFinite(lastDay) ? lastDay : null, today, { extra: lastRunHadHr === false ? 0.1 : 0 })
  // Started from his history: a little careful, and his own runs never make it more careful than the start.
  if (seedRun && evidence !== 'KNOWN') {
    const u = Math.min(conf.u, seededU({ fromDay: Number.isFinite(lastDay) ? lastDay : (seed as HistorySeed).fromDay, u: SEED_U }, today) + (lastRunHadHr === false ? 0.1 : 0))
    conf = { ...conf, u: round(u), state: stateFromU(u) }
  }
  const uShare = last3(recent.map(o => o.u))
  const drift = last3(recent.map(o => o.driftBpm))
  const efforts = recent.slice(-3).map(o => o.rpe).filter((x): x is number => x != null)
  let recheckWhy: string | null = null
  if (tests.length === 0) recheckWhy = 'No talk test yet.'
  else if (lastTest != null && today - lastTest >= RECHECK_DAYS) recheckWhy = `Last talk test ${today - lastTest} days ago.`
  else if (uShare != null && drift != null && uShare < 0.5 && drift < 5 && efforts.length > 0 && (mean(efforts) ?? 10) <= 4) recheckWhy = 'HR sits over the line but stays flat and feels easy: the line may be low.'
  else if (uShare != null && drift != null && uShare >= 0.9 && drift >= 10) recheckWhy = 'HR stays under the line but drifts up: the line may be high.'
  const longest = recent.filter(o => o.day >= today - 30 && o.durationSec != null).reduce<number | null>((m, o) => Math.max(m ?? 0, o.durationSec as number), null)
  const pace = mean(paces.slice(-3))
  return {
    ...conf,
    lineBpm: line.bpm,
    lineSource: line.source,
    linePriorBpm: prior,
    talkTests: tests.length,
    lastTalkTestDay: lastTest,
    recheckDue: recheckWhy != null,
    recheckWhy,
    uShare: uShare == null ? null : round(uShare),
    driftBpm: drift == null ? null : Math.round(drift),
    rungSec: decayFrom() == null ? rung : rungDecay(rung, today - (decayFrom() as number), RUNG_PRIOR_SEC),
    rungUpDay,
    rungSource: recent.length > 0 ? 'block' : seedRun ? 'history' : 'prior',
    seed: seedRun ? { medianSec: seedRun.medianSec, longestSec: seedRun.longestSec, runs: seedRun.runs, avgHr: seedRun.avgHr, lastDay: seedRun.lastDay, daysOff: (seed as HistorySeed).fromDay - seedRun.lastDay } : null,
    longestLast30Sec: longest,
    easyPaceSecKm: pace == null ? null : Math.round(pace),
    runsWithHr: withHr.length,
    runs: recent.length,
    lastRunHadHr,
    recent: recent.slice(-5),
  }
}

// ─── Bag ─────────────────────────────────────────────────────

export const BAG_KNOWN_SESSIONS = 3
export const BAG_MAX_ROUNDS = 12

function buildBag(events: ModelEvents, today: number, flags: Map<number, Set<NoteFlag>>, softAfter: (day: number) => number | null): BagEstimate {
  const all = events.bag.filter(b => b.day <= today).sort((a, b) => a.day - b.day)
  const scheduleCuts = all.filter(b => (b.status === 'skipped' && isScheduleReason(b.skipReason)) || (b.status === 'completed' && isScheduleReason(b.endReason))).length
  const done = all.filter(b => b.status === 'completed')
  let tol: number | null = null
  let flagCount = 0
  const hist: Array<{ effort: number | null; flag: boolean; rounds: number; solid: number | null }> = []
  for (const b of done) {
    // Rounds he actually worked: the finish's per-round seconds, else the rounds he rated, else the plan.
    const worked = b.roundsDone ?? b.roundsRated
    const rounds = worked ?? b.roundsPlanned
    const cut = worked != null && worked < b.roundsPlanned && isHardEnd(b.endReason)
    const flag = flaggedNear(flags, b.day, 'wrist') || flaggedNear(flags, b.day, 'calf_shin')
    if (flag) flagCount++
    const sore = softAfter(b.day)
    const solid = b.ratings.length ? b.ratings.filter(r => r >= 2).length / b.ratings.length : null
    const effort = b.rpe
    if (tol == null) tol = effort != null && effort >= 8 ? Math.max(1, rounds - 1) : Math.max(1, rounds)
    else if ((effort != null && effort >= 8) || flag || (sore != null && sore >= 4)) tol = Math.min(tol, Math.max(1, rounds - 1))
    else if (cut) tol = Math.min(tol, Math.max(1, rounds))
    hist.push({ effort, flag, rounds, solid })
    const [a, c] = hist.slice(-2)
    // +1 tolerated round when the last 2 sessions had effort ≤6 and no wrist/shin flag (§4).
    if (c && a.effort != null && c.effort != null && a.effort <= 6 && c.effort <= 6 && !a.flag && !c.flag && Math.min(a.rounds, c.rounds) >= tol) tol = Math.min(BAG_MAX_ROUNDS, tol + 1)
  }
  const last2 = hist.slice(-2)
  const solidVals = last2.map(h => h.solid).filter((x): x is number => x != null)
  const solidShare = solidVals.length ? round(mean(solidVals) as number) : null
  const finishersAllowed = tol != null && tol >= 5 && last2.length === 2 && last2.every(h => h.effort != null && h.effort <= 6 && !h.flag) && (solidShare ?? 0) >= 0.7
  const evidence: EstimateState = done.length >= BAG_KNOWN_SESSIONS ? 'KNOWN' : done.length > 0 ? 'LEARNING' : 'GUESS'
  return {
    ...confidence(evidence, done.length, done.length ? done[done.length - 1].day : null, today),
    roundsTolerated: tol,
    finishersAllowed,
    solidShare,
    wristShinFlags: flagCount,
    sessions: done.length,
    lastEffort: hist.length ? hist[hist.length - 1].effort : null,
    scheduleCuts,
  }
}

// ─── Recovery baselines (two windows) ────────────────────────

export const BASELINE_WINDOW = 28
export const RECENT_WINDOW = 3
export const LIVE_VALUES = 4
export const LIVE_SPAN = 10
export const RECOVERY_KNOWN_CHECKINS = 14
export const RESPONSE_MIN = 3
export type CheckInItem = keyof Omit<ModelCheckIn, 'day'>
export const CHECKIN_ITEMS: readonly CheckInItem[] = ['sleepHours', 'sleepQuality', 'energy', 'soreness', 'stress', 'mood', 'backToday']

/** Live when 4 values sit inside some 10-day span. */
export function isLive(days: number[]): boolean {
  const ds = [...days].sort((a, b) => a - b)
  for (let i = 0; i + LIVE_VALUES - 1 < ds.length; i++) if (ds[i + LIVE_VALUES - 1] - ds[i] < LIVE_SPAN) return true
  return false
}

/** An item's baseline as of `day` (28-day window ending the day before, recent = the last 3 days to `day`). */
export function itemBaseline(checkIns: ModelCheckIn[], item: CheckInItem, day: number): RecoveryItemBaseline | null {
  const win = checkIns.filter(c => c.day >= day - BASELINE_WINDOW && c.day < day && c[item] != null)
  if (!isLive(win.map(c => c.day))) return null
  const vals = win.map(c => c[item] as number)
  const rec = checkIns.filter(c => c.day > day - RECENT_WINDOW && c.day <= day && c[item] != null).map(c => c[item] as number)
  return { mean: round(mean(vals) as number), sd: round(sd(vals) ?? 0), recent: rec.length ? round(mean(rec) as number) : null, values: vals.length }
}

const HINGE = /rdl|deadlift|block-pull|good-morning|glute-bridge|hip-thrust|kettlebell-swing/
const SQUAT = /squat|lunge|step-up|leg-press/
export function liftKind(exerciseId: string): 'hinge' | 'squat' | 'other' {
  return HINGE.test(exerciseId) ? 'hinge' : SQUAT.test(exerciseId) ? 'squat' : 'other'
}

function sessionKinds(events: ModelEvents, today: number): Array<{ day: number; kind: 'legs' | 'run' | 'class' | 'bag'; pattern: Set<'hinge' | 'squat'> }> {
  const patterns = new Map<string, Set<'hinge' | 'squat'>>()
  for (const s of events.sets) {
    if (s.section !== 'main' || s.isWarmup) continue
    const k = liftKind(s.exerciseId)
    if (k === 'other') continue
    const set = patterns.get(s.sessionId) ?? new Set()
    set.add(k)
    patterns.set(s.sessionId, set)
  }
  const out: Array<{ day: number; kind: 'legs' | 'run' | 'class' | 'bag'; pattern: Set<'hinge' | 'squat'> }> = []
  for (const s of events.sessions) {
    if (s.status !== 'completed' || s.day > today) continue
    const pattern = patterns.get(s.id) ?? new Set()
    if (s.type === 'strength' && pattern.size > 0) out.push({ day: s.day, kind: 'legs', pattern })
    else if (s.type === 'foundation_run' || s.type === 'running') out.push({ day: s.day, kind: 'run', pattern })
    else if (s.type === 'mt_class') out.push({ day: s.day, kind: 'class', pattern })
    else if (s.type === 'bag_work') out.push({ day: s.day, kind: 'bag', pattern })
  }
  return out
}

function buildRecovery(events: ModelEvents, today: number): RecoveryEstimate {
  const cis = events.checkIns.filter(c => c.day <= today).sort((a, b) => a.day - b.day)
  const baseline: RecoveryEstimate['baseline'] = {}
  for (const item of CHECKIN_ITEMS) {
    const b = itemBaseline(cis, item, today + 1)
    if (b) baseline[item] = b
  }
  const everLive = CHECKIN_ITEMS.some(item => isLive(cis.filter(c => c[item] != null).map(c => c.day)))
  const byDay = new Map(cis.map(c => [c.day, c]))
  const response: RecoveryEstimate['response'] = {}
  const acc = new Map<string, { s: number[]; e: number[]; n: number }>()
  const seen = new Set<string>()
  for (const k of sessionKinds(events, today)) {
    const key = `${k.kind}|${k.day}`
    if (seen.has(key)) continue
    seen.add(key)
    const next = byDay.get(k.day + 1)
    if (!next) continue
    const a = acc.get(k.kind) ?? { s: [], e: [], n: 0 }
    a.n++
    const bs = itemBaseline(cis, 'soreness', k.day + 1)
    const be = itemBaseline(cis, 'energy', k.day + 1)
    if (bs && next.soreness != null) a.s.push(next.soreness - bs.mean)
    if (be && next.energy != null) a.e.push(next.energy - be.mean)
    acc.set(k.kind, a)
  }
  for (const [kind, a] of acc) {
    const ok = a.n >= RESPONSE_MIN
    const ms = mean(a.s)
    const me = mean(a.e)
    response[kind as 'legs'] = { soreness: ok && ms != null ? round(ms) : null, energy: ok && me != null ? round(me) : null, instances: a.n }
  }
  const evidence: EstimateState = cis.length >= RECOVERY_KNOWN_CHECKINS ? 'KNOWN' : everLive ? 'LEARNING' : 'GUESS'
  return { ...confidence(evidence, cis.length, cis.length ? cis[cis.length - 1].day : null, today), baseline, checkIns: cis.length, response }
}

// ─── Back ────────────────────────────────────────────────────

export const BACK_KNOWN_SCORES = 14
export const BACK_ALPHA = 0.3

function buildBack(events: ModelEvents, today: number, flags: Map<number, Set<NoteFlag>>): BackEstimate {
  const scores = events.checkIns.filter(c => c.day <= today && c.backToday != null).sort((a, b) => a.day - b.day)
  let level: number | null = null
  for (const s of scores) level = level == null ? (s.backToday as number) : level + BACK_ALPHA * ((s.backToday as number) - level)
  const first = scores.length ? scores[0].day : null
  const firstWeek = first == null ? null : mean(scores.filter(s => s.day < first + 7).map(s => s.backToday as number))
  const last21 = mean(scores.filter(s => s.day > today - 21).map(s => s.backToday as number))
  const byDay = new Map(scores.map(s => [s.day, s.backToday as number]))
  const kinds = sessionKinds(events, today).filter(k => k.kind === 'legs')
  const sensitivity: BackEstimate['sensitivity'] = {}
  for (const p of ['hinge', 'squat'] as const) {
    const afterDays = new Set(kinds.filter(k => k.pattern.has(p)).map(k => k.day + 1))
    const after = [...afterDays].map(d => byDay.get(d)).filter((x): x is number => x != null)
    const other = scores.filter(s => !afterDays.has(s.day)).map(s => s.backToday as number)
    if (after.length >= 3 && other.length > 0) sensitivity[p] = { delta: round((mean(after) as number) - (mean(other) as number)), exposures: after.length }
  }
  let backNotes = 0
  for (const [d, f] of flags) if (d <= today && f.has('back')) backNotes++
  const openPlans = events.openBodyAlerts.filter(a => /back/i.test(a.region)).length
  const evidence: EstimateState = scores.length >= BACK_KNOWN_SCORES ? 'KNOWN' : scores.length > 0 ? 'LEARNING' : 'GUESS'
  // The doc's profile prior (u 0.8) is not used: the live model starts every area at u = 1 (Josh, 2026-10-20).
  const conf = confidence(evidence, scores.length, scores.length ? scores[scores.length - 1].day : null, today)
  return {
    ...conf,
    level: level == null ? null : round(level),
    firstWeekMean: firstWeek == null ? null : round(firstWeek),
    last21Mean: last21 == null ? null : round(last21),
    trend: firstWeek != null && last21 != null ? round(last21 - firstWeek) : null,
    sensitivity,
    scores: scores.length,
    backNotes,
    openPlans,
    profileSensitive: events.profile.backSensitive,
  }
}

// ─── MT class ────────────────────────────────────────────────

export const CLASS_KNOWN = 3
export const CLASS_MAX_PER_WEEK = 3
const RECOVERY_REASONS: ReadonlySet<string> = new Set(['tired', 'too_sore', 'sick', 'illness', 'rough_day', 'low_sleep', 'injury'])
const OWN_SOURCES: ReadonlySet<string> = new Set(['ad_hoc', 'replace'])
const mondayOf = (day: number) => day - ((dowOf(day) + 6) % 7)

function emptyDay(): ClassDay {
  return { ...betaCell(1, 1), n: 0, suggested: 0, attended: 0, scheduleSkips: 0, unexplained: 0, recoverySkips: 0 }
}

function buildClass(events: ModelEvents, today: number, worseItemsOn: (day: number) => number | null): ClassEstimate {
  const classes = events.sessions.filter(s => s.type === 'mt_class' && s.day <= today).sort((a, b) => a.day - b.day)
  const days: Record<number, ClassDay> = {}
  for (let d = 0; d < 7; d++) days[d] = emptyDay()
  const byDay = new Map(events.checkIns.map(c => [c.day, c]))
  const attendedDays: number[] = []
  for (const c of classes) {
    const n = days[dowOf(c.day)]
    const suggested = !OWN_SOURCES.has(c.source ?? '')
    if (suggested) n.suggested++
    let a = n.alpha
    let b = n.beta
    if (c.status === 'completed') { n.attended++; a++; attendedDays.push(c.day) } else if (c.skipReason === 'coach_rest') {
      // The coach took it off: it says nothing about the day.
      continue
    } else if (c.status === 'skipped' || c.status === 'missed') {
      if (isScheduleReason(c.skipReason)) { n.scheduleSkips++; b++ } else if (c.skipReason && RECOVERY_REASONS.has(c.skipReason)) n.recoverySkips++
      else if (c.day < today) { n.unexplained++; b++ }
    } else continue
    Object.assign(n, betaCell(a, b), { n: n.attended + n.scheduleSkips + n.unexplained })
  }
  // Tolerance: +1 a week when last week's classes were done with next-morning soreness ≤3 and
  // the next morning not amber; −1 after a class followed by soreness ≥4. Schedule skips never move it.
  let tol = 1
  const weeks = [...new Set(attendedDays.map(mondayOf))].sort((a, b) => a - b)
  for (const w of weeks) {
    if (w + 7 > today) break
    const inWeek = attendedDays.filter(d => d >= w && d < w + 7)
    const nexts = inWeek.map(d => byDay.get(d + 1))
    if (nexts.some(n => n?.soreness != null && n.soreness >= 4)) { tol = Math.max(1, tol - 1); continue }
    const fine = nexts.every(n => n != null && n.soreness != null && n.soreness <= 3) && inWeek.every(d => (worseItemsOn(d + 1) ?? 0) < 2)
    if (fine && inWeek.length >= tol) tol = Math.min(CLASS_MAX_PER_WEEK, tol + 1)
  }
  const learned = events.classLogs.filter(l => l.day <= today && l.learned).length
  const evidence: EstimateState = attendedDays.length >= CLASS_KNOWN ? 'KNOWN' : attendedDays.length > 0 ? 'LEARNING' : 'GUESS'
  return {
    ...confidence(evidence, attendedDays.length, attendedDays.length ? attendedDays[attendedDays.length - 1] : null, today),
    perWeekTolerated: tol,
    classes: attendedDays.length,
    learnedNotes: learned,
    days,
  }
}

// ─── When he trains ──────────────────────────────────────────

/** Observations older than this count at half weight (his 2026 history as the prior, §4). */
export const HALF_WEIGHT_AFTER_DAYS = 90
export const START_CLUSTER_MIN = 30
const CELLS: readonly SlotCellKey[] = ['am-weekday', 'am-weekend', 'pm-weekday', 'pm-weekend']

export function cellOf(day: number, slot: 'am' | 'pm' | null, startMin: number | null): SlotCellKey {
  const s = slot ?? (startMin != null && startMin >= 720 ? 'pm' : 'am')
  const dow = dowOf(day)
  return `${s}-${dow === 0 || dow === 6 ? 'weekend' : 'weekday'}` as SlotCellKey
}

/** Usual start: the median of the densest cluster of starts (±30 min). */
export function usualStartOf(minutes: number[]): { minute: number; of: number; inCluster: number } | null {
  if (minutes.length === 0) return null
  const sorted = [...minutes].sort((a, b) => a - b)
  let best: number[] = []
  for (const m of sorted) {
    const c = sorted.filter(x => Math.abs(x - m) <= START_CLUSTER_MIN)
    if (c.length > best.length) best = c
  }
  return { minute: best[Math.floor((best.length - 1) / 2)], of: minutes.length, inCluster: best.length }
}

function buildAdherence(events: ModelEvents, today: number): AdherenceEstimate {
  const past = events.sessions.filter(s => KEY_TYPES.has(s.type) && (s.day < today || (s.day === today && s.status === 'completed')))
  const acc: Record<SlotCellKey, { a: number; b: number }> = { 'am-weekday': { a: 1, b: 1 }, 'am-weekend': { a: 1, b: 1 }, 'pm-weekday': { a: 1, b: 1 }, 'pm-weekend': { a: 1, b: 1 } }
  let lastDay: number | null = null
  for (const s of past) {
    const w = today - s.day > HALF_WEIGHT_AFTER_DAYS ? 0.5 : 1
    const cell = acc[cellOf(s.day, s.slot, s.startMin)]
    if (s.status === 'completed') cell.a += w
    else if (s.status === 'missed' || (s.status === 'skipped' && isScheduleReason(s.skipReason))) cell.b += w
    else continue
    lastDay = Math.max(lastDay ?? s.day, s.day)
  }
  const cells = {} as AdherenceEstimate['cells']
  let best: EstimateState = 'GUESS'
  let total = 0
  for (const k of CELLS) {
    const c = betaCell(acc[k].a, acc[k].b)
    const n = round(c.n - 2)
    const st = cellState(n)
    total += n
    if (st === 'KNOWN' || (st === 'LEARNING' && best === 'GUESS')) best = st
    cells[k] = { ...c, n, state: st }
  }
  const done = events.sessions.filter(s => s.status === 'completed' && s.startMin != null && s.day <= today)
  const usualStart: AdherenceEstimate['usualStart'] = {}
  for (const t of new Set(done.map(s => s.type))) {
    const u = usualStartOf(done.filter(s => s.type === t).map(s => s.startMin as number))
    if (u) usualStart[t] = u
  }
  const pmShareOfDone = done.length ? round(done.filter(s => (s.startMin as number) >= 720).length / done.length) : null

  // Rest days: in weeks he trained (2+ days), a day with no completed key session is rest; his
  // moves count double (the day he cleared is rest he chose, the day he moved to is not).
  const trainedDays = new Set(events.sessions.filter(s => s.status === 'completed' && KEY_TYPES.has(s.type) && s.day <= today).map(s => s.day))
  const rest: Record<number, { a: number; b: number }> = {}
  for (let d = 0; d < 7; d++) rest[d] = { a: 1, b: 1 }
  const weeks = [...new Set([...trainedDays].map(mondayOf))]
  for (const w of weeks) {
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => w + i).filter(d => d < today)
    if (days.filter(d => trainedDays.has(d)).length < 2) continue
    const wt = today - w > HALF_WEIGHT_AFTER_DAYS ? 0.5 : 1
    for (const d of days) rest[dowOf(d)][trainedDays.has(d) ? 'b' : 'a'] += wt
  }
  for (const m of events.moves) {
    if (m.toDay > today + 7 || !KEY_TYPES.has(m.type)) continue
    rest[dowOf(m.fromDay)].a += 2
    rest[dowOf(m.toDay)].b += 2
  }
  const restDays: Record<number, BetaCell> = {}
  for (let d = 0; d < 7; d++) restDays[d] = { ...betaCell(rest[d].a, rest[d].b), n: round(rest[d].a + rest[d].b - 2) }
  const preferredRestDays = Object.entries(restDays)
    .filter(([, c]) => c.n >= 3 && c.p >= 0.7)
    .sort((a, b) => b[1].p - a[1].p)
    .slice(0, 2)
    .map(([d]) => Number(d))

  const sched = events.sessions.filter(s => s.day <= today && s.status === 'skipped' && isScheduleReason(s.skipReason))
    .map(s => ({ day: s.day, type: s.type, reason: s.skipReason as string }))
  const cuts = events.runs.filter(r => r.day <= today && isScheduleReason(r.shortReason)).map(r => ({ day: r.day, type: 'run_cut', reason: r.shortReason as string }))
  const all = [...sched, ...cuts].sort((a, b) => a.day - b.day)
  const byType: Record<string, number> = {}
  for (const s of all) byType[s.type] = (byType[s.type] ?? 0) + 1

  return {
    ...confidence(best, round(total), lastDay, today),
    cells,
    usualStart,
    pmShareOfDone,
    restDays,
    preferredRestDays,
    scheduleSkips: { total: all.length, byType, recent: all.filter(s => s.day > today - 28).slice(-10) },
  }
}

// ─── The whole model ─────────────────────────────────────────

/** Check-in items ≥1 worse than his own baseline that morning (sleep: ≥1 h less), §6.1's "worse". */
export function worseItems(checkIns: ModelCheckIn[], day: number): number | null {
  const c = checkIns.find(x => x.day === day)
  if (!c) return null
  let worse = 0
  for (const item of CHECKIN_ITEMS) {
    const v = c[item]
    const b = itemBaseline(checkIns, item, day)
    if (v == null || !b) continue
    const higherWorse = item === 'soreness' || item === 'stress'
    if (higherWorse ? v - b.mean >= 1 : b.mean - v >= 1) worse++
  }
  return worse
}

/**
 * Only what was logged on or after `fromDay` (the active block's start). Older
 * history no longer folds in as events: it only seeds the areas the block has
 * no estimate for yet (history.ts; Josh, 2026-10-21: "start me at my real level").
 */
export function scopeEvents(events: ModelEvents, fromDay: number): ModelEvents {
  const on = <T extends { day: number }>(xs: T[]) => xs.filter(x => x.day >= fromDay)
  return {
    ...events,
    sessions: on(events.sessions),
    sets: on(events.sets),
    runs: on(events.runs),
    talkTests: on(events.talkTests),
    bag: on(events.bag),
    checkIns: on(events.checkIns),
    notes: on(events.notes),
    moves: events.moves.filter(m => m.fromDay >= fromDay && m.toDay >= fromDay),
    classLogs: on(events.classLogs),
    trainingMaxes: events.trainingMaxes.filter(t => t.day >= fromDay),
  }
}

/**
 * The model as of `today`. `fromDay` scopes it to the active block (scopeEvents);
 * `seed` (history.ts) starts the lifts and the run from his history before it
 * until the block has its own. With neither, every area is a GUESS prior at u = 1.
 */
export function buildAthleteModel(input: ModelEvents, today: number, opts: { fromDay?: number; seed?: HistorySeed | null } = {}): AthleteModel {
  const events = opts.fromDay != null ? scopeEvents(input, opts.fromDay) : input
  const flags = flagsByDay(events)
  const byDay = new Map(events.checkIns.map(c => [c.day, c]))
  const sorenessAfter = (day: number) => byDay.get(day + 1)?.soreness ?? null
  const liftSink: Array<{ exerciseId: string; exposure: LiftExposure }> = []
  const runSink: RunObservation[] = []
  const lifts = buildLifts(events, today, liftSink, opts.seed)
  const run = buildRun(events, today, flags, runSink, opts.seed)
  const rpeOf = new Map(events.sessions.map(s => [s.id, s.rpe]))
  const sessionOfDay = (exerciseId: string, day: number) => events.sets.find(s => s.exerciseId === exerciseId && s.day === day)?.sessionId
  const levelIn: LevelInputs = {
    runs: runSink,
    lifts: liftSink.map(l => ({ ...l, sessionRpe: rpeOf.get(sessionOfDay(l.exerciseId, l.exposure.day) ?? '') ?? null })),
    combat: events.sessions.filter(s => s.status === 'completed' && s.day <= today && (s.type === 'mt_class' || s.type === 'bag_work')).sort((a, b) => a.day - b.day)
      .map(s => { const b = events.bag.find(x => x.sessionId === s.id); return { day: s.day, type: s.type, rpe: s.rpe, hardEnd: isHardEnd(b?.endReason) } }),
  }
  // His own eases still holding: none in a domain once he has done a session there since.
  const doneByDomain = new Map<string, number[]>()
  for (const s of events.sessions) {
    const d = domainOf(s.type)
    if (d && s.status === 'completed' && s.day <= today) doneByDomain.set(d, [...(doneByDomain.get(d) ?? []), s.day])
  }
  const ownEases = buildOwnEases(events, liftSink, today).filter(e => !(doneByDomain.get(e.domain) ?? []).some(d => d > e.day))
  return {
    version: MODEL_VERSION,
    asOfDay: today,
    lifts,
    run,
    bag: buildBag(events, today, flags, sorenessAfter),
    klass: buildClass(events, today, d => worseItems(events.checkIns, d)),
    recovery: buildRecovery(events, today),
    back: buildBack(events, today, flags),
    adherence: buildAdherence(events, today),
    load: buildLoad(sessionLoads(events, today), today),
    levels: buildLevels(levelIn),
    ownEases,
  }
}

/** The model as athlete_estimates rows (§13.5): one per lift, then one per area (two for run and class). */
export function modelRows(m: AthleteModel): EstimateRow[] {
  const row = (kind: EstimateRow['kind'], key: string, c: { state: EstimateState; n: number; u: number }, value: unknown): EstimateRow =>
    ({ kind, key, valueJson: JSON.stringify(value), state: c.state, n: Math.round(c.n), uncertainty: c.u })
  const rows: EstimateRow[] = []
  for (const [id, l] of Object.entries(m.lifts).sort(([a], [b]) => a.localeCompare(b))) rows.push(row('lift', id, l, l))
  const { recent, ...runRest } = m.run
  rows.push(row('run', 'line', m.run, { lineBpm: m.run.lineBpm, lineSource: m.run.lineSource, linePriorBpm: m.run.linePriorBpm, talkTests: m.run.talkTests, lastTalkTestDay: m.run.lastTalkTestDay, recheckDue: m.run.recheckDue, recheckWhy: m.run.recheckWhy, evidence: m.run.evidence, lastDay: m.run.lastDay }))
  rows.push(row('run', 'tolerance', m.run, { ...runRest, recent }))
  rows.push(row('bag', 'main', m.bag, m.bag))
  const { days, ...klass } = m.klass
  rows.push(row('class', 'main', m.klass, klass))
  rows.push(row('class', 'days', m.klass, { days }))
  rows.push(row('recovery', 'main', m.recovery, m.recovery))
  rows.push(row('back', 'main', m.back, m.back))
  const a = m.adherence
  for (const k of CELLS) rows.push(row('adherence', k, { state: a.cells[k].state, n: a.cells[k].n, u: confidence(a.cells[k].state, a.cells[k].n, a.lastDay, m.asOfDay).u }, a.cells[k]))
  rows.push(row('adherence', 'start-times', a, { usualStart: a.usualStart, pmShareOfDone: a.pmShareOfDone }))
  rows.push(row('adherence', 'rest-days', a, { restDays: a.restDays, preferredRestDays: a.preferredRestDays }))
  rows.push(row('adherence', 'schedule', a, a.scheduleSkips))
  const known = m.load.recent.length ? { state: 'LEARNING' as EstimateState, n: m.load.recent.length, u: 0.5 } : { state: 'GUESS' as EstimateState, n: 0, u: 1 }
  rows.push(row('load', 'pools', known, { ...m.load, ownEases: m.ownEases }))
  for (const [d, l] of Object.entries(m.levels)) rows.push(row('level', d, { state: l.sessions >= 6 ? 'KNOWN' : l.sessions > 0 ? 'LEARNING' : 'GUESS', n: l.sessions, u: l.sessions >= 6 ? 0.15 : l.sessions > 0 ? 0.5 : 1 }, l))
  return rows
}

/** One plain line per area, for the nightly log and the replay (no personal data beyond the numbers). */
export function modelSummary(m: AthleteModel): string[] {
  const kg = (v: number | null) => (v == null ? '-' : `${Math.round(v * 2.20462)} lb`)
  const lines: string[] = []
  for (const l of Object.values(m.lifts)) {
    lines.push(`lift ${l.exerciseId}: ${l.state} u=${l.u} n=${l.n} e1RM=${kg(l.e1rmKg)} working=${kg(l.workingKg)} (${l.workingSource ?? '-'}${l.seed ? ` from ${kg(l.seed.lastKg)} ${l.seed.daysOff} days before the block, -${Math.round(l.seed.discount * 100)}%` : ''}) bias=${l.rirBias} exposures=${l.exposures}${l.last ? ` last: top ${kg(l.last.topKg)} of ${kg(l.last.plannedKg)}${l.last.lowered ? ' LOWERED' : ''}${l.last.raised ? ' RAISED' : ''}${l.last.incomplete ? ' INCOMPLETE' : ''} rir=${l.last.lastRir ?? '-'}` : ''} easeStreak=${l.easeStreak}`)
  }
  const r = m.run
  lines.push(`run: ${r.state} u=${r.u} line=${r.lineBpm} (${r.lineSource}; age prior ${r.linePriorBpm}) U=${r.uShare ?? '-'} drift=${r.driftBpm ?? '-'} rung=${r.rungSec}s (${r.rungSource ?? '-'}${r.seed ? `: history median ${r.seed.medianSec}s, longest ${r.seed.longestSec}s, avg HR ${r.seed.avgHr ?? '-'}` : ''}) longest30=${r.longestLast30Sec ?? '-'}s easyPace=${r.easyPaceSecKm ?? '-'}s/km runs=${r.runs} withHr=${r.runsWithHr} recheck=${r.recheckWhy ?? 'no'}`)
  lines.push(`bag: ${m.bag.state} u=${m.bag.u} rounds=${m.bag.roundsTolerated ?? '-'} finishers=${m.bag.finishersAllowed} sessions=${m.bag.sessions} scheduleCuts=${m.bag.scheduleCuts}`)
  const classDays = Object.entries(m.klass.days).filter(([, n]) => n.n > 0 || n.recoverySkips > 0).map(([d, n]) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(d)]} ${n.attended}/${n.suggested} sched-skip ${n.scheduleSkips} p=${n.p}`).join('; ')
  lines.push(`class: ${m.klass.state} u=${m.klass.u} perWeek=${m.klass.perWeekTolerated} classes=${m.klass.classes} days: ${classDays || '-'}`)
  const base = Object.entries(m.recovery.baseline).map(([k, b]) => `${k} ${b?.mean}±${b?.sd}`).join(', ')
  lines.push(`recovery: ${m.recovery.state} u=${m.recovery.u} check-ins=${m.recovery.checkIns} baseline: ${base || 'not live'}`)
  lines.push(`back: ${m.back.state} u=${m.back.u} level=${m.back.level ?? '-'} trend=${m.back.trend ?? '-'} scores=${m.back.scores} notes=${m.back.backNotes} openPlans=${m.back.openPlans}`)
  const a = m.adherence
  const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
  const cells = CELLS.map(k => `${k} ${a.cells[k].p} (n ${a.cells[k].n}, ${a.cells[k].state})`).join('; ')
  const starts = Object.entries(a.usualStart).map(([t, s]) => `${t} ~${hhmm(s.minute)} (${s.inCluster}/${s.of})`).join(', ')
  lines.push(`when: ${a.state} u=${a.u} ${cells}`)
  lines.push(`when: usual starts ${starts || '-'}; PM share of done ${a.pmShareOfDone ?? '-'}; rest days ${a.preferredRestDays.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') || '-'}; schedule skips ${a.scheduleSkips.total}`)
  const L = m.load
  lines.push(`load: strength fatigue ${L.strengthFatigue}, endurance fatigue ${L.enduranceFatigue}, endurance fitness ${L.enduranceFitness}, form ${L.form}; last 7 days strength ${L.last7.strength} endurance ${L.last7.endurance}`)
  lines.push(`levels: ${Object.entries(m.levels).map(([d, l]) => `${d} ${l.level} (${l.sessions})`).join(', ')}; own eases holding: ${m.ownEases.map(e => `${e.domain} ${e.kind}`).join(', ') || 'none'}`)
  return lines
}

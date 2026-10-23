// Coach brain P2 (coach-brain.md §3 step 2, §5.2, §6.2, §6.3): the rules-only
// brain's dose for one session. For each kind of session the rules read the
// athlete model and pick a level on the ladder
//
//   REST · RECOVER · EASE · HOLD · PROGRESS · PUSH
//
// under today's readiness ceiling (§6.1), then write the exact dose: sets ×
// reps @ weight, run pieces and rounds, bag rounds. The dose comes from the
// model and its uncertainty u (§4): target RIR = 2 + round(1.5u), sets =
// 3 − round(u), run piece = rung × (1 − 0.3u), bag rounds = tolerance ×
// (1 − 0.3u). One mechanism: no lead-in, no comeback ramp, no stacked eases.
// What he actually did beats the prescription: a weight he lowered or raised,
// a set not finished, a run or bag session cut short (HOLD when the reason is
// time), HR over the line. Pure.

import { RUN_WALK_WEEKS, runWalkTotalSec, singleRunCap, weeklyRunCap, RESTART_SESSION_SEC, type WeeklyRunContext } from '../blockZero/running'
import { snapIncreaseKg, snapLoadKg, type LoadEquipment } from '../strengthLoads'
import { liftRegion } from '../blockZero/strength'
import { workingWeight, RUNG_LADDER } from './athleteModel'
import { backDaySwap, chooseSlot, ravenSwap, slotOf, type MainSlot } from './progression'
import type { ReadinessState } from './readiness'
import type { AthleteModel, LiftEstimate } from './types'
import { CONTINUOUS_FROM_SEC, gapWords, monthOf } from './history'

export type Level = 'REST' | 'RECOVER' | 'EASE' | 'HOLD' | 'PROGRESS' | 'PUSH'
export const LEVELS: readonly Level[] = ['REST', 'RECOVER', 'EASE', 'HOLD', 'PROGRESS', 'PUSH']
const RANK: Readonly<Record<Level, number>> = { REST: 0, RECOVER: 1, EASE: 2, HOLD: 3, PROGRESS: 4, PUSH: 5 }

/** Today's ceiling from the readiness state (§6.1). */
export const CEILING: Readonly<Record<ReadinessState, Level>> = { FRESH: 'PUSH', GREEN: 'PROGRESS', AMBER: 'HOLD', RED: 'RECOVER' }

export function minLevel(a: Level, b: Level): Level {
  return RANK[a] <= RANK[b] ? a : b
}

export function levelAbove(a: Level, b: Level): boolean {
  return RANK[a] > RANK[b]
}

/** What every dose reads besides its own inputs. */
export interface DoseCtx {
  day: number
  /** The effective state: the night's ceiling, lowered by the morning check-in. */
  state: ReadinessState
  stateWhy: string | null
  model: AthleteModel
  backToday: number | null
  /** Open raven plans by region (an implemented plan is a limit). */
  openPlans: ReadonlyArray<{ region: string }>
  /**
   * The highest level this dose may take (coach brain P3): the nightly
   * decision's pick when it is below the rules' own. Only ever lowers.
   */
  levelCap?: Level | null
  /**
   * A level above the rules' default the nightly decision chose with numeric
   * evidence (approved 2026-10-21, item 12). It only lifts a HOLD signal (never
   * an ease, never a lift with no reps-left on file or a high uncertainty), and
   * the readiness ceiling and every hard limit (one step a week, felt hard,
   * run caps, AMBER) still apply on top.
   */
  levelFloor?: Level | null
}

/** The higher of two levels. */
export function maxLevel(a: Level, b: Level): Level {
  return RANK[a] >= RANK[b] ? a : b
}

/** Most uncertainty a push above the rules' default may carry (item 12). */
export const PUSH_MAX_U = 0.5

const DAY_WORD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** His own skip or lighter swap still holding a domain (idea 12): the level stays at HOLD at most. */
export function ownHold(model: AthleteModel, domain: 'strength' | 'run' | 'bag'): { why: string } | null {
  const e = [...(model.ownEases ?? [])].reverse().find(x => x.domain === domain && (x.kind === 'skipped' || x.kind === 'swapped'))
  if (!e) return null
  const day = DAY_WORD[((e.day % 7) + 11) % 7]
  return { why: e.kind === 'skipped' ? `You sat out ${day}'s session. Same as last time today, nothing added.` : `You went lighter on ${day}. Same as last time today, nothing added.` }
}

/** Today's ceiling: the readiness state's, lowered by a decision's level cap. */
export function ceilingFor(ctx: Pick<DoseCtx, 'state' | 'levelCap'>): Level {
  return ctx.levelCap ? minLevel(CEILING[ctx.state], ctx.levelCap) : CEILING[ctx.state]
}

/** At or below RECOVER (a rest pick doses like recover if it is started anyway). */
const recoverOrLess = (l: Level) => RANK[l] <= RANK.RECOVER

// ─── Strength ────────────────────────────────────────────────

/** Block Zero's targets the model's u works down from (§4, §6.2). */
export const BASE_SETS = 3
export const BASE_RIR = 2
export const MAX_SETS = 4
export const WORKUP_SETS = 4

export interface MainLiftIn {
  exerciseId: string
  label: string
  reps: number
  notes?: string | null
}

export interface StrengthIn {
  kind: 'block_zero' | 'fighter'
  main: MainLiftIn[]
  /** Fighter: TM × the wave's % per lift, and the wave's sets and reps. */
  fighter?: { loadKg: Readonly<Record<string, number | null>>; sets: number; reps: number } | null
  tmKg: Readonly<Record<string, number>>
  equipment: Readonly<Record<string, LoadEquipment>>
  /** Lifts that already stepped up this calendar week: one step a week. */
  steppedThisWeek: readonly string[]
  /** The last similar session felt 2+ over its target, or the next morning was sore (4+): at most HOLD. */
  lastFeltHard: string | null
}

export type LoadChange = 'start' | 'increase' | 'hold' | 'decrease'

export interface LiftDose {
  exerciseId: string
  label: string
  slot: MainSlot | null
  sets: number
  reps: number
  targetRir: number
  weightKg: number | null
  /** "Find your weight": sets of 8 a little heavier each time (a lift the model knows nothing about). */
  workUp: boolean
  /** Work-up weights per set (ascending). */
  setWeightsKg?: Array<number | null>
  change: LoadChange
  fromKg: number | null
  level: Level
  u: number
  state: string
  note: string | null
  why: string | null
}

export interface StrengthDose {
  kind: 'strength'
  level: Level
  lifts: LiftDose[]
  /** Accessory sets for the day (null: as the template has them). */
  accessorySets: number | null
  /** Main working sets at the rules' HOLD level, and as prescribed (the replay compares them). */
  holdSets: number
  sets: number
  why: string[]
}

/** Default first weight when nothing is known (kg): the empty bar, a light dumbbell. */
export function startKg(equipment: LoadEquipment): number | null {
  switch (equipment) {
    case 'barbell': return 20.41 // 45 lb bar
    case 'dumbbell': return 9.07 // 20 lb
    case 'machine': return 18.14 // 40 lb
    default: return null
  }
}

function snap(kg: number | null, eq: LoadEquipment, dir: 'nearest' | 'up' | 'down' = 'nearest'): number | null {
  if (kg == null || !(kg > 0)) return kg
  return snapLoadKg(kg, eq, { direction: dir })
}

/** One load step for a lift: lower body +5-10%, upper +2.5-5% (§6.2), snapped to the next loadable step. */
export function stepUpKg(fromKg: number, exerciseId: string, eq: LoadEquipment, large = false): number {
  const lower = liftRegion(exerciseId) === 'lower'
  const pct = lower ? (large ? 0.1 : 0.05) : (large ? 0.05 : 0.025)
  return snapIncreaseKg(fromKg, fromKg * (1 + pct), eq)
}

const STEP_DOWN: Readonly<Record<'upper' | 'lower', number>> = { upper: 0.05, lower: 0.075 }

/** §4: target RIR and sets from u. */
export function liftTargets(u: number): { rir: number; sets: number } {
  return { rir: BASE_RIR + Math.round(1.5 * u), sets: Math.max(1, BASE_SETS - Math.round(u)) }
}

/** The lift's signal level from what he actually did (§6.2). */
export function liftSignal(lift: LiftEstimate | undefined): { level: Level; why: string | null } {
  if (!lift || !lift.last) return { level: 'HOLD', why: null }
  const last = lift.last
  if (last.lowered) return { level: 'EASE', why: `${lift.exerciseId}: you lowered the weight last time. It starts from what you used.` }
  if (last.incomplete && !last.claimedShort) return { level: 'EASE', why: `${lift.exerciseId}: a set came up short last time.` }
  if (last.lastRir != null && last.lastRir <= BASE_RIR - 1) return { level: 'EASE', why: `${lift.exerciseId}: ${last.lastRir} left on the last set last time.` }
  if (last.claimedShort) return { level: 'HOLD', why: null }
  const recent = lift.recent ?? [last]
  const two = recent.slice(-2)
  const easy = (e: typeof last) => e.lastRir != null && e.lastRir >= BASE_RIR + 1 && !e.incomplete && !e.lowered
  if (two.length === 2 && two.every(easy)) return { level: 'PROGRESS', why: `${lift.exerciseId}: 3+ left on the last set two sessions running.` }
  if (last.raised && !last.incomplete && (last.lastRir == null || last.lastRir >= BASE_RIR)) return { level: 'PROGRESS', why: `${lift.exerciseId}: you raised the weight and hit every rep.` }
  return { level: 'HOLD', why: null }
}

/** Plain lift names in why-lines (the model keys are exercise ids). */
function named(why: string | null, id: string, label: string): string | null {
  return why == null ? null : why.replace(id, label)
}

function blockZeroLift(ctx: DoseCtx, inp: StrengthIn, tex: MainLiftIn, sessionCeiling: Level): LiftDose {
  const slot = slotOf(tex.exerciseId)
  let exerciseId = tex.exerciseId
  let label = tex.label
  let note: string | null = tex.notes ?? null
  const whys: string[] = []
  if (slot) {
    const c = chooseSlot(slot, ctx.model)
    exerciseId = c.exerciseId
    label = c.label
    if (c.note) note = `${c.note} ${note ?? ''}`.trim()
    if (c.why) whys.push(c.why)
  }
  const swap = ravenSwap(exerciseId, ctx.openPlans) ?? backDaySwap(exerciseId, ctx.backToday)
  if (swap) { exerciseId = swap.exerciseId; label = swap.label; whys.push(swap.why) }
  const eq = inp.equipment[exerciseId] ?? 'none'
  const lift = ctx.model.lifts[exerciseId]
  const u = lift?.u ?? 1
  const t = liftTargets(u)
  const reps = tex.reps

  // A lift the model knows nothing about: find your weight (§7), sets of 8 working up.
  const known = lift != null && lift.workingKg != null && lift.workingSource !== 'training_max'
  if (!known) {
    const tm = inp.tmKg[exerciseId]
    const fromTm = tm != null ? snap(workingWeight(tm / 0.9, reps, BASE_RIR + 2, 0, eq) * 0.8, eq, 'down') : null
    const first = fromTm ?? startKg(eq)
    const weights: Array<number | null> = []
    let w = first
    const n = recoverOrLess(sessionCeiling) ? 2 : ctx.state === 'AMBER' || sessionCeiling === 'EASE' ? WORKUP_SETS - 1 : WORKUP_SETS
    for (let i = 0; i < n; i++) {
      weights.push(w)
      if (w != null && eq !== 'none') w = stepUpKg(w, exerciseId, eq, true)
    }
    const level = minLevel('HOLD', sessionCeiling)
    return {
      exerciseId, label, slot, sets: n, reps, targetRir: 3, weightKg: first, workUp: true, setWeightsKg: weights, change: 'start', fromKg: null, level, u, state: lift?.state ?? 'GUESS',
      note: `Find your weight: sets of ${reps}, a little heavier each set. Stop adding at the first set with about 3 left, and stay there. ${note ?? ''}`.trim(),
      why: whys.join(' ') || null,
    }
  }

  // Known: the working weight for today's target RIR from the e1RM, else the weight he last used.
  const last = lift.last
  const usedKg = last?.topKg ?? lift.workingKg
  // The weight reads the target RIR unrounded (2 + 1.5u), so it climbs as u falls; he sees the rounded RIR.
  const fromE1rm = lift.e1rmKg != null ? workingWeight(lift.e1rmKg, reps, BASE_RIR + 1.5 * u, lift.rirBias, eq) : null
  const sig = liftSignal(lift)
  // A decision's push (item 12) lifts only a HOLD signal on a lift with reps-left on file and low uncertainty.
  const floorOk = ctx.levelFloor != null && sig.level === 'HOLD' && last?.lastRir != null && u <= PUSH_MAX_U
  let level = minLevel(floorOk ? maxLevel(sig.level, ctx.levelFloor as Level) : sig.level, sessionCeiling)
  if (level === 'PROGRESS' && ctx.state === 'FRESH' && sessionCeiling === 'PUSH' && !floorOk) level = 'PUSH'
  if (levelAbove(level, 'HOLD') && inp.lastFeltHard) level = 'HOLD'
  if (levelAbove(level, 'HOLD') && inp.steppedThisWeek.includes(exerciseId)) level = 'HOLD'
  if (sig.why && level === sig.level) whys.push(named(sig.why, lift.exerciseId, label) as string)
  // Started from his history (no exposure in the block yet): where the weight comes from, in lb.
  if (lift.workingSource === 'history' && lift.seed && level === 'HOLD' && lift.workingKg != null) {
    const lb = (kg: number) => Math.round(kg * 2.20462)
    whys.push(lift.seed.discount > 0
      ? `${label}: ${lb(lift.workingKg)} lb, down from your ${lb(lift.seed.lastKg)} lb in ${monthOf(lift.seed.lastDay)} after ${gapWords(lift.seed.daysOff)} off.`
      : `${label}: ${lb(lift.workingKg)} lb, where you left off.`)
  }

  let sets = t.sets
  let weight: number | null
  let change: LoadChange = 'hold'
  // HOLD: today's target from the e1RM, never more than one step over what he used, and
  // with no RIR on file the weight he used (no RIR, no progression).
  const holdKg = fromE1rm != null && usedKg != null ? Math.min(fromE1rm, stepUpKg(usedKg, exerciseId, eq) - 0.01) : (usedKg ?? fromE1rm)
  if (level === 'RECOVER' || level === 'REST') {
    sets = 1
    weight = snap(holdKg != null ? holdKg * 0.9 : null, eq, 'down')
    change = 'decrease'
  } else if (level === 'EASE') {
    sets = Math.max(1, sets - 1)
    const base = usedKg != null && holdKg != null ? Math.min(usedKg, holdKg) : (holdKg ?? usedKg)
    const twice = lift.easeStreak >= 2
    weight = snap(base != null && twice ? base * (1 - STEP_DOWN[liftRegion(exerciseId)]) : base, eq, twice ? 'down' : 'nearest')
    change = twice ? 'decrease' : 'hold'
    if (twice) whys.push(`${label}: short two sessions running. Weight down a step.`)
  } else if (level === 'PROGRESS' || level === 'PUSH') {
    // One step from the weight he actually used (he raised it: from there).
    const from = usedKg ?? holdKg ?? 0
    if (level === 'PROGRESS' && sets < BASE_SETS) {
      sets += 1
      weight = snap(holdKg, eq)
    } else {
      weight = from > 0 ? stepUpKg(from, exerciseId, eq) : snap(holdKg, eq)
      change = 'increase'
      if (level === 'PUSH') sets = Math.min(MAX_SETS, sets + 1)
    }
  } else {
    weight = snap(holdKg, eq)
    if (weight != null && usedKg != null && weight > usedKg + 0.01) change = 'increase'
    else if (weight != null && usedKg != null && weight < usedKg - 0.01) change = 'decrease'
  }
  // AMBER: hard sessions lose a set (§6.1).
  if (ctx.state === 'AMBER' && level !== 'RECOVER' && level !== 'REST') sets = Math.max(1, sets - 1)
  const targetRir = level === 'RECOVER' || level === 'REST' ? BASE_RIR + 2 : t.rir
  return { exerciseId, label, slot, sets, reps, targetRir, weightKg: weight, workUp: false, change, fromKg: usedKg ?? null, level, u, state: lift.state, note, why: whys.join(' ') || null }
}

/** TM-anchored lifts (Fighter): only the time since the last session adds caution, never the block start. */
export function ageingU(lift: LiftEstimate | undefined): number {
  if (!lift) return 0
  const base = lift.evidence === 'KNOWN' ? 0.15 : lift.evidence === 'LEARNING' ? 0.5 : 1
  return Math.max(0, Math.round((lift.u - base) * 100) / 100)
}

function fighterLift(ctx: DoseCtx, inp: StrengthIn, tex: MainLiftIn, sessionCeiling: Level): LiftDose {
  const f = inp.fighter!
  let exerciseId = tex.exerciseId
  let label = tex.label
  const whys: string[] = []
  const swap = ravenSwap(exerciseId, ctx.openPlans) ?? backDaySwap(exerciseId, ctx.backToday)
  if (swap) { exerciseId = swap.exerciseId; label = swap.label; whys.push(swap.why) }
  const eq = inp.equipment[exerciseId] ?? 'none'
  const lift = ctx.model.lifts[exerciseId] ?? ctx.model.lifts[tex.exerciseId]
  const age = ageingU(lift)
  const base = f.loadKg[tex.exerciseId] ?? null
  const sig = liftSignal(lift)
  const floorOk = ctx.levelFloor != null && sig.level === 'HOLD' && lift?.last?.lastRir != null && (lift?.u ?? 1) <= PUSH_MAX_U
  let level = minLevel(floorOk ? maxLevel(sig.level, ctx.levelFloor as Level) : sig.level, sessionCeiling)
  if (levelAbove(level, 'HOLD') && inp.lastFeltHard) level = 'HOLD'
  if (sig.why && level === sig.level) whys.push(named(sig.why, lift?.exerciseId ?? '', label) as string)
  // The wave carries Fighter progression; time away trims the load a little (≤ 10% at u = 0.4).
  let weight = base != null ? base * (1 - 0.25 * age) : null
  let sets = f.sets
  let change: LoadChange = age > 0 ? 'decrease' : 'hold'
  if (age > 0 && lift?.lastDay != null) whys.push(`${label}: ${ctx.day - lift.lastDay} days since you last lifted it. A little lighter today.`)
  if (level === 'RECOVER' || level === 'REST') { sets = 1; weight = weight != null ? weight * 0.9 : null; change = 'decrease' } else if (level === 'EASE') {
    sets = Math.max(1, sets - 1)
    if ((lift?.easeStreak ?? 0) >= 2 && weight != null) { weight *= 0.95; change = 'decrease' }
  } else if (level === 'PUSH') sets = Math.min(f.sets + 1, MAX_SETS + 1)
  if (ctx.state === 'AMBER' && level !== 'RECOVER' && level !== 'REST') sets = Math.max(1, sets - 1)
  return {
    exerciseId, label, slot: null, sets, reps: f.reps, targetRir: level === 'RECOVER' ? BASE_RIR + 2 : BASE_RIR, weightKg: snap(weight, eq, change === 'decrease' ? 'down' : 'nearest'),
    workUp: false, change, fromKg: base, level, u: lift?.u ?? 1, state: lift?.state ?? 'GUESS', note: tex.notes ?? null, why: whys.join(' ') || null,
  }
}

export function strengthDose(ctx: DoseCtx, inp: StrengthIn): StrengthDose {
  const own = ownHold(ctx.model, 'strength')
  const ceiling = own ? minLevel(ceilingFor(ctx), 'HOLD') : ceilingFor(ctx)
  const lifts = inp.main.map(tex => (inp.kind === 'fighter' && inp.fighter ? fighterLift(ctx, inp, tex, ceiling) : blockZeroLift(ctx, inp, tex, ceiling)))
  // HOLD sets: what the rules give with readiness and signals set aside (the replay's "plain" dose).
  const holdSets = inp.main.reduce((n, _tex, i) => {
    const l = lifts[i]
    if (l.workUp) return n + l.sets
    if (inp.kind === 'fighter' && inp.fighter) return n + inp.fighter.sets
    return n + liftTargets(ctx.model.lifts[l.exerciseId]?.u ?? 1).sets
  }, 0)
  const sets = lifts.reduce((n, l) => n + l.sets, 0)
  const level = lifts.reduce<Level>((m, l) => minLevel(m, l.level), lifts[0]?.level ?? 'HOLD')
  const why = [ctx.state === 'AMBER' || ctx.state === 'RED' ? ctx.stateWhy : null, own && !recoverOrLess(ceiling) ? own.why : null, ...lifts.map(l => l.why)].filter((w): w is string => !!w)
  return { kind: 'strength', level, lifts, accessorySets: recoverOrLess(ceiling) ? 1 : null, holdSets, sets, why }
}

// ─── Run ─────────────────────────────────────────────────────

export const RUNG_FLOOR_SEC = RUNG_LADDER[0]
export const RECOVER_WALK_MIN = 20

export function nextRung(sec: number): number {
  return RUNG_LADDER.find(r => r > sec) ?? RUNG_LADDER[RUNG_LADDER.length - 1]
}

/** The ladder rung at or under a piece. */
export function rungAtOrBelow(sec: number): number {
  const at = RUNG_LADDER.filter(r => r <= sec)
  return at.length ? at[at.length - 1] : RUNG_FLOOR_SEC
}

/** The run-walk shape (walk, rounds) that goes with a rung: the Block Zero ladder week it belongs to. */
export function shapeForRung(rungSec: number): { walkSec: number; rounds: number; warmupSec: number } {
  const w = RUN_WALK_WEEKS.find(x => x.runSec === rungSec) ?? RUN_WALK_WEEKS.find(x => x.runSec >= rungSec) ?? RUN_WALK_WEEKS[RUN_WALK_WEEKS.length - 2]
  return { walkSec: w.walkSec, rounds: w.rounds, warmupSec: w.warmupSec }
}

export interface RunIn {
  kind: 'run_walk' | 'continuous'
  longestLast30Sec: number | null
  weekly: WeeklyRunContext
  hrCeilingBpm: number
  /** A raven plan's run shape (2:00 segments): the rung never goes over it. */
  maxRungSec?: number | null
  /** The raven or an injury turns it into an easy bike or walk. */
  bike?: { label: string; why: string } | null
  /** Continuous runs: the planned time. */
  plannedSec?: number | null
  /** Running seconds of the previous run dose, and whether a run already went up this calendar week. */
  lastRunSec: number | null
  riseThisWeek: boolean
}

export interface RunDose {
  kind: 'run'
  level: Level
  rungSec: number
  runSec: number
  walkSec: number
  rounds: number
  warmupSec: number
  totalSec: number
  /** An easy walk or bike instead of running. */
  walkOnly: boolean
  /** Running seconds at the rules' HOLD level, and as prescribed. */
  holdRunSec: number
  runTotalSec: number
  hrCeilingBpm: number
  talkTestDue: boolean
  capped: boolean
  why: string[]
}

export function runSignal(model: AthleteModel, day: number): { level: Level; why: string | null } {
  const r = model.run
  const recent = r.recent
  const last = recent[recent.length - 1]
  if (!last) return { level: 'HOLD', why: null }
  const prev = recent[recent.length - 2]
  if (last.struggled) {
    const why = last.tooFast ? 'HR sat over your line last run.' : last.cutShort ? 'Last run was cut short.' : last.rpe != null && last.rpe >= 7 ? `Last run felt like a ${last.rpe}.` : last.driftBpm != null && last.driftBpm >= 10 ? `HR drifted up ${last.driftBpm} bpm last run.` : 'Last run was a struggle.'
    return { level: 'EASE', why }
  }
  if (last.scheduleCut) return { level: 'HOLD', why: null }
  const recentUp = r.rungUpDay != null && day - r.rungUpDay < 7
  if (last.handled && prev?.handled && !recentUp) return { level: 'PROGRESS', why: last.tooSlow ? 'HR stayed well under your line and it felt easy: you can pick it up a little.' : 'Last two runs sat under your line and felt easy.' }
  return { level: 'HOLD', why: null }
}

function capRounds(shape: { runSec: number; walkSec: number; rounds: number; warmupSec: number }, capSec: number) {
  const cycle = shape.runSec + shape.walkSec
  const rounds = Math.max(0, Math.min(shape.rounds, Math.floor((capSec - shape.warmupSec) / cycle)))
  return { ...shape, rounds }
}

export function runDose(ctx: DoseCtx, input: RunIn): RunDose {
  // A walk-only day (0 s of running) is not a "last run": it never caps or resets the next one (audit #8).
  const inp: RunIn = { ...input, lastRunSec: input.lastRunSec != null && input.lastRunSec > 0 ? input.lastRunSec : null }
  const m = ctx.model.run
  const ceiling = ceilingFor(ctx)
  const why: string[] = []
  const talkTestDue = inp.kind === 'run_walk' && m.recheckDue
  if (inp.bike || recoverOrLess(ceiling)) {
    const reason = inp.bike?.why ?? ctx.stateWhy ?? 'Recover today.'
    const min = RECOVER_WALK_MIN
    return {
      kind: 'run', level: 'RECOVER', rungSec: m.rungSec, runSec: 0, walkSec: 0, rounds: 0, warmupSec: min * 60, totalSec: min * 60, walkOnly: true,
      holdRunSec: 0, runTotalSec: 0, hrCeilingBpm: inp.hrCeilingBpm, talkTestDue: false, capped: false, why: [reason],
    }
  }
  const sig = runSignal(ctx.model, ctx.day)
  const own = ownHold(ctx.model, 'run')
  // A decision's push (item 12): one rung up from a HOLD, never past one rung a week, never with high uncertainty. Runs never PUSH.
  const recentUp = m.rungUpDay != null && ctx.day - m.rungUpDay < 7
  const floorOk = ctx.levelFloor != null && sig.level === 'HOLD' && !recentUp && !inp.riseThisWeek && m.u <= PUSH_MAX_U && !own
  const signal: Level = floorOk ? maxLevel(sig.level, minLevel(ctx.levelFloor as Level, 'PROGRESS')) : sig.level
  const level = minLevel(minLevel(signal === 'PROGRESS' && ceiling === 'PUSH' ? 'PROGRESS' : signal, ceiling), own ? 'HOLD' : 'PUSH')
  if (sig.why && level === sig.level) why.push(sig.why)
  if (own && sig.level === 'PROGRESS') why.push(own.why)

  if (inp.kind === 'continuous') {
    const planned = inp.plannedSec ?? 1800
    let sec = level === 'EASE' ? Math.round(planned * 0.8) : planned
    if (ctx.state === 'AMBER') sec = Math.round(sec * 0.9)
    const cap = singleRunCap(sec, inp.longestLast30Sec)
    const capped = cap.capSec < sec
    if (capped && cap.reason) why.push(cap.reason)
    sec = Math.min(sec, cap.capSec)
    return { kind: 'run', level, rungSec: m.rungSec, runSec: sec, walkSec: 0, rounds: 1, warmupSec: 0, totalSec: sec, walkOnly: false, holdRunSec: Math.min(planned, cap.capSec), runTotalSec: sec, hrCeilingBpm: inp.hrCeilingBpm, talkTestDue, capped, why }
  }

  // He runs 10 min or more straight (his runs, or his history before the block): easy continuous runs, no walk breaks.
  if (m.rungSec >= CONTINUOUS_FROM_SEC && inp.maxRungSec == null) {
    const easy = easyContinuous(ctx, inp, level, sig.level, why)
    if (easy) return easy
  }

  // The rung the dose aims at: one up on PROGRESS; the model has already stepped it back after a struggle.
  let rung = level === 'PROGRESS' ? nextRung(m.rungSec) : rungAtOrBelow(m.rungSec)
  if (inp.maxRungSec != null) rung = Math.min(rung, rungAtOrBelow(inp.maxRungSec))
  const piece = (r: number) => Math.max(RUNG_FLOOR_SEC, Math.min(r, Math.round((r * (1 - 0.3 * m.u)) / 5) * 5))
  const build = (r: number) => ({ runSec: piece(r), ...shapeForRung(r) })
  let shape = build(rung)
  const hold = build(rungAtOrBelow(Math.min(m.rungSec, inp.maxRungSec ?? Infinity)))
  if (ctx.state === 'AMBER') shape = { ...shape, rounds: Math.max(2, shape.rounds - 1) }
  // An ease the decision chose (no struggle on file): one round fewer.
  else if (level === 'EASE' && sig.level !== 'EASE') shape = { ...shape, rounds: Math.max(2, shape.rounds - 1) }
  // Caps: a single run ≤ 110% of the longest in 30 days (never under the first run-walk), the week ≤ +30%.
  const total = runWalkTotalSec(shape)
  const single = singleRunCap(total, inp.longestLast30Sec)
  const singleCap = Math.max(single.capSec, Math.min(total, RESTART_SESSION_SEC))
  const weekly = weeklyRunCap(total, inp.weekly)
  let capSec = Math.min(singleCap, weekly.capSec)
  // Never more running than last time after a struggle; at most one rise a week.
  if (inp.lastRunSec != null && (level === 'EASE' || inp.riseThisWeek)) {
    const maxRounds = Math.floor(inp.lastRunSec / shape.runSec)
    if (shape.runSec * shape.rounds > inp.lastRunSec) capSec = Math.min(capSec, shape.warmupSec + Math.max(0, maxRounds) * (shape.runSec + shape.walkSec))
  }
  let capped = false
  if (capSec < total) {
    shape = capRounds(shape, capSec)
    capped = true
    if (single.capSec < total && single.reason) why.push(single.reason)
    else if (weekly.capSec < total && weekly.reason) why.push(weekly.reason)
  }
  if (shape.rounds < 2) {
    // Too little room for intervals: the first-week shape, else an easy walk.
    const w1 = { runSec: RUN_WALK_WEEKS[0].runSec, walkSec: RUN_WALK_WEEKS[0].walkSec, warmupSec: RUN_WALK_WEEKS[0].warmupSec }
    const rounds = Math.floor((capSec - w1.warmupSec) / (w1.runSec + w1.walkSec))
    shape = rounds >= 2 ? { ...w1, rounds: Math.min(rounds, RUN_WALK_WEEKS[0].rounds) } : { runSec: 0, walkSec: 0, rounds: 0, warmupSec: Math.max(600, capSec) }
  }
  const runTotal = shape.runSec * shape.rounds
  // HOLD inside the same limits (the caps bind every candidate; they are not eases).
  const holdTot = runWalkTotalSec(hold)
  const holdCap = Math.min(Math.max(singleRunCap(holdTot, inp.longestLast30Sec).capSec, Math.min(holdTot, RESTART_SESSION_SEC)), weeklyRunCap(holdTot, inp.weekly).capSec)
  const holdShape = holdTot > holdCap ? capRounds(hold, holdCap) : hold
  const holdTotal = holdShape.runSec * Math.max(0, holdShape.rounds)
  return {
    kind: 'run', level, rungSec: rung, runSec: shape.runSec, walkSec: shape.walkSec, rounds: shape.rounds, warmupSec: shape.warmupSec,
    totalSec: runWalkTotalSec(shape), walkOnly: shape.rounds === 0, holdRunSec: holdTotal, runTotalSec: runTotal,
    hrCeilingBpm: inp.hrCeilingBpm, talkTestDue, capped, why: [...(ctx.state === 'AMBER' ? [ctx.stateWhy ?? 'One round fewer today.'] : []), ...why],
  }
}

/**
 * The why-line of a first run seeded from his history (audit #9, #19): the month of that evidence,
 * and the time off when the run is shorter than his usual. "15 min easy, no walk breaks: your usual
 * run in June was 18 min, less for 4 months off."
 */
export function seedRunWhy(sec: number, seed: { medianSec: number; lastDay: number; daysOff: number }): string {
  const usual = Math.round(seed.medianSec / 60)
  const min = Math.round(sec / 60)
  const off = min < usual && seed.daysOff > 14 ? `, less for ${gapWords(seed.daysOff)} off` : ''
  return `${min} min easy, no walk breaks: your usual run in ${monthOf(seed.lastDay)} was ${usual} min${off}.`
}

/** The next continuous run: 10% longer, to the minute, at least a minute more. */
export function nextContinuous(sec: number): number {
  return Math.max(sec + 60, Math.round((sec * 1.1) / 60) * 60)
}

/**
 * An easy continuous run at the HR line (Block Zero, once he runs 10 min or
 * more straight). The same rules as the run-walk: one rise a week on PROGRESS
 * (10% longer), 20% shorter after a struggle, 10% off on an AMBER morning, the
 * single-run and weekly caps, never more than last time after a struggle.
 * Null when the caps leave less than 10 min: the run-walk takes over.
 */
function easyContinuous(ctx: DoseCtx, inp: RunIn, level: Level, signal: Level, why: string[]): RunDose | null {
  const m = ctx.model.run
  const base = Math.max(CONTINUOUS_FROM_SEC, Math.round(m.rungSec / 60) * 60)
  let sec = level === 'PROGRESS' && !inp.riseThisWeek ? nextContinuous(base) : base
  // An ease the decision chose (no struggle on file): 10% shorter; the model already shortened it after a struggle.
  if (level === 'EASE' && signal !== 'EASE') sec = Math.round((sec * 0.9) / 60) * 60
  if (ctx.state === 'AMBER') sec = Math.round((sec * 0.9) / 60) * 60
  if (inp.lastRunSec != null && (level === 'EASE' || inp.riseThisWeek)) sec = Math.min(sec, Math.max(inp.lastRunSec, level === 'EASE' ? 0 : base))
  const capOf = (x: number) => {
    const single = singleRunCap(x, inp.longestLast30Sec)
    const singleCap = Math.max(single.capSec, Math.min(x, RESTART_SESSION_SEC))
    const weekly = weeklyRunCap(x, inp.weekly)
    return { capSec: Math.min(singleCap, weekly.capSec), reason: singleCap <= weekly.capSec ? single.reason : weekly.reason }
  }
  const cap = capOf(sec)
  const capped = cap.capSec < sec
  if (capped) sec = Math.floor(cap.capSec / 60) * 60
  if (sec < CONTINUOUS_FROM_SEC) return null
  if (capped && cap.reason) why.push(cap.reason)
  const hold = Math.min(base, Math.floor(capOf(base).capSec / 60) * 60)
  if (m.rungSource === 'history' && level === 'HOLD' && m.seed) {
    why.push(seedRunWhy(sec, m.seed))
  }
  return {
    kind: 'run', level, rungSec: sec, runSec: sec, walkSec: 0, rounds: 1, warmupSec: 0, totalSec: sec, walkOnly: false,
    holdRunSec: hold, runTotalSec: sec, hrCeilingBpm: inp.hrCeilingBpm, talkTestDue: m.recheckDue, capped,
    why: [...(ctx.state === 'AMBER' ? [ctx.stateWhy ?? 'A little shorter today.'] : []), ...why],
  }
}

// ─── Bag ─────────────────────────────────────────────────────

export const FIRST_BAG_ROUNDS = 4
export const BAG_CAP_EARLY = 6

export interface BagDose {
  kind: 'bag'
  level: Level
  rounds: number
  holdRounds: number
  finishers: boolean
  why: string[]
}

export function bagDose(ctx: DoseCtx, inp: { maxRounds: number; injuryWhy?: string | null }): BagDose {
  const b = ctx.model.bag
  const ceiling = ceilingFor(ctx)
  if (b.roundsTolerated == null) {
    const rounds = Math.min(FIRST_BAG_ROUNDS, inp.maxRounds)
    return { kind: 'bag', level: minLevel('HOLD', ceiling), rounds: recoverOrLess(ceiling) ? 3 : ceiling === 'EASE' ? rounds - 1 : rounds, holdRounds: rounds, finishers: false, why: ['First bag session: technique rounds while it learns you.'] }
  }
  const hold = Math.max(1, Math.min(inp.maxRounds, Math.round(b.roundsTolerated * (1 - 0.3 * b.u))))
  const own = ownHold(ctx.model, 'bag')
  if (ceiling === 'EASE' && !inp.injuryWhy) return { kind: 'bag', level: 'EASE', rounds: Math.max(1, hold - 1), holdRounds: hold, finishers: false, why: [] }
  if (recoverOrLess(ceiling) || inp.injuryWhy) return { kind: 'bag', level: 'RECOVER', rounds: Math.min(3, hold), holdRounds: hold, finishers: false, why: [inp.injuryWhy ?? ctx.stateWhy ?? 'Technique only today.'] }
  let rounds = hold
  const why: string[] = []
  if (ctx.state === 'AMBER') { rounds = Math.max(1, rounds - 1); why.push(ctx.stateWhy ?? 'One round fewer today.') }
  const finishers = b.finishersAllowed && ceiling !== 'HOLD' && ctx.state !== 'AMBER' && !own
  let level: Level = ctx.state === 'AMBER' ? 'HOLD' : finishers ? 'PROGRESS' : 'HOLD'
  // A decision's push (item 12): one round more than the hold, inside the cap.
  if (level === 'HOLD' && ctx.levelFloor != null && levelAbove(ctx.levelFloor, 'HOLD') && levelAbove(ceiling, 'HOLD') && ctx.state !== 'AMBER' && !own && b.u <= PUSH_MAX_U && rounds < inp.maxRounds) {
    rounds += 1
    level = 'PROGRESS'
  }
  if (own) why.push(own.why)
  return { kind: 'bag', level, rounds, holdRounds: hold, finishers, why }
}

// ─── The dose as the strength template the start route writes ─

/** "about 3 left" / "3 or more left" for a target RIR. */
export function leftWords(rir: number): string {
  return rir >= 3 ? '3 or more left' : `about ${rir} left`
}

/**
 * The template with its main lifts replaced by the dose: the chosen exercise,
 * its sets × reps at the dose's weight (work-up sets climbing), the note in
 * plain words. Accessories keep the template's sets, one set on a recover day.
 */
export function templateFromDose<T extends { exercises: Array<{ exerciseId: string; label: string; section: string; sets: Array<{ isWarmup: boolean; targetReps: number; restSec: number; suggestedWeightKg?: number | null; loadMultiplier?: number }>; notes?: string }> }>(template: T, dose: StrengthDose): T {
  let mainIdx = 0
  const exercises = template.exercises.map(tex => {
    if (tex.section === 'main') {
      const l = dose.lifts[mainIdx++]
      if (!l) return tex
      const rest = tex.sets.find(s => !s.isWarmup)?.restSec ?? 150
      const sets = Array.from({ length: l.sets }, (_, i) => ({ isWarmup: false, targetReps: l.reps, restSec: rest, suggestedWeightKg: l.workUp ? (l.setWeightsKg?.[i] ?? l.weightKg) : l.weightKg }))
      const what = l.workUp ? null : `${l.sets} × ${l.reps}, ${leftWords(l.targetRir)}. Never to failure.`
      return { ...tex, exerciseId: l.exerciseId, label: l.label, sets, notes: [l.why, what, l.note].filter(Boolean).join(' ') }
    }
    if (dose.accessorySets != null && (tex.section === 'accessory' || tex.section === 'core')) {
      const warm = tex.sets.filter(s => s.isWarmup)
      const work = tex.sets.filter(s => !s.isWarmup).slice(0, dose.accessorySets)
      return { ...tex, sets: [...warm, ...work] }
    }
    return tex
  })
  return { ...template, exercises }
}

// ─── A decision's tweak (coach brain P3) ─────────────────────

/**
 * A bounded tweak on top of a chosen dose (coach-brain.md §5.3). Each field is
 * a step count: -1 or 0 (the rules never let a tweak go up; a harder dose is
 * only ever one of the rules' own candidates). setsDelta: every main lift one
 * set less; loadStep: every known lift one weight step down; roundsDelta: a
 * run-walk or bag session one round less (a continuous run 10% shorter).
 */
export interface Tweak { setsDelta: number; loadStep: number; roundsDelta: number }

export const NO_TWEAK: Tweak = { setsDelta: 0, loadStep: 0, roundsDelta: 0 }

export function isNoTweak(t: Tweak | null | undefined): boolean {
  return !t || (t.setsDelta === 0 && t.loadStep === 0 && t.roundsDelta === 0)
}

export function tweakStrength(d: StrengthDose, t: Tweak, equipment: Readonly<Record<string, LoadEquipment>>): StrengthDose {
  if (isNoTweak(t)) return d
  const lifts = d.lifts.map(l => {
    let { sets, weightKg, change, setWeightsKg } = l
    if (t.setsDelta < 0) {
      sets = Math.max(l.workUp ? 2 : 1, sets + t.setsDelta)
      if (setWeightsKg) setWeightsKg = setWeightsKg.slice(0, sets)
    }
    if (t.loadStep < 0 && !l.workUp && weightKg != null && weightKg > 0) {
      const eq = equipment[l.exerciseId] ?? 'none'
      if (eq !== 'none') {
        const down = snap(weightKg * (1 - STEP_DOWN[liftRegion(l.exerciseId)]), eq, 'down')
        if (down != null && down < weightKg) { weightKg = down; change = 'decrease' }
      }
    }
    return { ...l, sets, weightKg, change, setWeightsKg, level: minLevel(l.level, 'EASE') }
  })
  return { ...d, lifts, sets: lifts.reduce((n, l) => n + l.sets, 0), level: minLevel(d.level, 'EASE') }
}

export function tweakRun(d: RunDose, t: Tweak): RunDose {
  if (isNoTweak(t) || t.roundsDelta >= 0 || d.walkOnly) return d
  if (d.rounds <= 1) {
    const sec = Math.round((d.runSec * 0.9) / 30) * 30
    return { ...d, runSec: sec, totalSec: sec, runTotalSec: sec, level: minLevel(d.level, 'EASE') }
  }
  const rounds = Math.max(2, d.rounds + t.roundsDelta)
  const shape = { runSec: d.runSec, walkSec: d.walkSec, rounds, warmupSec: d.warmupSec }
  return { ...d, rounds, totalSec: runWalkTotalSec(shape), runTotalSec: d.runSec * rounds, level: minLevel(d.level, 'EASE') }
}

export function tweakBag(d: BagDose, t: Tweak): BagDose {
  if (isNoTweak(t) || t.roundsDelta >= 0) return d
  return { ...d, rounds: Math.max(1, d.rounds + t.roundsDelta), finishers: false, level: minLevel(d.level, 'EASE') }
}

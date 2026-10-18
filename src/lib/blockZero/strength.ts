// Block Zero strength targets, load steps and back-friendly variations.
//
// R1 (Helms 2016; Zourdos 2016): autoregulate by RPE/RIR, never to failure.
//   Weeks 1-2 RPE 6-7 (3-4 RIR), weeks 3-5 RPE 7-8 (2-3 RIR).
// R2 (ACSM 2009/2026; Rhea 2003): 2-3 hard sets per lift is enough early.
// R3 (ACSM 2009): add ~2-5% upper / ~5-10% lower only when the top set's
//   RIR beats the target.
// R4 (LeSuer 1997): submaximal e1RM check from week 3 (3-5 reps at RPE ~8).
// R16 (Bell 2023): week 6 cuts volume 30-50% and holds intensity.

import { rirFromRpe } from './e1rm'
import { BLOCK_ZERO_BASE_WEEKS, blockZeroPhase, blockZeroTrainingWeek, type BlockZeroPhase } from './weeks'

export interface CheckSetTarget {
  repRange: [number, number]
  targetReps: number
  rpe: number
  /** Load relative to the week's working load. 5 @ RPE 8 vs 8 @ RPE 7-8 is ~1.1x by Epley. */
  loadMultiplier: number
}

export interface StrengthWeekTarget {
  week: number
  phase: BlockZeroPhase
  /** Working sets for main lifts, check set excluded. */
  mainSets: number
  reps: number
  repRange: [number, number]
  rpe: [number, number]
  rir: [number, number]
  checkSet: CheckSetTarget | null
  accessorySets: number
  coreSets: number
  /**
   * Fraction of the stored training max for the working sets. Until per-set
   * RPE exists this anchors the suggestion: week 1 sits in the 50-60% band the
   * evidence gives as a conservative first-session anchor for sets of 8.
   */
  loadPct: number
  /** What the athlete reads on the main lifts. */
  note: string
}

const CHECK_SET: CheckSetTarget = { repRange: [3, 5], targetReps: 5, rpe: 8, loadMultiplier: 1.1 }

function target(t: Omit<StrengthWeekTarget, 'rir' | 'phase'>): StrengthWeekTarget {
  return { ...t, phase: blockZeroPhase(t.week), rir: [rirFromRpe(t.rpe[1]), rirFromRpe(t.rpe[0])] }
}

export const STRENGTH_WEEK_TARGETS: readonly StrengthWeekTarget[] = [
  target({
    week: 1, mainSets: 2, reps: 8, repRange: [8, 10], rpe: [6, 7], checkSet: null,
    accessorySets: 2, coreSets: 2, loadPct: 0.55,
    note: 'Test week. Work up to a set of 8 at RPE 6-7, 3-4 reps left. Log that weight. It is your starting load. No maxes.',
  }),
  target({
    week: 2, mainSets: 2, reps: 8, repRange: [8, 10], rpe: [6, 7], checkSet: null,
    accessorySets: 2, coreSets: 2, loadPct: 0.575,
    note: '2 sets of 8 at RPE 6-7, 3-4 reps left. Never to failure.',
  }),
  target({
    week: 3, mainSets: 2, reps: 8, repRange: [8, 10], rpe: [7, 8], checkSet: CHECK_SET,
    accessorySets: 2, coreSets: 2, loadPct: 0.6,
    note: 'First set is a check: 3-5 reps at about RPE 8, 2 left. Then 2 sets of 8 at RPE 7-8. Never to failure.',
  }),
  target({
    week: 4, mainSets: 3, reps: 8, repRange: [8, 10], rpe: [7, 8], checkSet: null,
    accessorySets: 3, coreSets: 2, loadPct: 0.625,
    note: '3 sets of 8 at RPE 7-8, 2-3 reps left. Add load only when the top set felt easier than that. Never to failure.',
  }),
  target({
    week: 5, mainSets: 3, reps: 8, repRange: [8, 10], rpe: [7, 8], checkSet: null,
    accessorySets: 3, coreSets: 2, loadPct: 0.65,
    note: '3 sets of 8 at RPE 7-8, 2-3 reps left. Add load only when the top set felt easier than that. Never to failure.',
  }),
  target({
    week: 6, mainSets: 1, reps: 8, repRange: [8, 10], rpe: [7, 7], checkSet: CHECK_SET,
    accessorySets: 2, coreSets: 1, loadPct: 0.65,
    note: 'Retest. One set of 3-5 at about RPE 8, 2 left, then one set of 8 at RPE 7. Volume is down, intensity holds.',
  }),
]

/** Targets for a block week. Extension weeks use week 5. */
export function getStrengthWeekTarget(weekNumber: number): StrengthWeekTarget {
  const w = blockZeroTrainingWeek(weekNumber)
  const t = STRENGTH_WEEK_TARGETS[w - 1]
  return weekNumber > BLOCK_ZERO_BASE_WEEKS ? { ...t, phase: 'extension' } : t
}

/** Hard working sets per main lift that week, check set included. */
export function mainLiftHardSets(t: StrengthWeekTarget): number {
  return t.mainSets + (t.checkSet ? 1 : 0)
}

// ─── Load steps (R3) ──────────────────────────────────────────

export type LiftRegion = 'upper' | 'lower'

export interface TopSet {
  weightKg: number
  reps: number
  rpe?: number | null
  rir?: number | null
  /** trainingReality status when no RPE was logged. */
  inferredStatus?: string | null
}

export interface LoadTarget {
  reps: number
  rpe: [number, number]
}

export type LoadChange = 'increase' | 'hold' | 'decrease'

export interface NextLoad {
  weightKg: number
  change: LoadChange
  reason: string
}

const STEP: Record<LiftRegion, { small: number; large: number }> = {
  upper: { small: 0.025, large: 0.05 },
  lower: { small: 0.05, large: 0.1 },
}
const DECREASE = 0.05
const ROUND_TO_KG = 0.5

function roundLoad(kg: number): number {
  return Math.round(kg / ROUND_TO_KG) * ROUND_TO_KG
}

/**
 * Next working load from the last top set. Load only goes up when the top set
 * was easier than the target RPE band (below its low end) with all reps done.
 * At or above the band it holds; clearly above it, or reps short, it drops 5%.
 * Without RPE/RIR, a rep surplus counts as easier and a shortfall as harder.
 */
export function nextLoad(top: TopSet, t: LoadTarget, region: LiftRegion): NextLoad {
  const w = top.weightKg
  if (!(w > 0)) return { weightKg: w, change: 'hold', reason: 'No load logged. Hold.' }

  const rpe = top.rpe ?? (top.rir != null ? 10 - top.rir : null)
  const repsShort = top.reps < t.reps

  if (repsShort || (rpe != null && rpe > t.rpe[1] + 0.5) || top.inferredStatus === 'rep_shortfall') {
    return { weightKg: roundLoad(w * (1 - DECREASE)), change: 'decrease', reason: 'Top set was harder than the target. Down 5%.' }
  }

  if (rpe != null) {
    if (rpe >= t.rpe[0]) return { weightKg: w, change: 'hold', reason: `Top set landed at RPE ${rpe}. Target is ${t.rpe[0]}-${t.rpe[1]}. Hold.` }
    const below = t.rpe[0] - rpe
    const step = below >= 2 ? STEP[region].large : STEP[region].small
    const next = Math.max(roundLoad(w * (1 + step)), w + ROUND_TO_KG)
    return { weightKg: next, change: 'increase', reason: `Top set was RPE ${rpe}, easier than ${t.rpe[0]}-${t.rpe[1]}. Up ${Math.round(step * 1000) / 10}%.` }
  }

  if (top.inferredStatus === 'rep_surplus') {
    const next = Math.max(roundLoad(w * (1 + STEP[region].small)), w + ROUND_TO_KG)
    return { weightKg: next, change: 'increase', reason: `Reps beat the target. Up ${STEP[region].small * 100}%.` }
  }
  return { weightKg: w, change: 'hold', reason: 'No effort rating. Hold.' }
}

// ─── Exercise selection ───────────────────────────────────────

export type MainLiftSlot = 'squat' | 'hinge' | 'row'

/**
 * Back-friendly by default: the easiest-on-the-back version first (goblet
 * squat, DB RDL, supported row), the barbell version from week 3 once the
 * test week and a week of build are in.
 */
export function defaultMainLift(slot: MainLiftSlot, weekNumber: number): { exerciseId: string; label: string } {
  const early = blockZeroTrainingWeek(weekNumber) <= 2
  switch (slot) {
    case 'squat': return early ? { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat' } : { exerciseId: 'ex-front-squat', label: 'Front Squat' }
    case 'hinge': return early ? { exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift' } : { exerciseId: 'ex-block-pull', label: 'Block Pull' }
    case 'row': return early ? { exerciseId: 'ex-db-row', label: 'Dumbbell Row' } : { exerciseId: 'ex-bent-over-row', label: 'Bent Over Row' }
  }
}

/** "Back today" at or below this swaps in lower-load variations. */
export const BACK_FRIENDLY_THRESHOLD = 2

// Spine-loading or hinged patterns → versions with less axial or shear load.
// Every id here exists in seed.ts or migrations 0022 / 0026.
export const BACK_FRIENDLY_SWAPS: Readonly<Record<string, { exerciseId: string; label: string }>> = {
  'ex-front-squat': { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat' },
  'ex-tempo-squat': { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat' },
  'ex-deadlift': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-block-pull': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-trap-bar-deadlift': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-rdl': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-db-rdl': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-single-leg-rdl': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-band-good-morning': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-bent-over-row': { exerciseId: 'ex-db-row', label: 'Dumbbell Row' },
  'ex-ohp': { exerciseId: 'ex-db-ohp', label: 'DB Overhead Press' },
  'ex-bulgarian-split-squat': { exerciseId: 'ex-reverse-lunge', label: 'Reverse Lunge' },
  'ex-ab-wheel': { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs' },
  'ex-body-saw': { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs' },
  'ex-hanging-leg-raise': { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs' },
}

export interface VariationChoice {
  exerciseId: string
  label: string | null
  swapped: boolean
  reason: string | null
}

/** Pure mapping: given "back today" (1-5), the variation to load. */
export function backFriendlyVariation(exerciseId: string, backToday: number | null | undefined): VariationChoice {
  if (backToday == null || backToday > BACK_FRIENDLY_THRESHOLD) {
    return { exerciseId, label: null, swapped: false, reason: null }
  }
  const swap = BACK_FRIENDLY_SWAPS[exerciseId]
  if (!swap) return { exerciseId, label: null, swapped: false, reason: null }
  return {
    exerciseId: swap.exerciseId,
    label: swap.label,
    swapped: true,
    reason: `Back is at ${backToday} today. ${swap.label} keeps load off the spine.`,
  }
}

// ─── Working load from logged effort (R1, R3) ─────────────────

/** Region for the load step. Lifts not listed step as upper body (the smaller step). */
export const LIFT_REGION: Readonly<Record<string, LiftRegion>> = {
  'ex-goblet-squat': 'lower',
  'ex-front-squat': 'lower',
  'ex-tempo-squat': 'lower',
  'ex-db-rdl': 'lower',
  'ex-rdl': 'lower',
  'ex-single-leg-rdl': 'lower',
  'ex-block-pull': 'lower',
  'ex-trap-bar-deadlift': 'lower',
  'ex-deadlift': 'lower',
  'ex-reverse-lunge': 'lower',
  'ex-bulgarian-split-squat': 'lower',
  'ex-glute-bridges': 'lower',
  'ex-bench-press': 'upper',
  'ex-db-bench-press': 'upper',
  'ex-ohp': 'upper',
  'ex-db-ohp': 'upper',
  'ex-bent-over-row': 'upper',
  'ex-db-row': 'upper',
}

export function liftRegion(exerciseId: string): LiftRegion {
  return LIFT_REGION[exerciseId] ?? 'upper'
}

/** Highest RIR the set log offers. The tap reads "3 or more". */
export const RIR_MAX = 3
/**
 * "3 or more" counts as 3.5 (RPE 6.5) for the load step. Exactly 3 would sit
 * on the edge of the RPE 7-8 band and load could never rise from a 3+ tap;
 * 3.5 reads as a little easier than the build-week band (small step up) and
 * inside the test-week band (hold), which is what the tap means.
 */
export const RIR_THREE_PLUS_AS = 3.5

/** Logged RIR (0-3) → the value the load step reads. */
export function effectiveRir(rir: number): number {
  return rir >= RIR_MAX ? RIR_THREE_PLUS_AS : rir
}

export interface LoggedWorkingSet {
  weightKg: number | null
  reps: number
  plannedReps: number | null
  rir: number | null
  /** Unix seconds; orders sets across sessions. */
  completedAt: number | null
  setNumber: number
  /** Groups sets by session. Without it, sets within 3 h of the latest count as one session. */
  sessionId?: string
}

/**
 * The top set of the latest session that logged effort: the heaviest working
 * set with weight, reps and RIR (the later one on a tie, it carries the most
 * fatigue). Check sets (planned 3-5 reps) never count, they have their own target.
 */
export function latestRirTopSet(sets: LoggedWorkingSet[], workingReps: number): LoggedWorkingSet | null {
  const usable = sets.filter(s => s.weightKg != null && s.weightKg > 0 && s.rir != null && s.completedAt != null
    && (s.plannedReps == null || s.plannedReps >= workingReps))
  if (usable.length === 0) return null
  const latest = usable.reduce((a, s) => ((s.completedAt as number) > (a.completedAt as number) ? s : a))
  const session = latest.sessionId != null
    ? usable.filter(s => s.sessionId === latest.sessionId)
    : usable.filter(s => (s.completedAt as number) >= (latest.completedAt as number) - 3 * 3600)
  return session.reduce((best, s) => {
    if ((s.weightKg as number) > (best.weightKg as number)) return s
    if (s.weightKg === best.weightKg && s.setNumber > best.setNumber) return s
    return best
  })
}

export interface WorkingLoad {
  weightKg: number
  source: 'rir'
  change: LoadChange
  reason: string
}

/**
 * Next session's working load for a main lift from its last RIR-logged top
 * set, against the coming week's target. Week 1's work-up (a set of 8 at 3-4
 * left) is that top set, so it becomes the starting load: it lands inside the
 * RPE 6-7 band and holds. An eased day never goes up. Null = no RIR data
 * yet; the caller falls back to training max x %.
 */
export function blockZeroWorkingLoad(input: {
  exerciseId: string
  history: LoggedWorkingSet[]
  target: Pick<StrengthWeekTarget, 'reps' | 'rpe'>
  eased?: boolean
}): WorkingLoad | null {
  const top = latestRirTopSet(input.history, input.target.reps)
  if (!top || top.rir == null || top.weightKg == null) return null
  const next = nextLoad(
    { weightKg: top.weightKg, reps: top.reps, rir: effectiveRir(top.rir) },
    { reps: input.target.reps, rpe: input.target.rpe },
    liftRegion(input.exerciseId),
  )
  if (input.eased && next.weightKg > top.weightKg) {
    return { weightKg: top.weightKg, source: 'rir', change: 'hold', reason: 'Easy day. Load holds.' }
  }
  return { weightKg: next.weightKg, source: 'rir', change: next.change, reason: next.reason }
}

// The set screen's weight: Josh measures in lb (data stays kg). The plan's kg is shown as the
// loadable lb the app already snaps to (strengthLoads.snapLoadKg), the − / + step is that
// equipment's smallest loadable change, and what is logged goes back to kg.
import { LOAD_STEP, bodyweightOk, ladderRungKg, loadEquipment, snapIncreaseKg, snapLoadKg } from '../strengthLoads'
import { liftRegion } from '../blockZero/strength'
import { isPower } from '../landmine'
import { kgToLbs, lbsToKg } from '../units'

/** The planned weight on the set screen, in whole loadable lb (null = bodyweight, no weight row). */
export function plannedSetLbs(kg: number | null | undefined, equipment: string | null | undefined): number | null {
  if (kg == null || !Number.isFinite(kg)) return null
  if (kg <= 0) return 0
  const eq = loadEquipment(equipment)
  // A landmine's plates go on one at a time, 2.5 lb the smallest: half pounds show.
  if (eq === 'landmine') return Math.round(snapLoadKg(kg, eq) * 2.20462 * 2) / 2
  return kgToLbs(snapLoadKg(kg, eq))
}

/**
 * Where the weight row starts. The plan's load when it has one. A loadable lift
 * with no planned load (a dumbbell or kettlebell main lift in the week-1 work-up,
 * "Log that weight") still gets the row: it starts from this lift's last logged
 * weight (earlier this session, else last session), else 0 (the empty bar for a
 * barbell). Bodyweight-only lifts have no weight row (null).
 */
export function startSetLbs(plannedKg: number | null | undefined, equipment: string | null | undefined, carryKg?: number | null, editedKg?: number | null): number | null {
  // He changed the last set at this same planned load: the next one starts where he put it (m12).
  if (editedKg != null && editedKg > 0 && loadEquipment(equipment) !== 'none') return plannedSetLbs(editedKg, equipment)
  const planned = plannedSetLbs(plannedKg, equipment)
  if (planned != null) return planned
  const eq = loadEquipment(equipment)
  if (eq === 'none') return null
  const carried = carryKg != null && carryKg > 0 ? plannedSetLbs(carryKg, equipment) : null
  if (carried != null) return carried
  return eq === 'barbell' ? 45 : 0
}

/** The − / + step in lb: the smallest loadable change (5 lb; a landmine plate 2.5 lb), never below 0 (or the empty bar for a barbell). */
export function stepSetLbs(lbs: number, dir: 1 | -1, equipment: string | null | undefined): number {
  const eq = loadEquipment(equipment)
  const step = eq === 'none' ? 5 : LOAD_STEP.lb[eq]
  const floor = eq === 'barbell' && lbs >= 45 ? 45 : 0
  return Math.max(floor, lbs + dir * step)
}

/** What is logged: the lb on the screen, stored as kg. 0 is no weight (bodyweight), never a weight of 0. */
export function setLbsToKg(lbs: number | null): number | null {
  return lbs == null || !(lbs > 0) ? null : lbsToKg(lbs)
}

/**
 * LOG SET waits for a weight (m11, "Set the weight you lift."): a working set
 * of a loadable lift (dumbbell, kettlebell, barbell, cable, machine) still at 0.
 * A lift he can do at bodyweight (calf raise, lunge, single-leg RDL) logs at 0.
 */
export function setNeedsWeight(equipment: string | null | undefined, isWarmup: boolean, lbs: number | null): boolean {
  if (isWarmup || lbs == null || lbs > 0) return false
  // A landmine at 0 is the bar only: a real load.
  if (loadEquipment(equipment) === 'landmine') return false
  return loadEquipment(equipment) !== 'none' && !bodyweightOk(equipment)
}

// ─── What this session lifted, kept on the phone (m10, m12) ───

/** Per lift: the last weight logged (any set), and the last working set's plan, weight and reps left. */
export interface LiftCarry {
  kg?: number
  work?: { plannedKg: number | null; kg: number; rir?: number | null }
}

/** Where a session's carried weights wait on the phone (an offline reload keeps them). */
export function carryKey(sessionId: string): string {
  return `waymark_carry_kg:${sessionId}`
}

export function parseCarry(raw: string | null | undefined): Record<string, LiftCarry> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, LiftCarry>) : {}
  } catch {
    return {}
  }
}

/** After a logged set: remember its weight, and a working set's plan beside it. */
export function withLogged(carry: Record<string, LiftCarry>, exerciseId: string, kg: number | null, set: { isWarmup: boolean; plannedKg: number | null }): Record<string, LiftCarry> {
  if (kg == null || !(kg > 0)) return carry
  const prev = carry[exerciseId] ?? {}
  return { ...carry, [exerciseId]: { kg, work: set.isWarmup ? prev.work : { plannedKg: set.plannedKg, kg } } }
}

/** The reps-left tap on the last working set (3 = "3+"), kept beside its weight. */
export function withEffort(carry: Record<string, LiftCarry>, exerciseId: string, rir: number | null): Record<string, LiftCarry> {
  const prev = carry[exerciseId]
  if (!prev?.work) return carry
  return { ...carry, [exerciseId]: { ...prev, work: { ...prev.work, rir } } }
}

/** One load step up from a weight (lower body +5%, upper +2.5%), at least the smallest loadable change. */
export function oneStepUpKg(kg: number, exerciseId: string, equipment: string | null | undefined): number {
  const eq = loadEquipment(equipment)
  return snapIncreaseKg(kg, kg * (liftRegion(exerciseId) === 'lower' ? 1.05 : 1.025), eq)
}

/**
 * Where a working set starts from what he did on the last one (null: the plan).
 * - At the same planned load (m12): where he put it; after a "3+" at the plan
 *   (rebuild Phase 4), one step over it, as a "Try N lb?" (`up`).
 * - A work-up: after a "3+" the next rung, never under one rung over what he
 *   lifted; at the first set with about 3 left (a tap of 2 or less), or a rung
 *   he stayed under, every later set stays at what he logged ("stop adding, and
 *   stay there").
 */
export function carryStart(c: LiftCarry | undefined, set: { isWarmup: boolean; plannedKg: number | null }, exerciseId = '', equipment: string | null = null): { kg: number; up: boolean } | null {
  if (set.isWarmup || !c?.work || set.plannedKg == null || c.work.plannedKg == null) return null
  const w = { ...c.work, plannedKg: c.work.plannedKg }
  // A power move's sets are fixed: no step up mid-session (page 93).
  const easy = w.rir != null && w.rir >= 3 && !isPower(exerciseId)
  if (Math.abs(w.plannedKg - set.plannedKg) <= 0.01) {
    // One step over the plan, once: a second 3+ at the step keeps it (the coach moves the plan next time).
    if (easy && exerciseId && loadEquipment(equipment) !== 'none' && w.kg <= w.plannedKg + 0.01) return { kg: oneStepUpKg(w.plannedKg, exerciseId, equipment), up: true }
    return Math.abs(w.kg - set.plannedKg) > 0.01 ? { kg: w.kg, up: false } : null
  }
  if (set.plannedKg <= w.plannedKg + 0.01) return null
  // The next rung of a climb.
  const stopped = w.kg < w.plannedKg - 0.01 || (w.rir != null && w.rir < 3)
  if (stopped) return set.plannedKg > w.kg + 0.01 ? { kg: w.kg, up: false } : null
  if (easy && exerciseId && loadEquipment(equipment) !== 'none') {
    const rung = ladderRungKg(w.kg, loadEquipment(equipment), liftRegion(exerciseId))
    return rung > set.plannedKg + 0.01 ? { kg: rung, up: false } : null
  }
  return null
}

/** The weight a working set starts from when he changed the last one, or after his tap on it; else null. */
export function editedStartKg(c: LiftCarry | undefined, set: { isWarmup: boolean; plannedKg: number | null }, exerciseId = '', equipment: string | null = null): number | null {
  return carryStart(c, set, exerciseId, equipment)?.kg ?? null
}

/**
 * The ladder keeps going (rebuild Phase 4): after the last set of a
 * find-your-weight climb still read "3+", one more set a load step up (the
 * planned rungs were the big jumps; past them it closes in), up to `maxSets`
 * working sets. Null: the climb is done.
 */
export function nextRungAfter(sets: ReadonlyArray<{ isWarmup: boolean | number; plannedWeightKg?: number | null; weightKg?: number | null }>, loggedKg: number | null, rir: number | null, exerciseId: string, equipment: string | null | undefined, maxSets: number): number | null {
  const work = sets.filter(s => !s.isWarmup)
  if (rir == null || rir < 3 || loggedKg == null || !(loggedKg > 0) || work.length >= maxSets) return null
  const eq = loadEquipment(equipment)
  if (eq === 'none') return null
  const first = work[0]?.plannedWeightKg ?? null
  const last = work[work.length - 1]?.plannedWeightKg ?? null
  // A climb: the plan rises from its first set to its last.
  if (first == null || last == null || !(last > first + 0.01)) return null
  return oneStepUpKg(loggedKg, exerciseId, equipment)
}

// The set screen's weight: Josh measures in lb (data stays kg). The plan's kg is shown as the
// loadable lb the app already snaps to (strengthLoads.snapLoadKg), the − / + step is that
// equipment's smallest loadable change, and what is logged goes back to kg.
import { LOAD_STEP, loadEquipment, snapLoadKg } from '../strengthLoads'
import { kgToLbs, lbsToKg } from '../units'

/** The planned weight on the set screen, in whole loadable lb (null = bodyweight, no weight row). */
export function plannedSetLbs(kg: number | null | undefined, equipment: string | null | undefined): number | null {
  if (kg == null || !Number.isFinite(kg)) return null
  if (kg <= 0) return 0
  return kgToLbs(snapLoadKg(kg, loadEquipment(equipment)))
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

/** The − / + step in lb: the smallest loadable change (5 lb), never below 0 (or the empty bar for a barbell). */
export function stepSetLbs(lbs: number, dir: 1 | -1, equipment: string | null | undefined): number {
  const eq = loadEquipment(equipment)
  const step = eq === 'none' ? 5 : LOAD_STEP.lb[eq]
  const floor = eq === 'barbell' && lbs >= 45 ? 45 : 0
  return Math.max(floor, lbs + dir * step)
}

/** What is logged: the lb on the screen, stored as kg. */
export function setLbsToKg(lbs: number | null): number | null {
  return lbs == null ? null : lbsToKg(lbs)
}

// ─── What this session lifted, kept on the phone (m10, m12) ───

/** Per lift: the last weight logged (any set), and the last working set's plan and weight. */
export interface LiftCarry {
  kg?: number
  work?: { plannedKg: number | null; kg: number }
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

/** The weight a working set starts from when he changed the last one at the same planned load; else null. */
export function editedStartKg(c: LiftCarry | undefined, set: { isWarmup: boolean; plannedKg: number | null }): number | null {
  if (set.isWarmup || !c?.work || set.plannedKg == null || c.work.plannedKg == null) return null
  if (Math.abs(c.work.plannedKg - set.plannedKg) > 0.01) return null
  return Math.abs(c.work.kg - set.plannedKg) > 0.01 ? c.work.kg : null
}

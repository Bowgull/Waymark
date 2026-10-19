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
export function startSetLbs(plannedKg: number | null | undefined, equipment: string | null | undefined, carryKg?: number | null): number | null {
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

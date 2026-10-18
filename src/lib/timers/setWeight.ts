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

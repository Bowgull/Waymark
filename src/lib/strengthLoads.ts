// Loadable weights, warm-up ramps and accessory loads. Pure.
//
// - Plate snapping: a prescription you can't load is a prescription you don't
//   lift (44 kg shows "97 lb", the bar takes 95). Barbell loads snap to the
//   bar plus the smallest plate pair (5 lb total, 2.5 kg total), dumbbells and
//   stacks to their usual steps (5 lb, 2 kg). When the rule says increase, the
//   next loadable step up is used, so small upper-body steps (~1 kg) land.
//   The app shows pounds, so 'lb' is the default unit; nothing in settings
//   names a plate set yet.
// - Warm-up ramp (general strength-training practice; the evidence file
//   favours ramp work over going in cold): ~45% x5, ~65% x3, ~80% x2 before
//   the first heavy set, starting at the empty bar, fewer sets for light
//   loads. Ramp sets are isWarmup, so no stat counts them.
// - Accessories are never prescribed at 100% of a training max: ~60% of TM is
//   a set of 10-12 at a moderate effort (ACSM novice ranges, 60-70% 1RM for
//   8-12; TM is already below 1RM). Core and durability work gets no load.
// - Accessory double progression adds weight only after every planned set hit
//   its planned reps at or under the target effort. A miss never adds weight.

export type LoadUnit = 'lb' | 'kg'
export type LoadEquipment = 'barbell' | 'dumbbell' | 'machine' | 'none'
export type SnapDirection = 'nearest' | 'up' | 'down'

const LB_PER_KG = 2.20462
const BAR: Record<LoadUnit, number> = { lb: 45, kg: 20 }
/** Smallest loadable change, in the unit. Barbell = the smallest plate pair. */
export const LOAD_STEP: Record<LoadUnit, Record<Exclude<LoadEquipment, 'none'>, number>> = {
  lb: { barbell: 5, dumbbell: 5, machine: 5 },
  kg: { barbell: 2.5, dumbbell: 2, machine: 2.5 },
}

/** Loading kind from the library's equipment string ("barbell,bench", "bodyweight,dumbbell"). */
export function loadEquipment(equipment: string | null | undefined): LoadEquipment {
  const tokens = (equipment ?? '').toLowerCase().split(',').map(t => t.trim())
  for (const t of tokens) {
    if (t === 'barbell' || t === 'ez-bar' || t === 'trap_bar' || t === 'trap-bar' || t === 'blocks') return 'barbell'
    if (t === 'dumbbell' || t === 'kettlebell') return 'dumbbell'
    if (t === 'cable' || t === 'machine') return 'machine'
  }
  return 'none'
}

function toUnit(kg: number, unit: LoadUnit): number {
  return unit === 'lb' ? kg * LB_PER_KG : kg
}

function fromUnit(v: number, unit: LoadUnit): number {
  return unit === 'lb' ? Math.round((v / LB_PER_KG) * 100) / 100 : Math.round(v * 100) / 100
}

function roundTo(v: number, step: number, direction: SnapDirection): number {
  const q = v / step
  // Tolerance of 2% of a step: 5 lb stored as kg reads back as 5.004 lb.
  const eps = 0.02
  const n = direction === 'up' ? Math.ceil(q - eps) : direction === 'down' ? Math.floor(q + eps) : Math.round(q)
  return n * step
}

/** Snap a load (kg) to what can be loaded. Unloaded equipment passes through. */
export function snapLoadKg(kg: number, equipment: LoadEquipment, opts: { unit?: LoadUnit; direction?: SnapDirection } = {}): number {
  if (!(kg > 0) || equipment === 'none') return kg
  const unit = opts.unit ?? 'lb'
  const step = LOAD_STEP[unit][equipment]
  const v = toUnit(kg, unit)
  if (equipment === 'barbell') {
    const bar = BAR[unit]
    const snapped = v <= bar ? bar : bar + roundTo(v - bar, step, opts.direction ?? 'nearest')
    return fromUnit(Math.max(bar, snapped), unit)
  }
  return fromUnit(Math.max(step, roundTo(v, step, opts.direction ?? 'nearest')), unit)
}

/**
 * The next loadable step at or above `toKg` and strictly above `fromKg`, so a
 * 2.5% step that rounds back down still moves the bar one plate pair.
 */
export function snapIncreaseKg(fromKg: number, toKg: number, equipment: LoadEquipment, unit: LoadUnit = 'lb'): number {
  if (equipment === 'none') return toKg
  const from = snapLoadKg(fromKg, equipment, { unit })
  const up = snapLoadKg(toKg, equipment, { unit, direction: 'up' })
  if (up > from + 1e-6) return up
  return fromUnit(toUnit(from, unit) + LOAD_STEP[unit][equipment], unit)
}

/** Snap by the rule's direction: increase → next step up, decrease → step down, hold → nearest. */
export function snapForChangeKg(kg: number, equipment: LoadEquipment, change: 'increase' | 'hold' | 'decrease' | null | undefined, fromKg?: number | null, unit: LoadUnit = 'lb'): number {
  if (change === 'increase' && fromKg != null && fromKg > 0) return snapIncreaseKg(fromKg, kg, equipment, unit)
  return snapLoadKg(kg, equipment, { unit, direction: change === 'decrease' ? 'down' : 'nearest' })
}

// ─── Warm-up ramp ───────────────────────────────────────────────

export interface RampSet {
  weightKg: number
  reps: number
}

export const RAMP_REST_SEC = 60
const BARBELL_RAMP = [{ pct: 0.45, reps: 5 }, { pct: 0.65, reps: 3 }, { pct: 0.8, reps: 2 }]
const DUMBBELL_RAMP = [{ pct: 0.5, reps: 5 }, { pct: 0.75, reps: 3 }]

/**
 * Ramp sets before the first heavy set (check set or first work set) of a
 * main lift. Snapped, strictly rising, all below the work load. Empty when the
 * work load is the bar or a light dumbbell, or the lift isn't loaded.
 */
export function warmupRamp(firstHeavyKg: number | null | undefined, equipment: LoadEquipment, unit: LoadUnit = 'lb'): RampSet[] {
  if (firstHeavyKg == null || !(firstHeavyKg > 0) || equipment === 'none') return []
  const work = snapLoadKg(firstHeavyKg, equipment, { unit })
  const workU = toUnit(work, unit)
  let plan: Array<{ pct: number; reps: number }>
  if (equipment === 'barbell') {
    const bar = BAR[unit]
    if (workU <= bar + 1e-6) return []
    // Up to ~1.5x the bar: the empty bar is the warm-up. Heavier: the full ramp.
    plan = workU < bar * 1.5 ? [{ pct: 0, reps: 5 }] : BARBELL_RAMP
  } else {
    const light = unit === 'lb' ? 20 : 9
    const medium = unit === 'lb' ? 40 : 18
    if (workU < light) return []
    plan = workU < medium ? DUMBBELL_RAMP.slice(0, 1) : DUMBBELL_RAMP
  }
  const out: RampSet[] = []
  for (const step of plan) {
    const weightKg = snapLoadKg(step.pct === 0 ? 0.01 : firstHeavyKg * step.pct, equipment, { unit, direction: 'down' })
    if (weightKg >= work - 1e-6) continue
    if (out.length > 0 && weightKg <= out[out.length - 1].weightKg + 1e-6) continue
    out.push({ weightKg, reps: step.reps })
  }
  return out
}

// ─── Accessory loads ─────────────────────────────────────────────

export const ACCESSORY_TM_FRACTION = 0.6

/** Working load for a non-main row from a training max. Core and durability get none. */
export function accessoryLoadKg(trainingMaxKg: number | null, section: string | null): number | null {
  if (trainingMaxKg == null || !(trainingMaxKg > 0)) return null
  if (section === 'accessory') return Math.round(trainingMaxKg * ACCESSORY_TM_FRACTION * 100) / 100
  return null
}

export interface AccessorySetLog {
  weightKg: number
  reps: number
  plannedReps: number | null
  rir?: number | null
  loadFeedback?: string | null
}

export interface AccessorySuggestion {
  type: 'weight_increase' | 'rep_increase' | 'hold_current'
  message: string
  suggestedWeightKg: number | null
}

/** Accessories run at RPE 7-8: at most 1 rep left in the tank (RIR < 2) is past target. */
export const ACCESSORY_MIN_RIR = 2

/**
 * Double progression on the last session's logged working sets. Weight goes up
 * one loadable step only when every planned set was done at or above its
 * planned reps and no set was past the target effort.
 */
export function accessoryProgression(
  lastSets: AccessorySetLog[],
  plannedSetCount: number,
  opts: { incrementKg: number; equipment: LoadEquipment; unit?: LoadUnit },
): AccessorySuggestion | null {
  if (lastSets.length === 0) return null
  const topKg = Math.max(...lastSets.map(s => s.weightKg))
  const target = Math.max(...lastSets.map(s => s.plannedReps ?? s.reps))
  const setsNeeded = Math.max(1, plannedSetCount)
  const allSets = lastSets.length >= setsNeeded
  const allReps = lastSets.every(s => s.reps >= (s.plannedReps ?? target))
  const tooHard = lastSets.some(s => (s.rir != null && s.rir < ACCESSORY_MIN_RIR) || s.loadFeedback === 'too_heavy')
  if (!allSets || !allReps) {
    return { type: 'rep_increase', message: `Build to ${setsNeeded}×${target}, then increase`, suggestedWeightKg: topKg }
  }
  if (tooHard) {
    return { type: 'hold_current', message: `Hit ${setsNeeded}×${target} but close to failure. Same weight`, suggestedWeightKg: topKg }
  }
  const next = opts.equipment === 'none'
    ? Math.round((topKg + opts.incrementKg) * 100) / 100
    : snapIncreaseKg(topKg, topKg + opts.incrementKg, opts.equipment, opts.unit ?? 'lb')
  return { type: 'weight_increase', message: `All sets hit ${target} reps. Increase weight`, suggestedWeightKg: next }
}

/**
 * Plate math calculator for barbell exercises.
 * Standard Olympic bar = 45lb.
 * Available plates per side (descending): 45, 35, 25, 10, 5, 2.5
 */

const BAR_LBS = 45
const PLATES = [45, 35, 25, 10, 5, 2.5]

export interface PlateResult {
  /** Human-readable plate loading string */
  plates: string
  /** Actual achievable weight after rounding */
  achievedLbs: number
}

export function calculatePlates(targetLbs: number): PlateResult {
  if (targetLbs <= BAR_LBS) {
    return { plates: 'Bar only', achievedLbs: BAR_LBS }
  }

  // Per-side load, rounded to nearest 2.5
  const perSide = Math.round((targetLbs - BAR_LBS) / 2 / 2.5) * 2.5
  if (perSide <= 0) {
    return { plates: 'Bar only', achievedLbs: BAR_LBS }
  }

  const usedPlates: number[] = []
  let remaining = perSide

  for (const plate of PLATES) {
    while (remaining >= plate) {
      usedPlates.push(plate)
      remaining -= plate
    }
  }

  const achievedLbs = BAR_LBS + perSide * 2
  const plateStr = usedPlates
    .map(p => (p === Math.floor(p) ? String(p) : p.toFixed(1)))
    .join(' + ')

  return {
    plates: `Bar + ${plateStr} each side`,
    achievedLbs,
  }
}

/** Format a prescription line: "3×5 @ 87lb" */
export function formatPrescription(sets: number, reps: number, weightLbs: number): string {
  return `${sets}×${reps} @ ${Math.round(weightLbs)}lb`
}

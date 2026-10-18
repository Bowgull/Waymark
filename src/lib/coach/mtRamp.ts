// Muay thai ramp start (R12; plan: the ramp resets after a long class gap).
// The ramp counts from the first class after the most recent gap of 14+ days
// without a class, not from the first class ever. Pure.

export const CLASS_GAP_RESET_DAYS = 14

/**
 * First class of the current ramp, given the days classes were done or
 * started (before or on `day`). Null when the class on `day` would start a
 * new ramp: no classes yet, or 14+ days since the last one.
 */
export function mtRampStartDay(classDays: number[], day: number): number | null {
  const ds = [...new Set(classDays)].filter(d => d <= day).sort((a, b) => a - b)
  if (ds.length === 0) return null
  if (day - ds[ds.length - 1] - 1 >= CLASS_GAP_RESET_DAYS) return null
  for (let i = ds.length - 1; i > 0; i--) {
    if (ds[i] - ds[i - 1] - 1 >= CLASS_GAP_RESET_DAYS) return ds[i]
  }
  return ds[0]
}

/** Whole weeks since the ramp started, or null for a fresh ramp. */
export function weeksSinceRampStart(classDays: number[], day: number): number | null {
  const start = mtRampStartDay(classDays, day)
  return start == null ? null : Math.floor((day - start) / 7)
}

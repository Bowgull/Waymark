// A strength set counts as done only when the athlete logged it.
//
// Start-strength pre-fills every set with the planned weight and reps, so a
// session ended early leaves untouched sets that look complete. completed_at
// (0024) is written only by the set log (PATCH /api/strength-sets/:id from
// the workout screen), so it is the logged marker. Sets written before 0024
// have no completed_at and drop out of stats (no reliable signal to backfill).

export interface SetLogFields {
  completedAt: number | null
  isWarmup?: number | boolean | null
}

export function isLoggedSet(set: SetLogFields): boolean {
  return set.completedAt != null
}

/** Logged and not a warm-up: the sets PRs, volume, trends and TM rules read. */
export function isLoggedWorkSet(set: SetLogFields): boolean {
  return isLoggedSet(set) && !(set.isWarmup === 1 || set.isWarmup === true)
}

export function loggedWorkSets<T extends SetLogFields>(sets: T[]): T[] {
  return sets.filter(isLoggedWorkSet)
}

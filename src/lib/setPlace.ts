// The set's place on the set board (page 31 "Set 1 of 3"). Warm-ups and
// working sets count apart: a lift with one ramp set and two working sets
// reads "Warmup 1 of 1", then "Set 1 of 2", "Set 2 of 2" (e2e minor 12).

export interface SetPlace {
  warmup: boolean
  /** 1-based, within its own kind. */
  n: number
  of: number
}

export function setPlace(sets: ReadonlyArray<{ isWarmup: number | boolean | null | undefined }>, idx: number): SetPlace | null {
  const set = sets[idx]
  if (!set) return null
  const warm = (s: { isWarmup: number | boolean | null | undefined }) => s.isWarmup === 1 || s.isWarmup === true
  const warmup = warm(set)
  let n = 0
  let of = 0
  sets.forEach((s, i) => {
    if (warm(s) !== warmup) return
    of++
    if (i <= idx) n++
  })
  return { warmup, n, of }
}

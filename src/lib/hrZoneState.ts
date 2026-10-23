// The run screen's heart-rate zone (page 74, approved): three states against
// the run's line (the HR ceiling, e.g. 147), plus "none" without a strap.
//
//   in   (teal)  under the line, more than GOLD_BAND bpm below it
//   gold         within GOLD_BAND bpm of the line, or over it for under OVER_SEC
//   over (ember) over the line for OVER_SEC or more: EASE OFF and one light buzz
//   none         no strap, or it dropped / went silent: a dim heart and dashes
//
// Pure: the run screen and the native recorder (Swift, the same numbers) both
// step it once per heart-rate sample.

export type HrZone = 'none' | 'in' | 'gold' | 'over'

/** "Within about 5 bpm of the line". */
export const GOLD_BAND = 5
/** "Over for about 30 s". */
export const OVER_SEC = 30

export interface ZoneTracker {
  zone: HrZone
  /** When the heart rate first went over the line in this stretch (ms), else null. */
  overSinceMs: number | null
}

export const ZONE_START: ZoneTracker = { zone: 'none', overSinceMs: null }

/**
 * The zone after one heart-rate sample at `nowMs`. No line: always teal.
 * `overBy` (a hard run's range, page 76): over the top is still gold; ember
 * only `overBy` bpm past it for 30 s. An easy run's line has 0.
 */
export function nextZone(prev: ZoneTracker, hr: number | null | undefined, ceiling: number | null | undefined, nowMs: number, overBy = 0): ZoneTracker {
  if (hr == null || !(hr > 0)) return { zone: 'none', overSinceMs: null }
  if (ceiling == null || !(ceiling > 0)) return { zone: 'in', overSinceMs: null }
  if (hr > ceiling + overBy) {
    const since = prev.overSinceMs ?? nowMs
    return { zone: nowMs - since >= OVER_SEC * 1000 ? 'over' : 'gold', overSinceMs: since }
  }
  return { zone: hr >= ceiling - GOLD_BAND ? 'gold' : 'in', overSinceMs: null }
}

/** The heart container's palette state for a zone (heart-family.js: under | gold | over | idle). */
export function heartState(zone: HrZone): 'under' | 'gold' | 'over' | 'idle' {
  return zone === 'in' ? 'under' : zone === 'none' ? 'idle' : zone
}

/** The grass tint per zone (page 74 ZONE): [teal mix, gold mix, ember]. */
export const ZONE_TINT: Readonly<Record<HrZone, readonly [number, number, number]>> = {
  in: [0.5, 0, 0],
  gold: [0, 0.45, 0],
  over: [0, 0, 1],
  none: [0, 0, 0],
}

/** True when this step crossed into ember (the moment for the one light buzz). */
export function enteredOver(prev: HrZone, next: HrZone): boolean {
  return prev !== 'over' && next === 'over'
}

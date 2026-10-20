// The splash's skip (page 38 A, changed by Josh 2026-10-19), pure:
//   ONE TAP skips the crest building itself: straight to the title screen
//   (the crest whole, its eye lit, WAYMARK under it), which then lifts as usual;
//   HOLD skips the whole splash: straight into the app.

// Page 38 A's own timeline (38-splash-loading-error.html, wA): Today fades up over the crest
// from 9.0 s (0.7 s) with WAYMARK still on top; the word then goes (0.3 s) and the splash ends.
export const SPLASH_TIMELINE = { flareOn: 6.0, flareOff: 7.4, word: 6.8, leave: 9.0, gone: 9.7, end: 10.0 } as const

/** A press this long (ms) is a hold. It skips as soon as it is held, without waiting for the release. */
export const SPLASH_HOLD_MS = 450

/** The title screen in the splash's timeline (s): the crest whole and lit, the flare gone, WAYMARK showing. */
export const SPLASH_TITLE_AT = 7.4

/** The splash starts lifting: Today's boards rise into it (TabStack). */
export const SPLASH_LEAVING_EVENT = 'waymark:splash-leaving'

export type SplashGesture = 'tap' | 'hold'

/** What a press was, from how long it was held (ms). */
export function splashGesture(heldMs: number): SplashGesture {
  return heldMs >= SPLASH_HOLD_MS ? 'hold' : 'tap'
}

export interface SplashSkip {
  /** Jump the crest's own clock to this (s); null leaves it. */
  crestAt: number | null
  /** Seconds from now until each beat of the rest of the splash. */
  word: number
  leave: number
  gone: number
  end: number
}

/**
 * The rest of the splash after a skip at `elapsed` seconds into it, against
 * its timeline (leave, gone, end). A tap before the title jumps to the title
 * and plays out from there; a tap once the title shows changes nothing; a hold
 * ends it at once (a short fade).
 */
export function splashSkip(gesture: SplashGesture, elapsed: number, timeline: { leave: number; gone: number; end: number }): SplashSkip {
  if (gesture === 'hold') return { crestAt: null, word: 0, leave: 0, gone: 0.2, end: 0.3 }
  const from = Math.max(elapsed, SPLASH_TITLE_AT)
  return {
    crestAt: elapsed < SPLASH_TITLE_AT ? SPLASH_TITLE_AT : null,
    word: 0,
    leave: Math.max(0, timeline.leave - from),
    gone: Math.max(0, timeline.gone - from),
    end: Math.max(0, timeline.end - from),
  }
}

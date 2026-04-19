/**
 * Skip rope engine microcopy — Flavor C (dry, observational dark humor).
 *
 * Canon: no em dashes, no exclamation marks, period-terminated fragments.
 */

export type SkipRopePhase =
  | 'ready'
  | 'skipping'
  | 'skipping-finish'
  | 'rest'
  | 'rest-ending'
  | 'last-round'
  | 'complete'

interface SkipRopeMicroCopy {
  preStart: string
  ready: string
  skipping: string
  skippingFinish: string
  rest: string
  restEnding: string
  lastRound: string
  complete: string
}

export const SKIP_ROPE_GENERIC: SkipRopeMicroCopy = {
  preStart: 'Pick up the rope. Time to float.',
  ready: 'Light on the feet. Wrists do the work.',
  skipping: 'Rhythm over speed. The rope does the counting.',
  skippingFinish: 'Ten seconds. Smooth to the bell.',
  rest: 'Breathe. Shake it out.',
  restEnding: 'Pick it back up.',
  lastRound: 'Last round. Clean reps.',
  complete: 'Done. Coil the rope.',
}

export interface SkipRopeMomentCtx {
  phase: SkipRopePhase
  isLastRound?: boolean
  /** Seconds remaining on the current timer (round or rest). */
  secondsRemaining?: number
}

export function resolveSkipRopeMoment(ctx: SkipRopeMomentCtx): string | null {
  const { phase, isLastRound, secondsRemaining } = ctx

  if (phase === 'complete') return SKIP_ROPE_GENERIC.complete

  if (phase === 'rest') {
    if (secondsRemaining != null && secondsRemaining <= 10) {
      return SKIP_ROPE_GENERIC.restEnding
    }
    return SKIP_ROPE_GENERIC.rest
  }

  if (phase === 'skipping') {
    if (secondsRemaining != null && secondsRemaining <= 10) {
      return SKIP_ROPE_GENERIC.skippingFinish
    }
    return SKIP_ROPE_GENERIC.skipping
  }

  // Ready phase
  if (isLastRound) return SKIP_ROPE_GENERIC.lastRound
  return SKIP_ROPE_GENERIC.ready
}

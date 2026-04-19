/**
 * Mobility engine microcopy — Flavor C (dry, observational dark humor).
 *
 * Canon: no em dashes, no exclamation marks, period-terminated fragments,
 * lowercase-tone even when capitalized. Each line is a *moment*, not a pep talk.
 *
 * Per-exercise hooks are keyed by exerciseId. Fallback generic lines cover any
 * exercise that doesn't have a custom intro yet.
 */

export interface MobilityMoment {
  /** Shown on the session card before Start. */
  preStart?: string
  /** Shown on the first exercise intro. */
  firstIntro?: string
  /** Shown while a hold timer is ticking down (before the "nearly through" threshold). */
  holdActive?: string
  /** Shown in the last ~10 seconds of a hold. */
  holdNearlyDone?: string
  /** Shown on rep-based exercises between prep and done. */
  repActive?: string
  /** Between exercises, after completing one and before the next. */
  transition?: string
  /** Shown when the user taps Skip. */
  onSkip?: string
  /** Shown on the final exercise. */
  finalIntro?: string
  /** Shown on the complete screen. */
  onComplete?: string
}

/**
 * Generic moments — fallbacks when no per-exercise line exists.
 */
export const MOBILITY_GENERIC: MobilityMoment = {
  preStart: 'Eight minutes. Your spine has been waiting.',
  firstIntro: 'Breathing first. Nothing else works if this does not.',
  holdActive: 'Hold. Count tiles on the ceiling if you must.',
  holdNearlyDone: 'Nearly through.',
  repActive: 'Controlled. Slow is the assignment.',
  transition: 'Next.',
  onSkip: 'Noted. The program remembers.',
  finalIntro: 'Last one. You earned the coffee.',
  onComplete: 'Done. The spine filed a thank-you note.',
}

/**
 * Per-exercise intro lines (shown instead of firstIntro/repActive when present).
 * Keys match exerciseId in src/lib/mobilityTemplate.ts.
 */
export const MOBILITY_BY_EXERCISE: Record<string, string> = {
  'ex-crocodile-breathing':
    'You breathe twenty thousand times a day. None of them have been good.',
  'ex-foam-roll-thoracic':
    'The desk bent you into this. Unbend.',
  'ex-prone-cobra':
    'Face down. Lift. This is the muscle the chair turned off.',
  'ex-band-external-rotation':
    'Small movement. The shoulders that actually stabilize are the ones nobody trains.',
  'ex-couch-stretch':
    'Thirty seconds per side. Tuck the tailbone or it does nothing.',
  'ex-worlds-greatest-stretch':
    'Named by someone who had not tried the others.',
  'ex-ankle-cars':
    'Slow circles. Your ankles are older than the rest of you.',
  // Foundation Run cooldown exercises
  'ex-foam-roll-pecs':
    'Release the armor before you stretch the seams.',
  'ex-foam-roll-hip-flexors':
    'The front of the hip. Where every desk hour lives.',
  'ex-doorway-pec-stretch':
    'Lean in. Breathe. The chest forgets it is allowed to open.',
  'ex-hip-flexor-stretch':
    'Half-kneeling. Squeeze the back glute. Do the boring part right.',
  'ex-pigeon-stretch':
    'Sink and breathe. The glute is not going to release itself.',
  'ex-cossack-squats':
    'Loaded range. Passive mobility is a hobby. This is the real thing.',
  'ex-90-90-hip-switches':
    'Internal rotation. Most desk workers have lost this entirely.',
  'ex-dead-bugs':
    'Core lockdown. Low back stays flat or it does not count.',
}

/**
 * Resolve the moment line to display for a given mobility step.
 *
 * @param ctx.exerciseId - current exercise id (optional)
 * @param ctx.phase - which engine phase we're in
 * @param ctx.isFirst - is this the first exercise in the session
 * @param ctx.isLast - is this the last exercise in the session
 * @param ctx.holdSecRemaining - seconds left on hold timer, if any
 */
export function resolveMobilityMoment(ctx: {
  exerciseId?: string
  phase: 'pre-start' | 'exercise' | 'transition' | 'complete' | 'skip'
  isFirst?: boolean
  isLast?: boolean
  holdSecRemaining?: number
  isHold?: boolean
}): string | null {
  const {
    exerciseId,
    phase,
    isFirst,
    isLast,
    holdSecRemaining,
    isHold,
  } = ctx

  if (phase === 'pre-start') return MOBILITY_GENERIC.preStart ?? null
  if (phase === 'complete') return MOBILITY_GENERIC.onComplete ?? null
  if (phase === 'skip') return MOBILITY_GENERIC.onSkip ?? null
  if (phase === 'transition') return MOBILITY_GENERIC.transition ?? null

  // Exercise phase
  if (isLast) return MOBILITY_GENERIC.finalIntro ?? null

  // If a hold is in its final stretch, surface the "nearly through" cue
  if (
    isHold &&
    holdSecRemaining != null &&
    holdSecRemaining > 0 &&
    holdSecRemaining <= 10
  ) {
    return MOBILITY_GENERIC.holdNearlyDone ?? null
  }

  // Per-exercise intro line takes precedence
  if (exerciseId && MOBILITY_BY_EXERCISE[exerciseId]) {
    return MOBILITY_BY_EXERCISE[exerciseId]
  }

  // Hold vs rep fallback
  if (isHold) return MOBILITY_GENERIC.holdActive ?? null
  if (isFirst) return MOBILITY_GENERIC.firstIntro ?? null
  return MOBILITY_GENERIC.repActive ?? null
}

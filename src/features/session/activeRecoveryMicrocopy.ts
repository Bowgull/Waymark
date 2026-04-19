/**
 * Active Recovery engine microcopy — Flavor C (dry, observational dark humor).
 *
 * Canon: no em dashes, no exclamation marks, period-terminated fragments.
 */

export type ActiveRecoveryPhase =
  | 'intro'
  | 'hip-ready'
  | 'hip-holding'
  | 'hip-holding-finish'
  | 'hip-reps'
  | 'roll-intro'
  | 'rolling'
  | 'rolling-finish'
  | 'complete'

interface ActiveRecoveryMicroCopy {
  intro: string
  hipReady: string
  hipHolding: string
  hipHoldingFinish: string
  hipReps: string
  rollIntro: string
  rolling: string
  rollingFinish: string
  complete: string
}

export const ACTIVE_RECOVERY_GENERIC: ActiveRecoveryMicroCopy = {
  intro: 'Two blocks. Hips first, rolling second.',
  hipReady: 'Slow into position. The stretch is not the goal.',
  hipHolding: 'Breathe into the tight spot. Do not fight it.',
  hipHoldingFinish: 'Last breath on this side.',
  hipReps: 'Smooth reps. No rush.',
  rollIntro: 'Roller down. Floor meets tissue.',
  rolling: 'Find the knot. Park there. Breathe.',
  rollingFinish: 'Last zone. Ease out.',
  complete: 'Done. Drink water.',
}

export interface ActiveRecoveryMomentCtx {
  phase: ActiveRecoveryPhase
  /** Seconds remaining on the current timer (if timed). */
  secondsRemaining?: number
}

export function resolveActiveRecoveryMoment(
  ctx: ActiveRecoveryMomentCtx,
): string | null {
  const { phase, secondsRemaining } = ctx

  if (phase === 'complete') return ACTIVE_RECOVERY_GENERIC.complete
  if (phase === 'intro') return ACTIVE_RECOVERY_GENERIC.intro
  if (phase === 'roll-intro') return ACTIVE_RECOVERY_GENERIC.rollIntro

  if (phase === 'hip-ready') return ACTIVE_RECOVERY_GENERIC.hipReady
  if (phase === 'hip-reps') return ACTIVE_RECOVERY_GENERIC.hipReps

  if (phase === 'hip-holding') {
    if (secondsRemaining != null && secondsRemaining <= 5) {
      return ACTIVE_RECOVERY_GENERIC.hipHoldingFinish
    }
    return ACTIVE_RECOVERY_GENERIC.hipHolding
  }

  if (phase === 'rolling') {
    if (secondsRemaining != null && secondsRemaining <= 5) {
      return ACTIVE_RECOVERY_GENERIC.rollingFinish
    }
    return ACTIVE_RECOVERY_GENERIC.rolling
  }

  return null
}

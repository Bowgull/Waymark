/**
 * Bag Work engine microcopy — Flavor C (dry, observational dark humor).
 *
 * Canon: no em dashes, no exclamation marks, period-terminated fragments,
 * muted confidence. Each line is a *moment*, not a pep talk.
 */

export type BagWorkPhase =
  | 'pre-start'
  | 'ready'
  | 'fighting'
  | 'fighting-finish'
  | 'rest'
  | 'rest-ending'
  | 'last-round'
  | 'complete'

export type BagWorkIntent =
  | 'Technical'
  | 'Rhythm'
  | 'Volume'
  | 'Pressure'
  | 'Power'

interface BagWorkMicroCopy {
  preStart: string
  ready: string
  fighting: string
  fightingFinish: string
  rest: string
  restEnding: string
  lastRound: string
  complete: string
}

export const BAG_WORK_GENERIC: BagWorkMicroCopy = {
  preStart: 'Twelve minutes with the bag. Nothing personal.',
  ready: 'Gloves on. Read the combo. Then stop reading.',
  fighting: 'Work. Breathe. Do not pose.',
  fightingFinish: 'Ten seconds. Finish clean.',
  rest: 'Breathe down. Let the heart settle.',
  restEnding: 'Glove up.',
  lastRound: 'Last round. Leave nothing.',
  complete: 'Done. Tape off, water up.',
}

/**
 * Intent-specific round lines (Technical / Rhythm / Volume / Pressure / Power).
 * Keyed by the positional-intent label the engine already assigns per round.
 */
export const BAG_WORK_BY_INTENT: Record<BagWorkIntent, string> = {
  Technical: 'Sharp mechanics. The form is the point.',
  Rhythm: 'Find the tempo. Let the bag answer.',
  Volume: 'More work. Less pose.',
  Pressure: 'Controlled aggression. Push the pace.',
  Power: 'Put everything on the line. Sustainably.',
}

/**
 * Round-type intros (when the round has a declared roundType).
 * Falls back to positional intent if absent.
 */
export const BAG_WORK_BY_ROUND_TYPE: Record<string, string> = {
  warmup: 'Warm the shoulders. No hero shots.',
  technical_flow: 'Clean lines. Speed comes later.',
  drill_isolation: 'One movement at a time. Earn the rest.',
  combo_practice: 'Sequence over speed. Sequence over everything.',
  power: 'Fewer punches. Meant ones.',
  conditioning: 'Pace is the opponent. Do not trade with it.',
}

export interface BagWorkMomentCtx {
  phase: BagWorkPhase
  intent?: BagWorkIntent
  roundType?: string | null
  isLastRound?: boolean
  secondsRemaining?: number
}

export function resolveBagWorkMoment(ctx: BagWorkMomentCtx): string | null {
  const { phase, intent, roundType, isLastRound, secondsRemaining } = ctx

  if (phase === 'pre-start') return BAG_WORK_GENERIC.preStart
  if (phase === 'complete') return BAG_WORK_GENERIC.complete

  if (phase === 'rest') {
    if (secondsRemaining != null && secondsRemaining <= 10) {
      return BAG_WORK_GENERIC.restEnding
    }
    return BAG_WORK_GENERIC.rest
  }

  if (phase === 'fighting') {
    if (secondsRemaining != null && secondsRemaining <= 10) {
      return BAG_WORK_GENERIC.fightingFinish
    }
    return BAG_WORK_GENERIC.fighting
  }

  // Ready phase — pick intent-specific or round-type line if available
  if (phase === 'ready') {
    if (isLastRound) return BAG_WORK_GENERIC.lastRound
    if (roundType && BAG_WORK_BY_ROUND_TYPE[roundType]) {
      return BAG_WORK_BY_ROUND_TYPE[roundType]
    }
    if (intent && BAG_WORK_BY_INTENT[intent]) {
      return BAG_WORK_BY_INTENT[intent]
    }
    return BAG_WORK_GENERIC.ready
  }

  return null
}

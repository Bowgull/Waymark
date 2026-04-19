/**
 * Run engine microcopy — Flavor C (dry, observational dark humor).
 *
 * Canon: no em dashes, no exclamation marks, period-terminated fragments.
 */

export type RunPhase = 'ready' | 'running' | 'running-finish' | 'logging' | 'complete'

export type RunType =
  | 'zone2'
  | 'easy'
  | 'easy_strides'
  | 'tempo'
  | 'intervals'
  | '5k_test'

interface RunMicroCopy {
  preStart: string
  ready: string
  running: string
  runningFinish: string
  logging: string
  complete: string
}

export const RUN_GENERIC: RunMicroCopy = {
  preStart: 'Tie the laces. Head out.',
  ready: 'Shoes on. Watch on. The road does not move itself.',
  running: 'Short strides. Tall posture. Do not chase the watch.',
  runningFinish: 'Close the window. Clean finish.',
  logging: 'Write it down. The log remembers what the legs forget.',
  complete: 'Done. Cool down, water, log.',
}

/**
 * Per-run-type ready lines. Shown on the pre-run card.
 */
export const RUN_BY_TYPE: Record<RunType, string> = {
  zone2: 'Conversational pace. If you cannot talk, you are working too hard.',
  easy: 'Easy. Easy is the work.',
  easy_strides: 'Cruise. Four short surges at the end. Nothing heroic.',
  tempo: 'Uncomfortable but sustainable. That is the edge.',
  intervals: 'Hard. Recover. Repeat. The recovery is not optional.',
  '5k_test': 'Twenty minutes of honesty.',
}

export const RUN_INDOOR_LINE =
  'Indoors. The bike does not have weather.'

export interface RunMomentCtx {
  phase: RunPhase
  runType?: RunType
  isIndoor?: boolean
  /** Seconds left on the target duration (if known). */
  secondsRemaining?: number
}

export function resolveRunMoment(ctx: RunMomentCtx): string | null {
  const { phase, runType, isIndoor, secondsRemaining } = ctx

  if (phase === 'complete') return RUN_GENERIC.complete
  if (phase === 'logging') return RUN_GENERIC.logging

  if (phase === 'running') {
    if (secondsRemaining != null && secondsRemaining <= 30) {
      return RUN_GENERIC.runningFinish
    }
    return RUN_GENERIC.running
  }

  // Ready phase
  if (isIndoor) return RUN_INDOOR_LINE
  if (runType && RUN_BY_TYPE[runType]) return RUN_BY_TYPE[runType]
  return RUN_GENERIC.ready
}

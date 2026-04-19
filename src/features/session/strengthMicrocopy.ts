/**
 * Strength engine microcopy — Flavor C (dry, observational dark humor).
 *
 * Canon: no em dashes, no exclamation marks, period-terminated fragments.
 * Each line is a *moment*, not a pep talk. Muted confidence.
 */

export type StrengthPhase =
  | 'pre-start'
  | 'warmup-skip-rope'
  | 'warmup-skip-ending'
  | 'exercise'
  | 'rest'
  | 'rest-ending'
  | 'next'
  | 'last-set'
  | 'skip'
  | 'complete'

export type StrengthSection = 'warmup' | 'main' | 'accessory' | 'core'

interface StrengthMicroCopy {
  preStart: string
  warmupSkipRope: string
  warmupSkipEnding: string
  firstExercise: string
  setActive: string
  afterLog: string
  restActive: string
  restEnding: string
  nextExercise: string
  lastSet: string
  skip: string
  complete: string
}

export const STRENGTH_GENERIC: StrengthMicroCopy = {
  preStart: 'Iron. Show up.',
  warmupSkipRope: 'Three minutes of rope. Tax upfront.',
  warmupSkipEnding: 'Almost warm. Stay honest.',
  firstExercise: 'The bar is cold. So are you.',
  setActive: 'Set up. Breathe. Lift.',
  afterLog: 'Logged. The ledger does not forget.',
  restActive: 'Rest. The gains happen here too.',
  restEnding: 'Re-grip. Re-brace.',
  nextExercise: 'Next.',
  lastSet: 'Last set. Make it count.',
  skip: 'Noted. The program remembers.',
  complete: 'Done. Rack the bar.',
}

/**
 * Section intro lines. Fires on the first exercise of a new section.
 */
export const STRENGTH_BY_SECTION: Record<StrengthSection, string> = {
  warmup: 'Warm up. Ego stays in the car.',
  main: 'The part that pays the rent.',
  accessory: 'Boring on purpose. That is the point.',
  core: 'Fifteen minutes. No heroism, no shortcuts.',
}

/**
 * Per-lift intros — keyed by exercise id OR normalized exercise name.
 * The resolver tries exercise id first, then a name-based fallback.
 */
export const STRENGTH_BY_LIFT: Record<string, string> = {
  // Primary compound lifts
  'bench press': 'Tight back. Feet down. Do not rush the descent.',
  'back squat': 'Brace. Depth. Stand up.',
  'squat': 'Brace. Depth. Stand up.',
  'front squat': 'Elbows up or the rack goes.',
  'deadlift': 'Slack out. Push the floor. Nothing poetic about it.',
  'conventional deadlift': 'Slack out. Push the floor. Nothing poetic about it.',
  'sumo deadlift': 'Hips close, knees out. Push, do not pull.',
  'overhead press': 'Strict. No leg drive, no excuses.',
  'ohp': 'Strict. No leg drive, no excuses.',
  'strict press': 'Strict. No leg drive, no excuses.',
  'barbell row': 'Pull to the ribs. Do not yank.',
  'bent over row': 'Pull to the ribs. Do not yank.',
  'pull up': 'Dead hang to chin. Elevator, not a catapult.',
  'pull ups': 'Dead hang to chin. Elevator, not a catapult.',
  'chin up': 'Dead hang to chin. Elevator, not a catapult.',
  'romanian deadlift': 'Hinge, do not squat. Hamstrings do the talking.',
  'rdl': 'Hinge, do not squat. Hamstrings do the talking.',
}

/**
 * Context moments — fire when a history condition is met.
 * Caller resolves the condition and picks which one to show.
 */
export const STRENGTH_CONTEXT = {
  matchLastSession: 'Same weight as last time. Earn the rep.',
  prHint: 'Last week was too easy. The program agrees.',
  deloadWeek: 'Deload. Less weight, same attention.',
  formWarning: 'Something is off. Breathe before the working sets.',
}

function normalizeLiftName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface StrengthMomentCtx {
  phase: StrengthPhase
  /** Exercise id (e.g. "ex-bench-press") — most specific. */
  exerciseId?: string
  /** Exercise name — used as fallback key into STRENGTH_BY_LIFT. */
  exerciseName?: string
  /** Section of the current exercise, if phase is 'exercise'. */
  section?: StrengthSection
  /** Is this the first exercise of its section. */
  isFirstInSection?: boolean
  /** Is this the first exercise overall. */
  isFirstOverall?: boolean
  /** Is this the final set of the entire session. */
  isLastSet?: boolean
  /** Seconds remaining on rest timer, if phase is 'rest'. */
  restSecondsRemaining?: number
  /** Optional context flag (match last / pr hint / deload). */
  context?: keyof typeof STRENGTH_CONTEXT
}

export function resolveStrengthMoment(ctx: StrengthMomentCtx): string | null {
  const { phase } = ctx

  if (phase === 'pre-start') return STRENGTH_GENERIC.preStart
  if (phase === 'skip') return STRENGTH_GENERIC.skip
  if (phase === 'complete') return STRENGTH_GENERIC.complete
  if (phase === 'warmup-skip-rope') return STRENGTH_GENERIC.warmupSkipRope
  if (phase === 'warmup-skip-ending') return STRENGTH_GENERIC.warmupSkipEnding
  if (phase === 'next') return STRENGTH_GENERIC.nextExercise
  if (phase === 'last-set') return STRENGTH_GENERIC.lastSet

  if (phase === 'rest') {
    if (ctx.restSecondsRemaining != null && ctx.restSecondsRemaining <= 10) {
      return STRENGTH_GENERIC.restEnding
    }
    return STRENGTH_GENERIC.restActive
  }

  // Exercise phase
  if (phase === 'exercise') {
    // Priority 1: context-driven line (PR hint etc.) if caller passed one
    if (ctx.context) return STRENGTH_CONTEXT[ctx.context]

    // Priority 2: last-set takes over if this is the final set
    if (ctx.isLastSet) return STRENGTH_GENERIC.lastSet

    // Priority 3: section intro on first exercise of the section
    if (ctx.isFirstInSection && ctx.section && STRENGTH_BY_SECTION[ctx.section]) {
      return STRENGTH_BY_SECTION[ctx.section]
    }

    // Priority 4: per-lift intro (by name lookup)
    if (ctx.exerciseName) {
      const key = normalizeLiftName(ctx.exerciseName)
      if (STRENGTH_BY_LIFT[key]) return STRENGTH_BY_LIFT[key]
    }

    // Priority 5: first exercise overall
    if (ctx.isFirstOverall) return STRENGTH_GENERIC.firstExercise

    // Fallback: set active
    return STRENGTH_GENERIC.setActive
  }

  return null
}

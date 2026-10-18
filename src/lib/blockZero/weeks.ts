// Block Zero week numbering. 6 base weeks, up to 2 extension weeks.
// Week 1 = test, 2-5 build, 6 = consolidate + retest (R16, Bell 2023).
// Extension weeks repeat week-5 levels. They never wrap back to week 1.

export const BLOCK_ZERO_BASE_WEEKS = 6
export const BLOCK_ZERO_MAX_EXTENSIONS = 2
export const BLOCK_ZERO_MAX_WEEKS = BLOCK_ZERO_BASE_WEEKS + BLOCK_ZERO_MAX_EXTENSIONS
/** The week extension weeks repeat. */
export const BLOCK_ZERO_EXTENSION_WEEK = 5

export type BlockZeroPhase = 'test' | 'build' | 'consolidate' | 'extension'

/**
 * Which week's training levels apply. Weeks 1-6 map to themselves; anything
 * past 6 is an extension and repeats week 5.
 */
export function blockZeroTrainingWeek(weekNumber: number): number {
  if (!Number.isFinite(weekNumber) || weekNumber < 1) return 1
  const w = Math.floor(weekNumber)
  return w <= BLOCK_ZERO_BASE_WEEKS ? w : BLOCK_ZERO_EXTENSION_WEEK
}

export function blockZeroPhase(weekNumber: number): BlockZeroPhase {
  if (weekNumber > BLOCK_ZERO_BASE_WEEKS) return 'extension'
  if (weekNumber <= 1) return 'test'
  if (weekNumber === BLOCK_ZERO_BASE_WEEKS) return 'consolidate'
  return 'build'
}

/** Extensions already used, from the block's current length. */
export function extensionsUsed(totalWeeks: number): number {
  return Math.max(0, Math.min(BLOCK_ZERO_MAX_EXTENSIONS, totalWeeks - BLOCK_ZERO_BASE_WEEKS))
}

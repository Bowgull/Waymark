export type RunCompletionStatus = 'complete' | 'shortened' | 'partial'
export type StrengthSetStatus = 'normal' | 'lighter' | 'heavier' | 'rep_shortfall' | 'rep_surplus'
export type BandColor = 'yellow' | 'orange' | 'red' | 'blue' | 'purple'

const BAND_ORDER: BandColor[] = ['yellow', 'orange', 'red', 'blue', 'purple']

function normalizeBandColor(value: string | null | undefined): BandColor | null {
  if (!value) return null
  return BAND_ORDER.find(color => color === value.toLowerCase()) ?? null
}

function shiftBandColor(color: BandColor, delta: -1 | 1): BandColor {
  const idx = BAND_ORDER.indexOf(color)
  const next = Math.min(Math.max(idx + delta, 0), BAND_ORDER.length - 1)
  return BAND_ORDER[next]
}

export interface RunCompletionInput {
  plannedDurationSec: number | null | undefined
  completedDurationSec: number | null | undefined
}

export interface RunCompletionResult {
  completionRatio: number | null
  completionStatus: RunCompletionStatus | null
}

export function assessRunCompletion(input: RunCompletionInput): RunCompletionResult {
  const planned = input.plannedDurationSec
  const completed = input.completedDurationSec
  if (!planned || planned <= 0 || completed == null || completed < 0) {
    return { completionRatio: null, completionStatus: null }
  }

  const ratio = Math.round((completed / planned) * 100) / 100
  if (ratio >= 0.8) return { completionRatio: ratio, completionStatus: 'complete' }
  if (ratio >= 0.5) return { completionRatio: ratio, completionStatus: 'shortened' }
  return { completionRatio: ratio, completionStatus: 'partial' }
}

export interface StrengthSetInput {
  plannedWeightKg: number | null | undefined
  plannedReps: number | null | undefined
  actualWeightKg: number | null | undefined
  actualReps: number | null | undefined
}

export interface BandSetInput {
  plannedBandColor: string | null | undefined
  actualBandColor: string | null | undefined
  plannedReps: number | null | undefined
  actualReps: number | null | undefined
}

export function assessStrengthSet(input: StrengthSetInput): StrengthSetStatus {
  const plannedReps = input.plannedReps ?? 0
  const actualReps = input.actualReps ?? 0
  const plannedWeight = input.plannedWeightKg ?? null
  const actualWeight = input.actualWeightKg ?? null

  if (plannedReps > 0 && actualReps <= Math.max(1, plannedReps - 3)) return 'rep_shortfall'
  if (plannedWeight != null && actualWeight != null && actualWeight < plannedWeight * 0.9) return 'lighter'
  if (plannedWeight != null && actualWeight != null && actualWeight > plannedWeight * 1.1) return 'heavier'
  if (plannedReps > 0 && actualReps >= plannedReps + 4) return 'rep_surplus'
  return 'normal'
}

export function assessBandSet(input: BandSetInput): StrengthSetStatus {
  const plannedReps = input.plannedReps ?? 0
  const actualReps = input.actualReps ?? 0
  const plannedBand = normalizeBandColor(input.plannedBandColor)
  const actualBand = normalizeBandColor(input.actualBandColor)

  if (plannedReps > 0 && actualReps <= Math.max(1, plannedReps - 3)) return 'rep_shortfall'
  if (plannedBand && actualBand) {
    const plannedIdx = BAND_ORDER.indexOf(plannedBand)
    const actualIdx = BAND_ORDER.indexOf(actualBand)
    if (actualIdx < plannedIdx) return 'lighter'
    if (actualIdx > plannedIdx) return 'heavier'
  }
  if (plannedReps > 0 && actualReps >= plannedReps + 4) return 'rep_surplus'
  return 'normal'
}

export function adjustBandColorFromReality(
  prescribedBandColor: string | null | undefined,
  reality: { inferredStatus: string | null; bandColor: string | null } | undefined,
): BandColor | null {
  const prescribed = normalizeBandColor(prescribedBandColor)
  if (!prescribed || !reality?.inferredStatus) return prescribed

  const actual = normalizeBandColor(reality.bandColor)
  if (reality.inferredStatus === 'lighter') return actual ?? shiftBandColor(prescribed, -1)
  if (reality.inferredStatus === 'heavier') return actual ?? shiftBandColor(prescribed, 1)
  if (reality.inferredStatus === 'rep_shortfall') return shiftBandColor(actual ?? prescribed, -1)
  if (reality.inferredStatus === 'rep_surplus') return shiftBandColor(actual ?? prescribed, 1)
  return prescribed
}

// Trend-based band adjustment (Phase 0 athlete-state). A 'push' verdict shifts
// the prescribed band one step heavier, 'deload' one step lighter, anchored on
// the most recent actual band the athlete used. 'hold' keeps the prescription.
export function adjustBandColorFromVerdict(
  prescribedBandColor: string | null | undefined,
  verdict: 'push' | 'hold' | 'deload' | undefined,
  latestBandColor: string | null | undefined,
): BandColor | null {
  const prescribed = normalizeBandColor(prescribedBandColor)
  if (!prescribed || !verdict || verdict === 'hold') return prescribed
  const anchor = normalizeBandColor(latestBandColor) ?? prescribed
  if (verdict === 'push') return shiftBandColor(anchor, 1)
  return shiftBandColor(anchor, -1)
}

export function shouldShowRunRealityMark(status: RunCompletionStatus | null): boolean {
  return status === 'shortened' || status === 'partial'
}

export function shouldShowStrengthRealityMark(status: StrengthSetStatus | null): boolean {
  return status === 'lighter' || status === 'heavier' || status === 'rep_shortfall' || status === 'rep_surplus'
}

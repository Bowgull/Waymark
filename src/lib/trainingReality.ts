export type RunCompletionStatus = 'complete' | 'shortened' | 'partial'
export type StrengthSetStatus = 'normal' | 'lighter' | 'heavier' | 'rep_shortfall' | 'rep_surplus'

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

export function shouldShowRunRealityMark(status: RunCompletionStatus | null): boolean {
  return status === 'shortened' || status === 'partial'
}

export function shouldShowStrengthRealityMark(status: StrengthSetStatus | null): boolean {
  return status === 'lighter' || status === 'heavier' || status === 'rep_shortfall' || status === 'rep_surplus'
}

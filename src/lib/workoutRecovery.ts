const RECOVERY_KEY = 'waymark_workout_recovery'

export interface RecoveryState {
  sessionId: string
  exerciseIdx: number
  setIdx: number
  roundIdx: number
  phase: string
  savedAt: number
}

interface RecoveryValidationContext {
  sessionId: string
  exerciseSetCounts?: number[]
  maxAgeMs?: number
  nowMs?: number
}

const TERMINAL_PHASES = new Set(['entrance', 'complete', 'mark-earned'])
const RECOVERABLE_PHASES = new Set(['exercise', 'rest', 'bag-preview', 'bag-warmup', 'fr-warmup', 'fr-run'])
const DEFAULT_MAX_AGE_MS = 4 * 60 * 60 * 1000

export function validateWorkoutRecovery(
  data: RecoveryState,
  ctx: RecoveryValidationContext,
): RecoveryState | null {
  const nowMs = ctx.nowMs ?? Date.now()
  const maxAgeMs = ctx.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  if (data.sessionId !== ctx.sessionId) return null
  if (nowMs - data.savedAt > maxAgeMs) return null
  if (!RECOVERABLE_PHASES.has(data.phase)) return null
  if (TERMINAL_PHASES.has(data.phase)) return null

  if (ctx.exerciseSetCounts) {
    const setCount = ctx.exerciseSetCounts[data.exerciseIdx]
    if (setCount == null) return null
    if (data.setIdx < 0 || data.setIdx >= setCount) return null
  }

  return data
}

export function saveWorkoutProgress(state: Omit<RecoveryState, 'savedAt'>) {
  try {
    const data: RecoveryState = { ...state, savedAt: Date.now() }
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(data))
  } catch {
    // localStorage unavailable or full -- silently fail
  }
}

export function getWorkoutRecovery(sessionId: string): RecoveryState | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY)
    if (!raw) return null
    const data: RecoveryState = JSON.parse(raw)
    const valid = validateWorkoutRecovery(data, { sessionId })
    if (!valid) {
      clearWorkoutRecovery()
      return null
    }
    return valid
  } catch {
    return null
  }
}

export function clearWorkoutRecovery() {
  try {
    localStorage.removeItem(RECOVERY_KEY)
  } catch {
    // silently fail
  }
}

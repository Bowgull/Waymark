const RECOVERY_KEY = 'waymark_workout_recovery'

interface RecoveryState {
  sessionId: string
  exerciseIdx: number
  setIdx: number
  roundIdx: number
  phase: string
  savedAt: number
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
    // Only recover if same session and less than 4 hours old
    if (data.sessionId !== sessionId) return null
    if (Date.now() - data.savedAt > 4 * 60 * 60 * 1000) {
      clearWorkoutRecovery()
      return null
    }
    return data
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

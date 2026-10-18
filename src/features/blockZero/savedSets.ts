// "Session interrupted" (page 38, approved as mocked): what's saved, set by
// set, then RESUME / BACK TO TODAY. Built from the workout the server has
// plus the set writes still waiting in this phone's outbox. Pure.

export interface WorkoutSetIn {
  id: string
  weightKg: number | null
  reps: number
  isWarmup: number | boolean
  completedAt?: number | null
}

export interface WorkoutExerciseIn {
  exercise: { name: string } | null
  sets: WorkoutSetIn[]
}

export interface PendingWriteIn {
  path: string
  body: string
}

export interface SavedLine {
  name: string
  /** "2×8 · 140", "1 of 3 sets". */
  detail: string
}

const SET_PATH = /\/api\/strength-sets\/([^/?]+)/

function lbs(kg: number): number {
  return Math.round(kg * 2.20462)
}

/**
 * One line per exercise with logged work sets: "2×8 · 140" when every logged
 * set matches, else "n of N sets". Pending outbox writes count as logged
 * (they are kept on this phone).
 */
export function savedSetLines(exercises: readonly WorkoutExerciseIn[], pending: readonly PendingWriteIn[] = []): SavedLine[] {
  const pendingBySet = new Map<string, { weightKg?: number | null; reps?: number; completedAt?: number }>()
  for (const p of pending) {
    const m = p.path.match(SET_PATH)
    if (!m) continue
    try {
      const body = JSON.parse(p.body) as { weightKg?: number | null; reps?: number; completedAt?: number }
      pendingBySet.set(m[1], { ...pendingBySet.get(m[1]), ...body })
    } catch {
      // unreadable body: skip
    }
  }
  const lines: SavedLine[] = []
  for (const ex of exercises) {
    const work = ex.sets.filter(s => !(s.isWarmup === 1 || s.isWarmup === true))
    const logged = work
      .map(s => {
        const p = pendingBySet.get(s.id)
        const completed = (p?.completedAt ?? s.completedAt) != null
        return completed ? { weightKg: p?.weightKg !== undefined ? p.weightKg : s.weightKg, reps: p?.reps ?? s.reps } : null
      })
      .filter((s): s is { weightKg: number | null; reps: number } => s != null)
    if (logged.length === 0) continue
    const name = ex.exercise?.name ?? 'Exercise'
    const same = logged.every(s => s.reps === logged[0].reps && s.weightKg === logged[0].weightKg)
    if (same && logged.length === work.length) {
      const w = logged[0].weightKg
      lines.push({ name, detail: `${logged.length}×${logged[0].reps}${w != null && w > 0 ? ` · ${lbs(w)}` : ''}` })
    } else {
      lines.push({ name, detail: `${logged.length} of ${work.length} sets` })
    }
  }
  return lines
}

/** Fallback when the workout can't be read (offline): how many set writes wait on this phone. */
export function pendingSetCount(pending: readonly PendingWriteIn[]): number {
  return new Set(pending.map(p => p.path.match(SET_PATH)?.[1]).filter(Boolean)).size
}

/**
 * The page error's NOTHING LOST lines (page 38, "A page"): SESSIONS and
 * MORNING REPORTS. Session writes (sets, finishes, effort) wait in this
 * phone's outbox until the server has them; a morning report is never held
 * on the phone (it saves at once, or the cards say it couldn't).
 */
export function pageSavedLines(pending: ReadonlyArray<{ sessionId: string | null }>): SavedLine[] {
  const sessions = new Set(pending.map(p => p.sessionId ?? '')).size
  const waiting = pending.length
  return [
    { name: 'Sessions', detail: waiting === 0 ? 'all saved' : `${sessions === 1 ? '1 session' : `${sessions} sessions`} waiting on this phone` },
    { name: 'Morning reports', detail: 'all saved' },
  ]
}

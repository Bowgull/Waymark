// Starting a session from any board (Today, Program's day board): the same
// start route per type that Today's ENTER uses, then the session screen.
import { apiFetch } from '@/lib/api'

export const WORKOUT_SESSION_TYPES = ['strength', 'mobility', 'bag_work', 'running', 'skip_rope', 'active_recovery', 'mt_class', 'foundation_run']

export function startEndpoint(id: string, type: string): string {
  const byType: Record<string, string> = {
    foundation_run: `/api/sessions/${id}/start-foundation-run`,
    mobility: `/api/sessions/${id}/start-mobility`,
    strength: `/api/sessions/${id}/start-strength`,
    bag_work: `/api/sessions/${id}/start-bag-work`,
    running: `/api/sessions/${id}/start-run`,
    skip_rope: `/api/sessions/${id}/start-skip-rope`,
    active_recovery: `/api/sessions/${id}/start-recovery`,
    mt_class: `/api/sessions/${id}/start-mt-class`,
  }
  return byType[type] ?? `/api/sessions/${id}/start-strength`
}

/** Starts (or resumes) a session and returns the route to open. Throws when the start route refuses. */
export async function startSession(s: { id: string; type: string; status: string }): Promise<string> {
  if (s.status !== 'in_progress') {
    if (WORKOUT_SESSION_TYPES.includes(s.type)) {
      await apiFetch(startEndpoint(s.id, s.type), { method: 'POST' })
    } else {
      await apiFetch(`/api/sessions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'in_progress', startedAt: Math.floor(Date.now() / 1000) }) })
    }
  }
  return `/session/${s.id}`
}

/** Today's board, or Program's day board on today: can this row be started from here? */
export function isStartableToday(status: string, scheduledDate: number | null, todayEpochDay: number): boolean {
  return scheduledDate === todayEpochDay && (status === 'planned' || status === 'in_progress' || status === 'missed')
}

/**
 * Program's day board: today's rows to do, plus a missed session on an earlier
 * day (it can still be done and logged late), and one left under way.
 */
export function isStartableOnBoard(status: string, scheduledDate: number | null, todayEpochDay: number): boolean {
  if (isStartableToday(status, scheduledDate, todayEpochDay)) return true
  return scheduledDate != null && scheduledDate < todayEpochDay && (status === 'missed' || status === 'in_progress')
}

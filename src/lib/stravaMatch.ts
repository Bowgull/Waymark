// Strava ingest decisions that don't need the network. Pure.
//
// - A run logged by hand (completed, no Strava link) on the same local day is
//   the same run when the times line up: the manual log was saved from an
//   hour before the activity started to six hours after it ended, and the
//   typed duration (when there is one) is within 25% or 10 minutes of the
//   moving time. Strava then enriches that run instead of adding a second one.
// - A dismissed activity stays dismissed.
// - A confirmed match is stamped with the run's own time, not the tap time.

export interface StravaActivityTimes {
  /** Unix seconds. */
  startSec: number
  movingSec: number | null
  elapsedSec: number | null
}

export interface ManualRunCandidate {
  sessionId: string
  runSessionId: string
  /** Session completed_at (unix seconds), when the athlete saved the log. */
  completedAt: number | null
  /** The duration the athlete typed or timed, seconds. */
  durationSec: number | null
}

export const MATCH_BEFORE_SEC = 3600
export const MATCH_AFTER_SEC = 6 * 3600
export const DURATION_TOLERANCE_PCT = 0.25
export const DURATION_TOLERANCE_MIN_SEC = 600

export function activityEndSec(a: StravaActivityTimes): number {
  return a.startSec + (a.elapsedSec ?? a.movingSec ?? 0)
}

function durationClose(manualSec: number, stravaSec: number): boolean {
  return Math.abs(manualSec - stravaSec) <= Math.max(DURATION_TOLERANCE_MIN_SEC, stravaSec * DURATION_TOLERANCE_PCT)
}

/** The completed manual run this activity duplicates, or null. Closest duration wins. */
export function matchManualRun(activity: StravaActivityTimes, candidates: ManualRunCandidate[]): ManualRunCandidate | null {
  const end = activityEndSec(activity)
  const stravaSec = activity.movingSec ?? activity.elapsedSec
  const fits = candidates.filter(c => {
    const timeOk = c.completedAt == null || (c.completedAt >= activity.startSec - MATCH_BEFORE_SEC && c.completedAt <= end + MATCH_AFTER_SEC)
    const durOk = c.durationSec == null || c.durationSec <= 0 || stravaSec == null || durationClose(c.durationSec, stravaSec)
    // Neither signal present: too weak to merge.
    const anySignal = c.completedAt != null || (c.durationSec != null && c.durationSec > 0)
    return timeOk && durOk && anySignal
  })
  if (fits.length === 0) return null
  const gap = (c: ManualRunCandidate) => (c.durationSec != null && stravaSec != null ? Math.abs(c.durationSec - stravaSec) : Number.MAX_SAFE_INTEGER)
  return fits.reduce((best, c) => (gap(c) < gap(best) ? c : best))
}

export function isDismissed(activityId: number, dismissedIds: Iterable<number>): boolean {
  for (const id of dismissedIds) if (id === activityId) return true
  return false
}

/**
 * Session times for a confirmed Strava run: started at the activity start,
 * completed at its end. Falls back to the tap time only with no activity times.
 */
export function confirmedRunTimes(run: { activityStartAt: number | null; activityEndAt: number | null; durationSec: number | null }, nowSec: number): { startedAt: number | null; completedAt: number } {
  if (run.activityStartAt == null) return { startedAt: null, completedAt: nowSec }
  const end = run.activityEndAt ?? run.activityStartAt + (run.durationSec ?? 0)
  return { startedAt: run.activityStartAt, completedAt: end }
}

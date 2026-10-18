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

// ─── The Strava card on Today (page 40) ───────────────────────

/** Zone 2 off max HR (the same band as sessionIntent's "Zone 2. 114 to 133 bpm."). */
export const ZONE2_LOW_PCT = 0.6
export const ZONE2_HIGH_PCT = 0.7
const ZONE24_HIGH_PCT = 0.9

export interface PlannedRunRef {
  type: string
  notes: string | null
  blockType: string | null
}

/** An easy run: Foundation's run-walk, a run tagged Zone 2, every Block Zero run. Progression isn't. */
export function isZone2Run(s: PlannedRunRef): boolean {
  if (s.type === 'foundation_run') return true
  if (s.type !== 'running') return false
  return s.notes === 'zone2' || (s.blockType === 'block_zero' && s.notes !== 'progression')
}

/**
 * The plan line on a matched run (page 40: "Zone 2. 114 to 133 bpm.").
 * Zone 2's top is the easy-run cap the chip reads (talk test, else max HR,
 * else age), so the line and the "+N over cap" chip never disagree. A
 * progression run reads Zone 2 to 4 off max HR. Null without a max HR
 * (nothing to say that the app has words for).
 */
export function stravaPlanLine(s: PlannedRunRef, maxHr: number | null, capBpm: number | null): string | null {
  const max = maxHr != null && maxHr > 0 ? maxHr : null
  if (isZone2Run(s)) {
    if (max == null) return null
    const top = capBpm != null && capBpm > 0 ? Math.round(capBpm) : Math.round(max * ZONE2_HIGH_PCT)
    const low = Math.round(max * ZONE2_LOW_PCT)
    return low < top ? `Zone 2. ${low} to ${top} bpm.` : null
  }
  if (s.type === 'running' && s.notes === 'progression' && max != null) {
    return `Zone 2 to 4. ${Math.round(max * ZONE2_LOW_PCT)} to ${Math.round(max * ZONE24_HIGH_PCT)} bpm.`
  }
  return null
}

/** How far the average heart rate went over the Zone 2 cap ("+9 over cap"), or null when it didn't. */
export function overCapBpm(avgHr: number | null, capBpm: number | null): number | null {
  if (avgHr == null || capBpm == null || avgHr <= 0 || capBpm <= 0) return null
  const over = Math.round(avgHr) - Math.round(capBpm)
  return over > 0 ? over : null
}

/** The four readouts' values (page 40): 5.02 km · 6:10 /km · 142 bpm · 168 bpm. */
export function stravaReadouts(run: { distanceKm: number | null; paceSecKm: number | null; avgHr: number | null; maxHr: number | null }): Array<{ key: 'distance' | 'pace' | 'avgHr' | 'maxHr'; label: string; value: string; unit: string }> {
  const out: Array<{ key: 'distance' | 'pace' | 'avgHr' | 'maxHr'; label: string; value: string; unit: string }> = []
  if (run.distanceKm != null && run.distanceKm > 0) out.push({ key: 'distance', label: 'DISTANCE', value: run.distanceKm >= 10 ? run.distanceKm.toFixed(1) : run.distanceKm.toFixed(2), unit: 'km' })
  if (run.paceSecKm != null && run.paceSecKm > 0) {
    const total = Math.round(run.paceSecKm)
    out.push({ key: 'pace', label: 'PACE', value: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`, unit: '/km' })
  }
  if (run.avgHr != null && run.avgHr > 0) out.push({ key: 'avgHr', label: 'AVG HR', value: String(Math.round(run.avgHr)), unit: 'bpm' })
  if (run.maxHr != null && run.maxHr > 0) out.push({ key: 'maxHr', label: 'MAX HR', value: String(Math.round(run.maxHr)), unit: 'bpm' })
  return out
}

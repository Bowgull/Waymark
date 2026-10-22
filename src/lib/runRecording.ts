// A run recorded by Waymark itself (page 74): the native recorder's 1 Hz
// series, and the pure sums the phone (Log your run, filled) and the server
// (POST /api/run-sessions/:id/recording) both take from it. The server then
// runs the same hrZones functions the Strava ingest used (bucketZones,
// sustainedMaxHr, maxHrAfterRun), so the coach reads a recorded run exactly
// as it read a Strava one.

/** One second per sample, from the recorder's start (pauses included, marked not moving). */
export interface RecordingSeries {
  /** Seconds since the start, one per sample. */
  t: number[]
  /** Heart rate that second, null when the strap had nothing (gap, off, silent). */
  hr: (number | null)[]
  /** 1 while the run clock ran, 0 while paused. */
  moving: (0 | 1)[]
  /** Cumulative GPS distance in metres (outdoor; 0s indoors). */
  distM: number[]
}

export interface RunRecording {
  /** The recorder's id for this run; doubles as the upload's Idempotency-Key. */
  runId: string
  sessionId: string
  runSessionId: string
  /** Unix seconds. */
  startedAt: number
  endedAt: number
  outdoor: boolean
  strapName?: string | null
  series: RecordingSeries
}

export interface RecordingSummary {
  distanceKm: number | null
  /** Moving seconds (pauses excluded), as Strava's moving_time. */
  durationSec: number
  paceSecKm: number | null
  avgHr: number | null
  maxHr: number | null
  /** Share of moving seconds with no usable heart rate (0..1). */
  hrGapShare: number
}

export interface RecordingSplit { kmIndex: number; durationSec: number; avgHr: number | null }

export const HR_MIN = 35
export const HR_MAX = 220
/** A one-sample jump this big is a spike unless it holds. */
export const HR_SPIKE_BPM = 25
/** Seconds a jump must hold to count. */
export const HR_SPIKE_HOLD = 5
/** Below this distance an outdoor run has no distance (GPS never settled). */
export const MIN_DISTANCE_M = 10

/**
 * The heart rate, cleaned: out-of-range values dropped, and a sudden jump of
 * more than 25 bpm dropped unless it holds for 5 s (a dry strap's cadence
 * lock, a spark). Gaps stay null; nothing is interpolated.
 */
export function cleanHr(hr: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = hr.map(v => (v != null && v >= HR_MIN && v <= HR_MAX ? v : null))
  let last: number | null = null
  for (let i = 0; i < out.length; i++) {
    const v = out[i]
    if (v == null) continue
    if (last != null && Math.abs(v - last) > HR_SPIKE_BPM) {
      let held = true
      for (let j = i + 1; j < Math.min(out.length, i + HR_SPIKE_HOLD); j++) {
        const w = out[j]
        if (w == null || Math.abs(w - v) > 10) { held = false; break }
      }
      if (!held) { out[i] = null; continue }
    }
    last = v
  }
  return out
}

function round1(x: number): number { return Math.round(x * 100) / 100 }

export function summarizeRecording(rec: Pick<RunRecording, 'outdoor' | 'series'>): RecordingSummary {
  const { t, moving, distM } = rec.series
  const hr = cleanHr(rec.series.hr)
  const n = Math.min(t.length, hr.length, moving.length, distM.length)
  let movingSec = 0, sum = 0, count = 0, max: number | null = null, gaps = 0
  for (let i = 0; i < n; i++) {
    if (!moving[i]) continue
    movingSec += 1
    const v = hr[i]
    if (v == null) { gaps += 1; continue }
    sum += v; count += 1
    if (max == null || v > max) max = v
  }
  const lastM = n > 0 ? distM[n - 1] : 0
  const distanceKm = rec.outdoor && lastM >= MIN_DISTANCE_M ? round1(lastM / 1000) : null
  return {
    distanceKm,
    durationSec: movingSec,
    paceSecKm: distanceKm && movingSec ? Math.round(movingSec / distanceKm) : null,
    avgHr: count > 0 ? Math.round(sum / count) : null,
    maxHr: max,
    hrGapShare: movingSec > 0 ? gaps / movingSec : 0,
  }
}

/** Per-km splits from the cumulative distance: moving seconds and mean heart rate in each whole km. */
export function recordingSplits(rec: Pick<RunRecording, 'outdoor' | 'series'>): RecordingSplit[] {
  if (!rec.outdoor) return []
  const { moving, distM } = rec.series
  const hr = cleanHr(rec.series.hr)
  const out: RecordingSplit[] = []
  let km = 1, sec = 0, sum = 0, count = 0
  for (let i = 0; i < distM.length; i++) {
    if (moving[i]) {
      sec += 1
      const v = hr[i]
      if (v != null) { sum += v; count += 1 }
    }
    if (distM[i] >= km * 1000) {
      out.push({ kmIndex: km, durationSec: sec, avgHr: count > 0 ? Math.round(sum / count) : null })
      km += 1; sec = 0; sum = 0; count = 0
    }
  }
  return out
}

/** The series as the hrZones functions want it: HR samples with a value, their times and moving flags. */
export function zoneStreams(rec: Pick<RunRecording, 'series'>): { hr: number[]; time: number[]; moving: boolean[] } {
  const hr = cleanHr(rec.series.hr)
  const out = { hr: [] as number[], time: [] as number[], moving: [] as boolean[] }
  for (let i = 0; i < hr.length; i++) {
    const v = hr[i]
    if (v == null) continue
    out.hr.push(v); out.time.push(rec.series.t[i]); out.moving.push(!!rec.series.moving[i])
  }
  return out
}

/** A recording that can be trusted enough to store (shape only; the server re-checks). */
export function isRecording(x: unknown): x is RunRecording {
  if (!x || typeof x !== 'object') return false
  const r = x as Partial<RunRecording>
  const s = r.series as Partial<RecordingSeries> | undefined
  return typeof r.runId === 'string' && typeof r.startedAt === 'number' && typeof r.endedAt === 'number'
    && !!s && Array.isArray(s.t) && Array.isArray(s.hr) && Array.isArray(s.moving) && Array.isArray(s.distM)
    && s.t.length === s.hr.length && s.t.length === s.moving.length && s.t.length === s.distM.length
    && s.t.length <= 6 * 3600
}

/** "mm:ss" for Log your run's TIME (minutes run past 59, as the log has always read). */
export function durationText(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

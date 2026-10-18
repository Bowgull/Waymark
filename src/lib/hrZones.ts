// Heart-rate zones and max HR from Strava streams. Pure.
//
// - Zone bounds are whole bpm, the same rounding as the zone-2 ceiling the
//   run screen prescribes (round(0.7 x max)), and inclusive at the top: a run
//   held exactly at the ceiling charts as zone 2.
// - Zone time counts moving time only. With Strava's `moving` stream, paused
//   samples are skipped; without it, one sample's dwell is capped so an
//   auto-pause gap can't pour minutes into whatever zone the run stopped in.
// - Max HR only moves on a sustained value: the highest HR held for at least
//   MAX_HR_SUSTAIN_SEC across the stream, never above the age cap
//   (220 - age + 15) when the age is known, never above the strap-noise clamp.
//   One spike can't raise max HR. A manual entry in the profile is the way
//   past the cap.

export interface ZoneSeconds { z1: number; z2: number; z3: number; z4: number; z5: number }

export const ZONE_PCTS = [0.6, 0.7, 0.8, 0.9] as const
/** Longest dwell one sample may carry when there is no moving stream. */
export const MAX_SAMPLE_DWELL_SEC = 30
export const MAX_HR_SUSTAIN_SEC = 10
export const MAX_HR_NOISE_CLAMP = 215
export const AGE_CAP_MARGIN = 15

/** Upper bpm of zones 1-4 (inclusive). Above the last is zone 5. */
export function zoneUpperBounds(maxHr: number): [number, number, number, number] {
  const [a, b, c, d] = ZONE_PCTS.map(p => Math.round(maxHr * p))
  // Z1 is below 60%; the 60% bpm itself starts Z2.
  return [a - 1, b, c, d]
}

export function zoneFor(hr: number, maxHr: number): keyof ZoneSeconds {
  const [z1, z2, z3, z4] = zoneUpperBounds(maxHr)
  if (hr <= z1) return 'z1'
  if (hr <= z2) return 'z2'
  if (hr <= z3) return 'z3'
  if (hr <= z4) return 'z4'
  return 'z5'
}

function dwells(time: number[], n: number, moving?: boolean[] | null): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (moving && moving[i] === false) { out.push(0); continue }
    const raw = i < n - 1 ? Math.max(0, time[i + 1] - time[i]) : 1
    out.push(moving ? raw : Math.min(raw, MAX_SAMPLE_DWELL_SEC))
  }
  return out
}

/** Seconds per zone from an HR stream (each sample's dwell = gap to the next). */
export function bucketZones(hr: number[], time: number[], maxHr: number, moving?: boolean[] | null): ZoneSeconds {
  const zones: ZoneSeconds = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  const n = Math.min(hr.length, time.length, moving ? moving.length : Infinity)
  const dt = dwells(time, n, moving)
  for (let i = 0; i < n; i++) zones[zoneFor(hr[i], maxHr)] += dt[i]
  return zones
}

/**
 * The highest HR the stream held for at least `sustainSec` in total (samples
 * at or above it). Null when the stream is too short to say.
 */
export function sustainedMaxHr(hr: number[], time: number[], opts: { sustainSec?: number; moving?: boolean[] | null } = {}): number | null {
  const sustain = opts.sustainSec ?? MAX_HR_SUSTAIN_SEC
  const n = Math.min(hr.length, time.length)
  if (n === 0) return null
  const dt = dwells(time, n, opts.moving)
  const order = Array.from({ length: n }, (_, i) => i).filter(i => hr[i] > 0).sort((a, b) => hr[b] - hr[a])
  let total = 0
  for (const i of order) {
    total += Math.max(dt[i], 1)
    if (total >= sustain) return Math.round(hr[i])
  }
  return null
}

/** Ceiling for an auto-detected max HR: 220 - age + 15, else the noise clamp. */
export function maxHrCap(ageYears: number | null | undefined): number {
  if (ageYears == null || !(ageYears > 0)) return MAX_HR_NOISE_CLAMP
  return Math.min(MAX_HR_NOISE_CLAMP, 220 - Math.round(ageYears) + AGE_CAP_MARGIN)
}

/**
 * The new max HR after a run, or null to keep the current one. Moves only on a
 * sustained value above the current max and at or under the cap.
 */
export function maxHrAfterRun(input: { currentMaxHr: number | null; sustainedHr: number | null; ageYears?: number | null }): number | null {
  const s = input.sustainedHr
  if (s == null || !(s > 0)) return null
  if (s > maxHrCap(input.ageYears)) return null
  if (input.currentMaxHr != null && s <= input.currentMaxHr) return null
  return s
}

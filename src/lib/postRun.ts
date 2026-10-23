// After a run (page 76 §4b, approved 2026-10-23): one plain line, right
// after SAVE RUN and on the done run in the week. Outside it comes from GPS:
// how far, how long, the pace, the heart, and how it compares with the last
// outside run at about the same heart rate (the first time: this is the
// starting point). On the treadmill it comes from the speed: how long, the
// speed and incline, the heart. Pure; relative imports only.

import { KM_PER_MILE, mmss, paceOf, paceText, speedText, type TreadmillUnit } from './runSpeed'

export interface PostRunFacts {
  outdoor: boolean
  distanceKm: number | null
  durationSec: number | null
  avgHr: number | null
  /** On the treadmill: the speed he ran at (typed km over the time, else the planned speed), km/h. */
  kmh: number | null
  incline: number | null
  /** Outside: the last outside run at about the same heart rate (within SAME_HR_BPM), its pace in s/km. */
  sameHrPaceSecKm: number | null
  /** Outside: no earlier outside run with a heart rate to compare with. */
  first: boolean
}

/** "About the same heart rate". */
export const SAME_HR_BPM = 3

/** The earlier run to compare with: the latest outside run with a heart rate within 3 bpm, its pace (s/km). */
export function sameHrPace(now: { avgHr: number | null }, earlier: ReadonlyArray<{ avgHr: number | null; distanceKm: number | null; durationSec: number | null; isIndoor: number | boolean; day: number }>): { pace: number | null; first: boolean } {
  const withHr = earlier.filter(r => !r.isIndoor && r.avgHr != null && r.avgHr > 0 && r.distanceKm != null && r.distanceKm >= 0.8 && r.durationSec != null && r.durationSec > 0)
  if (withHr.length === 0) return { pace: null, first: true }
  if (now.avgHr == null) return { pace: null, first: false }
  const same = withHr.filter(r => Math.abs((r.avgHr as number) - (now.avgHr as number)) <= SAME_HR_BPM).sort((a, b) => b.day - a.day)[0]
  return { pace: same ? Math.round((same.durationSec as number) / (same.distanceKm as number)) : null, first: false }
}

function compareWords(f: PostRunFacts, unit: TreadmillUnit): string | null {
  const pace = paceOf(f.distanceKm, f.durationSec, null)
  if (f.first) return 'your first outside run with the strap: this is your starting point'
  if (pace == null || f.sameHrPaceSecKm == null) return null
  const diffKm = f.sameHrPaceSecKm - pace
  const diff = Math.round(Math.abs(diffKm) * (unit === 'mph' ? KM_PER_MILE : 1))
  const per = unit === 'mph' ? 's/mile' : 's/km'
  if (diff < 2) return 'the same pace as last time at the same heart rate'
  return `${diff} ${per} ${diffKm > 0 ? 'faster' : 'slower'} than last time at the same heart rate`
}

/** The done run's one line (Program and Today rows). */
export function postRunLine(f: PostRunFacts, unit: TreadmillUnit): string | null {
  const heart = f.avgHr ? `heart ${f.avgHr}` : null
  if (!f.outdoor) {
    if (!f.durationSec) return null
    const min = `${Math.round(f.durationSec / 60)} min`
    return [f.kmh ? `${min} at ${speedText(f.kmh, unit)}` : min, f.kmh ? `incline ${f.incline ?? 1}` : null, heart].filter(Boolean).join(' · ')
  }
  if (!f.distanceKm || !f.durationSec) return null
  const kmh = (f.distanceKm / f.durationSec) * 3600
  return [`${f.distanceKm.toFixed(1)} km in ${mmss(f.durationSec)}`, paceText(kmh, unit), heart, heart ? compareWords(f, unit) : null].filter(Boolean).join(' · ')
}

/** The short line under the saved board (its numbers already show km, time and heart). */
export function postRunShort(f: PostRunFacts, unit: TreadmillUnit): string | null {
  if (!f.outdoor) return f.kmh ? `${speedText(f.kmh, unit)} · incline ${f.incline ?? 1}.` : null
  if (!f.distanceKm || !f.durationSec) return null
  const kmh = (f.distanceKm / f.durationSec) * 3600
  const cmp = f.avgHr ? compareWords(f, unit) : null
  return `${paceText(kmh, unit)}${cmp ? ` · ${f.first ? 'this is your starting point' : cmp}` : ''}.`
}

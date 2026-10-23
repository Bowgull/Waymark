// Inside or outside for a run (page 76, approved 2026-10-23): mostly the
// treadmill this winter; on a mild, dry hour the coach sends him outside. It
// reads the weather at the run's planned hour (the hour itself when it is in
// the next 8 hours, else that day's forecast) and says why in one line:
// "inside: 3° and sleet at 6" / "outside: 9° and clear at 7".
// Pure; relative imports only so the tests run it under node.

import { degText, type Sky, type Weather } from './weatherData'
import { plannedMinute, type CoachHours } from './plannedHours'

export interface PlaceWx {
  /** °C at the hour, and what it feels like. */
  t: number
  feels: number
  sky: Sky
  /** Chance of rain or snow (%). */
  pop: number
}

/** Outside from this feels-like up (°C), dry, no storm. */
export const OUTSIDE_FROM_C = 4
export const OUTSIDE_TO_C = 28
export const WET_POP = 40

const SKY_WORD: Readonly<Record<Sky, string>> = { sun: 'clear', moon: 'clear', part: 'some sun', partn: 'some cloud', cloud: 'cloudy', rain: 'rain', snow: 'snow', storm: 'thunder', fog: 'fog' }

export interface RunPlace {
  place: 'inside' | 'outside'
  /** "inside: 3° and sleet at 6" */
  line: string
}

/** The pick for one hour, and the line that says why. */
export function runPlace(wx: PlaceWx, hourWord: string, unit: 'C' | 'F' = 'C'): RunPlace {
  const wet = wx.sky === 'rain' || wx.sky === 'snow' || wx.sky === 'storm' || wx.pop >= WET_POP
  const sleet = wx.sky === 'rain' && wx.t <= 3
  const outside = !wet && wx.feels >= OUTSIDE_FROM_C && wx.t <= OUTSIDE_TO_C
  const what = sleet ? 'sleet' : wet && wx.sky !== 'snow' && wx.sky !== 'storm' && wx.sky !== 'rain' ? 'rain' : SKY_WORD[wx.sky]
  return { place: outside ? 'outside' : 'inside', line: `${outside ? 'outside' : 'inside'}: ${degText(wx.t, unit)}° and ${what} at ${hourWord}` }
}

/** "6" for 6 PM, "7" for 7 AM (the line's short hour). */
export function shortHour(ms: number): string {
  const h = new Date(ms).getHours()
  return String(h % 12 || 12)
}

/**
 * The weather at a run's hour: the hour itself in the next 8 hours, else that
 * day's forecast (morning near the low, evening between low and high). Null
 * when the forecast doesn't reach it.
 */
export function weatherAt(w: Weather, atMs: number): PlaceWx | null {
  const h = w.hours.find(x => atMs >= x.at && atMs < x.at + 3600000)
  if (h) return { t: h.t, feels: h.feels, sky: h.sky, pop: h.pop }
  const d = w.week.find(x => Math.abs(x.at - atMs) < 12 * 3600000)
  if (!d || d.hi == null || d.lo == null) return null
  const hour = new Date(atMs).getHours()
  const t = hour < 12 ? d.lo + (d.hi - d.lo) * 0.25 : d.lo + (d.hi - d.lo) * 0.6
  return { t, feels: t, sky: d.sky === 'moon' ? 'sun' : d.sky === 'partn' ? 'part' : d.sky, pop: d.sky === 'rain' || d.sky === 'snow' || d.sky === 'storm' ? 60 : 0 }
}

export interface WhereSession {
  type: string
  status: string
  timeSlot: string | null
  notes?: string | null
  contextJson?: string | null
  scheduledDate?: number | null
}

/**
 * Inside or outside for each run still to do, at its planned hour on its day
 * (null: not a run, done, or past the forecast).
 */
export function whereForRun(w: Weather | null, hours: CoachHours | null, unit: 'C' | 'F' = 'C'): (s: WhereSession) => RunPlace | null {
  return s => {
    if (!w || (s.type !== 'running' && s.type !== 'foundation_run') || s.status === 'completed' || s.scheduledDate == null) return null
    const iso = new Date(s.scheduledDate * 86400000).toISOString().slice(0, 10)
    const at = new Date(`${iso}T00:00:00`).getTime() + plannedMinute(s, hours) * 60000
    const wx = weatherAt(w, at)
    return wx ? runPlace(wx, shortHour(at), unit) : null
  }
}

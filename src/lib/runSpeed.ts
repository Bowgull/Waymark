// Treadmill speed and outdoor pace (page 76, approved 2026-10-23): one number
// in the unit he picked in Settings (KM/H or MPH), both while he has picked
// neither. Speeds are kept in km/h everywhere; this file only turns them into
// words, flaps and the voice's clip names (public/cues, scripts/make-cues.py).
// Pure; relative imports only so the tests run it under node.

/** settings.treadmill_unit: 'kmh' | 'mph', or null (not picked: both show). */
export type TreadmillUnit = 'kmh' | 'mph' | null

export const KM_PER_MILE = 1.609344

/** The incline every treadmill piece sits at (incline 1 feels like a flat road). */
export const BASE_INCLINE = 1

export function parseUnit(v: unknown): TreadmillUnit {
  return v === 'kmh' || v === 'mph' ? v : null
}

/** One decimal, the way a treadmill steps. */
export function tenth(n: number): number {
  return Math.round(n * 10) / 10
}

export function kmhToMph(kmh: number): number {
  return kmh / KM_PER_MILE
}

/** The speed's one number in the unit he picked (km/h until he picks MPH): 12.8, or 8.0. */
export function speedNumber(kmh: number, unit: TreadmillUnit): number {
  return tenth(unit === 'mph' ? kmhToMph(kmh) : kmh)
}

/** "12.8" (always one decimal, as the treadmill shows it). */
export function speedFlap(kmh: number, unit: TreadmillUnit): string {
  return speedNumber(kmh, unit).toFixed(1)
}

/** The unit word beside a speed flap: KM/H, or MPH when picked. */
export function speedUnitWord(unit: TreadmillUnit): 'KM/H' | 'MPH' {
  return unit === 'mph' ? 'MPH' : 'KM/H'
}

/** The speed in a line: "12.8 km/h", "8.0 mph", or both while none is picked: "12.8 km/h (8.0 mph)". */
export function speedText(kmh: number, unit: TreadmillUnit): string {
  const k = `${tenth(kmh).toFixed(1)} km/h`
  const m = `${tenth(kmhToMph(kmh)).toFixed(1)} mph`
  return unit === 'kmh' ? k : unit === 'mph' ? m : `${k} (${m})`
}

/** The small mph line under the speed on the run screen: only while no unit is picked. */
export function altMph(kmh: number, unit: TreadmillUnit): string | null {
  return unit == null ? `${tenth(kmhToMph(kmh)).toFixed(1)} mph` : null
}

/** Pace in whole seconds per km (per mile when MPH is picked). */
export function paceSec(kmh: number, unit: TreadmillUnit): number {
  if (!(kmh > 0)) return 0
  return Math.round((3600 / kmh) * (unit === 'mph' ? KM_PER_MILE : 1))
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "4:41" */
export function paceFlap(kmh: number, unit: TreadmillUnit): string {
  return mmss(paceSec(kmh, unit))
}

/** "/KM" or "/MILE" */
export function paceUnitWord(unit: TreadmillUnit): '/KM' | '/MILE' {
  return unit === 'mph' ? '/MILE' : '/KM'
}

/** "4:41 /km" or "7:32 /mile" */
export function paceText(kmh: number, unit: TreadmillUnit): string {
  return `${paceFlap(kmh, unit)} ${unit === 'mph' ? '/mile' : '/km'}`
}

/** Pace from a distance and a time, seconds per km (per mile with MPH). Null when either is missing. */
export function paceOf(distanceKm: number | null | undefined, durationSec: number | null | undefined, unit: TreadmillUnit): number | null {
  if (!distanceKm || !(distanceKm > 0) || !durationSec || !(durationSec > 0)) return null
  return Math.round((durationSec / distanceKm) * (unit === 'mph' ? KM_PER_MILE : 1))
}

// ─── The voice (pre-recorded clips) ───────────────────────────

/** Number clips cover 3.0 .. 18.0 (km/h 6-18 and their mph). */
export const NUMBER_CLIP_RANGE = [30, 180] as const
/** Pace clips cover 3:30 .. 9:00. */
export const PACE_CLIP_RANGE = [210, 540] as const

/** The number clip for a speed: "twelve point eight" is n_128. */
export function numberClip(value: number): string {
  const t = Math.min(NUMBER_CLIP_RANGE[1], Math.max(NUMBER_CLIP_RANGE[0], Math.round(value * 10)))
  return `n_${t}`
}

/** The pace clip: "four forty-one" is p_441. */
export function paceClip(sec: number): string {
  const s = Math.min(PACE_CLIP_RANGE[1], Math.max(PACE_CLIP_RANGE[0], Math.round(sec)))
  return `p_${Math.floor(s / 60)}${String(s % 60).padStart(2, '0')}`
}

/** The words a number clip says (the generator's words; the tests check both agree). */
export function numberWords(value: number): string {
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const t = Math.round(value * 10)
  const whole = Math.floor(t / 10)
  const frac = t % 10
  return frac === 0 ? ONES[whole] : `${ONES[whole]} point ${ONES[frac]}`
}

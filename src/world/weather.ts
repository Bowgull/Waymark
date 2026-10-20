// The world's weather (page 58, approved 2026-10-19): the injury event is a
// green rain over the whole world. Pure: the presets and how they mix, read by
// the engine (engine/weather.ts) and the world layer's colour grade.
//
//   green rain (1) · downpour (2) · storm (3) · the quieter fall after GOT IT
//   or DO IT (about 60% of the level) · the clearing (sun shafts, glints,
//   new shoots, fairy dust). Offline rain stays grey; green wins if both.
//
// Numbers are page 58's own (its WX presets), so the engine grades the same
// way the mockup does.

export interface WorldWeather {
  /** 0 none, 1 green rain, 2 downpour, 3 storm. */
  level: 0 | 1 | 2 | 3
  /** After GOT IT or DO IT: the quieter fall. */
  quiet: boolean
  /** The day it clears. */
  clearing: boolean
}

export const NO_WEATHER: WorldWeather = { level: 0, quiet: false, clearing: false }

/** Every knob the weather turns, 0..1. */
export interface WeatherParams {
  green: number
  rain: number
  fog: number
  wind: number
  dark: number
  motes: number
  puddles: number
  grade: number
  lightning: number
  leaves: number
  shafts: number
  glints: number
  sprouts: number
  dust: number
  /** The offline rain: grey, light (only when there is no green rain). */
  grey: number
}

export const WEATHER_KEYS: ReadonlyArray<keyof WeatherParams> = ['green', 'rain', 'fog', 'wind', 'dark', 'motes', 'puddles', 'grade', 'lightning', 'leaves', 'shafts', 'glints', 'sprouts', 'dust', 'grey']

const zero = (): WeatherParams => ({ green: 0, rain: 0, fog: 0, wind: 0, dark: 0, motes: 0, puddles: 0, grade: 0, lightning: 0, leaves: 0, shafts: 0, glints: 0, sprouts: 0, dust: 0, grey: 0 })

/** Page 58's presets (WX in the mockup). */
export const WX: Readonly<Record<'clear' | 'rain1' | 'held' | 'rain2' | 'storm' | 'easing' | 'clearing', Partial<WeatherParams>>> = {
  clear: {},
  rain1: { green: 0.72, rain: 0.42, fog: 0.35, wind: 0.2, dark: 0.14, motes: 0.5, puddles: 0.4, grade: 0.42 },
  held: { green: 0.62, rain: 0.26, fog: 0.3, wind: 0.14, dark: 0.1, motes: 0.35, puddles: 0.3, grade: 0.36 },
  rain2: { green: 0.86, rain: 0.72, fog: 0.5, wind: 0.34, dark: 0.28, motes: 0.6, puddles: 0.8, grade: 0.52 },
  storm: { green: 1, rain: 1, fog: 0.55, wind: 0.95, dark: 0.42, motes: 0.25, puddles: 1, grade: 0.58, lightning: 1, leaves: 1 },
  easing: { green: 0.35, rain: 0.12, fog: 0.2, wind: 0.08, dark: 0.05, motes: 0.25, puddles: 0.15, grade: 0.2 },
  clearing: { shafts: 1, glints: 1, sprouts: 1, dust: 1 },
}

export function full(p: Partial<WeatherParams>): WeatherParams {
  return { ...zero(), ...p }
}

/** a + (b - a) * k for every knob. */
export function mixWeather(a: WeatherParams, b: WeatherParams, k: number): WeatherParams {
  const out = zero()
  for (const key of WEATHER_KEYS) out[key] = a[key] + (b[key] - a[key]) * k
  return out
}

/**
 * The knobs for the world's weather. A loud level is its preset; the quieter
 * fall is page 58's `held` for green rain, and a downpour or a storm scaled
 * the same way (rain about 60%; the storm's lightning stays off). The clearing has no rain. Offline with no
 * green rain: the grey rain alone; with green rain, green wins.
 */
export function weatherParams(w: WorldWeather, offline: boolean): WeatherParams {
  if (w.clearing) return full(WX.clearing)
  if (w.level === 0) return full(offline ? { grey: 1 } : {})
  const loud = full(w.level === 3 ? WX.storm : w.level === 2 ? WX.rain2 : WX.rain1)
  if (!w.quiet) return loud
  if (w.level === 1) return full(WX.held)
  // A downpour or a storm settles the way green rain does: each knob by page 58's held / rain1.
  const held = full(WX.held), rain1 = full(WX.rain1)
  const out = { ...loud }
  for (const k of WEATHER_KEYS) if (rain1[k] > 0) out[k] = loud[k] * (held[k] / rain1[k])
  return { ...out, lightning: 0, leaves: loud.leaves * 0.3 }
}

/** Lightning: soft and rare, at most one flash every 4 s, never under Reduce Motion. */
export const LIGHTNING_MIN_GAP_S = 4

/** The next flash's wait, 4 to 7.5 s (r: 0..1). */
export function nextBoltIn(r: number): number {
  return LIGHTNING_MIN_GAP_S + Math.max(0, Math.min(1, r)) * 3.5
}

/** The world's light under the weather: the clearing brings the sun mode's beams. */
export function weatherMode<M extends string>(mode: M, w: WorldWeather): M | 'sun' {
  return w.clearing ? 'sun' : mode
}

/** Two weathers are the same (no rebuild, no transition). */
export function sameWeather(a: WorldWeather, b: WorldWeather): boolean {
  return a.level === b.level && a.quiet === b.quiet && a.clearing === b.clearing
}

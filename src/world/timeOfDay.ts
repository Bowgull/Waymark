// Time of day for the world (design-decisions.md: "follows the clock, with a
// Settings override (always misty / sun / night)"; "Misty is the default").
// Pure apart from the tiny storage helpers at the bottom.

export type WorldMode = 'misty' | 'sun' | 'night'
export type TimeOverride = 'clock' | WorldMode

export const TIME_OVERRIDES: ReadonlyArray<{ value: TimeOverride; label: string }> = [
  { value: 'clock', label: 'FOLLOW THE CLOCK' },
  { value: 'misty', label: 'ALWAYS MISTY' },
  { value: 'sun', label: 'ALWAYS DAY' },
  { value: 'night', label: 'ALWAYS NIGHT' },
]

/**
 * The clock's light: night from 19:00 to 05:59, morning mist until 09:59,
 * sun from 10:00 to 15:59, the evening mist from 16:00. Local time.
 */
export function modeForClock(date: Date): WorldMode {
  const h = date.getHours()
  if (h >= 19 || h < 6) return 'night'
  if (h >= 10 && h < 16) return 'sun'
  return 'misty'
}

export function resolveMode(override: TimeOverride, date: Date): WorldMode {
  return override === 'clock' ? modeForClock(date) : override
}

/** Milliseconds until the clock's light next changes (so the world can re-check then, not every frame). */
export function msUntilNextChange(date: Date): number {
  const bounds = [6, 10, 16, 19, 30]
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
  const next = bounds.find(b => b > h) ?? 30
  return Math.max(1000, Math.round((next - h) * 3600 * 1000))
}

export function parseOverride(raw: string | null | undefined): TimeOverride {
  return raw === 'misty' || raw === 'sun' || raw === 'night' || raw === 'clock' ? raw : 'clock'
}

export const TIME_OVERRIDE_KEY = 'waymark_world_time'
export const TIME_OVERRIDE_EVENT = 'waymark:world-time'

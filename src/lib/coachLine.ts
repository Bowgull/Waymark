// One quiet line off the app (page 56 item 12): what the coach moved, named
// in the morning alarm you already have and in the Live Activity's finish
// card. No new notification. GET /api/coach/line; null when there is nothing
// new or the API is unreachable.

import { apiFetch } from './api'
import { getTodayISO } from './dates'

function isoPlus(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The next alarm's day: today before the alarm time, else tomorrow. The alarm
 * can only name changes known when the app was last open.
 */
export function nextAlarmDay(todayIso: string, alarmTime: string | null | undefined, now: Date = new Date()): string {
  const [h, m] = (alarmTime ?? '06:30').split(':').map(Number)
  const minutes = now.getHours() * 60 + now.getMinutes()
  return minutes < (h || 0) * 60 + (m || 0) ? todayIso : isoPlus(todayIso, 1)
}

export async function coachLine(kind: 'morning' | 'finish', day?: string): Promise<string | null> {
  try {
    const today = getTodayISO()
    const out = await apiFetch<{ line: string | null } | null>(`/api/coach/line?for=${kind}&day=${day ?? today}&today=${today}`, { timeoutMs: 4000 })
    return out?.line ?? null
  } catch {
    return null
  }
}

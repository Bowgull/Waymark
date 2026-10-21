// The athlete's time zone (coach brain P2, Josh-approved 2026-10-20): the
// phone sends its IANA zone on every request (X-Waymark-TZ); the server keeps
// the latest in settings.time_zone and reads local days and start times in it.
// Until a phone has sent one, Toronto (where Josh trains) stands in.

import { settings } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

export { TZ_HEADER } from '../lib/dates'
export const FALLBACK_TIME_ZONE = 'America/Toronto'

/** A zone Intl knows, else null. */
export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz || tz.length > 64) return null
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

export async function athleteTimeZone(db: DB): Promise<string> {
  const [row] = await db.select({ tz: settings.timeZone }).from(settings).limit(1)
  return validTimeZone(row?.tz) ?? FALLBACK_TIME_ZONE
}

const fmtCache = new Map<string, { day: Intl.DateTimeFormat; minute: Intl.DateTimeFormat }>()
function fmts(tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = {
      day: new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }),
      minute: new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    }
    fmtCache.set(tz, f)
  }
  return f
}

/** Local epoch day of a unix-seconds time in `tz`. */
export function localDayIn(unixSec: number, tz: string): number {
  const iso = fmts(tz).day.format(new Date(unixSec * 1000))
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000)
}

/** Local minute of day (0-1439) of a unix-seconds time in `tz`. */
export function localMinuteIn(unixSec: number, tz: string): number {
  const parts = fmts(tz).minute.formatToParts(new Date(unixSec * 1000))
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return (h % 24) * 60 + m
}

/**
 * A request from the phone: keep its zone and the day it was opened (the
 * nightly pass skips when nothing was logged and the app not opened in 2 days).
 * One small write at most a day, or when the zone changes.
 */
export async function noteAppOpen(db: DB, tzHeader: string | null | undefined, nowSec: number): Promise<void> {
  const tz = validTimeZone(tzHeader)
  const [row] = await db.select({ id: settings.id, tz: settings.timeZone, seen: settings.coachSeenAt }).from(settings).limit(1)
  if (!row) return
  const zone = tz ?? row.tz ?? FALLBACK_TIME_ZONE
  const sameDay = row.seen != null && localDayIn(row.seen, zone) === localDayIn(nowSec, zone)
  if (sameDay && (tz == null || tz === row.tz)) return
  await db.update(settings).set({ coachSeenAt: nowSec, ...(tz ? { timeZone: tz } : {}) })
}

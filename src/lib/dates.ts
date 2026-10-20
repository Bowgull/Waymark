/** Convert a Date to an epoch-day integer (days since Unix epoch). */
export function getEpochDay(date: Date): number {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return Math.floor(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000 / 86400)
}

/** Convert an ISO date string (YYYY-MM-DD) to epoch-day. */
export function isoToEpochDay(iso: string): number {
  return Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000 / 86400)
}

/** Get today's date as YYYY-MM-DD in local time. */
export function getTodayISO(): string {
  return new Date().toLocaleDateString('en-CA') // en-CA gives YYYY-MM-DD
}

/** Format a date for display: "Friday, April 11" */
export function formatDateDisplay(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/** Get day-of-week name from a Date. */
export function getDayName(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

/**
 * Monday of the Monday-Sunday week an epoch day falls in. The one week
 * definition for plans, the week counter, rollover asks and the coach.
 * Epoch days come from the athlete's local date (isoToEpochDay on the
 * client's YYYY-MM-DD), never from the server clock in the evening.
 */
export function mondayOf(epochDay: number): number {
  const dow = new Date(epochDay * 86400000).getUTCDay()
  return epochDay - ((dow + 6) % 7)
}

/**
 * A safe "today" for server-side rollover when no local date was sent: UTC
 * today minus one. Late evening in the Americas is already tomorrow in UTC,
 * so rolling over with the raw UTC day would mark tonight's session missed.
 */
export function serverRolloverDay(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 86400000) - 1
}

/** An epoch day as YYYY-MM-DD (the inverse of isoToEpochDay). */
export function epochDayToISO(epochDay: number): string {
  return new Date(epochDay * 86400000).toISOString().slice(0, 10)
}

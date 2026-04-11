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

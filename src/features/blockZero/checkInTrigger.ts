// The morning alarm's I'M UP opens the check-in cards (design-decisions.md,
// Morning Report: "the morning alarm (I'm Up opens the dawn forest)"). The
// notification listener can fire before React mounts, so the request is kept
// in storage for today and announced with an event for a mounted Today.

import { getTodayISO } from '@/lib/dates'
import { getItem, removeItem, setItem } from '@/lib/safeStorage'

import { CHECK_IN_REQUEST_KEY, CHECK_IN_SKIP_KEY } from './checkInFlow'

export const CHECK_IN_EVENT = 'waymark:open-checkin'

export function requestMorningCheckIn(): void {
  setItem(CHECK_IN_REQUEST_KEY, getTodayISO())
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHECK_IN_EVENT))
}

/** True once per request, for today only. */
export function takeCheckInRequest(): boolean {
  const day = getItem(CHECK_IN_REQUEST_KEY)
  if (day == null) return false
  removeItem(CHECK_IN_REQUEST_KEY)
  return day === getTodayISO()
}

export function markCheckInSkipped(): void {
  setItem(CHECK_IN_SKIP_KEY, getTodayISO())
}

export function checkInSkippedOn(): string | null {
  return getItem(CHECK_IN_SKIP_KEY)
}

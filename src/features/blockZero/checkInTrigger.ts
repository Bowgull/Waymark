// The morning alarm's I'M UP opens the check-in cards (design-decisions.md,
// Morning Report: "the morning alarm (I'm Up opens the dawn forest)"). The
// notification listener can fire before React mounts, so the request is kept
// in storage for today and announced with an event for a mounted Today.

import { getTodayISO } from '@/lib/dates'
import { getItem, removeItem, setItem } from '@/lib/safeStorage'

import { CHECK_IN_DRAFT_KEY, CHECK_IN_REQUEST_KEY, parseCheckInDraft, type CheckInAnswers, type CheckInDraft, type CheckInKey } from './checkInFlow'

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

/** Today's answers on this phone, saved as each card is answered (survives a closed deck or a lost connection). */
export function saveCheckInDraft(date: string, answers: CheckInAnswers, backNotes: string, passed: ReadonlyArray<CheckInKey> = []): void {
  setItem(CHECK_IN_DRAFT_KEY, JSON.stringify({ date, answers, backNotes, passed }))
}

export function loadCheckInDraft(date: string): CheckInDraft | null {
  return parseCheckInDraft(getItem(CHECK_IN_DRAFT_KEY), date)
}

export function clearCheckInDraft(): void {
  removeItem(CHECK_IN_DRAFT_KEY)
}

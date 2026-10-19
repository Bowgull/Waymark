// What a pick on the Add Session board does (Part C). The server decided the
// form before the board showed the row: a plain add, the week's next strength
// session pulled forward to this day, or a swap for the day's planned session.
// Today and the Program day board both send picks through here.

import { apiFetch, idempotencyHeaders } from './api'
import type { SessionSuggestion } from './sessionSuggestions'

export interface BoardPick {
  type: string
  label: string
  timeSlot: 'am' | 'pm'
  runCategory?: string
  action?: SessionSuggestion['action']
}

export type BoardPickResult<S> =
  | { kind: 'added'; session: S }
  | { kind: 'moved'; session: S; displaced: S[] }
  | { kind: 'replaced'; original: S; replacement: S }

/** Send one board pick for `date` (YYYY-MM-DD); `today` is the athlete's local date. */
export async function submitBoardPick<S>(pick: BoardPick, date: string, today: string): Promise<BoardPickResult<S>> {
  const a = pick.action
  if (a?.kind === 'pull_forward') {
    const out = await apiFetch<{ session: S; displaced: S[] }>(`/api/sessions/${a.sessionId}/pull-forward`, {
      method: 'POST',
      body: JSON.stringify({ date, timeSlot: a.timeSlot, today }),
    })
    return { kind: 'moved', session: out.session, displaced: out.displaced }
  }
  if (a?.kind === 'replace') {
    const out = await apiFetch<{ original: S; replacement: S }>(`/api/sessions/${a.sessionId}/replace`, {
      method: 'POST',
      body: JSON.stringify({ reason: pick.label, type: pick.type, label: a.label ?? undefined, timeSlot: a.timeSlot, runCategory: pick.runCategory, today }),
    })
    return { kind: 'replaced', original: out.original, replacement: out.replacement }
  }
  const session = await apiFetch<S>('/api/sessions/insert-ad-hoc', {
    method: 'POST',
    headers: idempotencyHeaders(),
    body: JSON.stringify({
      date,
      type: pick.type,
      // Block Zero strength carries its letter (the board's row says which).
      ...(pick.type === 'strength' && /Strength [ABC]\b/.test(a?.label ?? pick.label) ? { label: a?.label ?? pick.label } : {}),
      timeSlot: pick.timeSlot,
      runCategory: pick.runCategory,
      today,
    }),
  })
  return { kind: 'added', session }
}

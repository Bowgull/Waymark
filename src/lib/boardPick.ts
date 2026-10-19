// His picks on the Add Session board and his REPLACE / SKIP (page 56,
// approved 2026-10-19). Nothing is refused: an add always adds (strength on a
// day with no lifting pulls the week's next strength forward), a pick on the
// REPLACE board swaps at once with the optional reason tile, and SKIP is
// instant (a reason tile can follow). The coach then rebalances on the
// server. Today and the Program day board both send picks through here.

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
  const session = await apiFetch<S>('/api/sessions/insert-ad-hoc', {
    method: 'POST',
    headers: idempotencyHeaders(),
    body: JSON.stringify({
      date,
      type: pick.type,
      // Block Zero strength carries its letter (the board's row says which).
      ...(pick.type === 'strength' && /Strength [ABC]\b/.test(a?.label ?? pick.label) ? { label: a?.label ?? pick.label } : {}),
      ...(pick.type === 'mt_class' ? { label: pick.label } : {}),
      timeSlot: pick.timeSlot,
      runCategory: pick.runCategory,
      today,
    }),
  })
  return { kind: 'added', session }
}

/** A pick on the REPLACE board: the swap, at once, with the optional reason code. */
export async function submitReplace<S>(sessionId: string, pick: Pick<BoardPick, 'type' | 'label' | 'timeSlot' | 'runCategory'>, reason: string | null, today: string): Promise<{ original: S; replacement: S }> {
  return apiFetch<{ original: S; replacement: S }>(`/api/sessions/${sessionId}/replace`, {
    method: 'POST',
    body: JSON.stringify({ reason, type: pick.type, label: pick.type === 'strength' && !/Strength [ABC]\b/.test(pick.label) ? undefined : pick.label, timeSlot: pick.timeSlot, runCategory: pick.runCategory, today }),
  })
}

/** SKIP, instant. Returns the skip's change id, for a reason tile tapped after. */
export async function submitSkip<S>(sessionId: string, today: string): Promise<{ session: S; changeId: string | null }> {
  return apiFetch<{ session: S; changeId: string | null }>(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'skipped', today }),
  })
}

/** A reason tile on a skip (null clears it); `detail` is the place for injury. */
export async function submitSkipReason(changeId: string, reason: string | null, detail: string | null, today: string): Promise<void> {
  await apiFetch(`/api/changes/${changeId}/reason`, { method: 'PATCH', body: JSON.stringify({ reason, detail, today }) })
}

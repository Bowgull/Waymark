// Strava's poll (Today, on open) said the link is broken: a 401 / 403 from the
// activity list, or a token refresh that fails. Kept on this phone so the
// existing Strava row in Settings can say "Strava needs reconnecting" (approved
// 2026-10-21; no new screen). A good poll, or a reconnect since, clears it.

import { getItem, removeItem, setItem } from './safeStorage'

export const STRAVA_RECONNECT_KEY = 'waymark_strava_needs_reconnect'

/** The poll errors that only a reconnect fixes. */
export function needsReconnect(error: string | null | undefined): boolean {
  return error === 'strava_401' || error === 'strava_403' || error === 'refresh_failed'
}

/** Today's poll answered: remember a broken link, forget it once a poll works. */
export function notePollResult(result: { connected: boolean; error?: string }, nowMs: number = Date.now()): void {
  if (!result.connected) { removeItem(STRAVA_RECONNECT_KEY); return }
  if (needsReconnect(result.error)) setItem(STRAVA_RECONNECT_KEY, JSON.stringify({ error: result.error, at: nowMs }))
  else if (!result.error) removeItem(STRAVA_RECONNECT_KEY)
}

/** Settings: does the connected Strava need reconnecting? (Not when it was connected again after the failure.) */
export function stravaNeedsReconnect(connectedAt: number | null | undefined, raw: string | null = getItem(STRAVA_RECONNECT_KEY)): boolean {
  if (!raw) return false
  try {
    const d = JSON.parse(raw) as { error?: unknown; at?: unknown }
    if (typeof d.at !== 'number' || !needsReconnect(typeof d.error === 'string' ? d.error : null)) return false
    // connected_at is stored in ms (older rows may be seconds)
    const connectedMs = connectedAt == null ? null : connectedAt < 1e12 ? connectedAt * 1000 : connectedAt
    return connectedMs == null || connectedMs < d.at
  } catch {
    return false
  }
}

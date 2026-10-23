// Class to combo on the phone (page 49): ask the server (the AI and the parser,
// checked against the bag), or, with no connection, run the parser here
// against the copy of the bag kept from the last time it was read. The note
// and any ADD TO BAG / NOT NOW wait in the outbox until the connection is back.

import { ApiError, apiFetch, idempotencyHeaders } from '@/lib/api'
import { classifyFound, deriveTechniques, parseCombos, type BagCombo, type FoundLine } from '@/lib/classCombos'
import { queueWrite } from '@/lib/outboxSync'
import { getItem, setItem } from '@/lib/safeStorage'

export const BAG_CACHE_KEY = 'waymark_bag_library'

export interface BagLibrary {
  combos: BagCombo[]
  enabled: string[]
  declined: string[]
}

export interface FoundResult {
  lines: FoundLine[]
  unknown: string[]
  off: string[]
  /** Worked out on this phone (no connection). */
  local?: boolean
}

/** The copy of the bag kept from the last read (null before the first). */
export function cachedBagLibrary(): BagLibrary | null {
  return cached()
}

function cached(): BagLibrary | null {
  try {
    const raw = getItem(BAG_CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as BagLibrary
    return Array.isArray(v.combos) && Array.isArray(v.enabled) && Array.isArray(v.declined) ? v : null
  } catch {
    return null
  }
}

/** Reads the bag and keeps a copy for the offline parser. Quiet on failure. */
export async function refreshBagLibrary(): Promise<BagLibrary | null> {
  try {
    const lib = await apiFetch<BagLibrary>('/api/class-combos/library')
    setItem(BAG_CACHE_KEY, JSON.stringify(lib))
    return lib
  } catch {
    return cached()
  }
}

const offline = (e: unknown) => e instanceof ApiError && e.type === 'network'

/** FIND COMBOS: the note saved with the class, and every combo found, checked against the bag. */
export async function findCombos(sessionId: string, mtLogId: string, note: string): Promise<FoundResult> {
  try {
    return await apiFetch<FoundResult>('/api/class-combos/learned', { method: 'POST', body: JSON.stringify({ mtLogId, note }), timeoutMs: 30_000 })
  } catch (e) {
    if (!offline(e)) throw e
    // No connection: the note waits in the outbox; the parser runs here.
    void queueWrite({ method: 'PATCH', path: `/api/mt-class-logs/${mtLogId}`, body: { learnedNote: note }, sessionId, kind: 'class-note' })
    const lib = cached() ?? { combos: [], enabled: ['boxing', 'kicks', 'defensive'], declined: [] }
    const x = parseCombos(note, deriveTechniques(lib.combos.map(c => c.text)), new Set(lib.enabled))
    return { lines: classifyFound(x.combos, lib.combos, new Set(lib.declined)), unknown: x.unknown, off: x.off, local: true }
  }
}

/** ADD TO BAG (a new combo, or a locked one unlocked). Queued when offline. */
export async function addComboToBag(sessionId: string, strikes: string[]): Promise<void> {
  try {
    await apiFetch('/api/class-combos/add', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ strikes, sessionId }) })
  } catch (e) {
    if (!offline(e)) throw e
    await queueWrite({ method: 'POST', path: '/api/class-combos/add', body: { strikes, sessionId }, sessionId, kind: 'class-combo' })
  }
}

/** NOT NOW, remembered so it isn't offered again. Queued when offline. */
export async function declineCombo(sessionId: string, strikes: string[]): Promise<void> {
  try {
    await apiFetch('/api/class-combos/decline', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ strikes, sessionId }) })
  } catch (e) {
    if (!offline(e)) throw e
    await queueWrite({ method: 'POST', path: '/api/class-combos/decline', body: { strikes, sessionId }, sessionId, kind: 'class-combo' })
  }
}

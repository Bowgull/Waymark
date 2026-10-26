// His combos and his bag sessions on the phone (page 80). The bag library
// (for reading a typed combo, offline too) and his pool and routines (for the
// bag builder) are read ahead, so nothing loads after a tap.

import { ApiError, apiFetch, idempotencyHeaders } from '@/lib/api'
import type { LevelKey } from '@/lib/classCombos'
import type { BagRoutine, FocusHistory, PoolCombo } from '@/lib/coach/bagArc'
import { queueWrite } from '@/lib/outboxSync'

export { cachedBagLibrary, refreshBagLibrary } from '@/features/session/classCombosClient'

/** A combo row as the server returns it. */
export interface AddedCombo extends PoolCombo {
  unlocked: number
  classDate?: number | null
}

const offline = (e: unknown) => e instanceof ApiError && e.type === 'network'

/**
 * ADD: the combo joins his bag ('mine' when typed, 'class' after a class).
 * Offline it waits in the outbox; the row is shown at once either way.
 */
export async function addTypedCombo(strikes: string[], opts: { source: 'mine' | 'class'; sessionId?: string | null; difficulty: LevelKey | null }): Promise<AddedCombo | null> {
  const body = { strikes, sessionId: opts.sessionId ?? null, source: opts.source, difficulty: opts.difficulty }
  try {
    const out = await apiFetch<{ combo: AddedCombo }>('/api/class-combos/add', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify(body) })
    if (out?.combo) {
      const pool = poolNow()
      if (pool) setPool({ ...pool, combos: [out.combo, ...pool.combos.filter(c => c.id !== out.combo.id)] })
    }
    return out?.combo ?? null
  } catch (e) {
    if (!offline(e)) throw e
    await queueWrite({ method: 'POST', path: '/api/class-combos/add', body, sessionId: opts.sessionId ?? null, kind: 'class-combo' })
    return null
  }
}

// ─── his pool and routines, read ahead ────────────────────────

export interface BagPoolData {
  combos: PoolCombo[]
  routines: BagRoutine[]
  /** Page 93: his last sessions' A and B, newest first (the coach keeps a pair about 3 sessions). */
  history?: FocusHistory[]
  /** His Settings switches (the finisher row follows them). */
  groups?: string[]
}

let pool: BagPoolData | null = null
let inflight: Promise<BagPoolData | null> | null = null
const listeners = new Set<() => void>()

function setPool(p: BagPoolData) {
  pool = p
  for (const l of listeners) l()
}

export function poolNow(): BagPoolData | null {
  return pool
}

export function subscribePool(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Read his pool and routines ahead (the picks window opening is the moment). Quiet on failure. */
export function prefetchBagPool(): Promise<BagPoolData | null> {
  inflight ??= apiFetch<BagPoolData>('/api/bag/pool')
    .then(p => { if (p && Array.isArray(p.combos)) setPool({ combos: p.combos, routines: Array.isArray(p.routines) ? p.routines : [], history: Array.isArray(p.history) ? p.history : [], groups: Array.isArray(p.groups) ? p.groups : undefined }); return pool })
    .catch(() => pool)
    .finally(() => { inflight = null })
  return inflight
}

/** SAVE ROUTINE (the same id or name updates it). */
export async function saveBagRoutine(r: Omit<BagRoutine, 'id'> & { id?: string }): Promise<BagRoutine> {
  const saved = await apiFetch<BagRoutine>('/api/bag/routines', { method: 'POST', body: JSON.stringify(r) })
  const p = poolNow() ?? { combos: [], routines: [] }
  setPool({ ...p, routines: [saved, ...p.routines.filter(x => x.id !== saved.id)] })
  return saved
}

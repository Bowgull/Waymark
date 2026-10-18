// Idempotent writes: the server half of the offline outbox (first slice).
//
// A write that carries an Idempotency-Key is claimed before it runs and its
// response stored after. A replay with the same key gets the stored response
// and writes nothing, so a retried set save, session finish or combo rating
// lands once. Two copies racing: the second sees the claim and gets a 409 it
// can retry later. A claim left behind by a crashed request goes stale after
// STALE_CLAIM_SEC and the next try takes it over. Only 2xx responses are
// stored: a 4xx or 5xx releases the claim so a fixed retry can run.
//
// Pure logic over a small store interface; the D1 store lives in the server.

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'
export const IDEMPOTENCY_TTL_SEC = 7 * 86400
export const STALE_CLAIM_SEC = 120
const KEY_PATTERN = /^[A-Za-z0-9:_.-]{8,128}$/

export interface StoredKey {
  key: string
  route: string
  /** 0 = in flight, else the HTTP status of the stored response. */
  status: number
  responseBody: string | null
  createdAt: number
}

export interface IdempotencyStore {
  /** Insert a claim (status 0). False when the key already exists. */
  claim(key: string, route: string, nowSec: number): Promise<boolean>
  get(key: string): Promise<StoredKey | null>
  /** Take over a stale claim: reset created_at, keep status 0. */
  reclaim(key: string, nowSec: number): Promise<void>
  complete(key: string, status: number, body: string, nowSec: number): Promise<void>
  release(key: string): Promise<void>
}

export interface WriteResult {
  status: number
  body: string
}

export type IdempotentOutcome =
  | { kind: 'executed'; result: WriteResult }
  | { kind: 'replayed'; result: WriteResult }
  | { kind: 'in_flight' }
  | { kind: 'mismatch' }

export function isValidIdempotencyKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

/** What to do with a key that already exists. */
export function decideExisting(existing: StoredKey, route: string, nowSec: number): 'replay' | 'in_flight' | 'takeover' | 'mismatch' {
  if (existing.route !== route) return 'mismatch'
  if (existing.status > 0) return 'replay'
  return nowSec - existing.createdAt >= STALE_CLAIM_SEC ? 'takeover' : 'in_flight'
}

/**
 * Run `exec` at most once per key. `route` should be the method plus the
 * concrete path, so a key reused for a different write is refused.
 */
export async function runIdempotent(
  store: IdempotencyStore,
  key: string,
  route: string,
  nowSec: number,
  exec: () => Promise<WriteResult>,
): Promise<IdempotentOutcome> {
  if (!(await store.claim(key, route, nowSec))) {
    const existing = await store.get(key)
    if (!existing) {
      // Released between our claim and read: try once more.
      if (!(await store.claim(key, route, nowSec))) return { kind: 'in_flight' }
    } else {
      const decision = decideExisting(existing, route, nowSec)
      if (decision === 'mismatch') return { kind: 'mismatch' }
      if (decision === 'in_flight') return { kind: 'in_flight' }
      if (decision === 'replay') return { kind: 'replayed', result: { status: existing.status, body: existing.responseBody ?? '' } }
      await store.reclaim(key, nowSec)
    }
  }

  let result: WriteResult
  try {
    result = await exec()
  } catch (err) {
    await store.release(key)
    throw err
  }
  if (result.status >= 200 && result.status < 300) {
    await store.complete(key, result.status, result.body, nowSec)
  } else {
    await store.release(key)
  }
  return { kind: 'executed', result }
}

/** Rows older than this are pruned (unix seconds cutoff). */
export function idempotencyCutoff(nowSec: number): number {
  return nowSec - IDEMPOTENCY_TTL_SEC
}

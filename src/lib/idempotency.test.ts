import assert from 'node:assert/strict'
import { decideExisting, idempotencyCutoff, isValidIdempotencyKey, runIdempotent, STALE_CLAIM_SEC, type IdempotencyStore, type StoredKey } from './idempotency'

function memoryStore(): IdempotencyStore & { rows: Map<string, StoredKey> } {
  const rows = new Map<string, StoredKey>()
  return {
    rows,
    async claim(key, route, nowSec) {
      if (rows.has(key)) return false
      rows.set(key, { key, route, status: 0, responseBody: null, createdAt: nowSec })
      return true
    },
    async get(key) { return rows.get(key) ?? null },
    async reclaim(key, nowSec) { const r = rows.get(key); if (r) r.createdAt = nowSec },
    async complete(key, status, body) { const r = rows.get(key); if (r) { r.status = status; r.responseBody = body } },
    async release(key) { rows.delete(key) },
  }
}

const KEY = 'set:abc123:1700000000'
const ROUTE = 'PATCH /api/strength-sets/abc123'

// Same key twice: one write, the second gets the stored response.
{
  const store = memoryStore()
  let writes = 0
  const exec = async () => { writes++; return { status: 200, body: JSON.stringify({ id: 'abc123', reps: 5 }) } }
  const first = await runIdempotent(store, KEY, ROUTE, 1000, exec)
  const second = await runIdempotent(store, KEY, ROUTE, 1005, exec)
  assert.equal(writes, 1, 'replayed key writes once')
  assert.equal(first.kind, 'executed')
  assert.equal(second.kind, 'replayed')
  assert.ok(second.kind === 'replayed' && second.result.body.includes('"reps":5'), 'replay returns the first response')
}

// A key reused for a different route is refused.
{
  const store = memoryStore()
  await runIdempotent(store, KEY, ROUTE, 1000, async () => ({ status: 200, body: '{}' }))
  const other = await runIdempotent(store, KEY, 'POST /api/sessions/s1/complete', 1001, async () => ({ status: 200, body: '{}' }))
  assert.equal(other.kind, 'mismatch', 'key reuse across routes is a mismatch')
}

// In flight: a second copy while the first runs gets in_flight, not a second write.
{
  const store = memoryStore()
  await store.claim(KEY, ROUTE, 1000)
  let writes = 0
  const out = await runIdempotent(store, KEY, ROUTE, 1010, async () => { writes++; return { status: 200, body: '{}' } })
  assert.equal(out.kind, 'in_flight')
  assert.equal(writes, 0)
  // Stale claim (crashed request) is taken over.
  const later = await runIdempotent(store, KEY, ROUTE, 1000 + STALE_CLAIM_SEC + 1, async () => { writes++; return { status: 200, body: '{"ok":true}' } })
  assert.equal(later.kind, 'executed', 'stale claim is taken over')
  assert.equal(writes, 1)
}

// Failures release the key so a retry can run.
{
  const store = memoryStore()
  const failed = await runIdempotent(store, KEY, ROUTE, 1000, async () => ({ status: 500, body: 'boom' }))
  assert.equal(failed.kind, 'executed')
  assert.equal(store.rows.size, 0, '5xx is not stored')
  await assert.rejects(runIdempotent(store, KEY, ROUTE, 1001, async () => { throw new Error('db down') }))
  assert.equal(store.rows.size, 0, 'a throw releases the claim')
  const retry = await runIdempotent(store, KEY, ROUTE, 1002, async () => ({ status: 200, body: '{}' }))
  assert.equal(retry.kind, 'executed', 'retry after a failure runs')
}

assert.equal(decideExisting({ key: KEY, route: ROUTE, status: 201, responseBody: '{}', createdAt: 0 }, ROUTE, 5), 'replay')
assert.ok(isValidIdempotencyKey('0b6c0f1e-3d5c-4c4e-9f3a-1a2b3c4d5e6f'))
assert.ok(!isValidIdempotencyKey('short'))
assert.ok(!isValidIdempotencyKey('has spaces in it'))
assert.ok(!isValidIdempotencyKey(null))
assert.equal(idempotencyCutoff(7 * 86400 + 10), 10)

console.log('idempotency tests passed')

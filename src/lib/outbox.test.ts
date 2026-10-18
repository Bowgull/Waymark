import assert from 'node:assert/strict'
import { hasIdempotencyKey, idempotencyHeaders, maxAttemptsFor } from './retryPolicy'
import { backoffMs, enqueue, flushQueue, flushStoredOutbox, isRetryableStatus, loadDeadLetters, loadOutbox, nextDueAt, pendingFor, resetOutboxMemory, saveOutbox, type OutboxEntry, type SendOutcome, type StorageLike } from './outbox'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}

const throwingStorage: StorageLike = {
  getItem() { throw new Error('SecurityError') },
  setItem() { throw new Error('QuotaExceededError') },
}

function setWrite(id: string, sessionId = 's1', kind = 'set'): Omit<OutboxEntry, 'attempts' | 'nextAttemptAtMs' | 'createdAtMs'> {
  return { id, method: 'PATCH', path: `/api/strength-sets/${id}`, body: '{"reps":5}', sessionId, kind }
}

// Enqueue dedupes by id (the Idempotency-Key).
{
  let q: OutboxEntry[] = []
  q = enqueue(q, setWrite('k1'), 0)
  q = enqueue(q, setWrite('k1'), 10)
  q = enqueue(q, setWrite('k2'), 20)
  assert.equal(q.length, 2, 'same key queued once')
  assert.equal(pendingFor(q, 's1').length, 2)
  assert.equal(nextDueAt(q), 0)
}

// Backoff grows and caps.
assert.deepEqual([1, 2, 3, 4, 9].map(backoffMs), [1000, 5000, 30000, 60000, 60000])
assert.ok(isRetryableStatus(0) && isRetryableStatus(503) && isRetryableStatus(409) && isRetryableStatus(429))
assert.ok(!isRetryableStatus(400) && !isRetryableStatus(404) && !isRetryableStatus(422))

// Order per session: a failed set blocks the finish behind it; another session still goes.
{
  let q: OutboxEntry[] = []
  q = enqueue(q, setWrite('set-a'), 0)
  q = enqueue(q, { id: 'finish-1', method: 'POST', path: '/api/sessions/s1/complete', body: '{"rpe":7}', sessionId: 's1', kind: 'finish' }, 0)
  q = enqueue(q, setWrite('set-b', 's2'), 0)
  const sentPaths: string[] = []
  const send = async (e: OutboxEntry): Promise<SendOutcome> => {
    sentPaths.push(e.path)
    if (e.id === 'set-a') return { ok: false, retry: true, error: 'network' }
    return { ok: true }
  }
  const out = await flushQueue(q, send, 100)
  assert.deepEqual(sentPaths, ['/api/strength-sets/set-a', '/api/strength-sets/set-b'], 'finish waits for its set')
  assert.equal(out.summary.sent, 1)
  assert.equal(out.queue.length, 2)
  const retried = out.queue.find(e => e.id === 'set-a')!
  assert.equal(retried.attempts, 1)
  assert.equal(retried.nextAttemptAtMs, 100 + 1000, 'first retry after 1 s')

  // Not due yet: nothing sent. Forced (online / resume / finishing): sent.
  const early = await flushQueue(out.queue, async () => ({ ok: true }), 500)
  assert.equal(early.summary.sent, 0, 'backoff respected')
  const forced = await flushQueue(out.queue, async () => ({ ok: true }), 500, { force: true })
  assert.equal(forced.summary.sent, 2, 'forced flush sends set then finish')
  assert.equal(forced.queue.length, 0)
}

// A 4xx that won't succeed goes to dead letters instead of looping.
{
  let q: OutboxEntry[] = []
  q = enqueue(q, setWrite('bad'), 0)
  const out = await flushQueue(q, async () => ({ ok: false, retry: false, error: '400 bad input' }), 0)
  assert.equal(out.queue.length, 0)
  assert.equal(out.dead.length, 1)
  assert.equal(out.dead[0].lastError, '400 bad input')
}

// A throwing sender counts as a retryable failure.
{
  const q = enqueue([], setWrite('t1'), 0)
  const out = await flushQueue(q, async () => { throw new Error('offline') }, 0)
  assert.equal(out.queue[0].attempts, 1)
  assert.equal(out.queue[0].lastError, 'offline')
}

// Persistence round trip, and writes queued mid-flush survive.
{
  resetOutboxMemory()
  const storage = memoryStorage()
  saveOutbox(storage, enqueue([], setWrite('p1'), 0))
  assert.equal(loadOutbox(storage).length, 1)
  const summary = await flushStoredOutbox(storage, async (e) => {
    if (e.id === 'p1') saveOutbox(storage, enqueue(loadOutbox(storage), setWrite('p2'), 5))
    return { ok: true }
  }, 10)
  assert.equal(summary.sent, 1)
  const left = loadOutbox(storage)
  assert.deepEqual(left.map(e => e.id), ['p2'], 'a write queued during the flush is kept')

  storage.data.set('waymark_outbox_v1', 'not json')
  assert.deepEqual(loadOutbox(storage), [], 'corrupt storage reads as empty')

  const deadStorage = memoryStorage()
  saveOutbox(deadStorage, enqueue([], setWrite('d1'), 0))
  await flushStoredOutbox(deadStorage, async () => ({ ok: false, retry: false, error: '404' }), 0)
  assert.equal(loadDeadLetters(deadStorage).length, 1, 'dead letter persisted')
}

// Storage that throws: the in-memory queue still holds the write for this run.
{
  resetOutboxMemory()
  saveOutbox(throwingStorage, enqueue([], setWrite('m1'), 0))
  assert.equal(loadOutbox(throwingStorage).length, 1, 'memory fallback when storage throws')
  assert.deepEqual(loadDeadLetters(throwingStorage), [])
  resetOutboxMemory()
}

// apiFetch retry policy: reads and keyed writes may retry; plain writes never.
assert.equal(maxAttemptsFor('GET', undefined), 2)
assert.equal(maxAttemptsFor('post', undefined), 1, 'a plain POST is sent once')
assert.equal(maxAttemptsFor('PATCH', { 'Content-Type': 'application/json' }), 1)
assert.equal(maxAttemptsFor('POST', idempotencyHeaders('abc-123-key')), 2, 'a keyed POST may retry')
assert.equal(maxAttemptsFor('POST', [['idempotency-key', 'abc-123-key']]), 2, 'header names are case-insensitive')
assert.ok(hasIdempotencyKey({ 'IDEMPOTENCY-KEY': 'x' }))
assert.notEqual(idempotencyHeaders()['Idempotency-Key'], idempotencyHeaders()['Idempotency-Key'], 'fresh key per logical write')

console.log('outbox tests passed')

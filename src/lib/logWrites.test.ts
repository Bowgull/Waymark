import assert from 'node:assert/strict'
import { classLogWrite, keepForRetry, runLogWrite } from './logWrites'

// Log your run: one stable key per run, ordered with its session's writes.
{
  const w = runLogWrite('r1', 's1', { distanceKm: 5 })
  assert.equal(w.method, 'PATCH')
  assert.equal(w.path, '/api/run-sessions/r1')
  assert.equal(w.sessionId, 's1', 'ordered before the finish')
  assert.equal(w.key, runLogWrite('r1', 's1', { distanceKm: 6 }).key, 'a second tap is the same write')
  assert.notEqual(w.key, runLogWrite('r2', 's1', {}).key)
  assert.deepEqual(w.body, { distanceKm: 5 })
}

// The MT class log: the same, per log.
{
  const w = classLogWrite('m1', 's1', { classType: 'pads' })
  assert.equal(w.path, '/api/mt-class-logs/m1')
  assert.equal(w.sessionId, 's1')
  assert.equal(w.key, classLogWrite('m1', null, {}).key)
  assert.notEqual(w.key, runLogWrite('m1', 's1', {}).key, 'a run and a class log never share a key')
}

// Only a save that may not have landed is kept for a retry.
assert.equal(keepForRetry({ type: 'network' }), true, 'no signal')
assert.equal(keepForRetry({ type: 'server' }), true, 'a 5xx or a timeout')
assert.equal(keepForRetry({ type: 'client' }), false, 'a 4xx is a real error')
assert.equal(keepForRetry(new Error('boom')), false)
assert.equal(keepForRetry(null), false)

console.log('logWrites tests passed')

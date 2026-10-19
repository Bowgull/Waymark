// Run: tsx src/lib/workoutCache.test.ts
import assert from 'node:assert/strict'

import type { StorageLike } from './sessionResume'
import { WORKOUT_CACHE_KEEP, WORKOUT_CACHE_MAX_AGE_MS, clearWorkoutCache, loadWithCopy, readWorkoutCache, writeWorkoutCache } from './workoutCache'

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v) }, removeItem: k => { map.delete(k) } }
}

const offline = new Error('network')
const isNetwork = (e: unknown) => e === offline

async function main() {
  const s = memory()
  // Online: fetched and kept.
  const first = await loadWithCopy(s, 'ses1', 'workout', async () => ({ sets: [1, 2] }), isNetwork, () => 1000)
  assert.deepEqual(first, { data: { sets: [1, 2] }, fromCopy: false })
  // Reload with the API unreachable: the copy (e2e major 6).
  const again = await loadWithCopy(s, 'ses1', 'workout', async () => { throw offline }, isNetwork, () => 2000)
  assert.deepEqual(again, { data: { sets: [1, 2] }, fromCopy: true })
  // A server refusal (not the network) is not hidden by the copy.
  const refused = new Error('404')
  await assert.rejects(loadWithCopy(s, 'ses1', 'workout', async () => { throw refused }, isNetwork, () => 2000), e => e === refused)
  // Nothing kept for that part: the network error stands.
  await assert.rejects(loadWithCopy(s, 'ses1', 'history:x', async () => { throw offline }, isNetwork, () => 2000), e => e === offline)
  // Too old: not used.
  assert.equal(readWorkoutCache(s, 'ses1', 'workout', 2000 + WORKOUT_CACHE_MAX_AGE_MS + 1), null)
  // Parts sit side by side; a later write keeps the earlier part.
  writeWorkoutCache(s, 'ses1', 'session', { id: 'ses1' }, 3000)
  assert.deepEqual(readWorkoutCache(s, 'ses1', 'workout', 3000), { sets: [1, 2] })
  // Only the newest few sessions are kept.
  for (let i = 2; i <= WORKOUT_CACHE_KEEP + 2; i++) writeWorkoutCache(s, `ses${i}`, 'workout', i, 4000 + i)
  assert.equal(readWorkoutCache(s, 'ses1', 'workout', 5000), null, 'the oldest session is dropped')
  assert.equal(readWorkoutCache(s, `ses${WORKOUT_CACHE_KEEP + 2}`, 'workout', 5000), WORKOUT_CACHE_KEEP + 2)
  clearWorkoutCache(s, `ses${WORKOUT_CACHE_KEEP + 2}`)
  assert.equal(readWorkoutCache(s, `ses${WORKOUT_CACHE_KEEP + 2}`, 'workout', 5000), null)
  // No storage: still loads.
  assert.deepEqual(await loadWithCopy(null, 'x', 'p', async () => 1, isNetwork), { data: 1, fromCopy: false })
  console.log('workoutCache tests passed')
}

void main().catch(e => { console.error(e); process.exit(1) })

// Run: tsx src/lib/setPlace.test.ts
import assert from 'node:assert/strict'

import { setPlace } from './setPlace'

const bench = [{ isWarmup: 1 }, { isWarmup: 0 }, { isWarmup: 0 }]
assert.deepEqual(setPlace(bench, 0), { warmup: true, n: 1, of: 1 }, 'the ramp set is Warmup 1 of 1')
assert.deepEqual(setPlace(bench, 1), { warmup: false, n: 1, of: 2 }, 'the first working set is Set 1 of 2, not 2 of 3')
assert.deepEqual(setPlace(bench, 2), { warmup: false, n: 2, of: 2 })
assert.deepEqual(setPlace([{ isWarmup: 0 }, { isWarmup: 0 }, { isWarmup: 0 }], 1), { warmup: false, n: 2, of: 3 }, 'no warm-ups: as before')
assert.equal(setPlace(bench, 5), null)
console.log('setPlace tests passed')

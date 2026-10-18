import assert from 'node:assert/strict'
import {
  NARUTO_ARCS, NARUTO_EPISODES, clampNarutoEp, narutoArcForEp,
  narutoEpisodesWatched, narutoNextEp, validateNarutoPatch,
} from './naruto'

// Minutes -> episodes watched.
const min = (m: number) => m * 60
assert.equal(narutoEpisodesWatched(min(14)), 0, 'under 15 min: no prompt')
assert.equal(narutoEpisodesWatched(min(14.99)), 0)
assert.equal(narutoEpisodesWatched(min(15)), 1, '15 min: at least 1')
assert.equal(narutoEpisodesWatched(min(20)), 1)
assert.equal(narutoEpisodesWatched(min(34)), 1, '34/23 = 1.48 -> 1')
assert.equal(narutoEpisodesWatched(min(35)), 2, '35/23 = 1.52 -> 2')
assert.equal(narutoEpisodesWatched(min(46)), 2)
assert.equal(narutoEpisodesWatched(min(60)), 3, '60/23 = 2.6 -> 3')
assert.equal(narutoEpisodesWatched(min(90)), 4)
assert.equal(narutoEpisodesWatched(0), 0)
assert.equal(narutoEpisodesWatched(-60), 0)
assert.equal(narutoEpisodesWatched(null), 0)
assert.equal(narutoEpisodesWatched(NaN), 0)

// Next episode, clamped to the series.
assert.equal(narutoNextEp(10, 2), 12)
assert.equal(narutoNextEp(null, 2), 2, 'unset counts from before ep 1')
assert.equal(narutoNextEp(219, 3), NARUTO_EPISODES, 'clamped at 220')
assert.equal(clampNarutoEp(0), 1)
assert.equal(clampNarutoEp(-5), 1)
assert.equal(clampNarutoEp(500), 220)

// Arc table: contiguous, covers 1..220, lookups at the edges.
assert.equal(NARUTO_ARCS[0].first, 1)
assert.equal(NARUTO_ARCS[NARUTO_ARCS.length - 1].last, NARUTO_EPISODES)
for (let i = 1; i < NARUTO_ARCS.length; i++) {
  assert.equal(NARUTO_ARCS[i].first, NARUTO_ARCS[i - 1].last + 1, `arc ${i} contiguous`)
}
assert.equal(narutoArcForEp(1), 'Land of Waves')
assert.equal(narutoArcForEp(19), 'Land of Waves')
assert.equal(narutoArcForEp(20), 'Chunin Exams')
assert.equal(narutoArcForEp(80), 'Konoha Crush')
assert.equal(narutoArcForEp(100), 'Search for Tsunade')
assert.equal(narutoArcForEp(107), 'Sasuke Recovery')
assert.equal(narutoArcForEp(135), 'Sasuke Recovery')
assert.equal(narutoArcForEp(136), 'Filler')
assert.equal(narutoArcForEp(220), 'Filler')
assert.equal(narutoArcForEp(0), null)
assert.equal(narutoArcForEp(221), null)
assert.equal(narutoArcForEp(1.5), null)
assert.equal(narutoArcForEp(null), null)

// Settings validation.
assert.deepEqual(validateNarutoPatch({}), { ok: true, updates: {} }, 'absent stays absent')
assert.deepEqual(validateNarutoPatch({ narutoEp: 12, narutoArc: 'Chunin Exams' }),
  { ok: true, updates: { narutoEp: 12, narutoArc: 'Chunin Exams' } })
assert.deepEqual(validateNarutoPatch({ narutoEp: '42' }), { ok: true, updates: { narutoEp: 42 } }, 'numeric string ok')
assert.deepEqual(validateNarutoPatch({ narutoEp: null, narutoArc: '' }),
  { ok: true, updates: { narutoEp: null, narutoArc: null } }, 'null or empty clears')
assert.equal(validateNarutoPatch({ narutoEp: 0 }).ok, false)
assert.equal(validateNarutoPatch({ narutoEp: 221 }).ok, false)
assert.equal(validateNarutoPatch({ narutoEp: 3.5 }).ok, false)
assert.equal(validateNarutoPatch({ narutoEp: 'ep 3' }).ok, false)
assert.equal(validateNarutoPatch({ narutoEp: true }).ok, false)
assert.equal(validateNarutoPatch({ narutoArc: 'Shippuden' }).ok, false)
assert.equal(validateNarutoPatch({ narutoArc: 5 }).ok, false)

console.log('naruto tests passed')

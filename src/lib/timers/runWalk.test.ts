// Run: tsx src/lib/timers/runWalk.test.ts
import assert from 'node:assert/strict'

import { runWalkTotalSec, getRunWalkWeek } from '../blockZero/running'
import { runWalkAt, runWalkCount, runWalkCueTimes, runWalkSegments } from './runWalk'

// Week 1: 5 min walk + 6 x (1 min run / 2 min walk) = 23 min.
const w1 = getRunWalkWeek(1)
const segs = runWalkSegments(w1)!
assert.equal(segs.length, 13, 'warm-up walk + 6 runs + 6 walks')
assert.equal(segs[0].kind, 'warmup')
assert.equal(segs[1].kind, 'run')
assert.equal(segs[1].startSec, 300)
assert.equal(segs[2].kind, 'walk')
const end = segs[segs.length - 1]
assert.equal(end.startSec + end.sec, runWalkTotalSec(w1), 'segments add up to the prescribed total')

assert.equal(runWalkAt(segs, 0).segment.kind, 'warmup')
assert.equal(runWalkAt(segs, 0).remainingSec, 300)
const r1 = runWalkAt(segs, 300)
assert.equal(r1.segment.kind, 'run')
assert.equal(r1.segment.round, 1)
assert.equal(r1.remainingSec, 60)
const wk = runWalkAt(segs, 300 + 60 + 30)
assert.equal(wk.segment.kind, 'walk')
assert.equal(wk.remainingSec, 90)
assert.equal(runWalkCount(runWalkAt(segs, 300 + 180).segment, 6), 'RUN 2/6')
assert.equal(runWalkCount(wk.segment, 6), 'WALK 1/6')
assert.equal(runWalkCount(segs[0], 6), 'WARM-UP')
const done = runWalkAt(segs, 23 * 60 + 5)
assert.equal(done.done, true)
assert.equal(done.remainingSec, 0)

const cues = runWalkCueTimes(segs)
assert.equal(cues.length, 12, 'a cue at every change, none at the start')
assert.deepEqual(cues.slice(0, 2), [{ atSec: 300, kind: 'run' }, { atSec: 360, kind: 'walk' }])

// An eased run (walk or bike) has no intervals: the one countdown stays.
assert.equal(runWalkSegments({ runSec: 0, walkSec: 0, rounds: 0, warmupSec: 1200 }), null)
assert.equal(runWalkSegments(null), null)
// No walk between runs.
assert.equal(runWalkSegments({ runSec: 120, walkSec: 0, rounds: 2, warmupSec: 0 })!.length, 2)

console.log('runWalk tests passed')

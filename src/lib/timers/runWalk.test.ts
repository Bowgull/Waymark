// Run: tsx src/lib/timers/runWalk.test.ts
import assert from 'node:assert/strict'

import { runWalkTotalSec, getRunWalkWeek } from '../blockZero/running'
import { movePlan, planOnRunClock, runWalkAt, runWalkCount, runWalkCueTimes, runWalkSegments } from './runWalk'

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

// ─── Swipe back (page 85): the plan shift ───
// Week 1: warm-up 0-300, run 1 300-360, walk 1 360-480, run 2 480-540 ...
// Skip in the warm-up at run clock 100: run 1 starts now (the plan is 200 s ahead).
let shift = movePlan(segs, 0, 100, 'skip')!
assert.equal(shift, 200)
let onRun = planOnRunClock(segs, shift)
assert.equal(onRun[1].startSec, 100, 'the next piece starts at the run clock now')
assert.equal(runWalkAt(onRun, 100).segment.kind, 'run')
assert.equal(runWalkAt(onRun, 100).remainingSec, 60, 'the whole run piece is ahead')
assert.equal(segs[1].startSec, 300, 'the plan itself is untouched')
assert.equal(runWalkAt(onRun, 160).segment.kind, 'walk', 'it goes on by itself from there')
// Its cues follow: the first change cue (run 1) is now, the walk a minute later.
assert.deepEqual(runWalkCueTimes(onRun).slice(0, 2), [{ atSec: 100, kind: 'run' }, { atSec: 160, kind: 'walk' }])

// Restart 40 s into walk 1 (run clock 200): the walk starts again now.
shift = movePlan(segs, 200, 200, 'restart')!
onRun = planOnRunClock(segs, shift)
assert.equal(runWalkAt(onRun, 200).segment.kind, 'walk')
assert.equal(runWalkAt(onRun, 200).remainingSec, 120)
// Again within 3 s (run clock 202): run 1 starts now.
shift = movePlan(segs, shift, 202, 'previous')!
onRun = planOnRunClock(segs, shift)
assert.equal(runWalkAt(onRun, 202).segment.kind, 'run')
assert.equal(runWalkAt(onRun, 202).segment.round, 1)
assert.equal(runWalkAt(onRun, 202).remainingSec, 60)
assert.equal(shift, 98)
assert.equal(onRun[0].startSec + onRun[0].sec, onRun[1].startSec, 'the pieces still line up')

// The first piece: back restarts it, never further; at its very start nothing moves.
assert.equal(movePlan(segs, 0, 50, 'previous'), -50)
assert.equal(movePlan(segs, 0, 50, 'restart'), -50)
assert.equal(movePlan(segs, 0, 0, 'restart'), null)
// The plan sits behind the run clock (shift below 0): the warm-up counts its 5 min from now.
assert.equal(runWalkAt(planOnRunClock(segs, -50), 50).remainingSec, 300)
assert.equal(planOnRunClock(segs, -50)[1].startSec, 350)

// The last piece: nothing to skip to (never the finish); past the end, back restarts the last piece.
const lastStart = segs[segs.length - 1].startSec
assert.equal(movePlan(segs, 0, lastStart + 10, 'skip'), null)
assert.equal(movePlan(segs, 0, 23 * 60 + 30, 'skip'), null)
const fromDone = movePlan(segs, 0, 23 * 60 + 30, 'restart')!
assert.equal(runWalkAt(planOnRunClock(segs, fromDone), 23 * 60 + 30).index, segs.length - 1)
assert.equal(runWalkAt(planOnRunClock(segs, fromDone), 23 * 60 + 30).done, false)

// An open piece (the 5K test's 5 km, Infinity) is never skipped out of; it can be restarted.
const withOpen = [{ startSec: 0, sec: 600 }, { startSec: 600, sec: Infinity }, { startSec: Infinity, sec: 300 }]
assert.equal(movePlan(withOpen, 0, 100, 'skip'), 500, 'the warm-up skips into the 5 km')
assert.equal(movePlan(withOpen, 500, 200, 'skip'), null)
assert.equal(movePlan(withOpen, 500, 800, 'restart'), -200, 'the 5 km counts from now again')
assert.equal(movePlan(withOpen, 500, 800, 'previous'), -800, 'the warm-up again')
assert.equal(movePlan([], 0, 10, 'skip'), null)

console.log('runWalk tests passed')

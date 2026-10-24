// Run: tsx src/lib/runPieceActivity.test.ts
// Page 84 item 14: the lock card and the Island count the piece you're in
// (a Run-Walk's run or walk, a hard run's piece), as the app does; the 5K
// test's open piece counts up.
import assert from 'node:assert/strict'

import { pieceTimes } from './runPieceActivity'
import { movePlan, planOnRunClock, runWalkAt, runWalkSegments } from './timers/runWalk'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const T0 = 1_000_000

test('a run-walk piece: its own start and end on the wall clock, not the whole run', () => {
  const segs = runWalkSegments({ runSec: 120, walkSec: 60, rounds: 6, warmupSec: 300 })!
  const at = runWalkAt(segs, 300 + 120 + 30) // round 1's walk, 30 s in
  const t = pieceTimes(at.segment, T0, 450, false)
  assert.deepEqual(t, { startedAt: T0 + 420_000, endsAt: T0 + 480_000 })
})

test('paused: what is left in the piece', () => {
  const t = pieceTimes({ startSec: 420, sec: 60 }, T0, 450.4, true)
  assert.equal(t.pausedRemaining, 30)
  assert.equal(t.endsAt - t.startedAt, 60_000)
})

test('the open 5 km counts up; its grass runs to the planned length; paused it holds the time in', () => {
  const t = pieceTimes({ startSec: 600, sec: Infinity, estSec: 1500 }, T0, 700, false)
  assert.deepEqual(t, { startedAt: T0 + 600_000, endsAt: T0 + 2_100_000, countsUp: true })
  const p = pieceTimes({ startSec: 600, sec: Infinity, estSec: 1500 }, T0, 725.6, true)
  assert.equal(p.countsUp, true)
  assert.equal(p.pausedRemaining, 125)
})

test('page 85: after a skip or a restart the card counts the new piece from now, the run clock untouched', () => {
  const segs = runWalkSegments({ runSec: 120, walkSec: 60, rounds: 6, warmupSec: 300 })!
  // Skip the warm-up at 100 s: run 1 starts now, its 2 min ahead.
  const shift = movePlan(segs, 0, 100, 'skip')!
  const at = runWalkAt(planOnRunClock(segs, shift), 100)
  assert.deepEqual(pieceTimes(at.segment, T0, 100, false), { startedAt: T0 + 100_000, endsAt: T0 + 220_000 })
  // Restart it 50 s in (run clock 150), paused: the whole 2 min is left and it stays paused.
  const back = movePlan(segs, shift, 150, 'restart')!
  const again = runWalkAt(planOnRunClock(segs, back), 150)
  assert.equal(again.segment.kind, 'run')
  assert.equal(pieceTimes(again.segment, T0, 150, true).pausedRemaining, 120)
})

test('page 85: the 5 km restarted counts up from 0 again', () => {
  const pieces = [{ startSec: 0, sec: 600 }, { startSec: 600, sec: Infinity, estSec: 1500 }]
  const shift = movePlan(pieces, 0, 900, 'restart')!
  const open = planOnRunClock(pieces, shift)[1]
  const t = pieceTimes(open, T0, 900, true)
  assert.equal(t.startedAt, T0 + 900_000)
  assert.equal(t.pausedRemaining, 0)
})

console.log(`runPieceActivity: ${passed} passed`)

// Run: tsx src/lib/runPieceActivity.test.ts
// Page 84 item 14: the lock card and the Island count the piece you're in
// (a Run-Walk's run or walk, a hard run's piece), as the app does; the 5K
// test's open piece counts up.
import assert from 'node:assert/strict'

import { pieceTimes } from './runPieceActivity'
import { runWalkAt, runWalkSegments } from './timers/runWalk'

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

console.log(`runPieceActivity: ${passed} passed`)

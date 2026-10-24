// Run: tsx src/lib/timers/swipeBack.test.ts
// Page 85: swipe down on a hold or rest timer restarts the part; again within 3 s, the part before.
import assert from 'node:assert/strict'

import { timerStart } from '../sessionResume'
import { backMove, freshSnap, previousRecoveryPart, previousSetPosition, restartSnap, runOf } from './swipeBack'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const T0 = 1_700_000_000_000

test('a restart keeps the run state and goes back to the full time', () => {
  assert.equal(runOf(null), 'ready')
  const running = { state: 'running' as const, startedAtMs: T0 - 20_000, endsAtMs: T0 + 10_000, durationSec: 30 }
  assert.deepEqual(restartSnap(running, 30, T0), timerStart(30, T0), 'running: from the full time, now')
  assert.deepEqual(restartSnap({ state: 'paused', remainingMs: 4_000, durationSec: 30 }, 30, T0), { state: 'paused', remainingMs: 30_000, durationSec: 30 }, 'paused stays paused, at full')
  assert.equal(restartSnap(null, 30, T0), null, 'not started: nothing to restart')
  const over = { state: 'running' as const, startedAtMs: T0 - 40_000, endsAtMs: T0 - 10_000, durationSec: 30 }
  assert.deepEqual(restartSnap(over, 30, T0), timerStart(30, T0), 'a part that ran out runs again')
  assert.deepEqual(freshSnap('paused', 45, T0), { state: 'paused', remainingMs: 45_000, durationSec: 45 }, 'the part before takes its own length')
})

test('first swipe restarts, a second within 3 s goes back, the first part only restarts', () => {
  assert.equal(backMove(null, T0, true), 'restart')
  assert.equal(backMove(T0, T0 + 2_000, true), 'previous')
  assert.equal(backMove(T0, T0 + 3_000, true), 'restart', '3 s or later: a fresh restart')
  assert.equal(backMove(T0, T0 + 1_000, false), 'restart', 'the first part: restart only')
  assert.equal(backMove(null, T0, true, false), 'previous', 'not started: already at full, so back')
  assert.equal(backMove(null, T0, false, false), 'restart')
})

test('the set before, across exercises', () => {
  const counts = [2, 0, 3]
  assert.deepEqual(previousSetPosition({ exerciseIdx: 2, setIdx: 1 }, counts), { exerciseIdx: 2, setIdx: 0 })
  assert.deepEqual(previousSetPosition({ exerciseIdx: 2, setIdx: 0 }, counts), { exerciseIdx: 0, setIdx: 1 }, 'skips an exercise with no sets')
  assert.equal(previousSetPosition({ exerciseIdx: 0, setIdx: 0 }, counts), null, 'the very first set: nothing before')
})

test('Active Recovery: hip hold before, then the walk; rolling before, then the last hip hold', () => {
  const holds = [true, true, true, true, false, false]
  assert.equal(previousRecoveryPart({ phase: 'walk' }, holds), null)
  assert.deepEqual(previousRecoveryPart({ phase: 'hip', hipIdx: 2 }, holds), { phase: 'hip', hipIdx: 1 })
  assert.deepEqual(previousRecoveryPart({ phase: 'hip', hipIdx: 0 }, holds), { phase: 'walk' })
  assert.deepEqual(previousRecoveryPart({ phase: 'roll', rollIdx: 3 }, holds), { phase: 'roll', rollIdx: 2 })
  assert.deepEqual(previousRecoveryPart({ phase: 'roll', rollIdx: 0 }, holds), { phase: 'hip', hipIdx: 3 }, 'the last hip HOLD, not a rep move')
  assert.deepEqual(previousRecoveryPart({ phase: 'roll', rollIdx: 0 }, [false, false]), { phase: 'walk' }, 'no hip holds: the walk')
})

console.log(`swipeBack: ${passed} passed`)

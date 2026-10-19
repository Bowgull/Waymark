// Run: tsx src/lib/plannedLength.test.ts
// Planned length from the prescription (page 33's "+N min" chip), and the
// per-round seconds bag work and rope keep for their done summaries.
import assert from 'node:assert/strict'
import { getStrengthTemplate } from './strengthTemplates'
import { estimateRoutineSec, foundationTemplate } from './foundation'
import { entranceLine, parseRoundSecs, plannedRoundMinutes, plannedStrengthMinutes, roundSecsKey, withRoundSec, WORK_SET_SEC } from './plannedLength'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

test('strength: work plus the rest after each set, none after the last', () => {
  assert.equal(plannedStrengthMinutes([]), null)
  assert.equal(plannedStrengthMinutes([{ isWarmup: 0, restSec: 180 }]), 1)
  // 3 working sets, 120 s rest: 3 x 40 + 2 x 120 = 360 s
  assert.equal(plannedStrengthMinutes([{ isWarmup: 0, restSec: 120 }, { isWarmup: 0, restSec: 120 }, { isWarmup: 0, restSec: 120 }]), Math.round((3 * WORK_SET_SEC + 240) / 60))
  assert.equal(plannedStrengthMinutes([{ isWarmup: true, restSec: 30 }, { isWarmup: false, restSec: null }]), 2, '25 + 30 + 40 s')
})

test('a real Block Zero strength day plans a believable length (30-75 min)', () => {
  for (const dow of [1, 3, 5]) {
    const t = getStrengthTemplate(dow, 3, 'block_zero', null)
    const min = plannedStrengthMinutes(t.exercises.flatMap(e => e.sets.map(s => ({ isWarmup: s.isWarmup, restSec: s.restSec }))))
    assert.ok(min != null && min >= 30 && min <= 75, `day ${dow}: ${min} min`)
  }
})

test('Foundation: the routine estimate, about 12 minutes', () => {
  const rows = foundationTemplate({ week: 3, backToday: 3 })
  const min = Math.round(estimateRoutineSec(rows) / 60)
  assert.ok(min >= 8 && min <= 18, `${min} min`)
})

test('rounds: every round and the rests between them', () => {
  assert.equal(plannedRoundMinutes([]), null)
  assert.equal(plannedRoundMinutes([{ durationSec: 180, restSec: 60 }, { durationSec: 180, restSec: 60 }, { durationSec: 180, restSec: 60 }]), Math.round((540 + 120) / 60))
})

test('per-round seconds: kept by index, read back only when well formed', () => {
  assert.deepEqual(withRoundSec([], 0, 180), [180])
  assert.deepEqual(withRoundSec([180], 2, 95.6), [180, 0, 96])
  assert.deepEqual(withRoundSec([180, 170], 1, 180), [180, 180])
  assert.deepEqual(parseRoundSecs('[180,150]'), [180, 150])
  assert.equal(parseRoundSecs('null'), null)
  assert.equal(parseRoundSecs('{"a":1}'), null)
  assert.equal(parseRoundSecs('[1,-2]'), null)
  assert.equal(parseRoundSecs('not json'), null)
  assert.equal(roundSecsKey('s1'), 'waymark_round_secs:s1')
})

test('entrance line: the length under the session name (page 19)', () => {
  assert.equal(entranceLine({ type: 'bag_work', rounds: 6, minutes: 40 }), '6 ROUNDS · 40 MIN')
  assert.equal(entranceLine({ type: 'strength', week: 3, minutes: 45 }), 'WEEK 3 · 45 MIN')
  assert.equal(entranceLine({ type: 'skip_rope', rounds: 1, minutes: 3 }), '1 ROUND · 3 MIN')
  assert.equal(entranceLine({ type: 'running', week: 2, minutes: 34.6 }), '35 MIN', 'only strength leads with its week')
  assert.equal(entranceLine({ type: 'bag_work', rounds: 6 }), '6 ROUNDS')
  assert.equal(entranceLine({ type: 'strength', week: null, minutes: 0 }), null)
})

console.log(`plannedLength: ${passed} passed`)

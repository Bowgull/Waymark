// Run: tsx src/lib/plannedLength.test.ts
// Planned length from the prescription (page 33's "+N min" chip), and the
// per-round seconds bag work and rope keep for their done summaries.
import assert from 'node:assert/strict'
import { getStrengthTemplate } from './strengthTemplates'
import { estimateRoutineSec, foundationTemplate } from './foundation'
import { bagMinutes, entranceLine, parseRoundSecs, plannedRoundMinutes, plannedStrengthMinutes, ropeMinutes, ropeRounds, roundSecsKey, withRoundSec, WORK_SET_SEC } from './plannedLength'
import { foundationMinutes, runWarmupSec } from './foundation'
import { RESET_WALK_MIN, resetMinutes } from './activeRecoveryTemplate'
import { doseMinutes } from './brain/doseMinutes'
import { estimatedMinutes } from './coach/sessions'

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

// Audit #23 / #24 / #15: one calculation per session kind, warm-ups included.
test('rope: one rounds rule and one minutes number (5 rounds 19 min, eased 3 rounds 11 min)', () => {
  assert.equal(ropeRounds('GREEN'), 5)
  assert.equal(ropeRounds('AMBER'), 3)
  assert.equal(ropeRounds('RED'), 3)
  assert.equal(ropeRounds('GREEN', true), 3, 'a walk-or-bike injury flag eases it too')
  assert.equal(ropeMinutes(5), 19)
  assert.equal(ropeMinutes(3), 11)
  assert.equal(estimatedMinutes({ type: 'skip_rope', notes: null, estimatedMin: null }, 'block_zero', 1), 19, 'the row estimate is the same number')
})

test('bag: the 5 min rope warm-up, the rounds and the rests between them', () => {
  assert.equal(bagMinutes(4), 20, 'first bag session: 4 rounds is about 20 min, not 16')
  assert.equal(bagMinutes(6), 28)
  assert.equal(bagMinutes([{ durationSec: 180, restSec: 60 }, { durationSec: 180, restSec: 60 }]), 12)
  // Page 86: the coach's finisher counts: the last round's rest, then its sets and rests.
  assert.equal(bagMinutes(4, 175), 24, '4 rounds, the last rest and an OK finisher (3 sets of 0:45, 2 rests)')
  assert.equal(bagMinutes([], 175), 5, 'no rounds: no finisher either')
  assert.equal(doseMinutes({ type: 'bag_work' }, { bag: { rounds: 4 } }), 24, 'the dose minutes agree (no level: an OK finisher)')
  assert.equal(doseMinutes({ type: 'bag_work' }, { bag: { rounds: 4, level: 'EASE' } }), 23, 'an easy day: the LOW finisher')
  assert.equal(doseMinutes({ type: 'bag_work' }, { bag: { rounds: 4, level: 'PROGRESS' } }), 25, 'finishers earned: the HIGH finisher')
})

test('Foundation: its routine for the level and day, not a flat 12', () => {
  const w1 = foundationMinutes({ week: 1 })
  const w3 = foundationMinutes({ week: 3 })
  assert.equal(w1, Math.round(estimateRoutineSec(foundationTemplate({ week: 1 })) / 60))
  assert.ok(w1 >= 11 && w1 <= 16 && w3 >= 11 && w3 <= 16, `11 to 16 min (${w1}, ${w3})`)
  assert.notEqual(w1, w3, 'the level changes the length')
  assert.equal(estimatedMinutes({ type: 'mobility', notes: null, estimatedMin: null }, 'block_zero', 3), w3)
})

test('run-walk: the dose minutes carry the ~6.5 min dynamic warm-up; a plain run has none', () => {
  assert.ok(runWarmupSec() >= 360 && runWarmupSec() <= 420, `about 6.5 min (${runWarmupSec()} s)`)
  assert.equal(doseMinutes({ type: 'foundation_run' }, { run: { totalSec: 1200 } }), Math.round((1200 + runWarmupSec()) / 60))
  assert.equal(doseMinutes({ type: 'running' }, { run: { totalSec: 1200 } }), 20)
})

test('Reset: the walk or bike first, then hips and the roller; one length everywhere', () => {
  assert.equal(RESET_WALK_MIN, 12)
  const all = resetMinutes()
  assert.ok(all > RESET_WALK_MIN + 10 && all < 30, `walk + hips + roller (${all} min)`)
  assert.equal(resetMinutes(15) - resetMinutes(12), 3, 'the walk minutes count in full')
  assert.equal(estimatedMinutes({ type: 'active_recovery', notes: null, estimatedMin: null }, 'block_zero', 1), all, 'the row estimate is the same number')
})

console.log(`plannedLength: ${passed} passed`)

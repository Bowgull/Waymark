// Run: tsx src/lib/timers/setWeight.test.ts
// The set screen shows lb (plate-snapped like the rest of the app) and logs kg.
import assert from 'node:assert/strict'

import { kgToLbs } from '../units'
import { carryKey, carryStart, editedStartKg, nextRungAfter, parseCarry, plannedSetLbs, setLbsToKg, setNeedsWeight, startSetLbs, stepSetLbs, withEffort, withLogged } from './setWeight'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

test('the plan shows in loadable lb', () => {
  assert.equal(plannedSetLbs(61.235, 'barbell'), 135)
  assert.equal(plannedSetLbs(44, 'barbell'), 95, '44 kg is 97 lb; the bar takes 95')
  assert.equal(plannedSetLbs(11.3, 'dumbbell'), 25)
  assert.equal(plannedSetLbs(null, 'barbell'), null, 'bodyweight: no weight row')
  assert.equal(plannedSetLbs(0, 'none'), 0)
})

test('the steppers move one loadable step (5 lb), not below the empty bar', () => {
  assert.equal(stepSetLbs(135, 1, 'barbell'), 140)
  assert.equal(stepSetLbs(135, -1, 'barbell'), 130)
  assert.equal(stepSetLbs(45, -1, 'barbell'), 45)
  assert.equal(stepSetLbs(5, -1, 'dumbbell'), 0)
  assert.equal(stepSetLbs(0, -1, null), 0)
})

test('a loadable lift with no planned load still gets a weight row (e2e major 1)', () => {
  assert.equal(startSetLbs(null, 'dumbbell'), 0, 'goblet squat work-up: starts at 0, steps in 5 lb')
  assert.equal(startSetLbs(null, 'kettlebell'), 0)
  assert.equal(startSetLbs(null, 'bodyweight,dumbbell'), 0, 'DB reverse lunge')
  assert.equal(startSetLbs(null, 'barbell'), 45, 'a barbell starts at the empty bar')
  assert.equal(startSetLbs(null, 'dumbbell', 11.3), 25, 'carries the last logged weight')
  assert.equal(startSetLbs(null, 'bodyweight'), null, 'bodyweight only: no weight row')
  assert.equal(startSetLbs(null, null), null)
  assert.equal(startSetLbs(61.235, 'barbell', 20), 135, 'the plan wins over the carry')
})

test('what is logged is kg, and reads back as the same lb', () => {
  for (const lbs of [45, 95, 135, 140, 225, 25]) assert.equal(kgToLbs(setLbsToKg(lbs)!), lbs)
  assert.equal(setLbsToKg(null), null)
})

test('m12: front squat set 1 changed to 70 lb, sets 2-3 start at 70', () => {
  const plan = 65 / 2.20462
  let c = withLogged({}, 'fsq', 70 / 2.20462, { isWarmup: false, plannedKg: plan })
  const next = editedStartKg(c.fsq, { isWarmup: false, plannedKg: plan })
  assert.equal(startSetLbs(plan, 'barbell', null, next), 70)
  // A warm-up never moves the work weight; a set at another plan (the check set) doesn't carry.
  c = withLogged(c, 'fsq', 45 / 2.20462, { isWarmup: true, plannedKg: null })
  assert.equal(editedStartKg(c.fsq, { isWarmup: false, plannedKg: plan }), next)
  assert.equal(editedStartKg(c.fsq, { isWarmup: false, plannedKg: 80 / 2.20462 }), null)
  // Logged as planned: nothing to carry.
  assert.equal(editedStartKg(withLogged({}, 'fsq', plan, { isWarmup: false, plannedKg: plan }).fsq, { isWarmup: false, plannedKg: plan }), null)
})

test('a work-up he stopped climbing: later sets start at what he logged, not the next rung', () => {
  const L = (lb: number) => lb / 2.20462
  // Rungs 20 → 25 → 30 → 35. Set 2 he stayed at 20 (under its 25): sets 3 and 4 start at 20.
  let c = withLogged({}, 'gs', L(20), { isWarmup: false, plannedKg: L(20) })
  assert.equal(editedStartKg(c.gs, { isWarmup: false, plannedKg: L(25) }), null, 'logged as planned: the next rung')
  c = withLogged(c, 'gs', L(20), { isWarmup: false, plannedKg: L(25) })
  assert.equal(startSetLbs(L(30), 'dumbbell', null, editedStartKg(c.gs, { isWarmup: false, plannedKg: L(30) })), 20, 'set 3: 20, not 30')
  assert.equal(startSetLbs(L(35), 'dumbbell', null, editedStartKg(c.gs, { isWarmup: false, plannedKg: L(35) })), 20, 'set 4: 20, not 35')
  // Climbing over a rung is not a stop: the next rung stands.
  const over = withLogged({}, 'gs', L(30), { isWarmup: false, plannedKg: L(25) })
  assert.equal(editedStartKg(over.gs, { isWarmup: false, plannedKg: L(30) }), null)
  // A warm-up never counts as stopping.
  assert.equal(editedStartKg(c.gs, { isWarmup: true, plannedKg: L(35) }), null)
})

test('bodyweight lifts log with no weight; loadable ones (cable and machine too) wait for one', () => {
  assert.equal(setNeedsWeight('bodyweight,dumbbell', false, 0), false, 'calf raise, single-leg RDL: bodyweight is fine')
  assert.equal(setNeedsWeight('bodyweight,dumbbell,band', false, 0), false, 'reverse lunge')
  assert.equal(setNeedsWeight('dumbbell,bench', false, 0), true, 'dumbbell row at 0: set the weight')
  assert.equal(setNeedsWeight('cable,band', false, 0), true, 'face pulls at 0: set the weight')
  assert.equal(setNeedsWeight('machine', false, 0), true, 'hamstring curl at 0: set the weight')
  assert.equal(setNeedsWeight('machine', false, 40), false)
  assert.equal(setNeedsWeight('machine', true, 0), false, 'a warm-up logs as it is')
  assert.equal(setNeedsWeight('bodyweight', false, null), false, 'no weight row at all')
  assert.equal(startSetLbs(null, 'machine'), 0, 'a stack with no plan starts empty, not at a real-looking weight')
  assert.equal(setLbsToKg(0), null, '0 is never saved as a weight')
})

test('m10: the carried weight survives a reload (stored per session)', () => {
  const c = withLogged({}, 'lat', 50 / 2.20462, { isWarmup: false, plannedKg: null })
  const back = parseCarry(JSON.stringify(c))
  assert.equal(startSetLbs(null, 'cable', back.lat.kg), 50)
  assert.equal(carryKey('s1'), 'waymark_carry_kg:s1')
  assert.deepEqual(parseCarry('not json'), {})
})

test('rebuild Phase 4: a 3+ starts the next set a step up, once, as a "Try N lb?"', () => {
  const L = (lb: number) => lb / 2.20462
  const lbs = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg * 2.20462))
  let c = withEffort(withLogged({}, 'bp', L(95), { isWarmup: false, plannedKg: L(95) }), 'bp', 3)
  const up = carryStart(c.bp, { isWarmup: false, plannedKg: L(95) }, 'ex-bench-press', 'barbell')
  assert.deepEqual([lbs(up?.kg), up?.up], [100, true], 'bench 95 at 3+: 100 next')
  assert.equal(startSetLbs(L(95), 'barbell', null, up?.kg), 100)
  // At the step, another 3+ keeps it there (the coach moves the plan next time).
  c = withEffort(withLogged(c, 'bp', L(100), { isWarmup: false, plannedKg: L(95) }), 'bp', 3)
  assert.equal(lbs(carryStart(c.bp, { isWarmup: false, plannedKg: L(95) }, 'ex-bench-press', 'barbell')?.kg), 100, 'one step over the plan, not two')
  // 2 left: as planned.
  const two = withEffort(withLogged({}, 'bp', L(95), { isWarmup: false, plannedKg: L(95) }), 'bp', 2)
  assert.equal(carryStart(two.bp, { isWarmup: false, plannedKg: L(95) }, 'ex-bench-press', 'barbell'), null)
  // Lower body: +5% (goblet 50 → 55 lb dumbbell).
  const gs = withEffort(withLogged({}, 'gs', L(50), { isWarmup: false, plannedKg: L(50) }), 'gs', 3)
  assert.equal(lbs(editedStartKg(gs.gs, { isWarmup: false, plannedKg: L(50) }, 'ex-goblet-squat', 'dumbbell')), 55)
  // Bodyweight moves have no weight to step.
  assert.equal(carryStart(gs.gs, { isWarmup: false, plannedKg: L(50) }, 'ex-chin-up', 'pull-up bar'), null)
})

test('rebuild Phase 4: a climb stops at about 3 left, and keeps going while it reads 3+', () => {
  const L = (lb: number) => lb / 2.20462
  const lbs = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg * 2.20462))
  // Rungs 45 → 55 → 65 → 75. 55 read 2: stay at 55 for the rest.
  const c = withEffort(withLogged({}, 'bp', L(55), { isWarmup: false, plannedKg: L(55) }), 'bp', 2)
  assert.equal(lbs(editedStartKg(c.bp, { isWarmup: false, plannedKg: L(65) }, 'ex-bench-press', 'barbell')), 55, 'about 3 left: stay there')
  // 3+ at the rung: the next rung as planned.
  const easy = withEffort(withLogged({}, 'bp', L(55), { isWarmup: false, plannedKg: L(55) }), 'bp', 3)
  assert.equal(editedStartKg(easy.bp, { isWarmup: false, plannedKg: L(65) }, 'ex-bench-press', 'barbell'), null)
  // The last rung still read 3+: one more set a step up, up to the most sets.
  const sets = [45, 55, 65, 75].map(w => ({ isWarmup: 0, plannedWeightKg: L(w) }))
  assert.equal(lbs(nextRungAfter(sets, L(75), 3, 'ex-bench-press', 'barbell', 7)), 80)
  assert.equal(nextRungAfter(sets, L(75), 2, 'ex-bench-press', 'barbell', 7), null, 'about 3 left: done')
  assert.equal(nextRungAfter([...sets, ...[80, 85, 90].map(w => ({ isWarmup: 0, plannedWeightKg: L(w) }))], L(90), 3, 'ex-bench-press', 'barbell', 7), null, '7 sets: done')
  assert.equal(nextRungAfter([95, 95, 95].map(w => ({ isWarmup: 0, plannedWeightKg: L(w) })), L(95), 3, 'ex-bench-press', 'barbell', 7), null, 'not a climb: no extra set')
  assert.equal(lbs(nextRungAfter([{ isWarmup: 1, plannedWeightKg: L(45) }, ...sets], L(75), 3, 'ex-bench-press', 'barbell', 5)), 80, 'warm-ups do not count toward the most sets')
})

test('rebuild Phase 5: the landmine on the set screen', () => {
  assert.equal(startSetLbs(null, 'landmine'), 0, 'no plan yet: the bar only, with a weight row')
  assert.equal(plannedSetLbs(12.5 / 2.20462, 'landmine'), 12.5, 'half pounds show')
  assert.equal(stepSetLbs(0, 1, 'landmine'), 2.5, 'one 2.5 lb plate a step')
  assert.equal(stepSetLbs(0, -1, 'landmine'), 0, 'never under the bar')
  assert.equal(setNeedsWeight('landmine', false, 0), false, 'bar only logs')
})

console.log(`setWeight: ${passed} passed`)

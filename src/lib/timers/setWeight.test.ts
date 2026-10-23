// Run: tsx src/lib/timers/setWeight.test.ts
// The set screen shows lb (plate-snapped like the rest of the app) and logs kg.
import assert from 'node:assert/strict'

import { kgToLbs } from '../units'
import { carryKey, editedStartKg, parseCarry, plannedSetLbs, setLbsToKg, setNeedsWeight, startSetLbs, stepSetLbs, withLogged } from './setWeight'

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

console.log(`setWeight: ${passed} passed`)

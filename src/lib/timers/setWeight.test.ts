// Run: tsx src/lib/timers/setWeight.test.ts
// The set screen shows lb (plate-snapped like the rest of the app) and logs kg.
import assert from 'node:assert/strict'

import { kgToLbs } from '../units'
import { carryKey, editedStartKg, parseCarry, plannedSetLbs, setLbsToKg, startSetLbs, stepSetLbs, withLogged } from './setWeight'

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

test('m10: the carried weight survives a reload (stored per session)', () => {
  const c = withLogged({}, 'lat', 50 / 2.20462, { isWarmup: false, plannedKg: null })
  const back = parseCarry(JSON.stringify(c))
  assert.equal(startSetLbs(null, 'cable', back.lat.kg), 50)
  assert.equal(carryKey('s1'), 'waymark_carry_kg:s1')
  assert.deepEqual(parseCarry('not json'), {})
})

console.log(`setWeight: ${passed} passed`)

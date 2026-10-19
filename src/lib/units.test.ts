// Run: tsx src/lib/units.test.ts
// Josh measures in lb: every weight people read is lb; data stays kg.
import assert from 'node:assert/strict'
import { bodyLbs, kgToLbs, kgToLbsFloor, lbText, lbsToKg, lbsToKgStored, loggedAtSec } from './units'
import { TM_STEP_KG } from './coach/tm'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

test('lb text from kg', () => {
  assert.equal(lbText(70.307), '155 lb')
  assert.equal(lbText(TM_STEP_KG.lower), '10 lb')
  assert.equal(lbText(TM_STEP_KG.upper), '5 lb')
})

test('lb typed in is stored as kg and reads back the same', () => {
  for (const lb of [45, 135, 155, 179]) assert.equal(kgToLbs(lbsToKg(lb)), lb)
})

test('a ceiling floored to lb converts back at or under the kg ceiling', () => {
  for (const kg of [60, 60.2, 61, 65.25, 72, 100.9]) {
    const lb = kgToLbsFloor(kg)
    assert.ok(lbsToKgStored(lb) <= kg, `${kg} kg -> ${lb} lb -> ${lbsToKgStored(lb)} kg`)
  }
  assert.equal(kgToLbsFloor(60), 132)
  assert.equal(lbsToKgStored(132), 59.87)
})

test('body weigh-in times read as seconds, ms or s (e2e major 3)', () => {
  assert.equal(loggedAtSec(1792409527398), 1792409527, 'ms from the old Body page')
  assert.equal(loggedAtSec(1792409527), 1792409527, 'seconds stay')
  assert.equal(Math.floor(loggedAtSec(1792409527398) / 86400), Math.floor(1792409527 / 86400), 'same epoch day either way')
})

test('m13: body weight keeps its decimal (182.4 lb logged reads 182.4)', () => {
  assert.equal(bodyLbs(lbsToKg(182.4)), 182.4)
})

console.log(`units: ${passed} passed`)

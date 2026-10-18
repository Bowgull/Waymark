// Run: tsx src/lib/units.test.ts
// Josh measures in lb: every weight people read is lb; data stays kg.
import assert from 'node:assert/strict'
import { kgToLbs, lbText, lbsToKg } from './units'
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

console.log(`units: ${passed} passed`)

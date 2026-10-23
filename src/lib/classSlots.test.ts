// MT class days, page 76: one flap per day, OFF → AM → PM → ANY → OFF; saved as mtClassDays + mtClassSlots.
import assert from 'node:assert/strict'

import { classDayState, classDayWord, cycleClassDay, formatClassSlots, nextClassDayState, parseClassSlots, withClassDayState } from './classSlots'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; void name }

test('a tap cycles OFF → AM → PM → ANY → OFF', () => {
  assert.equal(nextClassDayState('off'), 'am')
  assert.equal(nextClassDayState('am'), 'pm')
  assert.equal(nextClassDayState('pm'), 'any')
  assert.equal(nextClassDayState('any'), 'off')
})

test('a tile reads OFF when unpicked, else the saved slot or the default', () => {
  const days = new Set([1, 3, 6])
  const slots = parseClassSlots('mon:am')
  assert.equal(classDayState(days, slots, 1), 'am')
  assert.equal(classDayState(days, slots, 3), 'pm') // weekday default
  assert.equal(classDayState(days, slots, 6), 'any') // weekend default
  assert.equal(classDayState(days, slots, 2), 'off')
  assert.equal(classDayState(new Set(), parseClassSlots('tue:am'), 2), 'off') // a stale slot on an unpicked day is OFF
})

test('four taps on one day go round and save in the existing formats', () => {
  let s = { days: new Set<number>(), slots: {} as ReturnType<typeof parseClassSlots> }
  const saved = () => ({ days: [...s.days].sort().join(','), slots: formatClassSlots(s.days, s.slots) })
  s = cycleClassDay(s.days, s.slots, 2)
  assert.deepEqual(saved(), { days: '2', slots: 'tue:am' })
  s = cycleClassDay(s.days, s.slots, 2)
  assert.deepEqual(saved(), { days: '2', slots: 'tue:pm' })
  s = cycleClassDay(s.days, s.slots, 2)
  assert.deepEqual(saved(), { days: '2', slots: 'tue:any' })
  s = cycleClassDay(s.days, s.slots, 2)
  assert.deepEqual(saved(), { days: '', slots: '' }) // all OFF: no classes
  assert.equal(s.slots[2], undefined)
})

test('a defaulted day cycles on from its default; other days are untouched', () => {
  const days = new Set([1, 6])
  const slots = parseClassSlots('mon:am')
  const sat = cycleClassDay(days, slots, 6) // ANY (weekend default) → OFF
  assert.deepEqual([...sat.days], [1])
  assert.equal(formatClassSlots(sat.days, sat.slots), 'mon:am')
  const wed = cycleClassDay(new Set([3]), {}, 3) // PM (weekday default) → ANY
  assert.equal(formatClassSlots(wed.days, wed.slots), 'wed:any')
  assert.deepEqual(days, new Set([1, 6])) // inputs not changed
  assert.deepEqual(slots, { 1: 'am' })
  assert.deepEqual(withClassDayState(days, slots, 0, 'pm').slots, { 1: 'am', 0: 'pm' })
})

test('spoken words', () => {
  assert.deepEqual((['off', 'am', 'pm', 'any'] as const).map(classDayWord), ['off', 'morning', 'evening', 'either'])
})

console.log(`classSlots: ${passed} passed`)

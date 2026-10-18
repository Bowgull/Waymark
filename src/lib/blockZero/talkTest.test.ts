// Run: tsx src/lib/blockZero/talkTest.test.ts
import assert from 'node:assert/strict'

import { blockTestsBodySchema } from '../validators/schemas'
import { clampTalkHr, talkTestBody, talkTestDue, talkTestStart } from './talkTest'
import { validateTestResult } from './tests'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }
const base = { blockType: 'block_zero', blockWeek: 1, sessionType: 'foundation_run', weekResults: [] as { testKey: string; week?: number }[] }

test('asked on the first easy run-walk of week 1 and of week 6', () => {
  assert.equal(talkTestDue(base), true)
  assert.equal(talkTestDue({ ...base, blockWeek: 6 }), true)
  assert.equal(talkTestDue({ ...base, sessionType: 'running', runCategory: 'zone2' }), true)
})

test('not asked in other weeks, other blocks, hard runs, or once saved', () => {
  assert.equal(talkTestDue({ ...base, blockWeek: 3 }), false)
  assert.equal(talkTestDue({ ...base, blockType: 'fighter' }), false)
  assert.equal(talkTestDue({ ...base, sessionType: 'running', runCategory: 'progression' }), false)
  assert.equal(talkTestDue({ ...base, sessionType: 'strength' }), false)
  assert.equal(talkTestDue({ ...base, weekResults: [{ testKey: 'talk_test_hr', week: 1 }] }), false)
  assert.equal(talkTestDue({ ...base, weekResults: [{ testKey: 'side_plank_sec_l', week: 1 }] }), true)
})

test('the drum stays in range and starts at the run\'s average HR', () => {
  assert.equal(clampTalkHr(300), 210)
  assert.equal(clampTalkHr(40), 90)
  assert.equal(clampTalkHr(141.6), 142)
  assert.equal(talkTestStart(131), 131)
  assert.equal(talkTestStart(null), 140)
  assert.equal(talkTestStart(20), 140)
})

test('the body passes the block-tests route\'s schema and validation', () => {
  const body = talkTestBody(1, 142)
  assert.deepEqual(body, { week: 1, testKey: 'talk_test_hr', value: 142, unit: 'bpm' })
  assert.ok(blockTestsBodySchema.safeParse(body).success)
  assert.ok(validateTestResult(body, 6).ok)
  assert.ok(validateTestResult(talkTestBody(6, 146), 6).ok)
})

console.log(`talkTest: ${passed} passed`)

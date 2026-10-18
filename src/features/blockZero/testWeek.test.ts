import assert from 'node:assert/strict'

import { validateTestResult } from '../../lib/blockZero/tests'
import { blockTestsBodySchema } from '../../lib/validators/schemas'
import { gateOpen, retestComparison, verdictFor } from './gate'
import {
  GUIDED_TESTS,
  clampToSpec,
  existingValues,
  formatTestValue,
  guidedReducer,
  initialGuided,
  liftNameFromId,
  sheetRows,
  testsForWeek,
  testsPayload,
  weekTestTitle,
} from './testWeek'

// ─── which weeks ask ──
{
  assert.equal(testsForWeek(1, 6).length, GUIDED_TESTS.length, 'week 1: the baseline')
  assert.equal(testsForWeek(2, 6).length, 0)
  assert.equal(testsForWeek(3, 6).length, 0, 'week 3: the check set is logged in Strength')
  assert.equal(testsForWeek(6, 6).length, GUIDED_TESTS.length, 'week 6: the retest')
  assert.equal(testsForWeek(7, 8).length, GUIDED_TESTS.length, 'an extension week may retest')
  assert.equal(testsForWeek(7, 6).length, 0, 'past the block: nothing')
  assert.equal(weekTestTitle(1), 'BASELINE · WEEK 1')
  assert.equal(weekTestTitle(6), 'RETEST · WEEK 6')
}

// ─── every guided start, min and max is valid on the server ──
for (const t of GUIDED_TESTS) {
  for (const value of [t.start, t.min, t.max]) {
    const v = validateTestResult({ week: 1, testKey: t.key, value, unit: t.unit }, 6)
    assert.ok(v.ok, `${t.key}=${value} ${t.unit} is accepted (${v.ok ? '' : v.error})`)
  }
}

// ─── guided steps ──
{
  const tests = testsForWeek(1, 6)
  let s = initialGuided(tests)
  assert.equal(s.index, 0)
  assert.equal(s.dial.talk_test_hr, 140)
  s = guidedReducer(tests, s, { type: 'dial', value: 143.4 })
  assert.equal(s.dial.talk_test_hr, 143, 'snapped to the step')
  s = guidedReducer(tests, s, { type: 'dial', value: 999 })
  assert.equal(s.dial.talk_test_hr, 210, 'clamped to the max')
  s = guidedReducer(tests, s, { type: 'next' })
  assert.equal(s.index, 1)
  assert.equal(s.saved.talk_test_hr, 210)
  s = guidedReducer(tests, s, { type: 'skip' })
  assert.equal(s.index, 2)
  assert.equal(s.saved.fixed_effort_hr, undefined, 'a skipped test is not saved')
  s = guidedReducer(tests, s, { type: 'back' })
  assert.equal(s.index, 1)
  // Run to the end.
  for (let i = 0; i < tests.length; i++) s = guidedReducer(tests, s, { type: 'next' })
  assert.equal(s.done, true)
  assert.equal(guidedReducer(tests, s, { type: 'next' }), s, 'done ignores more taps')
  const body = testsPayload(1, s.saved, tests)
  assert.ok(body.length >= tests.length - 1)
  assert.ok(blockTestsBodySchema.safeParse(body).success, 'the payload passes the API schema')
  assert.equal(clampToSpec({ min: 0, max: 600, step: 5 }, 47), 45)
  // Resuming starts on the first test without a result and keeps the entered values.
  const resumed = initialGuided(tests, { talk_test_hr: 150, fixed_effort_hr: 139 })
  assert.equal(resumed.index, 2)
  assert.equal(resumed.dial.talk_test_hr, 150)
  assert.equal(initialGuided([]).done, true)
}

// ─── the results sheet ──
{
  const rows = [
    { week: 1, testKey: 'talk_test_hr', value: 142, unit: 'bpm' },
    { week: 1, testKey: 'mobility:hips', value: 3, unit: 'score' },
    { week: 1, testKey: 'e1rm:ex-back-squat', value: 77, unit: 'kg' },
    { week: 6, testKey: 'talk_test_hr', value: 146, unit: 'bpm' },
  ]
  const sheet = sheetRows(1, 6, rows)
  assert.equal(sheet.length, GUIDED_TESTS.length + 1, 'every guided test plus the lift estimate')
  assert.equal(sheet[0].value, '142 bpm')
  assert.equal(sheet[1].value, null, 'not entered yet')
  assert.equal(sheet.find(r => r.key === 'mobility:hips')?.value, '3/5')
  const lift = sheet[sheet.length - 1]
  assert.equal(lift.label, 'Back squat · est. max')
  assert.equal(lift.editable, false, 'lift estimates come from the check sets')
  assert.deepEqual(existingValues(6, rows), { talk_test_hr: 146 })
  assert.equal(liftNameFromId('ex-trap-bar-deadlift'), 'Trap bar deadlift')
  assert.equal(formatTestValue(45, 's'), '45 s')
  assert.equal(formatTestValue(88.5, 'kg'), '88.5 kg')
  assert.equal(sheetRows(3, 6, rows).length, 0, 'week 3 has no guided rows')
}

// ─── the gate: week 1 against the retest ──
{
  const rows = [
    { week: 1, testKey: 'pushups_max', value: 18, unit: 'reps' },
    { week: 6, testKey: 'pushups_max', value: 27, unit: 'reps' },
    { week: 1, testKey: 'fixed_effort_hr', value: 151, unit: 'bpm' },
    { week: 6, testKey: 'fixed_effort_hr', value: 139, unit: 'bpm' },
    { week: 7, testKey: 'fixed_effort_hr', value: 137, unit: 'bpm' },
    { week: 1, testKey: 'talk_test_hr', value: 142, unit: 'bpm' },
    { week: 6, testKey: 'talk_test_hr', value: 146, unit: 'bpm' },
    { week: 1, testKey: 'e1rm:ex-back-squat', value: 80, unit: 'kg' },
    { week: 6, testKey: 'e1rm:ex-back-squat', value: 92, unit: 'kg' },
    { week: 1, testKey: 'side_plank_sec_l', value: 45, unit: 's' },
  ]
  const c = retestComparison(rows)
  assert.equal(c[0].key, 'e1rm:ex-back-squat', 'lift estimates first')
  assert.equal(c[0].delta, '+15%')
  assert.equal(c[0].better, true)
  const hr = c.find(r => r.key === 'fixed_effort_hr')!
  assert.equal(hr.after, '137 bpm', 'the latest retest week wins')
  assert.equal(hr.delta, '−14')
  assert.equal(hr.better, true, 'lower heart rate at the same effort is better')
  assert.equal(c.find(r => r.key === 'talk_test_hr')?.better, null, 'talk-test HR carries no judgement')
  assert.equal(c.find(r => r.key === 'pushups_max')?.delta, '+9')
  assert.equal(c.some(r => r.key === 'side_plank_sec_l'), false, 'no retest, no row')

  const go = verdictFor({ decision: 'proceed', rationale: 'Move on.', rules: { decision: 'proceed', reasons: ['Key sessions 84%.'], extendWeeks: 0, totalWeeks: 6 }, nextBlockId: 'b2' })
  assert.equal(go.kind, 'move_on')
  assert.equal(go.primaryLabel, 'START FIGHTER BLOCK 1')
  const ext = verdictFor({ decision: 'hold', rationale: 'One more week.', rules: { decision: 'extend', reasons: ['A gap.'], extendWeeks: 2, totalWeeks: 8 } })
  assert.equal(ext.title, 'EXTEND 2 WEEKS')
  assert.equal(ext.primaryLabel, 'KEEP BUILDING')
  assert.equal(verdictFor({ decision: 'hold', rationale: 'Older row.' }).kind, 'extend', 'old rows without rules still read')
  assert.equal(verdictFor({ decision: 'proceed', rationale: 'x', rules: { decision: 'not_yet', reasons: [], extendWeeks: 0, totalWeeks: 6 } }).kind, 'not_yet')
  assert.equal(verdictFor({ decision: 'adjust', rationale: 'x', rules: { decision: 'adjust', reasons: [], extendWeeks: 0, totalWeeks: 6 }, nextBlockId: null }).kind, 'move_on')
  assert.equal(gateOpen(5, 6), false)
  assert.equal(gateOpen(6, 6), true)
  assert.equal(gateOpen(6, 7), false, 'an extended block opens the gate in its last week')
  assert.equal(gateOpen(7, 7), true)
}

console.log('testWeek / gate tests passed')

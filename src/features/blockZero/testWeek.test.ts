// The end gate's numbers (no test week since 2026-10-18; design-decisions
// "Block Zero tests"): week 1 against week 6 for the front squat estimate and
// the talk-test HR, the verdict, and Program's one gate board.
import assert from 'node:assert/strict'

import { GATE_ROWS, comparisonSource, gateBoardShows, gateOpen, retestComparison, shownValues, verdictFor } from './gate'
import { formatTestValue, liftNameFromId } from './testWeek'

// ─── formatting: lb for weights ──
{
  assert.equal(formatTestValue(88.5, 'kg'), '195 lb', 'weights stored in kg read in lb')
  assert.equal(formatTestValue(142, 'bpm'), '142 bpm')
  assert.equal(liftNameFromId('ex-front-squat'), 'Front squat')
  assert.equal(shownValues(77, 'kg', 88.5, 'kg').span, '170 → 195 lb', 'page 45: 77 → 88.5 kg reads 170 → 195 lb')
  assert.equal(shownValues(142, 'bpm', 146, 'bpm').span, '142 → 146 bpm')
}

// ─── the gate compares two numbers, week 1 → week 6 ──
{
  assert.deepEqual(GATE_ROWS.map(g => g.label), ['Front squat · est. max', 'Talk-test HR'])
  const rows = [
    { week: 1, testKey: 'talk_test_hr', value: 142, unit: 'bpm' },
    { week: 6, testKey: 'talk_test_hr', value: 146, unit: 'bpm' },
    { week: 7, testKey: 'talk_test_hr', value: 148, unit: 'bpm' },
    // the front squat starts in week 3: its first estimate is the week-3 check set
    { week: 3, testKey: 'e1rm:ex-front-squat', value: 77, unit: 'kg' },
    { week: 6, testKey: 'e1rm:ex-front-squat', value: 88.5, unit: 'kg' },
    // old rows from the dropped tests and other lifts: not compared
    { week: 1, testKey: 'pushups_max', value: 18, unit: 'reps' },
    { week: 6, testKey: 'pushups_max', value: 27, unit: 'reps' },
    { week: 1, testKey: 'fixed_effort_hr', value: 151, unit: 'bpm' },
    { week: 6, testKey: 'fixed_effort_hr', value: 139, unit: 'bpm' },
    { week: 3, testKey: 'e1rm:ex-bench-press', value: 60, unit: 'kg' },
    { week: 6, testKey: 'e1rm:ex-bench-press', value: 66, unit: 'kg' },
  ]
  const c = retestComparison(rows)
  assert.deepEqual(c.map(r => r.key), ['e1rm:ex-front-squat', 'talk_test_hr'], 'only the front squat and the talk test, squat first')
  assert.equal(c[0].label, 'Front squat · est. max')
  assert.equal(c[0].span, '170 → 195 lb')
  assert.equal(c[0].delta, '+15%')
  assert.equal(c[0].better, true, 'a higher estimate is the teal band')
  assert.equal(c[1].span, '142 → 148 bpm', 'the latest week 6+ wins')
  assert.equal(c[1].delta, '+6')
  assert.equal(c[1].better, null, 'talk-test HR carries no judgement (neutral chip)')
  // page 46: each row names where its first number is from
  assert.equal(c[0].source, 'from week 3, when front squat starts')
  assert.equal(c[1].source, 'week 1 → week 7', 'the weeks the two numbers came from')
  assert.equal(retestComparison(rows.filter(r => r.week !== 7))[1].source, 'week 1 → week 6')
  assert.equal(comparisonSource('e1rm:ex-front-squat', 4, 6), 'week 4 → week 6', 'a later first squat says its own week')
  const down = retestComparison([{ week: 1, testKey: 'e1rm:ex-front-squat', value: 80 }, { week: 6, testKey: 'e1rm:ex-front-squat', value: 76 }])
  assert.equal(down[0].better, false, 'a lower estimate is the clay band')
  assert.equal(down[0].delta, '−5%')
  assert.deepEqual(retestComparison([{ week: 1, testKey: 'talk_test_hr', value: 142 }]), [], 'no week-6 number, no row')
}

// ─── the verdict ──
{
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

// ─── Program: THE GATE board only (page 45) ──
{
  const talk6 = [{ week: 6, testKey: 'talk_test_hr', value: 146 }]
  assert.equal(gateBoardShows(1, 1, 6, []), false, 'no test-week board in week 1')
  assert.equal(gateBoardShows(6, 6, 6, []), false, 'week 6 before a number is in: no board')
  assert.equal(gateBoardShows(6, 6, 6, talk6), true, 'week 6 once the talk test is in')
  assert.equal(gateBoardShows(6, 6, 6, [{ week: 6, testKey: 'e1rm:ex-front-squat', value: 88 }]), false, 'the squat estimate alone does not open it')
  assert.equal(gateBoardShows(6, 6, 6, [{ week: 6, testKey: 'pushups_max', value: 20 }]), false, 'a dropped test does not open it')
  assert.equal(gateBoardShows(5, 6, 6, talk6), false, 'only on the current week')
  assert.equal(gateBoardShows(6, 6, 6, null), true, 'results could not load: shows by the week')
  assert.equal(gateBoardShows(6, 7, 7, talk6), false, 'an extended block: the gate is in its last week')
}

console.log('gate tests passed')

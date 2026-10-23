// Run: tsx src/lib/brain/hardRuns.test.ts
// Hard runs toward the 5K (page 76): the week's hard runs, the test cadence,
// heavy and tired weeks, speeds from a test, the heart range, the pieces.
import assert from 'node:assert/strict'
import {
  estimateFiveKSec, fiveKText, GOAL_5K_SEC, hardHeart, hardKindOf, hardLabel, hardPlan, hardRunDose, isTestWeek, latestTest,
  parseFiveK, planWeekRuns, repsFor, speedsFrom, steadyMinFor, toGoalText, totalOf, type WeekRun, type WeekRunsIn,
} from './hardRuns'
import { tweakRun } from './doses'

const MON = 20822 // Monday 2027-01-04
const run = (id: string, day: number, over: Partial<WeekRun> = {}): WeekRun => ({ id, day, kind: 'easy', status: 'planned', fixed: false, ...over })
const week = (w: number, over: Partial<WeekRunsIn> = {}): WeekRunsIn => ({
  week: w, runs: [run('tue', MON + 1), run('thu', MON + 3), run('sat', MON + 5)], classDays: [], bagDays: [], tired: false, ...over,
})
const hardIds = (k: Record<string, string>) => Object.entries(k).filter(([, v]) => v !== 'easy').map(([id]) => id).sort()

// Weeks 1 to 3: every run easy.
for (const w of [1, 2, 3]) {
  const out = planWeekRuns(week(w))
  assert.deepEqual(Object.values(out.kinds), ['easy', 'easy', 'easy'], `week ${w} all easy`)
  assert.equal(out.hardTarget, 0)
}

// Week 4: the test and run hard / jog; Tuesday and Saturday, Thursday easy.
{
  const out = planWeekRuns(week(4))
  assert.deepEqual(out.kinds, { tue: 'test', thu: 'easy', sat: 'intervals' })
  assert.equal(out.why, null)
}
// Week 5: steady hard and run hard / jog, the rest easy (two of three, about 80/20 by time).
assert.deepEqual(planWeekRuns(week(5)).kinds, { tue: 'steady', thu: 'easy', sat: 'intervals' })
// A test every 4 weeks from week 4.
assert.deepEqual([3, 4, 5, 6, 7, 8, 9, 12].map(isTestWeek), [false, true, false, false, false, true, false, true])
assert.equal(planWeekRuns(week(8)).kinds.tue, 'test')
assert.equal(planWeekRuns(week(6)).kinds.tue, 'steady')

// Classes and bag work are hard days: a heavy week (2+) keeps one hard run.
{
  const out = planWeekRuns(week(5, { classDays: [MON + 1, MON + 4] }))
  assert.equal(out.hardTarget, 1)
  assert.equal(hardIds(out.kinds).length, 1)
  assert.ok(out.why && /one hard run/.test(out.why))
  // The baseline is the plain plan: the difference is the coach's ease (a rune).
  assert.equal(hardIds(out.baseline).length, 2)
  // Not the day of a class or the day after one (Tuesday's class, Friday's class: Thursday or Saturday... Saturday follows Friday).
  assert.deepEqual(hardIds(out.kinds), ['thu'])
}
// One class: still two hard runs; they keep off the class day.
{
  const out = planWeekRuns(week(5, { classDays: [MON + 1] }))
  assert.equal(hardIds(out.kinds).length, 2)
  assert.ok(!hardIds(out.kinds).includes('tue'))
}
// A heavy test week: the one hard run is the test.
assert.deepEqual(Object.values(planWeekRuns(week(4, { classDays: [MON + 2], bagDays: [MON + 4] })).kinds).filter(k => k !== 'easy'), ['test'])

// A tired week eases to one hard run, never none.
{
  const out = planWeekRuns(week(6, { tired: true }))
  assert.equal(hardIds(out.kinds).length, 1)
  assert.ok(out.why && /tired/.test(out.why))
  const heavyTired = planWeekRuns(week(6, { tired: true, classDays: [MON, MON + 2], bagDays: [MON + 4] }))
  assert.equal(hardIds(heavyTired.kinds).length, 1, 'always at least one hard run')
}
// A done hard run counts; a skipped one doesn't (another run takes it).
{
  const out = planWeekRuns(week(5, { runs: [run('tue', MON + 1, { kind: 'steady', status: 'done', fixed: true }), run('thu', MON + 3), run('sat', MON + 5)] }))
  assert.deepEqual(out.kinds, { tue: 'steady', thu: 'easy', sat: 'intervals' })
  const skipped = planWeekRuns(week(5, { runs: [run('tue', MON + 1, { kind: 'steady', status: 'gone', fixed: true }), run('thu', MON + 3), run('sat', MON + 5)] }))
  assert.equal(skipped.kinds.thu, 'steady')
  assert.equal(skipped.kinds.sat, 'intervals')
}
// His own (fixed) easy run stays easy.
assert.equal(planWeekRuns(week(5, { runs: [run('tue', MON + 1, { fixed: true }), run('thu', MON + 3), run('sat', MON + 5)] })).kinds.tue, 'easy')

// Speeds and paces from a test time: 27:48 is 10.8 km/h.
{
  const sp = speedsFrom(27 * 60 + 48)
  assert.equal(sp.test, 10.8)
  assert.equal(sp.steady, 10.3)
  assert.equal(sp.hard, 11.3)
  assert.equal(sp.easy, 8.4)
  assert.ok(sp.jog <= sp.easy && sp.jog === 7.8)
  // A faster test, faster speeds.
  assert.ok(speedsFrom(25 * 60).hard > sp.hard)
  // His own easy pace leads the easy speed when the strap knows it.
  assert.equal(speedsFrom(27 * 60 + 48, 3600 / 420).easy, 8.6)
}
// Before the first test: a guess from his easy pace, else 30:00.
assert.equal(estimateFiveKSec(null), 1800)
assert.ok(Math.abs(estimateFiveKSec(420) - 1638) <= 1, `${estimateFiveKSec(420)}`)

// The heart range for hard runs: steady 85-90% of max, run hard up to 95%, the jog under the line + 3, EASE OFF 10 over.
{
  const st = hardHeart('steady', 186, 147)
  assert.deepEqual([st.low, st.top, st.overBy], [158, 167, 10])
  const iv = hardHeart('intervals', 186, 147)
  assert.deepEqual([iv.top, iv.jogTop], [176, 150])
  // No max on file: from the easy line (147 / 0.79 = 186).
  assert.equal(hardHeart('intervals', null, 147).top, 176)
}

// The pieces: run hard 2 min, jog 2 min, 5 the first week after a test, one more each week; steady 15 min in week 5.
assert.deepEqual([4, 5, 6, 7, 8, 9].map(repsFor), [5, 6, 7, 8, 5, 6])
assert.deepEqual([5, 6, 7].map(steadyMinFor), [15, 17, 19])
{
  const { plan, why } = hardPlan({ kind: 'intervals', week: 5, fiveK: { day: MON - 7, sec: 1668 }, easyPaceSecKm: null, maxHr: 186, lineBpm: 147, ease: false, capSec: null })
  assert.equal(plan.reps, 6)
  assert.equal(plan.pieces.filter(p => p.kind === 'hard').length, 6)
  assert.equal(plan.pieces[0].kind, 'easy')
  assert.equal(plan.pieces[0].sec, 600)
  assert.equal(totalOf(plan.pieces), 600 + 6 * 240 + 300)
  assert.equal(plan.incline, 1)
  assert.equal(hardLabel(plan), 'Hard × 6')
  assert.deepEqual(why, [])
  // An eased morning: one rep fewer.
  assert.equal(hardPlan({ kind: 'intervals', week: 5, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: true, capSec: null }).plan.reps, 5)
  // The run caps: fewer reps to fit.
  const capped = hardPlan({ kind: 'intervals', week: 7, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: false, capSec: 30 * 60 })
  assert.ok(totalOf(capped.plan.pieces) <= 30 * 60)
  assert.ok(capped.why.some(w => /Shorter/.test(w)))
  // The decision's tweak: one rep fewer; the test never changes.
  const d = hardRunDose('HOLD', plan, [])
  assert.equal(tweakRun(d, { setsDelta: 0, loadStep: 0, roundsDelta: -1 }).hard?.reps, 5)
}
{
  const { plan } = hardPlan({ kind: 'steady', week: 5, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: false, capSec: null })
  assert.deepEqual(plan.pieces.map(p => [p.kind, p.sec / 60]), [['easy', 10], ['steady', 15], ['easy', 5]])
  assert.equal(hardLabel(plan), 'Steady Hard')
}
{
  const { plan, why } = hardPlan({ kind: 'test', week: 4, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: true, capSec: null })
  const five = plan.pieces.find(p => p.kind === 'test')
  assert.equal(five?.distM, 5000)
  assert.equal(plan.speeds.test, 10) // 30:00 guess
  assert.ok(why.some(w => /first 5K test/.test(w)))
  assert.equal(tweakRun(hardRunDose('EASE', plan, why), { setsDelta: 0, loadStep: 0, roundsDelta: -1 }).hard?.pieces.length, 3)
}

// The kinds from a session row.
assert.equal(hardKindOf({ type: 'running', notes: 'tempo' }), 'steady')
assert.equal(hardKindOf({ type: 'running', notes: '5k_test' }), 'test')
assert.equal(hardKindOf({ type: 'foundation_run', notes: null }), null)

// The test's result: the time, how far from 22:00, the latest test before a day.
assert.equal(fiveKText(27 * 60 + 48), '27:48')
assert.equal(toGoalText(27 * 60 + 48), '5:48 to go')
assert.equal(toGoalText(GOAL_5K_SEC - 5), 'under 22:00')
assert.deepEqual(latestTest([{ day: 10, sec: 1700 }, { day: 38, sec: 1650 }, { day: 66, sec: 1600 }], 40), { day: 38, sec: 1650 })
assert.equal(latestTest([], 40), null)
assert.equal(parseFiveK('27:48'), 1668)
assert.equal(parseFiveK('3:00'), null)
assert.equal(parseFiveK('abc'), null)

console.log('hardRuns: ok')

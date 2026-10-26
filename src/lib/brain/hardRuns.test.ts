// Run: tsx src/lib/brain/hardRuns.test.ts
// Hard runs toward the 5K (page 76): the week's hard runs, the test cadence,
// heavy and tired weeks, speeds from a test, the heart range, the pieces.
import assert from 'node:assert/strict'
import {
  estimateFiveKSec, fiveKText, GOAL_5K_SEC, hardHeart, hardKindOf, hardLabel, hardPlan, hardRunDose, latestTest, testReady,
  nudgedFiveKSec, nudgesSince, parseFiveK, planWeekRuns, repsFor, speedsFrom, steadyMinFor, toGoalText, totalOf, wellInside,
  type HardResult, type WeekRun, type WeekRunsIn,
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

// Week 4 on: steady hard and run hard / jog, the rest easy (two of three, about 80/20 by time). No fixed test slot.
{
  const out = planWeekRuns(week(4))
  assert.deepEqual(out.kinds, { tue: 'steady', thu: 'easy', sat: 'intervals' })
  assert.equal(out.why, null)
  assert.equal(out.testId, null)
}
assert.deepEqual(planWeekRuns(week(8)).kinds, { tue: 'steady', thu: 'easy', sat: 'intervals' })

// The 5K test when he is ready (Josh, 2026-10-23): never before week 4, readiness gates, spacing.
{
  const good = (day: number) => ({ day, completed: true, maxHr: 174, top: 176 })
  const easyRun = (day: number) => ({ day, completed: true, maxHr: 165, top: 176 })
  const T = MON + 60
  assert.equal(testReady({ week: 3, today: T, sinceDay: T - 40, recent: [good(T - 5), good(T - 2)], rough: false }).ready, false, 'not before week 4')
  assert.equal(testReady({ week: 6, today: T, sinceDay: null, recent: [], rough: false }).ready, false, 'not before hard runs began')
  assert.equal(testReady({ week: 8, today: T, sinceDay: T - 30, recent: [good(T - 5), good(T - 2)], rough: true }).ready, false, 'a rough stretch waits')
  assert.equal(testReady({ week: 8, today: T, sinceDay: T - 30, recent: [good(T - 5), { ...good(T - 2), maxHr: 180 }], rough: false }).ready, false, 'over the heart top: not yet')
  assert.equal(testReady({ week: 8, today: T, sinceDay: T - 30, recent: [good(T - 5), { ...good(T - 2), completed: false }], rough: false }).ready, false, 'a hard run cut short: not yet')
  assert.equal(testReady({ week: 8, today: T, sinceDay: T - 30, recent: [good(T - 5), good(T - 2)], rough: false }).ready, true, '4 weeks, done at their speeds: ready')
  assert.equal(testReady({ week: 8, today: T, sinceDay: T - 24, recent: [good(T - 5), good(T - 2)], rough: false }).ready, false, 'under 4 weeks at a normal effort: not yet')
  assert.equal(testReady({ week: 8, today: T, sinceDay: T - 22, recent: [easyRun(T - 5), easyRun(T - 2)], rough: false }).ready, true, 'well under the top: sooner (3 weeks)')
  assert.equal(testReady({ week: 8, today: T, sinceDay: T - 15, recent: [easyRun(T - 5), easyRun(T - 2)], rough: false }).ready, false, 'never under 3 weeks')
  assert.equal(testReady({ week: 9, today: T, sinceDay: T - 43, recent: [good(T - 5), { ...good(T - 2), completed: false }], rough: false }).ready, true, 'past 6 weeks: due when nothing is rough')
  // Placed on a hard run, replacing it: not the day of or the day after a class or bag day.
  const placed = planWeekRuns(week(8, { test: { why: 'ready' } }))
  assert.deepEqual(placed.kinds, { tue: 'test', thu: 'easy', sat: 'intervals' })
  assert.equal(placed.testId, 'tue')
  assert.equal(placed.baseline.tue, 'steady', 'the plan alone has no test: the difference is the coach change (rune)')
  const afterClass = planWeekRuns(week(8, { test: { why: 'ready' }, classDays: [MON] }))
  assert.equal(afterClass.testId, 'thu', 'Tuesday follows Monday\'s class: the hard runs go Thursday and Saturday, the test first')
  assert.deepEqual(afterClass.kinds, { tue: 'easy', thu: 'test', sat: 'intervals' })
  assert.equal(planWeekRuns(week(8, { test: { why: 'ready' }, classDays: [MON, MON + 2, MON + 4] })).testId, null, 'every run the day after a class: no test this week')
  // His own test (done or fixed) counts: no second one.
  assert.equal(planWeekRuns(week(8, { test: { why: 'ready' }, runs: [run('tue', MON + 1, { kind: 'test', status: 'done', fixed: true }), run('thu', MON + 3), run('sat', MON + 5)] })).testId, null)
  // A heavy week with a test: the one hard run is the test.
  assert.deepEqual(Object.values(planWeekRuns(week(8, { test: { why: 'ready' }, classDays: [MON + 2], bagDays: [MON + 4] })).kinds).filter(k => k !== 'easy'), ['test'])
}

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

// A tired week eases to one hard run, never none.
{
  const out = planWeekRuns(week(6, { tired: true }))
  assert.equal(hardIds(out.kinds).length, 1)
  assert.ok(out.why && /tired/.test(out.why))
  const heavyTired = planWeekRuns(week(6, { tired: true, classDays: [MON, MON + 2], bagDays: [MON + 4] }))
  assert.equal(hardIds(heavyTired.kinds).length, 1, 'always at least one hard run')
}
// A done hard run counts. A skipped one is just missed (rebuild Phase 3): the easy run stays easy, the other hard run stays.
{
  const out = planWeekRuns(week(5, { runs: [run('tue', MON + 1, { kind: 'steady', status: 'done', fixed: true }), run('thu', MON + 3), run('sat', MON + 5)] }))
  assert.deepEqual(out.kinds, { tue: 'steady', thu: 'easy', sat: 'intervals' })
  const skipped = planWeekRuns(week(5, { runs: [run('tue', MON + 1, { kind: 'steady', status: 'gone', fixed: true }), run('thu', MON + 3), run('sat', MON + 5)] }))
  assert.deepEqual(Object.values(skipped.kinds).sort(), ['easy', 'intervals', 'steady'], 'the other hard run stays, one easy run stays easy')
  // One hard run planned and missed: no other run turns hard.
  const one = planWeekRuns(week(5, { maxHard: 1, runs: [run('tue', MON + 1, { kind: 'steady', status: 'gone', fixed: true }), run('thu', MON + 3), run('sat', MON + 5)] }))
  assert.deepEqual([one.kinds.thu, one.kinds.sat], ['easy', 'easy'], 'a missed hard run is just missed')
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

// The pieces: run hard 2 min, jog 2 min, 5 the first week after a test, one more each week; Tempo 15 to 20 min (page 93).
assert.deepEqual([0, 1, 2, 3, 4, 9].map(repsFor), [5, 6, 7, 8, 8, 8])
assert.deepEqual([0, 1, 2, 3, 9].map(steadyMinFor), [15, 17, 19, 20, 20])
{
  const { plan, why } = hardPlan({ kind: 'intervals', weeksSince: 1, fiveK: { day: MON - 7, sec: 1668 }, easyPaceSecKm: null, maxHr: 186, lineBpm: 147, ease: false, capSec: null })
  assert.equal(plan.reps, 6)
  assert.equal(plan.pieces.filter(p => p.kind === 'hard').length, 6)
  assert.equal(plan.pieces[0].kind, 'easy')
  assert.equal(plan.pieces[0].sec, 600)
  assert.equal(totalOf(plan.pieces), 600 + 6 * 240 + 300)
  assert.equal(plan.incline, 1)
  assert.equal(hardLabel(plan), 'Intervals')
  assert.deepEqual(why, [])
  // An eased morning: one rep fewer.
  assert.equal(hardPlan({ kind: 'intervals', weeksSince: 1, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: true, capSec: null }).plan.reps, 5)
  // The run caps: fewer reps to fit.
  const capped = hardPlan({ kind: 'intervals', weeksSince: 3, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: false, capSec: 30 * 60 })
  assert.ok(totalOf(capped.plan.pieces) <= 30 * 60)
  assert.ok(capped.why.some(w => /Shorter/.test(w)))
  // The decision's tweak: one rep fewer; the test never changes.
  const d = hardRunDose('HOLD', plan, [])
  assert.equal(tweakRun(d, { setsDelta: 0, loadStep: 0, roundsDelta: -1 }).hard?.reps, 5)
}
{
  const { plan } = hardPlan({ kind: 'steady', weeksSince: 1, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: false, capSec: null })
  assert.deepEqual(plan.pieces.map(p => [p.kind, p.sec / 60]), [['easy', 10], ['steady', 17], ['easy', 5]])
  assert.equal(hardLabel(plan), 'Tempo')
}
{
  const { plan, why } = hardPlan({ kind: 'test', weeksSince: 0, fiveK: null, easyPaceSecKm: null, maxHr: null, lineBpm: 147, ease: true, capSec: null })
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

// Review T4: never two hard runs on back-to-back days, even when only adjacent run days are free.
{
  const M = 20822
  const run = (id: string, day: number): WeekRun => ({ id, day, kind: 'easy', status: 'planned', fixed: false })
  const p = planWeekRuns({ week: 6, runs: [run('a', M + 1), run('b', M + 2)], classDays: [], bagDays: [], tired: false })
  assert.equal(Object.values(p.kinds).filter(k => k !== 'easy').length, 1, 'one hard run, not two in a row')
  // The 48 h after a lift (rebuild Phase 2): Monday morning's lift keeps Tuesday easy; Wednesday morning is 48 h on.
  const q = planWeekRuns({ week: 6, runs: [run('t', M + 1), run('w', M + 2), run('f', M + 4)], classDays: [], bagDays: [], tired: false, liftAt: [{ day: M, slot: 'am' }], maxHard: 1 })
  assert.deepEqual(Object.entries(q.kinds).filter(([, k]) => k !== 'easy').map(([id]) => id), ['w'], 'the hard run waits 48 h after heavy legs')
  // The week builder's room caps it: maxHard 0 leaves every run easy.
  assert.equal(Object.values(planWeekRuns({ week: 6, runs: [run('a', M + 1), run('b', M + 4)], classDays: [], bagDays: [], tired: false, maxHard: 0 }).kinds).filter(k => k !== 'easy').length, 0)
}

// Speeds that move between tests (rebuild Phase 3): two hard runs in a row well inside their range, 1.5% faster; 3% at most; a test resets.
{
  const r = (day: number, o: Partial<HardResult> = {}): HardResult => ({ day, kind: 'tempo', completed: true, maxHr: 160, top: 167, rpe: 6, ...o })
  assert.equal(wellInside(r(1)), true, 'heart 7 under the top')
  assert.equal(wellInside(r(1, { maxHr: 165 })), false, 'only 2 under')
  assert.equal(wellInside(r(1, { completed: false })), false, 'not done in full')
  assert.equal(wellInside(r(1, { maxHr: null, rpe: 3 })), false, 'no heart data: no nudge, however easy it felt')
  assert.equal(nudgesSince([r(1, { maxHr: null }), r(4, { maxHr: null })], null), 0)
  assert.equal(nudgesSince([r(1)], null), 0, 'one is not a pair')
  assert.equal(nudgesSince([r(1), r(4)], null), 1)
  assert.equal(nudgesSince([r(1), r(4, { maxHr: 170 }), r(8)], null), 0, 'a run over its range breaks the pair')
  assert.equal(nudgesSince([r(1), r(4), r(8), r(11), r(15), r(18)], null), 2, 'two at most')
  assert.equal(nudgesSince([r(1), r(4), r(8), r(11)], 5), 1, 'only since the last test')
  assert.equal(nudgesSince([r(1, { kind: '5k_test' }), r(4)], null), 0, 'the test itself never counts')
  assert.equal(nudgedFiveKSec(1800, 1), Math.round(1800 / 1.015))
  const base = hardPlan({ kind: 'steady', weeksSince: 1, fiveK: { day: MON - 7, sec: 1668 }, easyPaceSecKm: null, maxHr: 186, lineBpm: 147, ease: false, capSec: null })
  const nudged = hardPlan({ kind: 'steady', weeksSince: 1, fiveK: { day: MON - 7, sec: 1668 }, easyPaceSecKm: null, maxHr: 186, lineBpm: 147, ease: false, capSec: null, nudges: 1 })
  assert.ok(nudged.plan.speeds.steady > base.plan.speeds.steady, `${nudged.plan.speeds.steady} > ${base.plan.speeds.steady}`)
  assert.ok(nudged.why.some(w => /A little faster/.test(w)))
  const test = hardPlan({ kind: 'test', weeksSince: 1, fiveK: { day: MON - 7, sec: 1668 }, easyPaceSecKm: null, maxHr: 186, lineBpm: 147, ease: false, capSec: null, nudges: 2 })
  assert.equal(test.plan.speeds.test, speedsFrom(1668).test, 'the test starts at the last 5K, never nudged')
}

console.log('hardRuns: ok')

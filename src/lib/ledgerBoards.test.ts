// Run: tsx src/lib/ledgerBoards.test.ts
// Page 79's Ledger boards: the 5K (up is better), easy runs at his line, Fight,
// Strength since he started, Next block in plain words; honest early states.
import assert from 'node:assert/strict'
import {
  FIVE_K_GOAL_SEC, comboName, dayWord, easyRunsAtLine, easyRunsEmptyLine, estStrength, fightBars, fightBoard, fiveKBoard, fiveKChart,
  fiveKTestSec, fiveKY, liftFlap, mmss, plainNextBlock, plainPartLine, runPaceSecKm, setSpeedKmh, strengthLines, strengthSince,
} from './ledgerBoards'
import type { ReadinessPart, ReadinessReport } from './brain/readinessParts'
import { isoToEpochDay } from './dates'
import { programStartDay } from '../server/ledgerData'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const START = isoToEpochDay('2026-10-19') // a Monday: week 1
const LB = 0.45359237

test('5K test contract: run_type 5k_test with its time; GPS distance scales to 5 km; context test5kSec wins', () => {
  assert.equal(fiveKTestSec({ runType: '5k_test', durationSec: 1552, distanceKm: null }), 1552)
  assert.equal(fiveKTestSec({ runType: '5k_test', durationSec: 1558, distanceKm: 5.03 }), Math.round(1558 * 5 / 5.03))
  assert.equal(fiveKTestSec({ runType: '5k_test', durationSec: 1500, distanceKm: 2 }), 1500, 'a short GPS read is not scaled')
  assert.equal(fiveKTestSec({ runType: 'easy', durationSec: 1552, distanceKm: 5 }), null, 'an easy run is no test')
  assert.equal(fiveKTestSec({ runType: 'run_walk', durationSec: 1800, distanceKm: null, contextJson: '{"test5kSec":1600}' }), 1600)
  assert.equal(fiveKTestSec({ runType: '5k_test', durationSec: 0, distanceKm: null }), null)
})

test('5K before any test: from week 4 when ready, never a promised week; a planned test is named', () => {
  const v = fiveKBoard([], START, START)
  assert.equal(v.nextWeek, 4)
  assert.equal(v.flap, '5K FIRST TEST WK 4+')
  assert.match(v.line, /^Your first 5K test comes from week 4, when the coach sees you're ready/)
  assert.equal(fiveKBoard([], START, START + 5 * 7).flap, '5K TEST WHEN READY')
  const p = fiveKBoard([], START, START + 3 * 7 + 1, START + 3 * 7 + 3)
  assert.equal(p.flap, '5K FIRST TEST WK 4')
  assert.match(p.line, /^Your first 5K test is planned for week 4\./)
  assert.equal(fiveKChart(v).steps.length, 0)
  assert.equal(fiveKChart(v).next, null)
})

test('5K tests: latest headline, time to go, next test 4 weeks on; up is better (faster = higher)', () => {
  const v = fiveKBoard([{ day: START + 3 * 7 + 5, sec: 1668 }, { day: START + 7 * 7 + 5, sec: 1552 }], START, START + 7 * 7 + 6)
  assert.deepEqual(v.tests, [{ week: 4, sec: 1668 }, { week: 8, sec: 1552 }])
  assert.equal(v.flap, '5K 25:52')
  assert.equal(v.line, "3:52 to go. Next test when you're ready.")
  assert.equal(v.nextWeek, 12)
  assert.equal(v.axisWeeks, 12)
  const ch = fiveKChart(v)
  // the mockup's numbers: 27:48 at y 93.6, 25:52 at 70.4, weeks 4 and 8 at x 108 and 212
  assert.deepEqual(ch.steps, [{ x: 108, y: 93.6 }, { x: 212, y: 93.6 }, { x: 212, y: 70.4 }])
  assert.deepEqual(ch.next, { x0: 212, x: 316, y: 70.4 })
  assert.deepEqual(ch.ticks.map(t => t.text), ['START', 'WK 4', 'WK 8', 'WK 12'])
  assert.ok(fiveKY(1500, 1668) < fiveKY(1600, 1668), 'a faster time sits higher')
  assert.equal(fiveKY(FIVE_K_GOAL_SEC, 1668), 24, 'the goal is the top line')
  const slow = fiveKBoard([{ day: START + 25, sec: 2400 }], START, START + 26)
  assert.ok(fiveKY(2400, 2400) <= 114, 'a slow first test still fits')
  assert.equal(fiveKBoard([{ day: START + 25, sec: 1300 }], START, START + 26).line, "Under 22:00. Next test when you're ready.")
  assert.equal(fiveKBoard([{ day: START + 25, sec: 1600 }], START, START + 40, START + 44).line, '4:40 to go. Next test is planned for week 7.')
  assert.equal(slow.nextWeek, 8, 'a test in week 4 moves the next to week 8')
})

test('treadmill runs count: pace from the set speed when there is no distance', () => {
  assert.equal(runPaceSecKm({ paceSecKm: 400, distanceKm: 5, durationSec: 1800 }), 400)
  assert.equal(runPaceSecKm({ paceSecKm: null, distanceKm: 4, durationSec: 1800 }), 450)
  assert.equal(runPaceSecKm({ paceSecKm: null, distanceKm: null, durationSec: 1800, speedKmh: 8 }), 450)
  assert.equal(runPaceSecKm({ paceSecKm: null, distanceKm: null, durationSec: 1800 }), null)
  assert.equal(setSpeedKmh('{"run":{"speedKmh":8.5}}', null), 8.5)
  assert.equal(setSpeedKmh(null, '{"treadmillKmh":9}'), 9)
  assert.equal(setSpeedKmh('not json', null), null)
})

test('easy runs at HIS line (not 140); up is better; a month-ago delta; hard runs and tests stay out', () => {
  const today = START + 6 * 7 + 3
  const run = (wk: number, pace: number, hr: number, runType: string | null = 'run_walk') => ({ epochDay: START + wk * 7 + 1, avgHr: hr, completed: true, runType, paceSecKm: pace, distanceKm: null, durationSec: 1800 })
  const v = easyRunsAtLine([run(0, 440, 147), run(2, 430, 147), run(6, 410, 147), run(6, 300, 175, 'tempo'), run(5, 380, 147, '5k_test'), run(3, 420, 110)], 147, 10, today)
  assert.equal(v.bpm, 147)
  assert.equal(v.runs, 3)
  assert.equal(v.now, 410)
  assert.deepEqual(v.delta, { text: '▲ 20 s faster than a month ago', up: true })
  // scaled to the line: same pace at a higher heart is a slower pace at the line
  const hi = easyRunsAtLine([run(6, 400, 150)], 147, 10, today)
  assert.equal(hi.now, Math.round(400 * 150 / 147))
  assert.equal(hi.delta, null, 'one week: no arrow')
  const tread = easyRunsAtLine([{ epochDay: today, avgHr: 145, completed: true, runType: 'run_walk', paceSecKm: null, distanceKm: null, durationSec: 1500, speedKmh: 9 }], 147, 10, today)
  assert.equal(tread.runs, 1, 'a treadmill run counts from its set speed')
})

test('easy runs, empty: when his last run was and his next', () => {
  const today = isoToEpochDay('2026-10-23') // a Friday
  assert.equal(easyRunsEmptyLine(isoToEpochDay('2026-06-10'), today + 1, true, today), 'No easy runs since June. Your first easy run is tomorrow; treadmill runs count too.')
  assert.equal(easyRunsEmptyLine(null, null, true, today), 'No runs yet. Treadmill runs count too.')
  assert.equal(dayWord(today + 3, today), 'Monday')
  assert.equal(dayWord(today, today), 'today')
})

test('Fight: bag rounds per week (this week bright), MT classes, combos learned and mastered', () => {
  const today = START + 7 * 7 + 4
  const v = fightBoard({
    rounds: [{ day: START + 8, rounds: 6 }, { day: START + 7 * 7 + 1, rounds: 8 }, { day: START + 7 * 7 + 3, rounds: 6 }],
    classDays: [START + 7 * 7 + 2, START + 6 * 7],
    classDaysPicked: true,
    combos: [{ text: 'Jab → Cross → Hook', score: 8, rated: true }, { text: 'Jab → Cross', score: 12, rated: true }, { text: 'Teep', score: 0, rated: false }],
  }, START, today)
  assert.equal(v.flap, '14 ROUNDS')
  assert.equal(v.thisWeek, 14)
  assert.equal(v.weeks.length, 8)
  assert.deepEqual(v.weeks.map(w => w.label), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'])
  assert.equal(v.weeks[1].rounds, 6)
  assert.equal(v.classes.done, 1)
  assert.deepEqual([v.combos.learned, v.combos.mastered], [2, 1])
  assert.deepEqual(v.combos.closest, { name: 'Jab · cross · hook', dots: 2, words: '8 of 15 to mastered' })
  const bars = fightBars(v.weeks)
  assert.equal(bars[7].h, 60, 'the tallest week is 60 px')
  assert.equal(bars[7].now, true)
  assert.equal(comboName('Jab, Cross'), 'Jab · cross')
})

test('Fight, empty: 0 rounds, NOW only, none picked, 0 learned', () => {
  const v = fightBoard({ rounds: [], classDays: [], classDaysPicked: false, combos: [{ text: 'Jab', score: 0, rated: false }] }, START, START)
  assert.equal(v.flap, '0 ROUNDS')
  assert.equal(v.anyRounds, false)
  assert.deepEqual(v.weeks.map(w => w.label), ['', '', '', '', '', '', '', 'NOW'])
  assert.equal(v.classes.picked, false)
  assert.equal(v.combos.learned, 0)
  assert.equal(v.combos.closest, null)
})

test('Strength since you started: estimated from weight × reps, from 0 in week 1, "about N lb stronger"', () => {
  assert.ok(estStrength(30, 8) > estStrength(30, 5), '8 at 30 lb beats 5 at 30 lb')
  const set = (wk: number, id: string, lb: number, reps: number) => ({ day: START + wk * 7 + 1, exerciseId: id, weightKg: lb * LB, reps })
  const v = strengthSince([
    set(0, 'ex-db-rdl', 40, 8), set(4, 'ex-db-rdl', 55, 8), set(7, 'ex-db-rdl', 60, 8),
    set(0, 'ex-goblet-squat', 30, 5), set(7, 'ex-goblet-squat', 30, 8),
    set(0, 'ex-db-row', 30, 8), set(7, 'ex-db-row', 30, 8),
  ], START, START + 7 * 7 + 3)
  assert.equal(v.currentWeek, 8)
  assert.deepEqual(v.lifts.map(l => l.name), ['Goblet squat', 'DB RDL', 'DB row'], 'squat, hinge, pull order')
  const rdl = v.lifts.find(l => l.exerciseId === 'ex-db-rdl')!
  assert.equal(rdl.points[0].gain, 0, 'week 1 is 0')
  assert.equal(rdl.gain, Math.round(estStrength(60, 8) - estStrength(40, 8)))
  assert.equal(v.lifts.find(l => l.exerciseId === 'ex-goblet-squat')!.gain, Math.round(estStrength(30, 8) - estStrength(30, 5)), 'more reps at the same weight is stronger')
  assert.equal(v.up, 2)
  assert.equal(v.flap, '2 LIFTS UP')
  assert.equal(v.line, `DB RDL: about ${rdl.gain} lb stronger than week 1.`)
  assert.equal(liftFlap(rdl), `+${rdl.gain} LB`)
  const lines = strengthLines(v)
  assert.deepEqual(lines[1].pts[0], { x: 10, y: 114 }, 'every line starts on the base line in week 1')
  assert.ok(lines[1].pts[lines[1].pts.length - 1].y < 114, 'stronger is higher')
})

test('Strength before the first lift: the planned lifts "from today"', () => {
  const v = strengthSince([], START, START, { exerciseIds: ['ex-bench-press', 'ex-goblet-squat'], day: START, label: 'Strength A' })
  assert.equal(v.started, false)
  assert.equal(v.flap, 'FROM TODAY')
  assert.deepEqual(v.lifts.map(l => [l.name, liftFlap(l)]), [['Goblet squat', 'FROM TODAY'], ['Bench', 'FROM TODAY']])
  assert.equal(v.line, 'Each lift counts from your first session (today, Strength A). The line shows how much stronger you get, reps included.')
  const one = strengthSince([{ day: START, exerciseId: 'ex-db-row', weightKg: 30 * LB, reps: 8 }], START, START + 2)
  assert.equal(one.flap, 'WEEK 1 = 0', 'one week of lifting: honest, no trend')
})

const part = (key: ReadinessPart['key'], isIn: boolean, facts: ReadinessPart['facts'], tiles = isIn ? 6 : 2): ReadinessPart => ({ key, name: key, in: isIn, tiles, line: '', small: null, facts })
const report = (parts: ReadinessPart[], over: Partial<ReadinessReport> = {}): ReadinessReport => ({
  week: 8, daysIn: 50, minMet: true, parts, inCount: parts.filter(p => p.in).length, allIn: parts.every(p => p.in), ready: false, lagging: null, breakDays: 0,
  flap: 'BUILDING', tone: 'gold', line: '', foot: 'old foot', move: null, ...over,
})

test('Next block in plain words: Showing up, Running base, Lifting, Back; "N OF 4 DONE"; one line per part', () => {
  const r = report([
    part('habit', true, { due: 20, done: 18, weeksOk: 4, breakDays: 0 }),
    part('engine', false, { goodRuns: 0, runsInWindow: 3, lineBpm: 147, talkTests: 2, lineOk: true }, 4),
    part('strength', false, { missing: ['squat', 'hinge', 'press', 'pull'], rirShare: 0.5 }, 3),
    part('back', true, { scores: 10, cleanDays: 10, meanOk: true, planOpen: false }),
  ])
  const v = plainNextBlock(r)
  assert.equal(v.flap, '2 OF 4 DONE')
  assert.deepEqual(v.parts.map(p => p.name), ['Showing up', 'Running base', 'Lifting', 'Back'])
  assert.equal(v.line, 'Running base and lifting to go')
  assert.equal(v.openKey, 'engine', 'the first part not done is open')
  assert.equal(v.parts[0].say, '4+ training days a week, 3 of the last 4 weeks.')
  assert.equal(v.parts[1].say, '2 more easy run-walks of 27 min or longer, run pieces of 4 min, most of it at heart 147 or under.')
  assert.equal(v.parts[2].say, 'Squat, hinge, press and pull at 3 × 8 with a rep to spare. Log reps left on 9 in 10 sets.')
  assert.equal(v.parts[3].say, 'Back steady or better, and no back ease in 10 days.')
  assert.match(v.foot, /^All four done, and at least 4 weeks in/)
})

test('Next block, day 1: honest lines for each part', () => {
  const r = report([
    part('habit', false, { due: 0, done: 0, weeksOk: 0, breakDays: 0 }, 0),
    part('engine', false, { goodRuns: 0, runsInWindow: 0, lineBpm: 147, talkTests: 0, lineOk: false }, 0),
    part('strength', false, { missing: ['squat', 'hinge', 'press', 'pull'], rirShare: 0 }, 0),
    part('back', false, { scores: 0, cleanDays: 1, planOpen: false, meanOk: false }, 0),
  ], { week: 1, daysIn: 0, minMet: false })
  const v = plainNextBlock(r, { firstRunMin: 15 })
  assert.equal(v.flap, '0 OF 4 DONE')
  assert.equal(v.line, 'Showing up, running base, lifting and back to go')
  assert.equal(v.parts[0].say, 'Train 4+ days a week, 3 weeks running, without a week off. Week 1 starts today.')
  assert.equal(v.parts[1].say, '2 easy run-walks of 27 min or longer, run pieces of 4 min, most of it at heart 147 or under. Your runs start at 15 min.')
  assert.equal(v.parts[3].say, 'It takes 3 back scores from your check-ins to read; you have 0.')
  assert.equal(v.openKey, 'habit')
})

test('Next block: break, lagging and the rest of the part lines', () => {
  assert.equal(plainNextBlock(report([part('habit', false, {}), part('engine', true, { lineBpm: 140 }), part('strength', true, {}), part('back', true, {})], { breakDays: 3, flap: '3 DAY BREAK', line: 'One session by Fri keeps this break under a week' })).flap, '3 DAY BREAK')
  const lag = plainNextBlock(report([part('habit', true, {}), part('engine', false, { goodRuns: 1, lineBpm: 140 }, 1), part('strength', false, { missing: ['press'], rirShare: 0.95 }, 4), part('back', true, {})], { lagging: 'engine' }))
  assert.equal(lag.line, 'Running base first, then lifting')
  assert.equal(plainPartLine(part('strength', false, { missing: ['press'], rirShare: 0.95 })), 'Press at 3 × 8 with a rep to spare.')
  assert.equal(plainPartLine(part('strength', false, { missing: [], rirShare: 0.7 })), 'Log reps left on 9 in 10 sets (now 7 in 10).')
  assert.equal(plainPartLine(part('engine', false, { goodRuns: 1, runsInWindow: 1, lineBpm: 140 })), '1 more easy run-walk of 27 min or longer, run pieces of 4 min, most of it at heart 140 or under.')
  assert.equal(plainPartLine(part('engine', false, { goodRuns: 2, lineBpm: 140, talkTests: 0 })), 'A talk test on an easy run-walk sets your heart line.')
  assert.equal(plainPartLine(part('habit', false, { due: 10, done: 5, weeksOk: 1, breakDays: 2, needInARow: 2 })), 'Two more sessions done in a row, and 4+ training days a week in 2 more weeks.')
  assert.equal(plainPartLine(part('back', false, { scores: 5, cleanDays: 7, meanOk: true })), 'Three more days without a back ease.')
  assert.equal(plainPartLine(part('back', false, { planOpen: true })), 'The raven\'s plan for your back is still open.')
  const all = plainNextBlock(report(['habit', 'engine', 'strength', 'back'].map(k => part(k as ReadinessPart['key'], true, {})), { minMet: false }))
  assert.equal(all.flap, '4 OF 4 DONE')
})

test('since you started: the latest Block Zero\'s first day, else the active block\'s, else today', () => {
  const day = (d: number) => d * 86400
  assert.equal(programStartDay([
    { blockType: 'block_zero', status: 'ended', startedAt: day(START - 60), createdAt: day(START - 60) },
    { blockType: 'block_zero', status: 'ended', startedAt: day(START), createdAt: day(START) },
    { blockType: 'fighter', status: 'active', startedAt: day(START + 70), createdAt: day(START + 70) },
  ], START + 80), START)
  assert.equal(programStartDay([{ blockType: 'fighter', status: 'active', startedAt: null, createdAt: day(START + 3) }], START + 9), START + 3)
  assert.equal(programStartDay([], START + 9), START + 9)
})

test('mm:ss', () => {
  assert.equal(mmss(1552), '25:52')
  assert.equal(mmss(232), '3:52')
})

console.log(`\n${passed} ledger board tests passed`)

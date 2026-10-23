// Run: tsx src/lib/ledger.test.ts
// The Ledger's data (page 32): rings per session, pace at 140 bpm, top sets per week,
// the last seven mornings, weekly body weight, the streak.
import assert from 'node:assert/strict'
import {
  withoutRestartLeftovers,
  aerobicWeekly, buildRings, pondReaction, dayLetter, linePoints, mondayOf, paceAt140, paceDelta, paceFlap,
  avgFlap, avgName, herbMonth, ringState, ringWindow, sleepWeek, seasonRings, sessionRings, SEASON_WEEKS, spanWeeks, strengthWeekly, weightDelta, weightWeekly,
} from './ledger'
import { isoToEpochDay } from './dates'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const SUN = isoToEpochDay('2026-10-18')
const MON = isoToEpochDay('2026-10-12')

test('weeks start on Monday', () => {
  assert.equal(mondayOf(SUN), MON)
  assert.equal(mondayOf(MON), MON)
  assert.equal(dayLetter(SUN), 'S')
  assert.equal(dayLetter(MON), 'M')
})

test('ring windows: this week, this month, the last 13 weeks', () => {
  assert.deepEqual(ringWindow('week', SUN), { from: MON, to: MON + 6 })
  assert.deepEqual(ringWindow('month', SUN), { from: isoToEpochDay('2026-10-01'), to: isoToEpochDay('2026-10-31') })
  assert.deepEqual(ringWindow('season', SUN), { from: MON - 84, to: MON + 6 })
})

test('ring states: done, skipped or missed is struck, planned is to do', () => {
  assert.equal(ringState('completed'), 'done')
  assert.equal(ringState('skipped'), 'skip')
  assert.equal(ringState('missed'), 'skip')
  assert.equal(ringState('planned'), 'todo')
  assert.equal(ringState('in_progress'), 'todo')
  assert.equal(ringState('cancelled'), null)
})

test('rings: one segment per planned session, in date order, by type', () => {
  const rows = [
    { id: 'a', type: 'strength', status: 'completed', scheduledDate: MON },
    { id: 'b', type: 'strength', status: 'planned', scheduledDate: MON + 5 },
    { id: 'c', type: 'strength', status: 'completed', scheduledDate: MON + 3 },
    { id: 'd', type: 'foundation_run', status: 'skipped', scheduledDate: MON + 2, timeSlot: 'pm' },
    { id: 'e', type: 'zone2_bogus', status: 'completed', scheduledDate: MON },
    { id: 'f', type: 'mobility', status: 'completed', scheduledDate: MON + 1 },
    { id: 'g', type: 'strength', status: 'completed', scheduledDate: MON - 1 }, // last week
    { id: 'h', type: 'bag_work', status: 'completed', scheduledDate: MON + 2, timeSlot: 'am' },
  ]
  const rings = buildRings(rows, 'week', SUN)
  assert.deepEqual(rings.map(r => r.key), ['strength', 'condition', 'recovery'])
  assert.deepEqual(rings[0].list, ['done', 'done', 'todo'])
  assert.deepEqual(rings[1].list, ['done', 'skip'], 'AM before PM on the same day')
  assert.deepEqual(rings[2].list, ['done'])
  assert.equal(rings[1].icon, 'zone2')
  assert.equal(rings[2].label, 'Recovery')
})

test('aerobic base: runs near 140 bpm, normalised to 140, one point per week', () => {
  assert.equal(paceAt140(400, 140), 400)
  assert.equal(paceAt140(400, 147), 420)
  const runs = [
    { epochDay: MON - 7, paceSecKm: 420, avgHr: 140, completed: true },
    { epochDay: MON - 6, paceSecKm: 400, avgHr: 140, completed: true },
    { epochDay: MON + 1, paceSecKm: 380, avgHr: 140, completed: true },
    { epochDay: MON + 2, paceSecKm: 300, avgHr: 170, completed: true }, // hard run: out of the band
    { epochDay: MON + 3, paceSecKm: 360, avgHr: 140, completed: false }, // not done
    { epochDay: MON - 70, paceSecKm: 450, avgHr: 140, completed: true }, // older than 10 weeks
    { epochDay: MON - 30, paceSecKm: 500, avgHr: 110, completed: true }, // a walk: under the band
  ]
  const { points, runs: n } = aerobicWeekly(runs, 10, SUN)
  assert.equal(n, 3)
  // E2E minor 16: a Block Zero easy run under the talk-test cap (avg 128) counts.
  const easy = aerobicWeekly([{ epochDay: MON + 1, paceSecKm: 420, avgHr: 128, completed: true }], 10, SUN)
  assert.equal(easy.runs, 1)
  assert.deepEqual(easy.points, [{ weekStart: MON, value: 384 }])
  assert.deepEqual(points, [{ weekStart: MON - 7, value: 410 }, { weekStart: MON, value: 380 }])
  assert.deepEqual(paceDelta(points), { text: '▲ 30 s faster', up: true })
  assert.equal(paceFlap(365), '6:05/KM @140')
  assert.equal(aerobicWeekly(runs, 10, SUN).stale, false)
})

test('aerobic base (audit 2026-10-23 #21): stub runs under 2 min are out; old data has no arrow', () => {
  const stub = aerobicWeekly([
    { epochDay: MON - 7, paceSecKm: 420, avgHr: 140, completed: true, durationSec: 1200 },
    { epochDay: MON, paceSecKm: 300, avgHr: 140, completed: true, durationSec: 11 },
    { epochDay: MON + 1, paceSecKm: 400, avgHr: 140, completed: true, durationSec: 120 },
  ], 13, SUN)
  assert.equal(stub.runs, 2, 'an 11-second run is not a pace')
  assert.deepEqual(stub.points, [{ weekStart: MON - 7, value: 420 }, { weekStart: MON, value: 400 }])
  const old = aerobicWeekly([
    { epochDay: MON - 84, paceSecKm: 420, avgHr: 140, completed: true },
    { epochDay: MON - 63, paceSecKm: 390, avgHr: 140, completed: true },
  ], 13, SUN)
  assert.equal(old.points.length, 2)
  assert.equal(old.stale, true, 'newest point 9 weeks old: stale')
  assert.equal(aerobicWeekly([{ epochDay: MON - 56, paceSecKm: 390, avgHr: 140, completed: true }], 13, SUN).stale, false, '8 weeks old: still shown')
  assert.equal(aerobicWeekly([], 13, SUN).stale, false)
})

test('strength: the top set per week of the front squat and the bench', () => {
  const sets = [
    { epochDay: MON - 7, exerciseName: 'Front Squat', weightLbs: 135 },
    { epochDay: MON - 6, exerciseName: 'Front Squat', weightLbs: 145 },
    { epochDay: MON, exerciseName: 'Front Squat', weightLbs: 155 },
    { epochDay: MON, exerciseName: 'Bulgarian Split Squat', weightLbs: 60 },
    { epochDay: MON, exerciseName: 'Back Squat', weightLbs: 225 },
    { epochDay: MON + 2, exerciseName: 'Bench Press', weightLbs: 120 },
  ]
  const { lifts, sets: n } = strengthWeekly(sets, 10, SUN)
  assert.equal(n, 4)
  assert.deepEqual(lifts.map(l => l.short), ['front squat', 'bench'])
  assert.deepEqual(lifts[0].points, [{ weekStart: MON - 7, value: 145 }, { weekStart: MON, value: 155 }])
  assert.equal(strengthWeekly([], 10, SUN).lifts.length, 0)
  // Audit 2026-10-23 #28: Block Zero's squat is the goblet squat; it charts.
  const goblet = strengthWeekly([
    { epochDay: MON - 7, exerciseName: 'Goblet Squat', weightLbs: 30 },
    { epochDay: MON, exerciseName: 'Goblet Squat', weightLbs: 35 },
  ], 10, SUN)
  assert.deepEqual(goblet.lifts.map(l => l.short), ['goblet squat'])
  assert.deepEqual(goblet.lifts[0].points, [{ weekStart: MON - 7, value: 30 }, { weekStart: MON, value: 35 }])
})

test('sleep + soreness: the last seven mornings, gaps kept, average of the logged nights', () => {
  const logs = [
    { logDate: SUN, sleepHours: 7, soreness: 2 },
    { logDate: SUN - 1, sleepHours: 6, soreness: 9 },
    { logDate: SUN - 8, sleepHours: 9, soreness: 1 },
  ]
  const { days, avg } = sleepWeek(logs, SUN)
  assert.equal(days.length, 7)
  assert.deepEqual(days.map(d => d.letter).join(''), 'MTWTFSS')
  assert.equal(days[6].sleepHours, 7)
  assert.equal(days[5].soreness, null, 'off-scale soreness is not drawn')
  assert.equal(days[0].sleepHours, null)
  assert.equal(avg, 6.5)
  assert.equal(sleepWeek([], SUN).avg, null)
  // Audit 2026-10-23 #25: an average from fewer than 7 mornings says how many.
  assert.equal(sleepWeek(logs, SUN).mornings, 2)
  assert.equal(avgFlap('6.5 H', 2), '6.5 H · 2 MORNINGS')
  assert.equal(avgFlap('6.5 H', 1), '6.5 H · 1 MORNING')
  assert.equal(avgFlap('6.5 H', 7), '6.5 H AVG')
  assert.equal(avgName('28-day', 3), 'average of 3 mornings')
  assert.equal(avgName('28-day', 12), '28-day average')
})

test('body weight: the last weigh-in of each week', () => {
  const rows = [
    { epochDay: MON - 7, weightLbs: 182 },
    { epochDay: MON - 3, weightLbs: 181.4 },
    { epochDay: MON + 1, weightLbs: 180 },
  ]
  const { points, weighIns } = weightWeekly(rows, 10, SUN)
  assert.equal(weighIns, 3)
  assert.deepEqual(points, [{ weekStart: MON - 7, value: 181.4 }, { weekStart: MON, value: 180 }])
  assert.deepEqual(weightDelta(points), { text: '▼ 1.4 lb', down: true })
  assert.equal(spanWeeks(points), 2)
  assert.equal(spanWeeks([]), 0)
})

test('chart points: page 32\'s LINE (pad, min..max; inverted puts lower values higher)', () => {
  const pts = linePoints([412, 365], 320, 120, 10, true)
  assert.deepEqual(pts, [{ x: 10, y: 110 }, { x: 310, y: 10 }])
  assert.deepEqual(linePoints([5], 320, 120, 10, false), [{ x: 160, y: 10 }])
})

test('the pond reacts to how the week has gone', () => {
  assert.equal(pondReaction([]), null)
  assert.equal(pondReaction([{ key: 'strength', label: 'Strength', icon: 'strength', list: ['todo'] }]), null)
  assert.equal(pondReaction([{ key: 'strength', label: 'Strength', icon: 'strength', list: ['done', 'done', 'skip', 'todo'] }]), 2 / 3)
})

test('MONTH: one segment per planned session this calendar month', () => {
  const rows = [
    { id: 'a', type: 'strength', status: 'completed', scheduledDate: isoToEpochDay('2026-10-01') },
    { id: 'b', type: 'strength', status: 'planned', scheduledDate: isoToEpochDay('2026-10-31') },
    { id: 'c', type: 'strength', status: 'completed', scheduledDate: isoToEpochDay('2026-09-30') },
    { id: 'd', type: 'mobility', status: 'skipped', scheduledDate: isoToEpochDay('2026-10-10') },
  ]
  const rings = buildRings(rows, 'month', SUN)
  assert.deepEqual(rings.map(r => r.list), [['done', 'todo'], [], ['skip']])
})

test('SEASON: one segment per week of the last 13, lit when that week’s sessions of the type were done', () => {
  const rows = [
    // this week: strength both done -> lit; condition one done one planned -> dark
    { id: 's1', type: 'strength', status: 'completed', scheduledDate: MON },
    { id: 's2', type: 'strength', status: 'completed', scheduledDate: MON + 3 },
    { id: 'c1', type: 'foundation_run', status: 'completed', scheduledDate: MON + 1 },
    { id: 'c2', type: 'bag_work', status: 'planned', scheduledDate: MON + 5 },
    // last week: strength skipped -> dark; recovery done -> lit
    { id: 's3', type: 'strength', status: 'skipped', scheduledDate: MON - 7 },
    { id: 'r1', type: 'mobility', status: 'completed', scheduledDate: MON - 6 },
    // 13 weeks back is outside the season
    { id: 'old', type: 'strength', status: 'completed', scheduledDate: MON - 13 * 7 },
    // the first week of the season
    { id: 'first', type: 'mobility', status: 'completed', scheduledDate: MON - 12 * 7 },
  ]
  const rings = buildRings(rows, 'season', SUN)
  assert.deepEqual(rings, seasonRings(rows, SUN))
  for (const r of rings) assert.equal(r.list.length, SEASON_WEEKS)
  const [str, cond, rec] = rings
  assert.equal(str.list[12], 'done')
  assert.equal(str.list[11], 'todo')
  assert.equal(str.list.filter(s => s === 'done').length, 1)
  assert.equal(cond.list[12], 'todo')
  assert.equal(rec.list[11], 'done')
  assert.equal(rec.list[0], 'done')
  // a week with nothing of the type planned stays dark
  assert.equal(rec.list[12], 'todo')
  // the pond still reads the sessions themselves
  assert.deepEqual(sessionRings(rows, 'season', SUN)[0].list, ['skip', 'done', 'done'])
})

test('herb (page 62 B): 28 mornings, the 7- and 28-day averages, the sleep line from his own check-ins', () => {
  // the mockup's numbers, oldest first, ending today
  const HERB = [4, 5, 3, 6, 7, 5, 4, 5, 6, 4, 7, 8, 6, 5, 6, 5, 7, 8, 6, 7, 5, 6, 7, 5, 8, 9, 7, 6]
  const SLEEP = [7.6, 7.1, 7.8, 6.9, 6.5, 7.4, 7.7, 7.3, 6.9, 7.6, 6.4, 6.2, 7.0, 7.5, 6.8, 7.2, 6.5, 6.3, 7.0, 6.6, 7.4, 7.2, 6.8, 7.5, 6.1, 7.9, 7.4, 6.6]
  const logs = HERB.map((h, i) => ({ logDate: SUN - 27 + i, herbScale: h, sleepHours: SLEEP[i] }))
  const x = herbMonth(logs, SUN)
  assert.equal(x.days.length, 28)
  assert.equal(x.days[27].herb, 6)
  assert.equal(x.days[27].letter, 'S')
  assert.equal(x.avg7, 6.9)
  assert.equal(x.avg28, 6.0)
  assert.deepEqual(x.line, { avg: 6, above: 10, aboveSleep: 6.7, rest: 18, restSleep: 7.3, checkIns: 28 })
  assert.deepEqual([x.n7, x.n28], [7, 28])
  // gaps stay gaps; off-scale is not drawn; no herb logged: no averages, no line
  const gap = herbMonth([{ logDate: SUN, herbScale: 12, sleepHours: 7 }, { logDate: SUN - 1, herbScale: 3, sleepHours: null }], SUN)
  assert.equal(gap.days[27].herb, null)
  assert.equal(gap.avg28, 3)
  assert.equal(gap.line, null, 'no mornings with sleep on both sides: no line')
  assert.deepEqual([gap.n7, gap.n28], [1, 1], 'one morning logged: the boards say 1 morning')
  assert.deepEqual([herbMonth([], SUN).avg7, herbMonth([], SUN).avg28, herbMonth([], SUN).line], [null, null, null])
})

test('a restarted Block Zero: what it planned and he never did is off the rings, done still counts', () => {
  const W = isoToEpochDay('2026-10-21')
  const rows = [
    { id: 'lead', type: 'mobility', status: 'missed', scheduledDate: W },
    { id: 'did', type: 'mobility', status: 'completed', scheduledDate: W },
    { id: 'after', type: 'mobility', status: 'missed', scheduledDate: W + 3 },
  ]
  const kept = withoutRestartLeftovers(rows, [{ from: W - 1, to: W + 1 }]).map(r => r.id)
  assert.deepEqual(kept, ['did', 'after'])
  assert.deepEqual(sessionRings(withoutRestartLeftovers(rows.slice(0, 1), [{ from: W - 1, to: W + 1 }]), 'week', W).find(r => r.key === 'recovery')?.list, [], 'the one missed leftover: an empty ring')
})

console.log(`ledger: ${passed} passed`)

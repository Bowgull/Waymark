// Run: tsx src/lib/ledger.test.ts
// The Ledger's data (page 32): rings per session, pace at 140 bpm, top sets per week,
// the last seven mornings, weekly body weight, the streak.
import assert from 'node:assert/strict'
import {
  aerobicWeekly, buildRings, pondReaction, currentStreak, dayLetter, linePoints, mondayOf, paceAt140, paceDelta, paceFlap,
  ringState, ringWindow, sleepWeek, spanWeeks, strengthWeekly, weightDelta, weightWeekly,
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
  ]
  const { points, runs: n } = aerobicWeekly(runs, 10, SUN)
  assert.equal(n, 3)
  assert.deepEqual(points, [{ weekStart: MON - 7, value: 410 }, { weekStart: MON, value: 380 }])
  assert.deepEqual(paceDelta(points), { text: '▲ 30 s faster', up: true })
  assert.equal(paceFlap(365), '6:05/KM @140')
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

test('streak: days in a row with a completed session; today is still open', () => {
  const rows = [SUN - 1, SUN - 2, SUN - 3, SUN - 5].map((d, i) => ({ id: String(i), type: 'mobility', status: 'completed', scheduledDate: d }))
  assert.equal(currentStreak(rows, SUN), 3)
  assert.equal(currentStreak([...rows, { id: 'x', type: 'strength', status: 'completed', scheduledDate: SUN }], SUN), 4)
  assert.equal(currentStreak([], SUN), 0)
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

console.log(`ledger: ${passed} passed`)

// Today's pure pieces: the week strip, which Today shows (rest / unprepared /
// all done / the day), the lantern, and the runes on the tiles (page 56).
import assert from 'node:assert/strict'

import { ALL_DONE_AFTER_CONFIRM_MS, EVENING_HOUR, fadesToAllDone, lanternFor, showsHome, todayMode, tomorrowLine, weekStripDays, epochDayToISO } from './weekStrip'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; void name }

// 2026-10-12 is a Monday
const MON = Math.floor(Date.UTC(2026, 9, 12) / 86400000)

test('week strip: seven tiles Monday to Sunday, today marked, AM before PM', () => {
  const days = weekStripDays([
    { id: 'a', type: 'strength', status: 'completed', scheduledDate: MON, timeSlot: 'pm' },
    { id: 'b', type: 'mobility', status: 'completed', scheduledDate: MON, timeSlot: 'am' },
    { id: 'c', type: 'running', notes: 'zone2', status: 'planned', scheduledDate: MON + 2, timeSlot: 'pm' },
    { id: 'd', type: 'running', notes: 'tempo', status: 'skipped', scheduledDate: MON + 3, timeSlot: 'am' },
    { id: 'e', type: 'strength', status: 'missed', scheduledDate: MON + 4, timeSlot: 'am' },
  ], MON, MON + 2)
  assert.equal(days.length, 7)
  assert.deepEqual(days.map(d => d.letter), ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  assert.equal(days[0].iso, '2026-10-12')
  assert.equal(days[6].date, 18)
  assert.deepEqual(days[0].icons.map(i => [i.key, i.state]), [['foundation', 'done'], ['strength', 'done']])
  assert.equal(days[2].isToday, true)
  assert.deepEqual(days[2].icons.map(i => i.key), ['zone2'])
  assert.deepEqual(days[3].icons.map(i => [i.key, i.state]), [['run', 'skip']])
  assert.equal(days[4].icons[0].state, 'skip')
  assert.equal(days[1].rest, true, 'a prepared week with nothing on Tuesday: REST')
  assert.equal(weekStripDays([], MON, MON)[0].rest, false, 'no plan: not rest')
  assert.equal(epochDayToISO(MON + 6), '2026-10-18')
})

test('today mode: rest, unprepared, all done in the evening, else the day', () => {
  const week = [{ id: 'x', type: 'strength', status: 'planned', scheduledDate: MON }]
  assert.equal(todayMode({ today: [], weekSessions: week, hour: 9 }), 'rest')
  assert.equal(todayMode({ today: [], weekSessions: [], hour: 9 }), 'unprepared')
  assert.equal(todayMode({ today: [], weekSessions: null, hour: 9 }), 'unprepared')
  const done = [{ id: '1', type: 'mobility', status: 'completed' }, { id: '2', type: 'strength', status: 'completed' }, { id: '3', type: 'running', status: 'skipped' }]
  assert.equal(todayMode({ today: done, weekSessions: week, hour: EVENING_HOUR }), 'allDone')
  assert.equal(todayMode({ today: done, weekSessions: week, hour: EVENING_HOUR - 1 }), 'day', 'not evening yet')
  assert.equal(todayMode({ today: done, weekSessions: week, hour: 21, showDayAnyway: true }), 'day', 'tap to see the board again')
  assert.equal(todayMode({ today: [...done, { id: '4', type: 'running', status: 'planned' }], weekSessions: week, hour: 21 }), 'day')
  assert.equal(todayMode({ today: [{ id: '5', type: 'strength', status: 'skipped' }], weekSessions: week, hour: 21 }), 'day', 'only skipped: nothing was done')
  assert.equal(showsHome('rest') && showsHome('unprepared') && showsHome('allDone'), true)
  assert.equal(showsHome('day'), false)
})

test('a Strava confirm of the day’s last session fades to ALL DONE in the evening (page 46)', () => {
  const done = [{ status: 'completed' }, { status: 'completed' }, { status: 'skipped' }]
  assert.equal(fadesToAllDone(done, EVENING_HOUR), true)
  assert.equal(fadesToAllDone(done, EVENING_HOUR - 1), false, 'daytime: the day board stays')
  assert.equal(fadesToAllDone([...done, { status: 'planned' }], 20), false, 'not the last session')
  assert.equal(fadesToAllDone([{ status: 'skipped' }], 20), false)
  assert.equal(ALL_DONE_AFTER_CONFIRM_MS, 2000, 'about 2 s after LOGGED')
})

test('lantern dims on an eased day', () => {
  assert.equal(lanternFor(null), 0.85)
  assert.equal(lanternFor({ checkedIn: true, ease: false }), 1)
  assert.equal(lanternFor({ checkedIn: true, ease: true }), 0)
})

test('tomorrow line', () => {
  const name = (s: { type: string; label?: string | null }) => s.label ?? s.type
  assert.equal(tomorrowLine([], name), null)
  assert.equal(tomorrowLine([{ type: 'strength', label: 'Strength A', timeSlot: 'pm' }, { type: 'mobility', label: 'Foundation', timeSlot: 'am' }], name), 'Foundation, then Strength A.')
  assert.equal(tomorrowLine([{ type: 'x', label: 'A', timeSlot: 'am' }, { type: 'x', label: 'B', timeSlot: 'am' }, { type: 'x', label: 'C', timeSlot: 'pm' }], name), 'A, B, then C.')
  assert.equal(tomorrowLine([{ type: 'mobility', label: 'Foundation', timeSlot: 'am' }, { type: 'strength', label: 'Strength A', timeSlot: 'pm' }], name, 4), 'Foundation, then Strength A. Week 4 starts.', 'page 43 B')
})

test('runes at the foot of the day tiles (page 56): Dagaz new, Algiz seen, none', () => {
  const runes: Record<number, 'new' | 'missseen'> = { [MON + 2]: 'new', [MON + 4]: 'missseen' }
  const days = weekStripDays([{ id: 'a', type: 'strength', status: 'planned', scheduledDate: MON + 2, timeSlot: 'am' }], MON, MON + 2, d => runes[d] ?? null)
  assert.deepEqual(days.map(d => d.rune), [null, null, 'new', null, 'missseen', null, null])
  assert.equal(weekStripDays([], MON, MON)[0].rune, null, 'no changes: no rune')
})

console.log(`today.test: ${passed} passed`)

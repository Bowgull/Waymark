// Today's pure pieces: the week strip, which Today shows (rest / unprepared /
// all done / the day), the lantern, and the coach's asks as boards.
import assert from 'node:assert/strict'

import { askView, dayFlap, firstAsk, stepTm, tmAcceptBody } from './askView'
import { EVENING_HOUR, lanternFor, shortWhy, showsHome, splitLead, todayMode, tomorrowLine, weekStripDays, epochDayToISO } from './weekStrip'

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

test('ramp-up ask: proof tiles, options with icons, AM/PM only on an added run, decline', () => {
  const v = askView({
    id: 'r1', adjustmentType: 'ramp_up', reason: 'Fresh and easy. Push a little this week? Accept: one more set.', status: 'proposed',
    options: [
      { kind: 'extra_set', id: 'extra_set', title: '+1 SET', detail: 'Squat and RDL, 3×8', sessionId: 's1' },
      { kind: 'load_step', id: 'more_weight', title: 'MORE WEIGHT', detail: 'Squat 140 · RDL 120', sessionId: 's1', factor: 1.025, lifts: [] },
      { kind: 'add', id: 'extra_run', title: 'EXTRA RUN', detail: 'Zone 2, 30 min', type: 'foundation_run', sessionLabel: 'Zone 2', timeSlot: 'pm' },
    ],
    detail: { why: "You've been fresh and sessions felt easy.", proof: [{ label: 'FRESH', value: '3 DAYS' }, { label: 'EASY', value: '3 OF 3' }], decline: { id: 'not_this_week', title: 'NOT THIS WEEK' } },
  })!
  assert.equal(v.kind, 'ramp_up')
  assert.equal(v.flap, 'PUSH THIS WEEK?')
  assert.equal(v.line, "You've been fresh and sessions felt easy.")
  assert.deepEqual(v.proof, ['FRESH 3 DAYS', 'EASY 3 OF 3'], 'page 36: each proof tile is one short teal flap')
  assert.deepEqual(v.choices.map(c => [c.title, c.icon, c.slot, c.body?.option]), [['+1 SET', 'strength', null, 0], ['MORE WEIGHT', 'strength', null, 1], ['EXTRA RUN', 'zone2', 'pm', 2]])
  assert.equal(v.go, 'DO IT')
  assert.equal(v.decline?.title, 'NOT THIS WEEK')
})

test('make-regular ask: usual day, ANOTHER DAY (safe days picked after DONE), and I\'LL ADD IT MYSELF', () => {
  const v = askView({
    id: 'm1', adjustmentType: 'make_regular', sessionType: 'bag_work', reason: 'Bag Work was added 2 weeks running and went well. Make it part of the plan?',
    options: [
      { kind: 'make_regular', id: 'usual', title: 'WEDNESDAYS', detail: "Where you've been putting it", type: 'bag_work', slot: { dayOfWeek: 3, timeSlot: 'pm', label: 'WED PM' } },
      { kind: 'make_regular', id: 'another_day', title: 'ANOTHER DAY', detail: 'Pick from the safe days', type: 'bag_work', safeSlots: [{ dayOfWeek: 4, timeSlot: 'pm', label: 'THU PM' }, { dayOfWeek: 6, timeSlot: 'am', label: 'SAT AM' }] },
      { kind: 'keep_extra', id: 'keep_extra', title: "I'LL ADD IT MYSELF", detail: 'Not in the plan. Still counts when you add it' },
    ],
    detail: { why: "You've added it two weeks running and it went well.", proof: [{ label: 'WK 2', value: '✓' }, { label: 'WK 3', value: '✓' }, { label: 'NOT SORE', value: '' }], candidate: { type: 'bag_work', label: null, weeks: 2 } },
  })!
  assert.equal(v.hero, 'bag')
  assert.equal(v.flap, 'BAG WORK')
  assert.equal(v.line, "You've added it two weeks running and it went well. Make it part of the plan?")
  assert.deepEqual(v.proof, ['WK 2 ✓', 'WK 3 ✓', 'NOT SORE'], 'page 36 proof tiles')
  assert.deepEqual(v.choices.map(c => [c.title, c.sub, c.slot, c.body]), [
    ['WEDNESDAYS', "Where you've been putting it", 'pm', { option: 0 }],
    ['ANOTHER DAY', 'Pick from the safe days', null, null],
    ["I'LL ADD IT MYSELF", 'Not in the plan. Still counts when you add it', null, { option: 2 }],
  ])
  assert.deepEqual(v.choices[1].pick?.map(p => [p.title, p.slot, p.body]), [['THU PM', 'pm', { option: 1, slot: 0 }], ['SAT AM', 'am', { option: 1, slot: 1 }]], 'DONE then asks which safe day')
  const one = askView({ id: 'm2', adjustmentType: 'make_regular', sessionType: 'bag_work', reason: 'x', options: [{ kind: 'make_regular', id: 'another_day', title: 'ANOTHER DAY', detail: 'Pick from the safe days', safeSlots: [{ dayOfWeek: 4, timeSlot: 'pm', label: 'THU PM' }] }], detail: { candidate: { type: 'bag_work', weeks: 3 } } })!
  assert.deepEqual(one.choices[0].body, { option: 0, slot: 0 }, 'one safe day: DONE answers with it')
  assert.deepEqual(one.proof, ['3 WEEKS ✓'], 'an older ask without proof tiles: the weeks as one tile')
  assert.equal(v.go, 'DONE')
  assert.equal(v.decline, null)
})

test('missed-session ask: move / swap / drop rows with day flaps', () => {
  assert.equal(dayFlap('2026-10-18', 'am'), 'SUN AM')
  const v = askView({
    id: 'x1', adjustmentType: 'missed_session', sessionType: 'strength', reason: "You missed Thursday's Strength B. Fit it in?",
    options: [
      { kind: 'move', epochDay: MON + 6, date: '2026-10-18', timeSlot: 'am' },
      { kind: 'swap', type: 'active_recovery', label: 'Reset', epochDay: MON + 7, date: '2026-10-19', timeSlot: 'pm' },
      { kind: 'drop' },
    ],
  })!
  assert.equal(v.kind, 'missed_session')
  assert.equal(v.hero, 'strength')
  assert.deepEqual(v.choices.map(c => [c.title, c.icon, c.body?.option]), [['SUN AM', 'strength', 0], ['MON PM', 'reset', 1], ['DROP IT', null, 2]])
  assert.equal(v.rowLine, 'You missed Strength. Fit it in?')
})

test('training max ask: lifts, bounded steps, accept values', () => {
  const v = askView({
    id: 't1', adjustmentType: 'tm_update', reason: 'The block is done. New training maxes?',
    options: [{ kind: 'tm_update', id: 'approve', title: 'APPROVE', lifts: [] }],
    detail: { lifts: [{ exerciseId: 'sq', name: 'Back Squat', currentKg: 61, proposedKg: 66, minKg: 61, maxKg: 68.5, stepKg: 2.5, reason: '' }] },
  })!
  assert.equal(v.kind, 'tm_update')
  assert.equal(v.tm?.[0].name, 'BACK SQUAT')
  const lift = v.tm![0]
  assert.equal(stepTm(lift, 66, 1), 68.5)
  assert.equal(stepTm(lift, 68.5, 1), 68.5, 'capped at the rule bound')
  assert.equal(stepTm(lift, 61, -1), 61)
  assert.deepEqual(tmAcceptBody({ sq: 68.5 }), { option: 0, values: { sq: 68.5 } })
  assert.equal(v.decline?.title, 'KEEP THE OLD ONES')
})

test('only open asks of the four kinds become boards; the first is shown on open', () => {
  assert.equal(askView({ id: 'a', adjustmentType: 'swap', reason: 'x' }), null)
  assert.equal(askView({ id: 'b', adjustmentType: 'ramp_up', reason: 'x', status: 'accepted' }), null)
  assert.equal(firstAsk([{ id: 'a', adjustmentType: 'swap', reason: 'x' }, { id: 'c', adjustmentType: 'missed_session', sessionType: 'mobility', reason: 'y', options: [{ kind: 'drop' }] }])?.id, 'c')
})

test('the Coach board lines: a bold lead, and the why line shorter on Today (page 36)', () => {
  assert.deepEqual(splitLead('Lighter week. Two short nights and a sore Thursday.', 'sentence'), { lead: 'Lighter week.', rest: 'Two short nights and a sore Thursday.' })
  assert.deepEqual(splitLead('Strength C eased: one set, 10% lighter.', 'colon'), { lead: 'Strength C eased', rest: ': one set, 10% lighter.' })
  assert.deepEqual(splitLead('No colon here.', 'colon'), { lead: 'No colon here.', rest: '' })
  assert.equal(shortWhy('Lighter week. Two short nights and a sore Thursday, so strength holds at 2×8 and runs stay easy.'), 'Lighter week. Two short nights and a sore Thursday.')
  assert.equal(shortWhy('9 of 10 done, check-ins on trend. The plan moves on. Wave ends this week.'), '9 of 10 done, check-ins on trend. The plan moves on.')
  assert.equal(shortWhy(null), null)
})

console.log(`today.test: ${passed} passed`)

import assert from 'node:assert/strict'

import { cycleWeeks, dayStrip, readWeekAnalysis, splitWhy, weekDays, weekForDay, worldWeekPosts } from '../program/weekModel'
import {
  MINUS,
  askDay,
  askRequest,
  dayRowState,
  doneHeadline,
  missedAskChips,
  minutesLine,
  plannedRowMinutes,
  roundDiffLines,
  rowDetail,
  shortLift,
  strengthWeekLine,
  topLiftsLine,
  zone2PlanLine,
  runDiffLines,
  sessionDisplayName,
  strengthDiffLines,
  type AdjustmentLike,
  type DayBoardSession,
  type WorkoutExercise,
} from './rowState'

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000)
const MON = day('2025-10-13')
const THU = day('2025-10-16')
const SAT = day('2025-10-18')
const SUN = day('2025-10-19')

function base(over: Partial<DayBoardSession> = {}): DayBoardSession {
  return { id: 's1', type: 'strength', status: 'planned', timeSlot: 'am', label: 'Strength C', scheduledDate: SAT, ...over }
}

// ─── row state: status, swipe, slot ──
{
  const todo = dayRowState(base(), { planDetail: '2×8 RPE 6-7' })
  assert.equal(todo.status, 'todo')
  assert.equal(todo.variant, 'todo')
  assert.equal(todo.swipeable, true, 'a to-do swipes')
  assert.equal(todo.slot, 'am')
  assert.equal(todo.name, 'Strength C')
  assert.equal(todo.detail, '2×8 RPE 6-7')

  const live = dayRowState(base({ status: 'in_progress' }))
  assert.equal(live.status, 'todo')
  assert.equal(live.live, true)

  const done = dayRowState(base({ status: 'completed', durationSec: 52 * 60, rpe: 7, timeSlot: 'pm' }))
  assert.equal(done.status, 'done')
  assert.equal(done.swipeable, false, 'a done row never swipes')
  assert.equal(done.slot, 'pm')
  assert.equal(done.detail, '52 min', 'no plan line: the minutes it took')
  assert.equal(dayRowState(base({ status: 'completed', durationSec: 52 * 60, rpe: 7 }), { planDetail: '2×8 RPE 6-7' }).detail, '2×8 RPE 6-7', 'page 33: a done row keeps its plan line')

  const skipped = dayRowState(base({ status: 'skipped', skipReason: 'too_sore' }))
  assert.equal(skipped.variant, 'skipped')
  assert.equal(skipped.swipeable, false)
  assert.equal(skipped.detail, 'skipped: sore')

  const missed = dayRowState(base({ status: 'missed', scheduledDate: THU }))
  assert.equal(missed.variant, 'missed')
  assert.equal(missed.detail, 'missed Thursday')
  assert.equal(dayRowState(base({ timeSlot: null })).slot, 'am', 'no slot reads as AM')
}

// ─── names: the approved names ──
{
  assert.equal(sessionDisplayName({ type: 'mobility', label: 'Foundation' }), 'Foundation')
  assert.equal(sessionDisplayName({ type: 'active_recovery', label: null }), 'Reset')
  assert.equal(sessionDisplayName({ type: 'foundation_run', label: 'Run-Walk' }), 'Zone 2')
  assert.equal(sessionDisplayName({ type: 'running', notes: 'zone2' }), 'Zone 2')
  assert.equal(sessionDisplayName({ type: 'running', notes: 'progression', label: null }), 'Run')
  assert.equal(sessionDisplayName({ type: 'strength', label: null }), 'Strength')
  assert.equal(rowDetail({ id: 'x', type: 'foundation_run', status: 'planned', timeSlot: 'pm', label: 'Run-Walk' }, 'todo', { planDetail: '35 min' }), 'run-walk 35 min', 'page 33: a label that says more reads with the plan ("run-walk 30 min")')
}

// ─── changed rows: brass edge, "was X", one reason line ──
{
  const weekly = dayRowState(base(), {
    planDetail: '1×8 RPE 6',
    changes: [{ sessionId: 's1', reason: 'Eased: one set, 10% lighter. Soreness was 4 this morning.', was: '2×8', source: 'rules' }],
  })
  assert.equal(weekly.variant, 'changed')
  assert.equal(weekly.detail, '1×8 RPE 6 · was 2×8')
  assert.equal(weekly.reason, 'Eased: one set, 10% lighter. Soreness was 4 this morning.')
  assert.equal(weekly.swipeable, true, 'a changed row is still a to-do')

  const placement = dayRowState(base(), { changes: [{ sessionId: 's1', reason: 'moved', was: null, source: 'placement' }] })
  assert.equal(placement.variant, 'todo', 'placement shuffles are not coach changes')

  const auto: AdjustmentLike = { id: 'a1', adjustmentType: 'felt_hard', status: 'accepted', auto: 1, reason: 'Felt hard.', targetSessionId: 's1', detail: { note: 'Felt hard on Monday. One set less.', was: 'Planned sets and load' } }
  const eased = dayRowState(base(), { adjustments: [auto] })
  assert.equal(eased.reason, 'Felt hard on Monday. One set less.')
  assert.equal(eased.was, 'Planned sets and load')

  const moved = dayRowState(base({ adjustmentId: 'a2', contextJson: JSON.stringify({ movedFrom: { epochDay: THU, timeSlot: 'pm' } }) }), {
    adjustments: [{ id: 'a2', adjustmentType: 'skip_reschedule', status: 'accepted', reason: 'Moved to Saturday after a skip.' }],
  })
  assert.equal(moved.reason, 'Moved to Saturday after a skip.')
  assert.equal(moved.was, 'THU PM')

  const fitIn = dayRowState(base({ adjustmentId: 'a3' }), {
    adjustments: [{ id: 'a3', adjustmentType: 'missed_session', status: 'accepted', reason: 'x', detail: { missedDay: THU } }],
  })
  assert.equal(fitIn.reason, "Fit in after Thursday's was missed.")

  const doneChanged = dayRowState(base({ status: 'completed' }), { changes: [{ sessionId: 's1', reason: 'r', was: '2×8' }] })
  assert.equal(doneChanged.variant, 'done', 'a done row shows actuals, not the change')
  assert.equal(doneChanged.reason, null)
}

// ─── the missed-session ask: chips in the row ──
{
  const options = [
    { kind: 'drop' as const },
    { kind: 'move' as const, epochDay: SUN, date: '2025-10-19', timeSlot: 'am' as const },
    { kind: 'swap' as const, type: 'foundation_run', label: 'Walk', epochDay: SAT, timeSlot: 'pm' as const },
  ]
  const chips = missedAskChips(options)
  assert.deepEqual(chips.map(c => c.label), ['SUN AM', 'WALK SAT PM', 'DROP IT'], 'moves first, DROP IT last')
  assert.deepEqual(chips[0].request, { kind: 'accept', option: 1 }, 'the option index is the server index')
  assert.deepEqual(chips[1].request, { kind: 'accept', option: 2 })
  assert.deepEqual(chips[2].request, { kind: 'reject' }, 'drop it lets it go')
  assert.equal(chips[0].tone, 'gold')
  assert.equal(chips[2].tone, 'ink')
  assert.deepEqual(askRequest('adj', chips[0], '2025-10-18'), { path: '/api/adjustments/adj/accept', body: { option: 1, today: '2025-10-18' } })
  assert.deepEqual(askRequest('adj', chips[2], '2025-10-18'), { path: '/api/adjustments/adj/reject', body: null })
  assert.deepEqual(missedAskChips([]).map(c => c.label), ['DROP IT'])

  const s = base({ status: 'missed', scheduledDate: THU, label: 'Strength B' })
  const row = dayRowState(s, { adjustments: [{ id: 'q1', adjustmentType: 'missed_session', status: 'proposed', reason: 'x', targetSessionId: 's1', options }] })
  assert.equal(row.variant, 'ask')
  assert.equal(row.ask?.question, "You missed Thursday's Strength B. Fit it in?")
  assert.equal(row.ask?.chips.length, 3)
  assert.equal(row.swipeable, false)
  const answered = dayRowState(s, { adjustments: [{ id: 'q1', adjustmentType: 'missed_session', status: 'rejected', reason: 'x', targetSessionId: 's1', options }] })
  assert.equal(answered.ask, null, 'an answered ask is gone')

  const days = weekDays(MON)
  assert.equal(askDay(s, SAT, days), SAT, 'asks sit on today when today is in the week')
  assert.equal(askDay(s, SAT + 7, days), THU, 'otherwise on the missed day')
}

// ─── done strength: bands, lifted values, chips ──
{
  const set = (n: number, w: number, r: number, pw: number, pr: number, done = true) => ({ setNumber: n, weightKg: w, reps: r, plannedWeightKg: pw, plannedReps: pr, isWarmup: 0, completedAt: done ? 1 : null })
  const exs: WorkoutExercise[] = [
    { exerciseId: 'sq', section: 'main', exercise: { name: 'Front Squat' }, sets: [set(1, 63.5, 8, 61.2, 8), set(2, 63.5, 8, 61.2, 8)] },
    { exerciseId: 'rdl', section: 'main', exercise: { name: 'RDL' }, sets: [set(1, 52.2, 7, 52.2, 8), set(2, 52.2, 8, 52.2, 8)] },
    { exerciseId: 'ss', section: 'accessory', exercise: { name: 'Split Squat' }, sets: [set(1, 11.3, 10, 11.3, 10), set(2, 11.3, 10, 11.3, 10)] },
    { exerciseId: 'db', section: 'core', exercise: { name: 'Dead Bug' }, sets: [set(1, 0, 10, 0, 10), set(2, 0, 10, 0, 10, false)] },
    { exerciseId: 'wu', section: 'warmup', exercise: { name: 'Warm-up' }, sets: [set(1, 20, 5, 20, 5)] },
  ]
  const lines = strengthDiffLines(exs)
  assert.equal(lines.length, 4, 'warm-ups are left out')
  const [sq, rdl, ss, db] = lines
  assert.equal(sq.label, 'FRONT SQUAT')
  assert.equal(sq.band, 'up')
  assert.equal(sq.chip, '+5', 'load up in lbs')
  assert.deepEqual(sq.parts.filter(p => p.lifted).map(p => p.text), ['140'], 'the load is lifted')
  assert.equal(rdl.band, 'down')
  assert.equal(rdl.chip, `${MINUS}1 rep`)
  assert.deepEqual(rdl.parts.filter(p => p.lifted).map(p => p.text), ['2×7'])
  assert.equal(ss.band, null, 'as planned stays plain')
  assert.equal(ss.chip, null)
  assert.equal(ss.parts.some(p => p.lifted), false)
  assert.equal(db.band, 'down')
  assert.equal(db.chip, `${MINUS}1 set`)
  assert.equal(db.parts.map(p => p.text).join(''), '1×10 · BW')

  const notLogged = strengthDiffLines([{ exerciseId: 'x', section: 'main', exercise: { name: 'Bench' }, sets: [set(1, 50, 5, 50, 5, false)] }])
  assert.equal(notLogged[0].band, null, 'no logged sets: shown as planned, unbanded')
  assert.equal(notLogged[0].parts[0].text, '1×5 · 110')
}

// ─── headline and minutes ──
{
  const h = doneHeadline(52, 45, { rpe: 7 })
  assert.equal(h.chip, '+7 min')
  assert.equal(h.band, 'up')
  assert.equal(h.parts.map(p => p.text).join(''), 'Done · 52 min · RPE 7')
  assert.equal(doneHeadline(46, 45).chip, null, 'within a minute is as planned')
  assert.equal(doneHeadline(40, 45).chip, `${MINUS}5 min`)
  assert.equal(doneHeadline(40, 45).band, 'down')
  assert.equal(doneHeadline(null, 45).parts.map(p => p.text).join(''), 'Done')
  assert.equal(doneHeadline(32, 30, { from: 'Strava' }).parts.map(p => p.text).join(''), 'Done · 32 min · from Strava')
  assert.equal(minutesLine('CLASS', 67, 60)?.chip, '+7 min')
  assert.equal(minutesLine('CLASS', 60, 60)?.band, null)
  assert.equal(minutesLine('CLASS', null, 60), null)
}

// ─── done run: HR over the Zone 2 cap is the miss ──
{
  const lines = runDiffLines({ distanceKm: 4.6, paceSecKm: 418, avgHr: 146, maxHr: 158 }, { targetDistKm: 4.3, z2CeilingBpm: 142 }, { zone2: true })
  assert.deepEqual(lines.map(l => l.label), ['DISTANCE', 'PACE', 'AVG HR', 'MAX HR'])
  assert.equal(lines[0].chip, '+0.3 km')
  assert.equal(lines[0].band, 'up')
  assert.equal(lines[1].parts[0].text, '6:58 /km')
  assert.equal(lines[1].band, null, 'pace is plain')
  assert.equal(lines[2].chip, '+4 over cap')
  assert.equal(lines[2].band, 'down', 'over the cap counts as a miss')
  assert.equal(lines[3].band, null)
  const under = runDiffLines({ avgHr: 138 }, { z2CeilingBpm: 142 }, { zone2: true })
  assert.equal(under[0].band, null)
  const hard = runDiffLines({ avgHr: 165 }, { z2CeilingBpm: 142 }, { zone2: false })
  assert.equal(hard[0].band, null, 'no cap on a hard run')
}

// ─── the Program week: tiles, posts, days ──
{
  assert.deepEqual(cycleWeeks(3, 6, 'block_zero'), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(cycleWeeks(7, 7, 'block_zero'), [2, 3, 4, 5, 6, 7], 'six weeks around the viewed one')
  assert.deepEqual(cycleWeeks(8, 12, 'fighter'), [7, 8, 9, 10, 11, 12], 'the 6-week cycle')
  assert.deepEqual(cycleWeeks(2, 12, 'fighter'), [1, 2, 3, 4, 5, 6])

  const posts = worldWeekPosts([1, 2, 3, 4, 5, 6], 3, new Map([[1, 9], [2, 14], [3, 5]]))
  assert.deepEqual(posts.map(p => p.state), ['done', 'done', 'now', 'todo', 'todo', 'todo'])
  assert.deepEqual(posts.map(p => p.notches), [9, 10, 5, 0, 0, 0], 'notches cap at 10')

  const days = weekDays(MON)
  assert.equal(days.length, 7)
  assert.equal(days[0], MON)
  const strip = dayStrip(days, [
    { id: 'a', type: 'mobility', status: 'completed', timeSlot: 'am', scheduledDate: MON },
    { id: 'b', type: 'strength', status: 'skipped', timeSlot: 'am', scheduledDate: MON },
    { id: 'c', type: 'foundation_run', status: 'planned', timeSlot: 'pm', scheduledDate: MON + 1 },
  ], MON + 1)
  assert.equal(strip[0].letter, 'M')
  assert.equal(strip[0].date, 13)
  assert.deepEqual(strip[0].icons.map(i => i.state), ['done', 'skipped'])
  assert.equal(strip[1].today, true)
  assert.equal(strip[6].letter, 'S')

  assert.equal(weekForDay(SAT, SAT, 3, 6), 3, 'today is the current week')
  assert.equal(weekForDay(SAT + 7, SAT, 3, 6), 4)
  assert.equal(weekForDay(SAT - 21, SAT, 3, 6), 1, 'clamped to the block')
}


// ─── the week's read: why line and changes ──
{
  const r = readWeekAnalysis(JSON.stringify({ version: 2, why: 'Lighter this week. Two short nights.', changes: [{ sessionId: 's1', reason: 'Eased.', was: '2×8', now: '1×8', source: 'rules' }, { sessionId: null, reason: 7 }] }))
  assert.equal(r.why, 'Lighter this week. Two short nights.')
  assert.equal(r.changes.length, 1)
  assert.equal(r.changes[0].was, '2×8')
  assert.equal(readWeekAnalysis(null, 'From the column.').why, 'From the column.')
  assert.equal(readWeekAnalysis(JSON.stringify({ summary: 'Old rules read.' })).why, 'Old rules read.')
  assert.equal(readWeekAnalysis('not json').why, null)
  assert.deepEqual(splitWhy('Lighter this week. Two short nights.'), { lead: 'Lighter this week.', rest: 'Two short nights.' })
  assert.deepEqual(splitWhy('One line'), { lead: '', rest: 'One line' })
}

// Page 20 / 33 / 35 lines and chips (step 2 fixes)
{
  assert.equal(strengthWeekLine('block_zero', 3), 'Week 3: two sets of eight, about three left in the tank.', 'page 33 to-do strength line')
  assert.equal(strengthWeekLine('fighter', 3), null)
  assert.equal(shortLift('Front Squat'), 'Front squat')
  assert.equal(shortLift('Romanian Deadlift'), 'RDL')
  const lifts: WorkoutExercise[] = [
    { exerciseId: 'sq', section: 'main', name: 'Front Squat', prescription: { prescribedWeightKg: 61.2, setsReps: '2×8' } },
    { exerciseId: 'rdl', section: 'main', name: 'Romanian Deadlift', prescription: { prescribedWeightKg: 52.2, setsReps: '2×8' } },
    { exerciseId: 'ss', section: 'accessory', name: 'Split Squat', prescription: { prescribedWeightKg: 11.3, setsReps: '2×10' } },
  ]
  assert.equal(topLiftsLine(lifts), 'Front squat 2×135lbs · RDL 2×115lbs', 'page 20 top lifts on Today')
  assert.equal(topLiftsLine([]), null)
  assert.equal(zone2PlanLine('Run-walk', 142, 35), 'Easy, conversational pace. Heart rate under 142, nasal breathing. Run-walk, 35 min.', 'page 33 Zone 2 line')
  const sat = 20379 // a Saturday (2025-10-18)
  const bz = plannedRowMinutes({ type: 'strength', label: 'Strength C', scheduledDate: sat, blockWeek: 3, blockType: 'block_zero', notes: null })
  assert.ok(bz >= 30 && bz <= 75, `strength row minutes from its template: ${bz}`)
  assert.equal(plannedRowMinutes({ type: 'mobility', label: 'Foundation', scheduledDate: sat, blockWeek: 3, blockType: 'block_zero', notes: null }), 12)
  // done headline: Today says "effort 7" (page 35), Program "RPE 7" (page 33)
  assert.equal(doneHeadline(52, 45, { rpe: 7, effortWord: 'effort' }).parts.map(p => p.text).join(''), 'Done · 52 min · effort 7')
  assert.equal(doneHeadline(52, 45, { rpe: 7 }).chip, '+7 min')
  // bag work / rope: one line per round, clay where a round ended early, and the rounds short of the plan
  const rounds = roundDiffLines([180, 180, 130], [180, 180, 180, 180])
  assert.deepEqual(rounds.map(l => [l.label, l.parts.map(p => p.text).join(''), l.chip, l.band]), [
    ['ROUNDS', '3 of 4', `${MINUS}1`, 'down'],
    ['ROUND 1', '3:00', null, null],
    ['ROUND 2', '3:00', null, null],
    ['ROUND 3', '2:10', `${MINUS}0:50`, 'down'],
  ])
  assert.deepEqual(roundDiffLines([178], [180]).map(l => l.band), [null], 'within 10 s is as planned')
}

console.log('dayboard tests passed')

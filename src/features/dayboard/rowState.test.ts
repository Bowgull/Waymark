import { getWeekLabel } from '../../lib/strengthTemplates'
import assert from 'node:assert/strict'
import { doseJsonMinutes } from '../../lib/brain/doseMinutes'

import { cycleWeeks, dayStrip, readWeekAnalysis, splitWhy, weekDays, weekForDay, worldWeekPosts } from '../program/weekModel'
import {
  MINUS,
  dayRowState,
  doneHeadline,
  minutesLine,
  plannedRowMinutes,
  roundDiffLines,
  rowDetail,
  runWalkDetail,
  shortLift,
  strengthWeekLine,
  strengthPlanDetail,
  zone2PlanLine,
  runDiffLines,
  sessionDisplayName,
  slotRows,
  NO_ROW_SLOTS,
  strengthDiffLines,
  liftLoad,
  planLiftLine,
  type DayBoardSession,
  type WorkoutExercise,
} from './rowState'

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000)
const MON = day('2025-10-13')
const THU = day('2025-10-16')
const SAT = day('2025-10-18')

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
  assert.equal(sessionDisplayName({ type: 'foundation_run', label: null }), 'Zone 2', 'an unlabelled easy run is Zone 2')
  assert.equal(sessionDisplayName({ type: 'running', notes: 'zone2' }), 'Zone 2')
  assert.equal(sessionDisplayName({ type: 'running', notes: 'progression', label: null }), 'Run')
  assert.equal(sessionDisplayName({ type: 'strength', label: null }), 'Strength')
  assert.equal(sessionDisplayName({ type: 'foundation_run', label: 'Run-Walk' }), 'Run-Walk', 'page 56: the run-walk reads RUN-WALK')
  assert.equal(rowDetail({ id: 'x', type: 'foundation_run', status: 'planned', timeSlot: 'pm', label: 'Run-Walk' }, 'todo', { planDetail: '35 min' }), '35 min', 'its name already says run-walk')
}

// ─── changed rows: the small rune by the detail (page 56 item 7) ──
{
  const changed = dayRowState(base(), { planDetail: '2×8 RPE 7-8', rune: 'new' })
  assert.equal(changed.rune, 'new', 'a row the coach changed carries the rune')
  assert.equal(changed.detail, '2×8 RPE 7-8', 'no "was X" any more: the day\'s back says it')
  assert.equal(changed.variant, 'todo', 'no brass edge variant: the rune replaces it')
  assert.equal(changed.swipeable, true, 'a changed row is still a to-do')
  assert.equal(dayRowState(base({ status: 'completed' }), { rune: 'seen' }).rune, 'seen', 'a done row keeps its dim rune')
  assert.equal(dayRowState(base({ status: 'skipped' }), { rune: 'seen' }).rune, null, 'a skipped row shows none')
  assert.equal(dayRowState(base({ status: 'missed' }), { rune: 'miss' }).rune, 'miss', 'a missed session: Algiz')
  assert.equal(dayRowState(base()).rune, null)
}

// ─── Program's run-walk detail (page 56): rounds, intervals, minutes ──
{
  assert.equal(runWalkDetail({ contextJson: null }, 4), '5 rounds · run 3:30, walk 1:00 · 28 min')
  assert.equal(runWalkDetail({ contextJson: JSON.stringify({ coachEase: { kind: 'rounds', rounds: 4, reason: 'x' } }) }, 4), '4 rounds · run 3:30, walk 1:00 · 23 min', 'the coach\'s rounds')
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

  // A work-up (goblet squat 20 → 25 → 30 → 35): stopped at 25, no "−10" against a top he was never meant to force.
  const L = (lb: number) => lb / 2.20462
  const gs: WorkoutExercise = { exerciseId: 'gs', section: 'main', exercise: { name: 'Goblet Squat', equipment: 'dumbbell' }, sets: [set(1, L(20), 8, L(20), 8), set(2, L(25), 8, L(25), 8), set(3, L(25), 8, L(30), 8), set(4, L(25), 8, L(35), 8)] }
  const [stopped] = strengthDiffLines([gs])
  assert.equal(stopped.parts.map(p => p.text).join(''), '4×8 · 25')
  assert.deepEqual([stopped.band, stopped.chip], [null, null], 'stopping in a work-up is the plan, not a miss')
  const [todoGs] = strengthDiffLines([{ ...gs, sets: gs.sets!.map(x => ({ ...x, completedAt: null })) }])
  assert.equal(todoGs.parts[0].text, '4×8 · 20→35', 'not started: the ladder, first set to top')
  // A dumbbell row nothing was logged on yet, no weight: not BW.
  const [row] = strengthDiffLines([{ exerciseId: 'row', section: 'accessory', exercise: { name: 'Dumbbell Row', equipment: 'dumbbell,bench' }, sets: [set(1, 0, 10, 0, 10, false)] }])
  assert.equal(row.parts[0].text, '1×10 · find your weight')
}

// ─── to-do lift lines: one weight per lift ──
{
  const ex = (equipment: string | null, kg: number | null, fromKg: number | null = null): WorkoutExercise => ({ exerciseId: 'x', section: 'accessory', name: 'Lift', equipment, prescription: { prescribedWeightKg: kg, fromWeightKg: fromKg, setsReps: '4×8' } })
  assert.equal(liftLoad(ex('dumbbell', 35 / 2.20462, 20 / 2.20462)), '20→35', 'Goblet Squat 4×8 · 20→35 lb')
  assert.equal(liftLoad(ex('dumbbell,bench', null)), 'find your weight', 'Dumbbell Row with no weight: not BW')
  assert.equal(liftLoad(ex('cable,band', null)), 'find your weight', 'Face Pulls with no weight: not BW')
  assert.equal(liftLoad(ex('bodyweight', null)), 'BW', 'a bodyweight move')
  assert.equal(liftLoad(ex('bodyweight,dumbbell', null)), 'BW', 'calf raise at bodyweight')
  assert.equal(planLiftLine(ex('dumbbell', 35 / 2.20462, 20 / 2.20462)).parts[0].text, '4×8 · 20→35')
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
  // E2E minor 13: an eased session reads one set fewer; week 6's header is 1×8.
  assert.equal(strengthWeekLine('block_zero', 2, true), 'Week 2: one set of eight, about four left in the tank.')
  assert.equal(strengthPlanDetail('2×8, RPE 6-7', JSON.stringify({ coachEase: { kind: 'one_set', reason: 'x' } })), '1×8, RPE 6-7')
  assert.equal(strengthPlanDetail('2×8, RPE 6-7', JSON.stringify({ coachEase: { kind: 'reduce', reason: 'x' } })), '1×8, RPE 6-7')
  assert.equal(strengthPlanDetail('2×8, RPE 6-7', null), '2×8, RPE 6-7')
  assert.equal(strengthPlanDetail('1×8, RPE 7', JSON.stringify({ coachEase: { kind: 'one_set' } })), '1×8, RPE 7', 'never below one set')
  assert.equal(getWeekLabel(6, 'block_zero'), 'Block Zero · 1×8, RPE 7', 'week 6 is one set of 8 (the check set is apart)')
  assert.equal(getWeekLabel(2, 'block_zero'), 'Block Zero · 2×8, RPE 6-7')
  assert.equal(shortLift('Front Squat'), 'Front squat')
  assert.equal(shortLift('Romanian Deadlift'), 'RDL')
  assert.equal(shortLift('Bench Press'), 'Bench press', 'm14: one case for every lift')
  assert.equal(shortLift('DB Bench Press'), 'DB bench press')
  assert.equal(zone2PlanLine('Run-walk', 142, 35), 'Easy, conversational pace. Heart rate under 142, nasal breathing. Run-walk, 35 min.', 'page 33 Zone 2 line')
  const sat = 20379 // a Saturday (2025-10-18)
  const bz = plannedRowMinutes({ type: 'strength', label: 'Strength C', scheduledDate: sat, blockWeek: 3, blockType: 'block_zero', notes: null })
  assert.ok(bz >= 30 && bz <= 90, `strength row minutes from its template: ${bz}`)
  // m6 / X5 (E2E 2026-10-19b): sets count. Week 4 Strength B (Wed 21 Oct 2026) reads ~60 at 3x8, less when eased to 2x8.
  const wedB = { type: 'strength', label: 'Strength B', scheduledDate: 20747, blockWeek: 4, blockType: 'block_zero', notes: null }
  assert.equal(plannedRowMinutes(wedB), 60, 'X5: Strength B at 3x8 is ~60 min')
  assert.ok(plannedRowMinutes({ ...wedB, contextJson: '{"coachEase":{"kind":"one_set"}}' }) < 60, 'm6: one set fewer, fewer minutes')
  // Rebuild Phase 4: the lifts no longer change by week (the dose sets the sets), and every row is 60 or less.
  assert.equal(plannedRowMinutes({ ...wedB, blockWeek: 1 }), plannedRowMinutes(wedB), 'the same plan in week 1 and week 4')
  // Audit #24: Foundation's own routine for its level (week 3: level 2, about 16 min), not a flat 12.
  assert.equal(plannedRowMinutes({ type: 'mobility', label: 'Foundation', scheduledDate: sat, blockWeek: 3, blockType: 'block_zero', notes: null }), 16)
  // Page 73 (approved 2026-10-22): a row with the brain's dose reads the dose's minutes, the same the coach picks' preview shows.
  assert.equal(plannedRowMinutes({ type: 'foundation_run', label: 'Run-walk', scheduledDate: sat, blockWeek: 3, blockType: 'block_zero', notes: null, doseJson: JSON.stringify({ run: { totalSec: 26 * 60, runSec: 90, walkSec: 60, rounds: 8, walkOnly: false } }) }), 33, 'run row: the dose total with the ~6.5 min run-walk warm-up (audit #24)')
  assert.equal(plannedRowMinutes({ type: 'bag_work', label: 'Bag Work', scheduledDate: sat, blockWeek: 3, blockType: 'block_zero', notes: null, doseJson: JSON.stringify({ bag: { rounds: 5 } }) }), 29, 'bag row: the 5 min rope warm-up, the dose rounds, the rests, and the finisher after the last rest (audit #23, page 86; page 93 adds the rear teep)')
  const strengthDoseRow = { ...wedB, doseJson: JSON.stringify({ strength: { kind: 'strength', level: 'HOLD', accessorySets: null, holdSets: 2, sets: 2, why: [], lifts: [{ exerciseId: 'a', label: 'DB RDL', slot: null, sets: 2, reps: 8, targetRir: 3, weightKg: 14, workUp: false, change: 'hold', fromKg: 14, level: 'HOLD', u: 0 }] } }) }
  const fromDose = doseJsonMinutes(strengthDoseRow)
  assert.ok(fromDose != null && fromDose > 0, `strength dose minutes: ${fromDose}`)
  assert.equal(plannedRowMinutes(strengthDoseRow), fromDose, 'strength row: the dose minutes, not the template estimate')
  assert.equal(plannedRowMinutes({ ...wedB, doseJson: 'not json' }), 60, 'a bad dose falls back to the template')
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

{
  // Page 73: a swap, its undo or redo keeps the row (its name flips); rows keep their places.
  type R = { id: string; contextJson?: string | null }
  const swapOf = (id: string, orig: string): R => ({ id, contextJson: JSON.stringify({ replaced: { originalSessionId: orig } }) })
  const keys = (out: ReturnType<typeof slotRows<R>>) => out.list.map(s => `${s.id}=${out.keyOf(s)}`)
  const first = slotRows<R>([{ id: 'a' }, { id: 'x' }], NO_ROW_SLOTS)
  assert.deepEqual(keys(first), ['a=a', 'x=x'], 'first draw: own keys, list order')
  // A replaced by B: B lands at the end of the list, but takes A's row and place.
  const swapped = slotRows<R>([{ id: 'x' }, swapOf('b', 'a')], first.next)
  assert.deepEqual(keys(swapped), ['b=a', 'x=x'], 'the replacement takes its original row')
  // B replaced by C: still the first row.
  const again = slotRows<R>([{ id: 'x' }, swapOf('c', 'b')], swapped.next)
  assert.deepEqual(keys(again), ['c=a', 'x=x'], 'a swap of a swap keeps the row')
  // UNDO: B comes back into the same row; then A.
  const undone = slotRows<R>([{ id: 'x' }, swapOf('b', 'a')], again.next)
  assert.deepEqual(keys(undone), ['b=a', 'x=x'], 'undo keeps the row')
  const back = slotRows<R>([{ id: 'x' }, { id: 'a' }], undone.next)
  assert.deepEqual(keys(back), ['a=a', 'x=x'], 'the original back in its row')
  // An ADD is a new row where the list puts it; a removal just goes.
  const added = slotRows<R>([{ id: 'a' }, { id: 'n' }, { id: 'x' }], back.next)
  assert.deepEqual(keys(added), ['a=a', 'n=n', 'x=x'], 'an added row is its own, in the list order')
  assert.deepEqual(keys(slotRows<R>([{ id: 'x' }], added.next)), ['x=x'], 'a removed row goes')
  // Opened on a swap already made: the replacement keys by its original; UNDO keeps it.
  const cold = slotRows<R>([swapOf('c', 'b')], NO_ROW_SLOTS)
  assert.deepEqual(keys(cold), ['c=b'])
  assert.deepEqual(keys(slotRows<R>([swapOf('b', 'a')], cold.next)), ['b=b'], 'undo on a fresh board keeps the row')
  // Both on the board at once: no shared key.
  const both = slotRows<R>([{ id: 'a' }, swapOf('b', 'a')], first.next)
  assert.deepEqual(keys(both), ['a=a', 'b=b'], 'two rows never share a key')
}

console.log('dayboard tests passed')

// Page 80: a Custom bag session's row minutes are his own rounds, length and rest (+ the 5-min rope warm-up).
{
  const custom = plannedRowMinutes({ type: 'bag_work', notes: null, label: 'Bag Work', scheduledDate: 20750, blockWeek: 1, blockType: 'block_zero', contextJson: JSON.stringify({ bag: { mode: 'custom', rounds: 4, roundSec: 120, restSec: 60, picked: {} } }), doseJson: null })
  assert.equal(custom, 16, '4 × 2 min + 3 × 1 min rest + 5 min warm-up')
  console.log('ok: a Custom bag row counts his own rounds')
}

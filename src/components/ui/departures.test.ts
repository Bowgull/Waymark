import assert from 'node:assert/strict'

import { allBoardRows, boardSuggestions, computeSuggestions } from '../../lib/sessionSuggestions'
import { TRAINING_TARGETS } from '../../lib/trainingTargets'
import {
  buildDepartures,
  flipSlot,
  pickerOptions,
  REPLACE_REASONS,
  selectionFor,
  SKIP_PLACES,
  SKIP_REASONS,
  toggleTile,
  pmOnlyFor,
  replaceKeeps,
} from './departures'

const base = pickerOptions(TRAINING_TARGETS)

// ─── MT Class is a row like any session (page 56 item 15) ──
{
  assert.ok(base.some(o => o.type === 'mt_class'), 'MT Class is a picker option')
  assert.equal(base.length, TRAINING_TARGETS.length)
  const board = buildDepartures(base, null)
  assert.equal(board.rest.find(r => r.type === 'mt_class')!.icon, 'mt', 'MT Class carries the glove')
}

// ─── no suggestions: every option, plain ──
{
  const board = buildDepartures(base, null)
  assert.equal(board.picks.length, 0)
  assert.equal(board.rest.length, base.length)
  assert.ok(board.rest.every(r => r.tone === 'plain' && r.reason === null))
  assert.equal(board.rest.find(r => r.type === 'foundation_run')!.icon, 'zone2', 'the easy run gets the dial')
  assert.equal(board.rest.find(r => r.runCategory === 'progression')!.icon, 'run', 'progression gets the shoe')
  assert.equal(board.rest.find(r => r.type === 'mobility')!.icon, 'foundation')
}

// ─── sore and under-slept: picks lantern-lit, everything else plain and pickable ──
{
  const s = computeSuggestions({
    todayWellness: { sleepHours: 5, soreness: 4, herbScale: null, alcoholScale: null },
    recentWellness: null, weekSessions: [], blockWeek: 1, targetDate: 20592, existingSessionsOnDate: [],
  })
  const board = buildDepartures(base, s)
  assert.ok(board.picks.length > 0 && board.picks.every(r => r.tone === 'pick' && r.reason != null), 'coach picks carry their reason')
  assert.ok(board.rest.every(r => r.tone === 'plain' && r.reason === null), 'nothing ember, no preview lines (page 56)')
  assert.equal(board.picks.length + board.rest.length, base.length, 'every session is on the board once')
  assert.ok(!('blocked' in (board.rest[0] as object)), 'no row is blocked')
  assert.ok(board.labelLen <= 15 && board.labelLen > 0)
}

// ─── the Replace board drops its own type ──
{
  const board = buildDepartures(base.filter(o => o.type !== 'foundation_run'), null)
  assert.ok(![...board.picks, ...board.rest].some(r => r.type === 'foundation_run'))
}

// ─── the slot: default from the suggestion, flips, fixed sessions keep theirs ──
{
  const board = buildDepartures(base, null)
  const reset = board.rest.find(r => r.type === 'active_recovery')!
  assert.equal(reset.timeSlot, 'pm', 'default slot')
  assert.equal(flipSlot('am'), 'pm')
  assert.equal(flipSlot('pm'), 'am')
  assert.deepEqual(selectionFor(reset, 'am'), { type: 'active_recovery', label: 'Reset', timeSlot: 'am', runCategory: undefined })
  const foundation = board.rest.find(r => r.type === 'mobility')!
  assert.equal(foundation.flexibleTimeSlot, false)
  assert.equal(selectionFor(foundation, 'pm').timeSlot, 'am', 'a fixed-slot session keeps its slot')
  const prog = board.rest.find(r => r.runCategory === 'progression')!
  assert.equal(selectionFor(prog, 'pm').runCategory, 'progression', 'runCategory travels with the pick')
}

// ─── reason tiles (page 56 items 1-3) ──
{
  assert.deepEqual(REPLACE_REASONS.map(r => r.label), ['ROUGH DAY', 'TOO SORE', 'LOW ON SLEEP', 'SHORT ON TIME', 'NOT FEELING IT', 'BODY SIGNAL', 'CHANGING IT UP'])
  assert.deepEqual(SKIP_REASONS.map(r => r.label), ['ROUGH DAY', 'SORE', 'TIRED', 'INJURY / PAIN', 'TIME', 'SICK', 'LOW MOTIVATION', 'OTHER'])
  assert.equal(REPLACE_REASONS[0].value, 'rough_day')
  assert.equal(SKIP_REASONS[0].value, 'rough_day')
  assert.deepEqual(SKIP_REASONS.slice(1).map(r => r.value), ['too_sore', 'tired', 'injury', 'schedule', 'sick', 'low_drive', 'other'], 'the codes the server receives are unchanged')
  assert.deepEqual(SKIP_PLACES, ['Lower back', 'Knee', 'Hip', 'Shoulder', 'Ankle', 'Neck', 'Other'])
  assert.equal(toggleTile(null, 'rough_day'), 'rough_day', 'one tap lights a tile')
  assert.equal(toggleTile('rough_day', 'rough_day'), null, 'tap again to clear')
  assert.equal(toggleTile('rough_day', 'tired'), 'tired', 'one tile at a time')
}

// ─── M3, X1, X2 (E2E 2026-10-19b): the evening board, page 56 1B and 4A ───
{
  const base = pickerOptions(TRAINING_TARGETS)
  const names = (rows: Array<{ label: string }>) => rows.map(r => r.label.toUpperCase())
  const wrap = (suggestions: ReturnType<typeof boardSuggestions>) => ({ suggestions, wellness: { avgSleep: null, avgSoreness: null, todaySoreness: null, todaySleep: null }, flags: [], deficits: [] })

  // 1B: Tue 6:10 PM, replacing the run-walk (Foundation done this morning).
  const runWalk = { type: 'foundation_run', label: 'Run-Walk', notes: null }
  const repl = buildDepartures(base.filter(o => replaceKeeps(runWalk, o)), wrap(boardSuggestions(allBoardRows(), { mode: 'replace', replacing: 'foundation_run', dayTypes: ['mobility', 'foundation_run'] })), { pmOnly: pmOnlyFor('2026-10-20', '2026-10-20', 18) })
  assert.deepEqual(names(repl.picks), ['SKIP ROPE', 'RESET'], 'X1: coach picks Skip Rope, Reset')
  assert.deepEqual(repl.picks.map(r => r.reason), ["The run-walk's own swap", 'Easy, 20 min'])
  assert.deepEqual(names(repl.rest), ['BAG WORK', 'MT CLASS', 'STRENGTH', 'ZONE 2', 'PROGRESSION RUN', 'FOUNDATION'], 'X1: the rest in the mockup order, Zone 2 included')
  assert.ok([...repl.picks, ...repl.rest].every(r => r.timeSlot === 'pm'), 'M3: every row is PM in the evening')
  const bag = repl.rest.find(r => r.type === 'bag_work')!
  assert.equal(selectionFor(bag, bag.timeSlot).timeSlot, 'pm', 'M3: a 6:10 PM swap to Bag Work lands in PM')

  // 4A: Thu 6:30 PM + add session; Foundation, run-walk and bag are done.
  const add = buildDepartures(base, wrap(boardSuggestions(allBoardRows(), { mode: 'add', dayTypes: ['mobility', 'foundation_run', 'bag_work'] })), { pmOnly: true })
  assert.deepEqual(names(add.picks), ['RESET', 'FOUNDATION'], 'X2: coach picks Reset, Foundation')
  assert.deepEqual(add.picks.map(r => r.reason), ['Easy, 20 min', 'A second round, 12 min'])
  assert.deepEqual(names(add.rest), ['SKIP ROPE', 'MT CLASS', 'STRENGTH', 'BAG WORK', 'ZONE 2', 'PROGRESSION RUN'], 'X2: the rest in the mockup order')
  assert.ok([...add.picks, ...add.rest].every(r => r.timeSlot === 'pm'), 'X2: all PM')

  // The morning keeps each row's own slot.
  assert.equal(pmOnlyFor('2026-10-20', '2026-10-20', 9), false)
  assert.equal(pmOnlyFor('2026-10-21', '2026-10-20', 18), false, 'another day keeps its own slots')

  // Decision b (Josh, 2026-10-19): a knee, ankle or shin flag -> REPLACE on a run offers Reset, not rope.
  const knee = boardSuggestions(allBoardRows(), { mode: 'replace', replacing: 'foundation_run', dayTypes: [], kneeSafe: true })
  const kneePicks = knee.filter(s => s.priority === 'suggested')
  assert.deepEqual(kneePicks.map(s => s.type), ['active_recovery'], 'b: the knee-safe pick is Reset, rope is not a pick')
}

console.log('departures tests passed')

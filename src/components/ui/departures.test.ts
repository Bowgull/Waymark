import assert from 'node:assert/strict'

import { computeSuggestions } from '../../lib/sessionSuggestions'
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
    todayWellness: { sleepHours: 5, soreness: 4, weedGrams: null, alcoholScale: null },
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

console.log('departures tests passed')

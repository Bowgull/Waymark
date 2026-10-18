import assert from 'node:assert/strict'

import { computeSuggestions, type SuggestionsResponse } from '../../lib/sessionSuggestions'
import { TRAINING_TARGETS } from '../../lib/trainingTargets'
import type { ReplaceSuggestion } from '../../lib/prompts/tools'
import {
  boardNumber,
  buildDepartures,
  flipSlot,
  pickerOptions,
  replaceCommit,
  REPLACE_REASONS,
  selectionFor,
  signpostRoads,
  skipCommit,
  skipNeedsWords,
  SKIP_PLACES,
  SKIP_REASONS,
} from './departures'

const base = pickerOptions(TRAINING_TARGETS)
const empty = { avgSleep: null, avgSoreness: null, todaySoreness: null, todaySleep: null }

// ─── MT Class stays out ──
{
  assert.ok(!base.some(o => o.type === 'mt_class'), 'MT Class is not a picker option')
  assert.equal(base.length, TRAINING_TARGETS.length - 1)
  const withMt: SuggestionsResponse = {
    suggestions: [{ type: 'mt_class', label: 'MT Class', timeSlot: 'pm', flexibleTimeSlot: false, reason: 'x', priority: 'suggested' }],
    wellness: empty, flags: [], deficits: [],
  }
  const board = buildDepartures([...base, { type: 'mt_class', label: 'MT Class', timeSlot: 'pm', flexibleTimeSlot: false }], withMt)
  assert.ok(![...board.picks, ...board.rest].some(r => r.type === 'mt_class'), 'never on the board, even if suggested')
}

// ─── no suggestions: every option, plain, no flags line ──
{
  const board = buildDepartures(base, null)
  assert.equal(board.picks.length, 0)
  assert.equal(board.rest.length, base.length)
  assert.ok(board.rest.every(r => r.tone === 'plain' && r.reason === null))
  assert.equal(board.flagsLine, null)
  const z2 = board.rest.find(r => r.type === 'foundation_run')!
  assert.equal(z2.icon, 'zone2', 'Zone 2 gets the dial')
  assert.equal(board.rest.find(r => r.runCategory === 'progression')!.icon, 'run', 'progression gets the shoe')
  assert.equal(board.rest.find(r => r.type === 'mobility')!.icon, 'foundation')
  assert.equal(buildDepartures(base, { suggestions: [], wellness: empty, flags: ['Sleep is low'], deficits: [] }).flagsLine, null, 'an empty list stays plain')
}

// ─── sore and under-slept: picks lantern-lit, cautions as embers ──
{
  const s = computeSuggestions({
    todayWellness: { sleepHours: 5, soreness: 4, weedGrams: null, alcoholScale: null },
    recentWellness: null, weekSessions: [], blockWeek: 1, targetDate: 20592, existingSessionsOnDate: [],
  })
  const board = buildDepartures(base, s)
  assert.equal(board.flagsLine, 'Soreness is high · Sleep is low')
  assert.ok(board.picks.length > 0)
  assert.ok(board.picks.every(r => r.tone === 'pick'))
  assert.deepEqual(board.picks.map(r => r.type).sort(), ['active_recovery', 'foundation_run', 'mobility'])
  assert.equal(board.picks.find(r => r.type === 'active_recovery')!.reason, 'Recovery. Soreness is elevated')
  const bag = board.rest.find(r => r.type === 'bag_work')!
  assert.equal(bag.tone, 'ember')
  assert.equal(bag.reason, 'High intensity while sore')
  const strength = board.rest.find(r => r.type === 'strength')!
  assert.equal(strength.tone, 'plain')
  assert.equal(strength.reason, null, 'a neutral row carries no reason')
  assert.equal(board.rest[board.rest.length - 1].tone, 'ember', 'cautions come last')
  assert.ok(board.labelLen <= 11 && board.labelLen > 0)
}

// ─── suggestions are filtered to the base list (Replace drops its own type) ──
{
  const s = computeSuggestions({
    todayWellness: { sleepHours: 5, soreness: 4, weedGrams: null, alcoholScale: null },
    recentWellness: null, weekSessions: [], blockWeek: 1, targetDate: 20592, existingSessionsOnDate: [],
  })
  const board = buildDepartures(base.filter(o => o.type !== 'active_recovery'), s)
  assert.ok(![...board.picks, ...board.rest].some(r => r.type === 'active_recovery'))
  const none = buildDepartures(base.filter(o => o.type === 'strength'), { ...s, suggestions: s.suggestions.filter(x => x.type !== 'strength') })
  assert.equal(none.rest.length, 1, 'nothing matched: fall back to the base list')
  assert.equal(none.rest[0].tone, 'plain')
  assert.equal(none.flagsLine, 'Soreness is high · Sleep is low', 'the fallback keeps the flags line')
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

// ─── signpost: only the top 3, the first lit ──
{
  const roads: ReplaceSuggestion[] = [
    { type: 'active_recovery', label: 'Reset', timeSlot: 'pm', estimatedMin: 20 },
    { type: 'mobility', label: 'Foundation', timeSlot: 'am', estimatedMin: 15 },
    { type: 'running', label: 'Zone 2', timeSlot: 'am', estimatedMin: 30, runCategory: 'zone2' },
    { type: 'running', label: 'Progression Run', timeSlot: 'am', estimatedMin: 35, runCategory: 'progression' },
  ]
  const post = signpostRoads(roads)
  assert.equal(post.length, 3)
  assert.deepEqual(post.map(r => r.lit), [true, false, false])
  assert.deepEqual(post.map(r => r.icon), ['reset', 'foundation', 'zone2'])
  assert.equal(post[2].suggestion.runCategory, 'zone2', 'the suggestion is passed whole (runCategory kept)')
  assert.deepEqual(signpostRoads(undefined), [])
  assert.equal(signpostRoads([{ type: 'mt_class', label: 'MT', timeSlot: 'pm', estimatedMin: 60 }, roads[0]])[0].icon, 'reset')
}

// ─── why skip: the exact codes the server receives ──
{
  assert.deepEqual(SKIP_REASONS.map(r => r.value), ['too_sore', 'tired', 'injury', 'schedule', 'sick', 'low_drive', 'other'])
  assert.deepEqual(SKIP_PLACES, ['Lower back', 'Knee', 'Hip', 'Shoulder', 'Ankle', 'Neck', 'Other'])
  assert.equal(skipCommit(null, null, ''), null)
  assert.deepEqual(skipCommit('tired', null, ''), { reason: 'tired', detail: null })
  assert.deepEqual(skipCommit('too_sore', null, 'ignored'), { reason: 'too_sore', detail: null })
  assert.equal(skipCommit('injury', null, ''), null, 'injury needs a place')
  assert.deepEqual(skipCommit('injury', 'Lower back', ''), { reason: 'injury', detail: 'Lower back' })
  assert.equal(skipCommit('injury', 'Other', '  '), null, 'Other place needs words')
  assert.deepEqual(skipCommit('injury', 'Other', ' left wrist '), { reason: 'injury', detail: 'left wrist' })
  assert.equal(skipCommit('other', null, ''), null, 'Other needs a few words')
  assert.deepEqual(skipCommit('other', null, 'flat tyre'), { reason: 'other', detail: 'flat tyre' })
  assert.ok(skipNeedsWords('other', null))
  assert.ok(skipNeedsWords('injury', 'Other'))
  assert.ok(!skipNeedsWords('injury', 'Knee'))
  assert.equal(boardNumber(0), '01')
  assert.equal(boardNumber(6), '07')
}

// ─── why swap: the label is sent, Changing it up is the fast path ──
{
  assert.deepEqual(REPLACE_REASONS.map(r => r.label), ['Too sore', 'Low on sleep', 'Short on time', 'Not feeling it', 'Body signal', 'Changing it up'])
  assert.deepEqual(replaceCommit('too_sore'), { reason: 'Too sore', fastPath: false })
  assert.deepEqual(replaceCommit('variety'), { reason: 'Changing it up', fastPath: true })
}

console.log('departures tests passed')

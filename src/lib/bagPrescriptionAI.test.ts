import assert from 'node:assert/strict'

import { MASTERY_MAX, distinctRounds, recentMtNoteLines, summarizeCombo } from './bagPrescriptionAI'

// Mastery is the sum of the last five 1-3 ratings: the AI is told /15, not /10.
assert.equal(MASTERY_MAX, 15)
const line = summarizeCombo({ id: 'c1', text: 'Jab, cross, low kick', tier: 'foundation', techniques: 'boxing,kicks', masteryScore: 12, isFavourite: 1, formTips: null })
assert.ok(line.includes('mastery 12/15'), line)
assert.ok(!line.includes('/10'))

// MT notes arrive newest first (the query orders by session date desc); the
// prompt keeps the five newest with content, in that order.
const rows = [
  { focusSkill: 'newest', weakness: null, concept: null, actionItems: null },
  { focusSkill: null, weakness: null, concept: null, actionItems: null },
  { focusSkill: 'second', weakness: 'guard', concept: null, actionItems: null },
  { focusSkill: 'third', weakness: null, concept: null, actionItems: null },
  { focusSkill: 'fourth', weakness: null, concept: null, actionItems: null },
  { focusSkill: 'fifth', weakness: null, concept: null, actionItems: null },
  { focusSkill: 'sixth (oldest)', weakness: null, concept: null, actionItems: null },
]
const notes = recentMtNoteLines(rows)
assert.equal(notes.length, 5)
assert.equal(notes[0], 'focus: newest')
assert.equal(notes[1], 'focus: second | weakness: guard')
assert.ok(!notes.some(n => n.includes('oldest')), 'the oldest falls off, not the newest')

// Page 80: a new combo is marked for the coach; no two rounds hold the same combos.
assert.ok(summarizeCombo({ id: 'c2', text: 'Jab, cross, switch kick', tier: 'weapons', techniques: 'boxing,kicks', masteryScore: 0, isFavourite: 0, formTips: null, isNew: true }).includes(' NEW]'))
const dr = distinctRounds([
  { roundNumber: 1, comboIds: ['a', 'b'] },
  { roundNumber: 2, comboIds: ['b', 'a'] },
  { roundNumber: 3, comboIds: ['c'] },
])
assert.deepEqual(dr, [{ roundNumber: 1, comboIds: ['a', 'b'] }, { roundNumber: 2, comboIds: ['c'] }])

console.log('bagPrescriptionAI tests passed')

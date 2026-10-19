import assert from 'node:assert/strict'

import {
  bagCount,
  bookPages,
  comboStrikes,
  currentTier,
  entryDateLine,
  entryParagraphs,
  equipmentName,
  exerciseCounts,
  GROUPS,
  isGroupKey,
  isMastered,
  masteryDots,
  matchCombo,
  matchEntry,
  muscleBadges,
  tierViews,
  type LibraryCombo,
  type LibraryJournalEntry,
} from './libraryModel'

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000)

// page 39: six groups in order, each with its approved icon (Core = kettlebell, Mobility = roller)
assert.deepEqual(GROUPS.map(g => g.name), ['STRENGTH', 'CORE', 'FOUNDATION', 'MOBILITY', 'BAGWORK', 'WAYBOOK'])
assert.deepEqual(GROUPS.map(g => g.icon), ['strength', 'core', 'foundation', 'mobility', 'bag', 'waybook'])
assert.equal(isGroupKey('posture'), true)
assert.equal(isGroupKey('history'), false)
assert.equal(isGroupKey(null), false)

// mastery A: five dots = score ÷ 3; Mastered at 9
assert.equal(masteryDots(12), 4)
assert.equal(masteryDots(15), 5)
assert.equal(masteryDots(9), 3)
assert.equal(masteryDots(2), 0)
assert.equal(masteryDots(99), 5)
assert.equal(masteryDots(-3), 0)
assert.equal(isMastered({ masteryScore: 9 }), true)
assert.equal(isMastered({ masteryScore: 8 }), false)

// combos: separate strikes (JAB › CROSS › HOOK), never one line
assert.deepEqual(comboStrikes('Jab → Cross → Hook'), ['JAB', 'CROSS', 'HOOK'])
assert.deepEqual(comboStrikes('Double Jab → Cross'), ['DOUBLE JAB', 'CROSS'])
assert.deepEqual(comboStrikes('Jab - Low Kick'), ['JAB', 'LOW KICK'])
assert.deepEqual(comboStrikes('Jab, Cross'), ['JAB', 'CROSS'])
assert.deepEqual(comboStrikes('Jab -> Cross'), ['JAB', 'CROSS'])
assert.deepEqual(comboStrikes('Teep'), ['TEEP'])

const C = (id: string, tier: string, unlocked: number, masteryScore = 0): LibraryCombo => ({ id, text: 'Jab → Cross', tier, level: tier, unlocked, masteryScore, techniques: 'boxing', formTips: '', isFavourite: 0, timesSharp: 0 })
const combos = [C('a', 'foundation', 1, 12), C('b', 'foundation', 1, 9), C('c', 'foundation', 1, 3), C('z', 'foundation', 0), C('d', 'weapons', 0), C('e', 'flow', 0)]
assert.equal(bagCount(combos), '3/6')
const tiers = tierViews(combos)
assert.deepEqual(tiers.map(t => t.name), ['FUNDAMENTALS', 'WEAPONS', 'FLOW'])
assert.equal(tiers[0].mastered, 2)
assert.equal(tiers[0].unlocked, 3)
assert.equal(tiers[0].locked, false)
assert.equal(tiers[1].locked, true)
assert.deepEqual(tiers[0].combos.map(c => c.id), ['a', 'b', 'c', 'z'])
assert.equal(currentTier(tiers), 'foundation')
assert.equal(currentTier(tierViews([C('x', 'foundation', 1), C('y', 'weapons', 1)])), 'weapons')
assert.equal(currentTier(tierViews([C('x', 'foundation', 0)])), null)
assert.equal(matchCombo(C('a', 'foundation', 1), 'fundamentals'), true)
assert.equal(matchCombo(C('a', 'foundation', 1), 'cross'), true)
assert.equal(matchCombo(C('a', 'foundation', 1), 'kick'), false)

// exercises: names and badges as page 21 shows them
assert.equal(equipmentName('barbell'), 'Barbell')
assert.equal(equipmentName('barbell,bench'), 'Barbell, Bench')
assert.equal(equipmentName('pull-up bar'), 'Pull-up Bar')
assert.equal(equipmentName(null), '')
assert.equal(equipmentName('trap_bar'), 'Trap Bar', 'no raw ids (e2e minor 25)')
assert.equal(equipmentName('ez-bar'), 'EZ Bar')
assert.equal(equipmentName('dumbbell,ez-bar'), 'Dumbbell, EZ Bar')
assert.deepEqual(muscleBadges('quads,glutes,core'), ['Quads', 'Glutes', 'Core'])
assert.deepEqual(muscleBadges('hamstrings,upper_back'), ['Hamstrings', 'Upper Back'])
assert.deepEqual(muscleBadges(null), [])
assert.deepEqual(exerciseCounts([{ category: 'strength' }, { category: 'strength' }, { category: 'posture' }]), { strength: 2, posture: 1 })

// the Waybook (B): one page per month, newest first, reflections only, WEEKLY on weekly entries
const E = (id: string, iso: string, type: string, content: string): LibraryJournalEntry => ({ id, date: day(iso), type, content, createdAt: 0 })
const pages = bookPages([
  E('1', '2026-10-09', 'daily', 'Skipped the run.'),
  E('2', '2026-10-18', 'daily', 'Squat felt honest today.'),
  E('3', '2026-10-12', 'weekly', 'Week two closed.'),
  E('4', '2026-10-17', 'wellness', 'Back tight.'),
  E('5', '2026-09-28', 'daily', 'First week in.'),
  E('6', '2026-09-27', 'daily', '   '),
])
assert.deepEqual(pages.map(p => p.head), ["THE WAYBOOK · OCTOBER '26", "THE WAYBOOK · SEPTEMBER '26"])
assert.deepEqual(pages[0].entries.map(e => e.id), ['2', '3', '1'])
assert.deepEqual(pages[1].entries.map(e => e.id), ['5'])
assert.equal(entryDateLine(E('x', '2026-10-18', 'daily', '')), 'SUN, OCT 18')
assert.equal(entryDateLine(E('x', '2026-10-12', 'weekly', '')), 'MON, OCT 12 · WEEKLY')
assert.deepEqual(entryParagraphs('skipped the run.\n\nback was tight.'), ['Skipped the run.', 'Back was tight.'])
assert.equal(matchEntry(E('x', '2026-10-18', 'daily', 'Squat felt honest'), 'honest'), true)
assert.equal(matchEntry(E('x', '2026-10-18', 'daily', 'Squat felt honest'), ''), false)

console.log('libraryModel tests passed')

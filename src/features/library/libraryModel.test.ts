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
  aliasesOf,
  classDayLabel,
  combosUsing,
  hintParts,
  listed,
  techniqueFor,
  techniqueHits,
  techniqueSub,
  tipList,
  type LibraryCombo,
  type LibraryJournalEntry,
  type LibraryTechnique,
} from './libraryModel'

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000)

// page 39's groups in order, with page 52's two new kinds (Techniques: the MT glove; Runs: the shoe)
assert.deepEqual(GROUPS.map(g => g.name), ['STRENGTH', 'CORE', 'FOUNDATION', 'MOBILITY', 'BAGWORK', 'TECHNIQUES', 'RUNS', 'WAYBOOK'])
assert.deepEqual(GROUPS.map(g => g.icon), ['strength', 'core', 'foundation', 'mobility', 'bag', 'mt', 'run', 'waybook'])
assert.deepEqual(GROUPS.filter(g => g.isNew).map(g => g.key), ['techniques', 'runs'])
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

// ── page 52 / 60: techniques, items ──
{
  const tech = (id: string, name: string, kind: string, aliases: string[]): LibraryTechnique => ({ id, name, kind, aliases: JSON.stringify(aliases), cue: null, tips: null, formVideoUrl: null })
  const T = [
    tech('tech-jab', 'Jab', 'Punch', ['Jab', 'Double Jab', 'Jab x 3', 'Feint Jab']),
    tech('tech-cross', 'Cross', 'Punch', ['Cross', 'Body Cross']),
    tech('tech-roundhouse', 'Rear Roundhouse', 'Kick', ['Rear Roundhouse', 'Right Kick', 'Body Kick', 'Rear Kick']),
    tech('tech-switch-kick', 'Switch Kick', 'Kick', ['Switch Kick', 'Left Kick', 'Left Body Kick']),
    tech('tech-teep', 'Teep', 'Kick', ['Teep', 'Lead Teep', 'Fake Teep', 'Feint Teep']),
  ]
  assert.equal(techniqueFor('Left Kick', T)?.id, 'tech-switch-kick', '"Left Kick" is the switch kick')
  assert.equal(techniqueFor('JAB × 3', T)?.id, 'tech-jab')
  assert.equal(techniqueFor('Body kick', T)?.id, 'tech-roundhouse')
  assert.equal(techniqueFor('Superman Punch', T), null)
  assert.equal(techniqueSub(T[2]), 'Kick · also Right Kick, Body Kick, Rear Kick', "page 60's sub-line")
  assert.equal(techniqueSub(tech('t', 'Parry', 'Defence', ['Parry'])), 'Defence')
  assert.deepEqual(aliasesOf({ aliases: 'nope' }), [])
  const C = [{ text: 'Jab → Cross → Body Kick' }, { text: 'Double Jab → Cross → Right Kick' }, { text: 'Teep → Jab → Cross' }]
  assert.equal(combosUsing(T[2], C, T).length, 2, 'every combo that means the roundhouse')
  assert.equal(combosUsing(T[0], C, T).length, 3)
  assert.deepEqual(techniqueHits(T, 'teep').map(h => h.label), ['Teep', 'Lead Teep', 'Fake Teep', 'Feint Teep'])
  assert.deepEqual(techniqueHits(T, '  '), [])
}
assert.deepEqual(tipList('One. | Two. |  | Three. | Four.'), ['One.', 'Two.', 'Three.'], 'at most three tips')
assert.deepEqual(tipList(null), [])
assert.deepEqual(hintParts('Your main squat. Goblet squats in weeks 1-2.'), ['Your main squat.', 'Goblet squats in weeks 1-2.'])
assert.deepEqual(hintParts('No full stop'), ['No full stop', ''])
assert.equal(classDayLabel(day('2026-10-20')), 'Tue 20 Oct')
assert.equal(listed({ mergedInto: 'ex-worlds-greatest-stretch' }), false, "Spiderman + T-Spine folds into the World's Greatest Stretch")
assert.equal(listed({ mergedInto: null }), true)
console.log('libraryModel: page 52 / 60 ok')

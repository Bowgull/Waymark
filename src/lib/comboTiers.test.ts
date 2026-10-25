// Run: tsx src/lib/comboTiers.test.ts
// The coach's tier unlocks. Knee and elbow combos open with their tier and
// wait on their Settings switch (0052): only the level he is on is open, and
// a combo he can't train (KNEES off) doesn't hold the next tier back.
import assert from 'node:assert/strict'
import { currentComboTier, switchedOn, unlockOffer } from './comboTiers'

const C = (id: string, tier: string, unlocked: number, techniques = 'boxing', masteryScore = 0) => ({ id, tier, unlocked, techniques, masteryScore })
const ON = (s: string) => new Set(s.split(','))

assert.equal(switchedOn({ techniques: 'boxing,knees' }, ON('boxing,kicks,defensive')), false)
assert.equal(switchedOn({ techniques: 'boxing,knees' }, ON('boxing,kicks,defensive,knees')), true)
assert.equal(switchedOn({ techniques: '' }, ON('boxing')), true)

// the library after 0052: Fundamentals open (with its beginner knee and elbow combos), every other tier shut
const lib = [
  C('f01', 'foundation', 1, 'boxing', 9), C('f02', 'foundation', 1, 'boxing', 9), C('f03', 'foundation', 1, 'boxing', 3),
  C('f11', 'foundation', 1, 'knees'), C('f13', 'foundation', 1, 'elbows'),
  C('w02', 'weapons', 0, 'boxing,kicks'), C('w10', 'weapons', 0, 'boxing,knees'),
  C('m06', 'mastery', 0, 'boxing,elbows'),
]
assert.equal(currentComboTier(lib), 'foundation')

// KNEES and ELBOWS off: the beginner knee and elbow combos don't count, 2 of 3 is enough
const off = unlockOffer(lib, ON('boxing,kicks,defensive'))
assert.deepEqual([off.tier, off.next, off.mastered, off.of], ['foundation', 'weapons', 2, 3])
assert.deepEqual(off.offer.map(c => c.id), ['w02', 'w10'], 'the whole next tier opens, its knee combo waits on the switch')

// KNEES on: the knee starter counts too (2 of 4 is under 60%)
const kneesOn = unlockOffer(lib, ON('boxing,kicks,defensive,knees'))
assert.deepEqual([kneesOn.mastered, kneesOn.of, kneesOn.offer.length], [2, 4, 0])

// the coach's unlocks move him up; nothing unlocked is Fundamentals; the top tier has nothing next
assert.equal(currentComboTier([C('a', 'foundation', 1), C('w', 'weapons', 1, 'kicks')]), 'weapons')
assert.equal(currentComboTier([C('a', 'foundation', 0)]), 'foundation')
assert.equal(unlockOffer([C('m', 'mastery', 1, 'kicks', 9)]).next, null)

console.log('comboTiers tests passed')

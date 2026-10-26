// Run: tsx src/lib/comboTiers.test.ts
// The coach's tier unlocks. Knee and elbow combos open with their tier and
// wait on their Settings switch (0052): only the level he is on is open, and
// a combo he can't train (KNEES off) doesn't hold the next tier back.
import assert from 'node:assert/strict'
import { OFFER_SIZE, currentComboTier, offerMessage, switchedOn, unlockOffer } from './comboTiers'

const C = (id: string, tier: string, unlocked: number, techniques = 'boxing', masteryScore = 0, text = id) => ({ id, tier, unlocked, techniques, masteryScore, text })
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
assert.deepEqual(off.offer.map(c => c.id), ['w02'], 'only what he can train is offered: the knee combo waits, locked, for its switch')
assert.equal(offerMessage(off), "You've mastered 2/3 foundation combos. Ready to unlock weapons?")

// KNEES on: the knee starter counts too (2 of 4 is under 60%)
const kneesOn = unlockOffer(lib, ON('boxing,kicks,defensive,knees'))
assert.deepEqual([kneesOn.mastered, kneesOn.of, kneesOn.offer.length], [2, 4, 0])

// the coach's unlocks move him up; nothing unlocked is Fundamentals; the top tier has nothing next
assert.equal(currentComboTier([C('a', 'foundation', 1), C('w', 'weapons', 1, 'kicks')]), 'weapons')
assert.equal(currentComboTier([C('a', 'foundation', 0)]), 'foundation')
assert.equal(unlockOffer([C('m', 'mastery', 1, 'kicks', 9)]).next, null)
// a class combo he added in Weapons sits there without moving his level
assert.equal(currentComboTier([C('a', 'foundation', 1), { ...C('cls', 'weapons', 1, 'boxing,kicks'), source: 'class' }]), 'foundation')

// page 93: 3 or 4 at a time, kicks and teeps first, then the shortest; his tier's rest before the next tier
const big = [
  C('f01', 'foundation', 1, 'boxing', 9), C('f02', 'foundation', 1, 'boxing', 9),
  C('w01', 'weapons', 0, 'boxing', 0, 'Jab → Cross → Hook → Cross'), C('w02', 'weapons', 0, 'boxing,kicks', 0, 'Jab → Cross → Switch Kick'),
  C('w03', 'weapons', 0, 'kicks', 0, 'Switch Kick'), C('w04', 'weapons', 0, 'kicks,defensive', 0, 'Lead Teep → Switch Kick'),
  C('w05', 'weapons', 0, 'boxing', 0, 'Jab → Jab'), C('w06', 'weapons', 0, 'boxing,kicks', 0, 'Jab → Body Kick'),
  C('fl1', 'flow', 0, 'kicks', 0, 'Switch Kick → Body Kick'),
]
const first = unlockOffer(big, ON('boxing,kicks,defensive'))
assert.equal(OFFER_SIZE, 4)
assert.deepEqual(first.offer.map(c => c.id), ['w03', 'w04', 'w06', 'w02'], 'kicks first, shortest first, four at most')
// he kept three (unticked one): Weapons is his tier now, and the next card waits on 60% of those three
const kept = big.map(c => (['w03', 'w04', 'w06'].includes(c.id) ? { ...c, unlocked: 1 } : c))
assert.equal(currentComboTier(kept), 'weapons')
assert.deepEqual(unlockOffer(kept, ON('boxing,kicks,defensive')).offer, [], '0 of 3 mastered: nothing yet')
const learnt = kept.map(c => (['w03', 'w04'].includes(c.id) ? { ...c, masteryScore: 9 } : c))
const second = unlockOffer(learnt, ON('boxing,kicks,defensive'))
assert.deepEqual(second.offer.map(c => c.id), ['w02', 'w05', 'w01', 'fl1'], "the rest of Weapons first (the one he unticked is back), then Flow")
assert.equal(offerMessage({ ...second, offer: second.offer.slice(0, 3) }), "You've mastered 2/3 weapons combos. Ready for 3 more?")
// knees switched on later: a locked knee combo of an earlier tier comes in its tier's turn
const knee = unlockOffer([...learnt, C('w10', 'weapons', 0, 'boxing,knees', 0, 'Jab → Cross → Left Knee')], ON('boxing,kicks,defensive,knees'))
assert.ok(knee.offer.some(c => c.id === 'w10'))
// his own and class combos are never offered
assert.ok(!unlockOffer([...big, { ...C('mine', 'weapons', 0, 'kicks', 0, 'Body Kick'), source: 'mine' }], ON('boxing,kicks,defensive')).offer.some(c => c.id === 'mine'))

console.log('comboTiers tests passed')

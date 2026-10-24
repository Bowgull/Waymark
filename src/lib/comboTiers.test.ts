// Run: tsx src/lib/comboTiers.test.ts
// The coach's tier unlocks: knee and elbow combos open by their Settings
// switch, so an open elbow combo in Mastery never makes him a Mastery fighter
// (live, 2026-10-24: m06 and m07 were open, so Weapons was never offered).
import assert from 'node:assert/strict'
import { currentComboTier, openedBySwitch, unlockOffer } from './comboTiers'

const C = (id: string, tier: string, unlocked: number, techniques = 'boxing', masteryScore = 0) => ({ id, tier, unlocked, techniques, masteryScore })

assert.equal(openedBySwitch({ techniques: 'boxing,knees' }), true)
assert.equal(openedBySwitch({ techniques: 'defensive,elbows' }), true)
assert.equal(openedBySwitch({ techniques: 'boxing,kicks' }), false)
assert.equal(openedBySwitch({ techniques: null }), false)

// the live library: Fundamentals open, plus knee and elbow combos open in every tier
const live = [
  C('f01', 'foundation', 1, 'boxing', 9), C('f02', 'foundation', 1, 'boxing', 9), C('f03', 'foundation', 1, 'boxing', 3),
  C('w02', 'weapons', 0, 'boxing,kicks'), C('w10', 'weapons', 1, 'boxing,knees'),
  C('fl02', 'flow', 0, 'boxing,kicks'), C('fl08', 'flow', 1, 'boxing,knees'),
  C('m01', 'mastery', 0, 'boxing,kicks'), C('m06', 'mastery', 1, 'boxing,elbows'),
]
assert.equal(currentComboTier(live), 'foundation', 'open knee and elbow combos do not set the tier')
const o = unlockOffer(live)
assert.deepEqual([o.tier, o.next, o.mastered, o.of], ['foundation', 'weapons', 2, 3])
assert.deepEqual(o.offer.map(c => c.id), ['w02'], 'Weapons is offered, without the switch-gated knee combo')

// not ready: under 60% mastered
assert.deepEqual(unlockOffer([C('a', 'foundation', 1, 'boxing', 9), C('b', 'foundation', 1, 'boxing', 1), C('w', 'weapons', 0, 'kicks')]).offer, [])
// the coach's unlocks still move him up
assert.equal(currentComboTier([C('a', 'foundation', 1), C('w', 'weapons', 1, 'kicks')]), 'weapons')
// nothing unlocked: Fundamentals
assert.equal(currentComboTier([C('a', 'foundation', 0)]), 'foundation')
// top tier: nothing next
assert.equal(unlockOffer([C('m', 'mastery', 1, 'kicks', 9)]).next, null)

console.log('comboTiers tests passed')

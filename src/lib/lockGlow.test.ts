// Run: tsx src/lib/lockGlow.test.ts
// Every lock card's grass (page 82): the moment's colour per card, and the
// change counter that makes the grass flash once (and only at a real change).
import assert from 'node:assert/strict'

import { bagGlow, finisherGlow, flashes, hardRunGlow, holdsGlow, intervalGlow, resetGlow, ropeGlow, runWalkGlow, strengthGlow, zone2Glow, zoneTone } from './lockGlow'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

test('Zone 2 Run: teal in zone, gold at the top, ember over; the counter moves when the time is reached', () => {
  assert.equal(zone2Glow('in', false).glowTone, 'teal')
  assert.equal(zone2Glow('gold', false).glowTone, 'gold')
  assert.equal(zone2Glow('over', false).glowTone, 'ember')
  assert.equal(zone2Glow('none', false).glowTone, 'gold')
  assert.equal(flashes(zone2Glow('in', false), zone2Glow('gold', false)), false) // the widget flashes zone changes itself
  assert.equal(flashes(zone2Glow('in', false), zone2Glow('in', true)), true)
})

test('Run-Walk: teal walking, the zone running; each switch flashes', () => {
  assert.equal(runWalkGlow(0, false, 'in').glowTone, 'teal')
  assert.equal(runWalkGlow(0, false, 'gold').glowTone, 'gold')
  assert.equal(runWalkGlow(1, true, 'gold').glowTone, 'teal')
  assert.equal(flashes(runWalkGlow(0, false, 'in'), runWalkGlow(1, true, 'in')), true)
  assert.equal(flashes(runWalkGlow(1, true, 'in'), runWalkGlow(1, true, 'gold')), false)
})

test('Tempo / Intervals: gold RUN HARD, teal EASY JOG, ember well over; each piece flashes', () => {
  assert.equal(hardRunGlow(0, false, false).glowTone, 'gold')
  assert.equal(hardRunGlow(1, true, false).glowTone, 'teal')
  assert.equal(hardRunGlow(0, false, true).glowTone, 'ember')
  assert.equal(flashes(hardRunGlow(0, false, false), hardRunGlow(1, true, false)), true)
})

test('Bag work: gold round, teal rest, orange last 10 s (colour only); round and rest start flash', () => {
  const r3 = bagGlow(3, false, false), r3o = bagGlow(3, false, true), rest3 = bagGlow(3, true, false), r4 = bagGlow(4, false, false)
  assert.deepEqual([r3.glowTone, r3o.glowTone, rest3.glowTone], ['gold', 'orange', 'teal'])
  assert.equal(flashes(r3, r3o), false)
  assert.equal(flashes(r3o, rest3), true)
  assert.equal(flashes(rest3, r4), true)
  assert.ok(r4.glowSeq > rest3.glowSeq && rest3.glowSeq > r3.glowSeq)
})

test('Skip rope: gold rope, teal rest, each change flashes', () => {
  assert.equal(ropeGlow(2, false).glowTone, 'gold')
  assert.equal(ropeGlow(2, true).glowTone, 'teal')
  assert.equal(flashes(ropeGlow(2, false), ropeGlow(2, true)), true)
  assert.equal(flashes(ropeGlow(2, true), ropeGlow(3, false)), true)
})

test('Strength: teal; the rest keeps its set\'s number, the next set flashes as the rest ends', () => {
  const set1 = strengthGlow(1), rest1 = strengthGlow(1), set2 = strengthGlow(2)
  assert.equal(set1.glowTone, 'teal')
  assert.equal(flashes(set1, rest1), false)
  assert.equal(flashes(rest1, set2), true)
})

test('Holds: teal hold, gold move; a flash only when a hold ends', () => {
  const h2 = holdsGlow(2, true), end2 = holdsGlow(2, false), ready3 = holdsGlow(3, true), h3 = holdsGlow(3, true)
  assert.equal(h2.glowTone, 'teal')
  assert.equal(holdsGlow(2, true, true).glowTone, 'gold')
  assert.equal(flashes(h2, end2), true)
  assert.equal(flashes(end2, ready3), false)
  assert.equal(flashes(ready3, h3), false)
})

test('Reset: calm teal, each part change flashes', () => {
  assert.equal(resetGlow(1).glowTone, 'teal')
  assert.equal(flashes(resetGlow(1), resetGlow(2)), true)
  assert.equal(flashes(resetGlow(2), resetGlow(2)), false)
})

test('Interval timer: gold work, teal rest and get ready, orange near the end (colour only); each part flashes', () => {
  assert.deepEqual(intervalGlow(0, 'ready', false), { glowTone: 'teal', glowSeq: 1 })
  assert.deepEqual(intervalGlow(1, 'work', false), { glowTone: 'gold', glowSeq: 2 })
  assert.deepEqual(intervalGlow(1, 'work', true), { glowTone: 'orange', glowSeq: 2 })
  assert.equal(flashes(intervalGlow(1, 'work', false), intervalGlow(1, 'work', true)), false)
  assert.equal(flashes(intervalGlow(1, 'work', true), intervalGlow(2, 'rest', false)), true)
})

test('no previous state: nothing to flash from; zone tones', () => {
  assert.equal(flashes(null, resetGlow(1)), false)
  assert.deepEqual(['in', 'gold', 'over', 'none'].map(z => zoneTone(z as 'in')), ['teal', 'gold', 'ember', 'gold'])
})

test('Bag finisher (page 86): red sets, teal rests, orange near the end; each part flashes, the orange never', () => {
  assert.equal(finisherGlow(0, false, false).glowTone, 'red')
  assert.equal(finisherGlow(1, true, false).glowTone, 'teal')
  assert.equal(finisherGlow(0, false, true).glowTone, 'orange')
  assert.equal(flashes(finisherGlow(0, false, false), finisherGlow(1, true, false)), true)
  assert.equal(flashes(finisherGlow(0, false, false), finisherGlow(0, false, true)), false)
  // from the last round's rest into the first set, and a restart of the same set (a swipe back)
  assert.equal(flashes(bagGlow(6, true, false), finisherGlow(0, false, false)), true)
  assert.equal(flashes(finisherGlow(2, false, false, 0), finisherGlow(2, false, false, 1)), true)
})

console.log(`lockGlow: ${passed} passed`)

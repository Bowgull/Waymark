// Run: tsx src/lib/coach/bagFinisher.test.ts
// The bag finisher (page 86): sized by readiness, knees only with KNEES on,
// COACH and HYBRID get it and CUSTOM doesn't, the sets in order with 20 s
// rests, the stored plan read back, and the parts the timer runs.
import assert from 'node:assert/strict'

import { positionAt, skipTargetSec } from '../timers/intervalTimer'
import {
  FINISHER_REST_SEC,
  finisherCues,
  finisherParts,
  finisherReadiness,
  finisherTotalSec,
  kneesOn,
  nextAfterSet,
  parseFinisher,
  planFinisher,
  setCount,
  setLine,
  setOfPart,
  type FinisherPlan,
} from './bagFinisher'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const plan = (o: Partial<Parameters<typeof planFinisher>[0]> = {}): FinisherPlan => planFinisher({ mode: 'coach', readiness: 'ok', knees: false, ...o })!

test('readiness from the bag dose: an ease or less LOW, a hold OK, finishers earned HIGH, none OK', () => {
  assert.equal(finisherReadiness('REST'), 'low')
  assert.equal(finisherReadiness('RECOVER'), 'low')
  assert.equal(finisherReadiness('EASE'), 'low')
  assert.equal(finisherReadiness('HOLD'), 'ok')
  assert.equal(finisherReadiness('PROGRESS'), 'high')
  assert.equal(finisherReadiness('PUSH'), 'high')
  assert.equal(finisherReadiness(null), 'ok')
  assert.equal(finisherReadiness(undefined), 'ok')
})

test('sized by readiness: LOW goal 10 in 0:25, OK goal 20 in 0:45, HIGH goal 30 in 1:05', () => {
  for (const [r, goal, sec] of [['low', 10, 25], ['ok', 20, 45], ['high', 30, 65]] as const) {
    const p = plan({ readiness: r })
    assert.equal(p.readiness, r)
    for (const s of p.sets) assert.deepEqual({ goal: s.goal, sec: s.sec }, { goal, sec }, `${r} ${s.name}`)
  }
  assert.equal(setLine(plan().sets[0]), '0:45 · GOAL 20')
  assert.equal(setLine(plan({ readiness: 'high' }).sets[0]), '1:05 · GOAL 30')
})

test('the sets in order: body kick right, switch kick left, lead teep; no head kicks', () => {
  const p = plan()
  assert.deepEqual(p.sets.map(s => s.name), ['BODY KICK', 'SWITCH KICK', 'LEAD TEEP'])
  assert.deepEqual(p.sets.map(s => s.side), ['RIGHT LEG', 'LEFT LEG', 'FRONT LEG'])
  assert.ok(p.sets.every(s => !/HEAD/.test(s.name)))
})

test('KNEES on: the rear knee joins as the last set, its goal half again (30 on an OK day)', () => {
  const on = plan({ knees: true })
  assert.deepEqual(on.sets.map(s => s.name), ['BODY KICK', 'SWITCH KICK', 'LEAD TEEP', 'REAR KNEE'])
  assert.equal(on.sets[3].goal, 30)
  assert.equal(on.sets[3].sec, 45)
  assert.equal(plan({ knees: true, readiness: 'low' }).sets[3].goal, 15)
  assert.equal(plan({ knees: true, readiness: 'high' }).sets[3].goal, 45)
  assert.equal(plan({ knees: false }).sets.length, 3)
  assert.equal(kneesOn('boxing,kicks,defensive'), false)
  assert.equal(kneesOn('boxing,kicks,knees'), true)
  assert.equal(kneesOn(' knees '), true)
  assert.equal(kneesOn(null), false)
})

test('COACH and HYBRID get it; CUSTOM stays exactly as he built it', () => {
  assert.ok(planFinisher({ mode: 'coach', readiness: 'ok', knees: false }))
  assert.ok(planFinisher({ mode: 'hybrid', readiness: 'low', knees: true }))
  assert.equal(planFinisher({ mode: 'custom', readiness: 'high', knees: true }), null)
})

test('20 s rests between sets, none after the last', () => {
  const p = plan()
  assert.equal(p.restSec, FINISHER_REST_SEC)
  assert.equal(FINISHER_REST_SEC, 20)
  const parts = finisherParts(p)
  assert.deepEqual(parts.map(x => [x.ph, x.len, x.round, x.startSec]), [
    ['work', 45, 1, 0], ['rest', 20, 1, 45], ['work', 45, 2, 65], ['rest', 20, 2, 110], ['work', 45, 3, 130],
  ])
  assert.equal(finisherTotalSec(p), 175)
  assert.equal(finisherParts(plan({ knees: true })).length, 7)
})

test('the timer reads it: orange the last 10 s of a set and the last 5 s of a rest; a rest shows the set coming', () => {
  const p = plan()
  const parts = finisherParts(p)
  assert.equal(positionAt(parts, 30).warn, false)
  assert.equal(positionAt(parts, 36).warn, true)
  assert.equal(positionAt(parts, 50).warn, false)
  assert.equal(positionAt(parts, 61).warn, true)
  assert.equal(setOfPart(p, positionAt(parts, 50).part).name, 'SWITCH KICK')
  assert.equal(setOfPart(p, positionAt(parts, 10).part).name, 'BODY KICK')
  assert.equal(positionAt(parts, 175).done, true)
  assert.equal(skipTargetSec(parts, 10), 45, 'a swipe up: the rest')
  assert.equal(skipTargetSec(parts, 140), 175, 'past the last set: done')
})

test('the words: NEXT · REST 0:20 and the next set; NEXT · COOL-DOWN after the last; 1 OF 3', () => {
  const p = plan()
  assert.deepEqual(nextAfterSet(p, 0), ['NEXT · REST 0:20', 'SWITCH KICK'])
  assert.deepEqual(nextAfterSet(p, 1), ['NEXT · REST 0:20', 'LEAD TEEP'])
  assert.deepEqual(nextAfterSet(p, 2), ['NEXT · COOL-DOWN'])
  assert.equal(setCount(p, 1), '1 OF 3')
  assert.equal(setCount(plan({ knees: true }), 4), '4 OF 4')
})

test('the bells: each set starts, warns at 10 s and ends; each rest warns at 5 s', () => {
  const cues = finisherCues(finisherParts(plan()))
  assert.deepEqual(cues.slice(0, 4), [
    { atSec: 0, kind: 'set' }, { atSec: 35, kind: 'set_warn' }, { atSec: 45, kind: 'set_end' }, { atSec: 60, kind: 'rest_warn' },
  ])
  assert.equal(cues.filter(c => c.kind === 'set').length, 3)
  assert.equal(cues[cues.length - 1].atSec, 175)
  // A LOW set of 25 s still warns at 10 s left.
  assert.deepEqual(finisherCues(finisherParts(plan({ readiness: 'low' }))).slice(0, 3).map(c => c.atSec), [0, 15, 25])
})

test('the stored plan reads back; anything else is no finisher', () => {
  const p = plan({ knees: true, readiness: 'high' })
  assert.deepEqual(parseFinisher(JSON.parse(JSON.stringify(p))), p)
  assert.equal(parseFinisher(null), null)
  assert.equal(parseFinisher({}), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: [] }), null)
  assert.equal(parseFinisher({ readiness: 'max', sets: p.sets }), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: [{ ...p.sets[0], key: 'head_kick' }] }), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: [{ ...p.sets[0], sec: 0 }] }), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: p.sets })?.restSec, 20, 'a missing rest is the 20 s')
})

console.log(`bagFinisher: ${passed} passed`)

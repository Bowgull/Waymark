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
  techniqueGroups,
  nextAfterSet,
  parseFinisher,
  planFinisher,
  setCount,
  setLine,
  setOfPart,
  type FinisherPlan,
  finalFinisherLog,
  logEnded,
  logJumped,
  logRanTo,
  newFinisherLog,
  parseFinisherLog,
  plannedFinisherSec,
  readinessAfterLast,
  type FinisherLog,
} from './bagFinisher'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const G = (s: string) => new Set(s.split(','))
const KNEES = G('boxing,kicks,defensive,knees')
const plan = (o: Partial<Parameters<typeof planFinisher>[0]> = {}): FinisherPlan => planFinisher({ mode: 'coach', readiness: 'ok', groups: G('boxing,kicks,defensive'), ...o })!

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
  const on = plan({ groups: KNEES })
  assert.deepEqual(on.sets.map(s => s.name), ['BODY KICK', 'SWITCH KICK', 'LEAD TEEP', 'REAR KNEE'])
  assert.equal(on.sets[3].goal, 30)
  assert.equal(on.sets[3].sec, 45)
  assert.equal(plan({ groups: KNEES, readiness: 'low' }).sets[3].goal, 15)
  assert.equal(plan({ groups: KNEES, readiness: 'high' }).sets[3].goal, 45)
  assert.equal(plan({ groups: G('boxing,kicks,defensive') }).sets.length, 3)
  assert.equal(techniqueGroups('boxing,kicks,defensive').has('knees'), false)
  assert.equal(techniqueGroups('boxing,kicks,knees').has('knees'), true)
  assert.equal(techniqueGroups(' knees ').has('knees'), true)
  assert.deepEqual([...techniqueGroups(null)].sort(), ['boxing', 'defensive', 'kicks'], 'nothing saved: the defaults')
  // the switches decide: KICKS off leaves the teep, nothing on leaves no finisher
  assert.deepEqual(plan({ groups: G('boxing,defensive') }).sets.map(s => s.key), ['lead_teep'])
  assert.deepEqual(plan({ groups: G('boxing,defensive,knees') }).sets.map(s => s.key), ['lead_teep', 'rear_knee'])
  assert.equal(planFinisher({ mode: 'coach', readiness: 'ok', groups: G('boxing') }), null)
})

test('COACH and HYBRID get it; CUSTOM stays exactly as he built it', () => {
  assert.ok(planFinisher({ mode: 'coach', readiness: 'ok', groups: G('boxing,kicks,defensive') }))
  assert.ok(planFinisher({ mode: 'hybrid', readiness: 'low', groups: G('boxing,kicks,defensive,knees') }))
  assert.equal(planFinisher({ mode: 'custom', readiness: 'high', groups: G('boxing,kicks,defensive,knees') }), null)
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
  assert.equal(finisherParts(plan({ groups: KNEES })).length, 7)
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

test('the words: NEXT · REST 0:20 and the next set; NEXT · COMBO RATINGS after the last; 1 OF 3', () => {
  const p = plan()
  assert.deepEqual(nextAfterSet(p, 0), ['NEXT · REST 0:20', 'SWITCH KICK'])
  assert.deepEqual(nextAfterSet(p, 1), ['NEXT · REST 0:20', 'LEAD TEEP'])
  assert.deepEqual(nextAfterSet(p, 2), ['NEXT · COMBO RATINGS'])
  assert.equal(setCount(p, 1), '1 OF 3')
  assert.equal(setCount(plan({ groups: KNEES }), 4), '4 OF 4')
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
  const p = plan({ groups: KNEES, readiness: 'high' })
  assert.deepEqual(parseFinisher(JSON.parse(JSON.stringify(p))), p)
  assert.equal(parseFinisher(null), null)
  assert.equal(parseFinisher({}), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: [] }), null)
  assert.equal(parseFinisher({ readiness: 'max', sets: p.sets }), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: [{ ...p.sets[0], key: 'head_kick' }] }), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: [{ ...p.sets[0], sec: 0 }] }), null)
  assert.equal(parseFinisher({ readiness: 'ok', sets: p.sets })?.restSec, 20, 'a missing rest is the 20 s')
})

test('the log: time running out marks a set done; a swipe past marks it skipped; held through skips the rest', () => {
  const p = plan()
  const parts = finisherParts(p)
  const statuses = (l: FinisherLog) => l.sets.map(s => s.status)
  let l = newFinisherLog(p)
  assert.deepEqual(statuses(l), [null, null, null])
  assert.deepEqual(l.sets[0], { key: 'body_kick', name: 'BODY KICK', goal: 20, sec: 45, status: null }, 'each set keeps its goal and time')
  l = logRanTo(l, parts, 1) // set 1 ran out into its rest
  assert.deepEqual(statuses(l), ['done', null, null])
  l = logRanTo(l, parts, 2)
  l = logJumped(l, parts, 2, 3, true) // set 2 swiped past
  assert.deepEqual(statuses(l), ['done', 'skipped', null])
  assert.equal(l.at, 3)
  l = logRanTo(l, parts, 3) // nothing more passed by the jump itself
  assert.deepEqual(statuses(l), ['done', 'skipped', null])
  const ended = logEnded(l, parts, 3) // held through in the rest before set 3
  assert.deepEqual(statuses(ended), ['done', 'skipped', 'skipped'])
  assert.equal(ended.ended, true)
  // the last set ran out: all of it passed; a skip past the end does not count as done
  const full = logRanTo(logRanTo(newFinisherLog(p), parts, 4), parts, parts.length)
  assert.deepEqual(statuses(full), ['done', 'done', 'done'])
  const skippedLast = logJumped(logRanTo(newFinisherLog(p), parts, 4), parts, 4, parts.length, true)
  assert.deepEqual(statuses(logRanTo(skippedLast, parts, parts.length)), ['done', 'done', 'skipped'])
  // back into a set and done again: done
  const back = logJumped(logJumped(logRanTo(newFinisherLog(p), parts, 0), parts, 0, 1, true), parts, 1, 0, false)
  assert.deepEqual(statuses(logRanTo(back, parts, 1)), ['done', null, null])
})

test('the log as sent: a set never reached is skipped and the finisher counts as ended; it reads back', () => {
  const p = plan()
  const sent = finalFinisherLog(logRanTo(newFinisherLog(p), finisherParts(p), 1))
  assert.deepEqual(sent.sets.map(s => s.status), ['done', 'skipped', 'skipped'])
  assert.equal(sent.ended, true)
  const whole = finalFinisherLog(logRanTo(newFinisherLog(p), finisherParts(p), 99))
  assert.equal(whole.ended, false)
  assert.deepEqual(parseFinisherLog(JSON.parse(JSON.stringify(sent))), sent)
  assert.equal(parseFinisherLog({ readiness: 'ok', ended: false, sets: [] }), null)
  assert.equal(parseFinisherLog({ readiness: 'ok', ended: false, sets: [{ key: 'head_kick', goal: 20, sec: 45, status: 'done' }] }), null)
})

test('the coach reads the last one: a skipped set or an ended finisher never pushes the size up', () => {
  const p = plan({ readiness: 'ok' })
  const parts = finisherParts(p)
  const full = finalFinisherLog(logRanTo(newFinisherLog(p), parts, 99))
  const skipped = finalFinisherLog(logJumped(newFinisherLog(p), parts, 0, 1, true))
  const ended = finalFinisherLog(logEnded(newFinisherLog(p), parts, 0))
  assert.equal(readinessAfterLast('high', null), 'high', 'no finisher before: today decides')
  assert.equal(readinessAfterLast('high', full), 'high', 'all of it done: today decides')
  assert.equal(readinessAfterLast('high', skipped), 'ok', 'a set skipped: no bigger than last time')
  assert.equal(readinessAfterLast('high', ended), 'ok', 'ended early: no bigger than last time')
  assert.equal(readinessAfterLast('ok', skipped), 'ok')
  assert.equal(readinessAfterLast('low', skipped), 'low', 'today can still bring it down')
})

test('planned length before the start: the dose level sizes it with the default switches', () => {
  assert.equal(plannedFinisherSec('HOLD'), 175)
  assert.equal(plannedFinisherSec(undefined), 175)
  assert.equal(plannedFinisherSec('EASE'), 3 * 25 + 2 * 20)
  assert.equal(plannedFinisherSec('PUSH'), 3 * 65 + 2 * 20)
})

console.log(`bagFinisher: ${passed} passed`)

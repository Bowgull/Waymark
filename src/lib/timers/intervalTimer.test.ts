// Run: tsx src/lib/timers/intervalTimer.test.ts
// The hidden interval timer (page 81): the phase schedule (get ready, work and
// rest, no rest after the last round, the orange windows, the total with the
// get ready), the sounds, the clock, the number pad's typing and limits, the
// last numbers kept, and the lock card's state.
import assert from 'node:assert/strict'

import {
  clampSetup, clockAt, countFor, cueSchedule, leftText, nextWords, DEFAULT_SETUP, doneWord, elapsedSec, LAST_KEY, loadLast, mmss, padBack, padPush, padShow, padValue,
  parseSaved, partClip, pauseClock, phaseWord, plan, positionAt, resumeClock, saveLast, startClock, stepDown, stepUp, totalLine, totalSec,
  valueText, warnLen, type IntervalSetup,
} from './intervalTimer'
import { intervalActivityState } from './intervalActivity'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

const S: IntervalSetup = { rounds: 8, work: 30, rest: 15 }

test('get ready first: 10 s, teal, round 1', () => {
  const p = plan(S)
  assert.deepEqual(p[0], { ph: 'ready', len: 10, round: 1, startSec: 0 })
  assert.equal(phaseWord('ready'), 'GET READY')
})

test('work then rest each round; the last round has no rest', () => {
  const p = plan(S)
  assert.equal(p.length, 1 + 8 + 7)
  assert.deepEqual(p.slice(1, 4).map(x => [x.ph, x.round, x.startSec]), [['work', 1, 10], ['rest', 1, 40], ['work', 2, 55]])
  const last = p[p.length - 1]
  assert.equal(last.ph, 'work')
  assert.equal(last.round, 8)
  assert.equal(p.filter(x => x.ph === 'rest').length, 7)
})

test('rest 0:00 means no rest at all; one round is get ready and one work', () => {
  assert.deepEqual(plan({ rounds: 3, work: 20, rest: 0 }).map(x => x.ph), ['ready', 'work', 'work', 'work'])
  assert.deepEqual(plan({ rounds: 1, work: 20, rest: 10 }).map(x => x.ph), ['ready', 'work'])
})

test('total time includes the 10 s get ready', () => {
  assert.equal(totalSec(S), 10 + 8 * 30 + 7 * 15)
  assert.equal(totalLine(S), '8 rounds · 5:55 total')
  assert.equal(totalLine({ rounds: 1, work: 60, rest: 30 }), '1 round · 1:10 total')
  assert.equal(totalSec({ rounds: 3, work: 20, rest: 0 }), 70)
  const p = plan(S), last = p[p.length - 1]
  assert.equal(last.startSec + last.len, totalSec(S))
})

test('orange: last 10 s of work, last 5 s of rest and of get ready (the whole part when shorter)', () => {
  assert.equal(warnLen({ ph: 'work', len: 30 }), 10)
  assert.equal(warnLen({ ph: 'rest', len: 15 }), 5)
  assert.equal(warnLen({ ph: 'ready', len: 10 }), 5)
  assert.equal(warnLen({ ph: 'work', len: 5 }), 5)
  const p = plan(S)
  // get ready: 10..6 calm, 5..1 orange
  assert.equal(positionAt(p, 4.5).warn, false)
  assert.equal(positionAt(p, 5).warn, true)
  // work 1 runs 10..40: orange from 30 (10 s left)
  assert.equal(positionAt(p, 29.9).warn, false)
  assert.equal(positionAt(p, 30).warn, true)
  assert.equal(positionAt(p, 39.9).shown, 1)
  // rest 1 runs 40..55: orange from 50
  assert.equal(positionAt(p, 49.5).warn, false)
  assert.equal(positionAt(p, 50).warn, true)
})

test('position: part, whole seconds rounded up, done at the end', () => {
  const p = plan(S)
  const a = positionAt(p, 0)
  assert.equal(a.part.ph, 'ready')
  assert.equal(a.shown, 10)
  const b = positionAt(p, 10)
  assert.equal(b.part.ph, 'work')
  assert.equal(b.shown, 30)
  assert.equal(b.index, 1)
  const c = positionAt(p, 12.2)
  assert.equal(c.shown, 28)
  const d = positionAt(p, totalSec(S))
  assert.equal(d.done, true)
  assert.equal(d.shown, 0)
})

test('the sounds: a change beep and Poppy at each part, a tick each orange second, done at the end', () => {
  const cues = cueSchedule(S)
  assert.deepEqual(cues[0], { atSec: 0, kind: 'change', clips: ['t_change', 't_get_ready'] })
  // get ready's ticks at 5..9
  assert.deepEqual(cues.filter(c => c.kind === 'tick' && c.atSec < 10).map(c => c.atSec), [5, 6, 7, 8, 9])
  assert.deepEqual(cues.find(c => c.atSec === 10), { atSec: 10, kind: 'change', clips: ['t_change', 't_round_1'] })
  assert.deepEqual(cues.filter(c => c.kind === 'tick' && c.atSec >= 10 && c.atSec < 40).map(c => c.atSec), [30, 31, 32, 33, 34, 35, 36, 37, 38, 39])
  assert.deepEqual(cues.find(c => c.atSec === 40)?.clips, ['t_change', 't_rest'])
  const last = cues.filter(c => c.kind === 'change').pop()!
  assert.deepEqual(last.clips, ['t_change', 't_last_round'])
  assert.deepEqual(cues[cues.length - 1], { atSec: totalSec(S), kind: 'done', clips: ['chime_done', 't_done'] })
  // a part shorter than its orange: no tick on its first second (its change beep is there)
  const short = cueSchedule({ rounds: 2, work: 5, rest: 0 })
  assert.equal(short.some(c => c.kind === 'tick' && c.atSec === 10), false)
  assert.deepEqual(short.filter(c => c.kind === 'tick' && c.atSec >= 10 && c.atSec < 15).map(c => c.atSec), [11, 12, 13, 14])
})

test('Poppy: "Round N." up to 30, "Last round." only when there is more than one', () => {
  const p = plan({ rounds: 30, work: 10, rest: 5 })
  assert.equal(partClip(p.find(x => x.ph === 'work' && x.round === 29)!, 30), 't_round_29')
  assert.equal(partClip(p.find(x => x.ph === 'work' && x.round === 30)!, 30), 't_last_round')
  assert.equal(partClip(plan({ rounds: 1, work: 10, rest: 0 })[1], 1), 't_round_1')
  assert.equal(doneWord(8), 'DONE · 8 ROUNDS')
  assert.equal(doneWord(1), 'DONE · 1 ROUND')
})

test('the clock leaves pauses out; the native word re-sets it', () => {
  let c = startClock(1000)
  assert.equal(elapsedSec(c, 6000), 5)
  c = pauseClock(c, 6000)
  assert.equal(elapsedSec(c, 60000), 5)
  c = resumeClock(c, 16000)
  assert.equal(elapsedSec(c, 18000), 7)
  const n = clockAt(42000, true, 100000)
  assert.equal(elapsedSec(n, 200000), 42)
})

test('steppers: rounds by 1 (1-30); times by 5 s under a minute, then 15 s; limits held', () => {
  assert.equal(stepUp('rounds', 8), 9)
  assert.equal(stepUp('rounds', 30), 30)
  assert.equal(stepDown('rounds', 1), 1)
  assert.equal(stepUp('work', 55), 60)
  assert.equal(stepUp('work', 60), 75)
  assert.equal(stepDown('work', 75), 60)
  assert.equal(stepDown('work', 60), 55)
  assert.equal(stepDown('work', 5), 5)
  assert.equal(stepUp('work', 600), 600)
  assert.equal(stepDown('rest', 0), 0)
  assert.equal(stepUp('rest', 300), 300)
  assert.equal(valueText('work', 90), '1:30')
  assert.equal(valueText('rounds', 8), '8')
  assert.equal(mmss(605), '10:05')
})

test('number pad: rounds up to 2 digits, times like a microwave (m:ss), no leading zero', () => {
  let b = ''
  for (const d of ['0', '1', '3', '0']) b = padPush('work', b, d)
  assert.equal(b, '130')
  assert.equal(padShow('work', b), '1:30')
  assert.equal(padValue('work', b), 90)
  assert.equal(padShow('work', ''), '0:00')
  assert.equal(padShow('work', '5'), '0:05')
  assert.equal(padBack(b), '13')
  let r = ''
  for (const d of ['1', '2', '3']) r = padPush('rounds', r, d)
  assert.equal(r, '12')
  assert.equal(padShow('rounds', ''), '0')
  assert.equal(padPush('work', '1234', '5'), '1234')
  assert.equal(padPush('work', '1', 'x'), '1')
})

test('number pad limits: rounds 1-30, work 0:05-10:00, rest 0:00-5:00; nothing typed keeps it', () => {
  assert.equal(padValue('rounds', '45'), 30)
  assert.equal(padValue('work', '3'), 5)
  assert.equal(padValue('work', '1500'), 600)
  assert.equal(padValue('rest', '700'), 300)
  assert.equal(padValue('rest', '90'), 90)
  assert.equal(padValue('work', ''), null)
})

test('the last numbers used are kept and read back (bad or missing data: the defaults)', () => {
  const store = new Map<string, string>()
  const get = (k: string) => store.get(k) ?? null
  const set = (k: string, v: string) => { store.set(k, v) }
  assert.deepEqual(loadLast(get), DEFAULT_SETUP)
  saveLast(set, { rounds: 12, work: 45, rest: 20 })
  assert.deepEqual(loadLast(get), { rounds: 12, work: 45, rest: 20 })
  store.set(LAST_KEY, '{nope')
  assert.deepEqual(loadLast(get), DEFAULT_SETUP)
  assert.equal(parseSaved(JSON.stringify({ rounds: 'x', work: 1, rest: 1 })), null)
  assert.deepEqual(parseSaved(JSON.stringify({ rounds: 99, work: 1, rest: 9999 })), { rounds: 30, work: 5, rest: 300 })
  assert.deepEqual(clampSetup(null), DEFAULT_SETUP)
})

test('lock card: ROUND n OF N, the part\'s end, the phase colour, the counter per part', () => {
  const p = plan(S)
  const c = startClock(1_000_000)
  const w = intervalActivityState(positionAt(p, 12), c, 8)
  assert.equal(w.phase, 'active')
  assert.equal(w.label, 'WORK')
  assert.equal(w.round, 1)
  assert.equal(w.roundTotal, 8)
  assert.equal(w.endsAt, 1_000_000 + 40_000)
  assert.equal(w.startedAt, 1_000_000 + 10_000)
  assert.equal(w.glowTone, 'gold')
  assert.equal(w.glowSeq, 2)
  // the same part later: the same card (nothing sent), then orange: the colour only
  assert.deepEqual(intervalActivityState(positionAt(p, 20), c, 8), w)
  const o = intervalActivityState(positionAt(p, 31), c, 8)
  assert.equal(o.glowTone, 'orange')
  assert.equal(o.glowSeq, 2)
  const r = intervalActivityState(positionAt(p, 41), c, 8)
  assert.equal(r.phase, 'rest')
  assert.equal(r.label, 'REST')
  assert.equal(r.glowTone, 'teal')
  assert.equal(r.glowSeq, 3)
  const paused = pauseClock(c, 1_000_000 + 12_000)
  const ps = intervalActivityState(positionAt(p, elapsedSec(paused, 2_000_000)), paused, 8)
  assert.equal(ps.isPaused, true)
  assert.equal(ps.pausedRemaining, 28)
  const g = intervalActivityState(positionAt(p, 1), c, 8)
  assert.equal(g.label, 'GET READY')
  assert.equal(g.phase, 'rest')
})

test('page 83: ROUND at work, NEXT resting and getting ready; NEXT · REST only into a rest; the time left', () => {
  const p = plan(S)
  assert.deepEqual(countFor(positionAt(p, 1), 8), { label: 'NEXT', n: 1, tone: 'teal' })
  assert.deepEqual(countFor(positionAt(p, 12), 8), { label: 'ROUND', n: 1, tone: 'gold' })
  assert.deepEqual(countFor(positionAt(p, 41), 8), { label: 'NEXT', n: 2, tone: 'teal' })
  assert.deepEqual(countFor(positionAt(p, totalSec(S)), 8), { label: 'ROUND', n: 8, tone: 'gold' })
  assert.equal(nextWords(p, positionAt(p, 12)), 'NEXT · REST 0:15')
  assert.equal(nextWords(p, positionAt(p, 41)), null)
  assert.equal(nextWords(p, positionAt(p, 1)), null)
  assert.equal(nextWords(p, positionAt(p, totalSec(S) - 1)), null) // the last round: no rest after it
  assert.equal(nextWords(plan({ rounds: 3, work: 20, rest: 0 }), positionAt(plan({ rounds: 3, work: 20, rest: 0 }), 12)), null)
  assert.equal(leftText(S, 0), '5:55')
  assert.equal(leftText(S, 109.4), '4:06')
  assert.equal(leftText(S, 9999), '0:00')
})

console.log(`intervalTimer: ${passed} passed`)

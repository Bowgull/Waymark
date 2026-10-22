// Run: tsx src/lib/timers/timerLook.test.ts
// The session timers' look (pages 19 and 31): heat bands in the last 10 s, the calm
// swell of holds and rest, the clock digits and their short-way flips, the swipe-up
// skip, combo strikes, and the grass scene.
import assert from 'node:assert/strict'

import { flipFrames } from '../../design/flap'
import { cellGlyph, grassGrid, timerCell, zoneCell } from './grassScene'
import {
  clockDigits, comboStrikes, effortWord, heatFor, momentLine,
  ENDED_SHOW_MS, PULL_SETTLE_MS, progressOf, pullAmount, releaseAction, settlePull, shownSeconds, swellK, workLabel,
  BOARD_OUT_MS, END_HOLD_MS, FINISHING_AFTER_MS, GRASS_HOLD_MS, HOLD_RELEASE_MS, HOLD_TAP_MS, holdReleaseLeft, ZONE_EASE_MS, zoneEase,
} from './timerLook'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

test('work timers heat up: yellow 10-7, orange 6-4, red 3-0', () => {
  assert.equal(heatFor(11), null)
  for (const s of [10, 9, 8, 7]) assert.equal(heatFor(s), 'hy', `${s}`)
  for (const s of [6, 5, 4]) assert.equal(heatFor(s), 'ho', `${s}`)
  for (const s of [3, 2, 1, 0]) assert.equal(heatFor(s), 'hr', `${s}`)
  assert.equal(heatFor(-1), null, 'overtime is not hot')
})

test('holds and rest never heat; they swell from 5 s out', () => {
  assert.equal(heatFor(3, 'hold'), null)
  assert.equal(heatFor(3, 'rest'), null)
  assert.equal(swellK(6, 'rest'), 0)
  assert.equal(swellK(5, 'hold'), 0)
  assert.ok(swellK(4.4, 'hold') > 0 && swellK(4.4, 'hold') < 1)
  assert.equal(swellK(3.8, 'rest'), 1)
  assert.equal(swellK(0, 'rest'), 0, 'done: no swell')
  assert.equal(swellK(3, 'work'), 0, 'work timers heat instead')
})

test('FINISH replaces the running word in the last 10 s', () => {
  assert.equal(workLabel('FIGHT', 35), 'FIGHT')
  assert.equal(workLabel('FIGHT', 10), 'FINISH')
  assert.equal(workLabel('SKIP', 4), 'FINISH')
  assert.equal(workLabel('RUNNING', 11), 'RUNNING')
})

test('clock digits MM:SS', () => {
  assert.equal(clockDigits(35), '0035')
  assert.equal(clockDigits(180), '0300')
  assert.equal(clockDigits(61), '0101')
  assert.equal(clockDigits(-4), '0000')
  assert.equal(clockDigits(1800), '3000')
  assert.equal(shownSeconds(34_100), 35, 'rounds up')
  assert.equal(shownSeconds(0), 0)
  assert.equal(shownSeconds(-500), 0)
})

test('each second one quiet flip: a digit steps the short way, only through digits', () => {
  assert.deepEqual(flipFrames('9', '8'), ['8'])
  assert.deepEqual(flipFrames('0', '9'), ['9'], '0 -> 9 is one step back, not nine forward')
  assert.deepEqual(flipFrames('1', '0'), ['0'])
  assert.deepEqual(flipFrames('0', '5'), ['1', '2', '3', '4', '5'], 'a minute roll steps through digits only')
  for (const f of flipFrames('3', '7')) assert.match(f, /^[0-9]$/)
})

test('progress of a countdown', () => {
  assert.equal(progressOf(180_000, 180), 0)
  assert.equal(progressOf(90_000, 180), 0.5)
  assert.equal(progressOf(-5_000, 180), 1)
  assert.equal(progressOf(1000, 0), 0)
})

test('swipe up skips on a full pull; a short drag up lets go; a tap pauses', () => {
  assert.equal(pullAmount(300, 300, 400), 0)
  assert.equal(pullAmount(300, 120, 400), 1, '180 px of a 400 px zone is 45%')
  assert.ok(pullAmount(300, 210, 400) > 0.49 && pullAmount(300, 210, 400) < 0.51)
  assert.equal(pullAmount(300, 400, 400), 0, 'down is no pull')
  assert.equal(releaseAction(1, -200), 'skip')
  assert.equal(releaseAction(0.6, -100), 'none')
  assert.equal(releaseAction(0, 2), 'tap')
})

test('combos are strike tiles: "Jab → Cross → Hook"', () => {
  assert.deepEqual(comboStrikes('Jab → Cross → Hook'), ['JAB', 'CROSS', 'HOOK'])
  assert.deepEqual(comboStrikes('Jab → Low Kick'), ['JAB', 'LOW KICK'])
  assert.deepEqual(comboStrikes('Double Jab -> Cross'), ['DOUBLE JAB', 'CROSS'])
  assert.deepEqual(comboStrikes('Teep'), ['TEEP'])
})

test('effort words and the moment line (page 19 #6)', () => {
  assert.equal(effortWord(7), 'HARD')
  assert.equal(effortWord(1), 'VERY LIGHT')
  assert.equal(effortWord(10), 'MAX EFFORT')
  assert.equal(effortWord(42), 'MAX EFFORT')
  assert.equal(momentLine('Strength A', 7), 'STRENGTH A · RPE 7')
})

test('grass: the lit part is time gone, the edge is a gold mark, heat burns the lit tips', () => {
  const t = 1.3, now = 100
  const lit = timerCell(0.1, 0.2, t, { progress: 0.5, mode: 'work' }, now)
  const dark = timerCell(0.9, 0.2, t, { progress: 0.5, mode: 'work' }, now)
  assert.ok(lit.b > dark.b, 'lit grass is brighter')
  const edge = timerCell(0.5, 0.2, t, { progress: 0.5, mode: 'work' }, now)
  assert.equal(edge.ch, '*')
  const hot = timerCell(0.1, 0.2, t, { progress: 0.5, mode: 'work', hot: true, hotCol: [208, 72, 58] }, now)
  assert.ok(hot.c[0] > lit.c[0] && hot.c[1] < lit.c[1], 'red tips')
  const rest = timerCell(0.1, 0.5, t, { progress: 0.5, mode: 'rest' }, now)
  assert.ok(rest.c[1] > rest.c[0], 'rest is teal')
  const glow = timerCell(0.1, 0.5, t, { progress: 0.5, mode: 'rest', glow: 1 }, now)
  assert.ok(glow.b >= rest.b)
})

test('grass follows the finger: light under it, a beam when pulled, a full pull lights the top', () => {
  const p = { progress: 0, mode: 'work' as const, finger: { x: 0.5, y: 0.8, on: true }, pull: 1 }
  const under = timerCell(0.5, 0.8, 0, p, 0)
  assert.equal(under.ch, '*')
  const beam = timerCell(0.5, 0.5, 0, p, 0)
  assert.equal(beam.ch, '|')
  const top = timerCell(0.5, 0.05, 0, p, 0)
  assert.equal(top.b, 1)
  assert.ok(cellGlyph(top))
})

test('grass grid is the mockups\' fit at 14 px', () => {
  const g = grassGrid(390, 396.68)
  assert.equal(g.cols, 46)
  assert.equal(g.rows, 24)
})

test('an early pull settles back over about a third of a second, easing out', () => {
  assert.ok(PULL_SETTLE_MS >= 300 && PULL_SETTLE_MS <= 400)
  assert.equal(settlePull(0.5, 0), 0.5, 'starts where the finger let go')
  assert.equal(settlePull(0.5, PULL_SETTLE_MS), 0, 'gone at the end')
  assert.equal(settlePull(0.5, PULL_SETTLE_MS * 2), 0)
  const half = settlePull(1, PULL_SETTLE_MS / 2)
  assert.ok(half < 0.5 && half > 0, 'eases out: most of the way down by halfway')
  assert.ok(settlePull(1, 50) > settlePull(1, 100), 'only ever sinks')
  assert.equal(settlePull(0, 10), 0)
})

test('the hold-to-end shows ENDED before leaving', () => {
  assert.ok(ENDED_SHOW_MS >= 600 && ENDED_SHOW_MS <= 1200)
})

test('page 74 timings: the holds 3 s, FINISHING after 1 s, let-go 450 ms, a board out in 180 ms, zones ~1 s', () => {
  assert.equal(END_HOLD_MS, 3000)
  assert.equal(GRASS_HOLD_MS, 3000)
  assert.equal(FINISHING_AFTER_MS, 1000)
  assert.equal(HOLD_RELEASE_MS, 450)
  assert.equal(BOARD_OUT_MS, 180)
  assert.equal(ZONE_EASE_MS, 1000)
  assert.ok(HOLD_TAP_MS < FINISHING_AFTER_MS, 'a tap is over long before FINISHING')
})

test('an early let-go of the grass eases back over 450 ms (ease-out); Reduce Motion: at once', () => {
  assert.equal(holdReleaseLeft(0.6, 0), 0.6)
  assert.equal(holdReleaseLeft(0.6, HOLD_RELEASE_MS), 0)
  assert.ok(holdReleaseLeft(1, HOLD_RELEASE_MS / 2) < 0.5, 'eases out')
  assert.equal(holdReleaseLeft(0.6, 10, true), 0)
})

test('the zone tint eases from where it was to the zone, ease-out over ~1 s; Reduce Motion: instant', () => {
  const teal = [0.5, 0, 0] as const, ember = [0, 0, 1] as const
  assert.deepEqual(zoneEase(teal, ember, 0), [0.5, 0, 0])
  assert.deepEqual(zoneEase(teal, ember, ZONE_EASE_MS), [0, 0, 1])
  assert.ok(zoneEase(teal, ember, ZONE_EASE_MS / 2)[2] > 0.5, 'more than halfway by half time')
  assert.deepEqual(zoneEase(teal, ember, 0, true), [0, 0, 1])
})

test('the run grass: the zone tints it; the bend lies flat behind the wave, untouched beyond it', () => {
  const base = { progress: 0.4, mode: 'work' as const }
  const plain = timerCell(0.8, 0.5, 1, base, 1)
  const ember = zoneCell(0.8, 0.5, 1, { ...base, zone: [0, 0, 1] }, 1)
  assert.ok(ember.c[0] > ember.c[1], 'ember reads red-orange')
  assert.notDeepEqual(ember.c, plain.c)
  // the wave from the thumb at (0.5, 0.9): near the thumb it's flat ('_'), far beyond the front untouched
  const near = zoneCell(0.5, 0.88, 1, { ...base, wave: 0.6, wx: 0.5, wy: 0.9 }, 1)
  assert.equal(near.ch, '_')
  const far = zoneCell(0.02, 0.02, 1, { ...base, wave: 0.2, wx: 0.9, wy: 0.9 }, 1)
  assert.deepEqual(far, timerCell(0.02, 0.02, 1, base, 1))
  // at full the whole band lies flat
  for (const [x, y] of [[0, 0], [1, 0], [0.5, 0.5], [0, 1]]) assert.equal(zoneCell(x, y, 1, { ...base, wave: 1, wx: 0.5, wy: 0.9 }, 1).ch, '_', `${x},${y}`)
})

console.log(`timerLook: ${passed} passed`)

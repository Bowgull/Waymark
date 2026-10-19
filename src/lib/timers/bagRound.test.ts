// Run: tsx src/lib/timers/bagRound.test.ts
// The bag round (page 55, approved 2026-10-19): the cue's 20 s, the M:SS clock,
// one combo size per session in the app, and the lock card's one or two lines.
import assert from 'node:assert/strict'

import {
  bagComboSize, CUE_SHOW_SEC, cueShown, flapWidth, LOCK_COMBO_MAX, LOCK_COMBO_MIN, lockComboLines, lockComboSize,
  lockLineWidth, roundClockText, splitTwoLines, stackHeight, thenHeight, viewFits, type BagRoundView,
} from './bagRound'
import { comboStrikes } from './timerLook'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok: ${name}`) }

// Real library combos (src/db/seed.sql), as page 55 uses them.
const K = (t: string) => comboStrikes(t)
const fl02 = K('Double Jab → Cross → Right Kick')
const f06 = K('Lead Hook → Cross')
const w04 = K('Jab → Cross → Hook → Low Kick')
const f02 = K('Jab → Cross → Hook')
const d04 = K('Jab → Check → Cross → Hook → Right Kick')
const fl04 = K('Jab → Cross → Lead Hook Body → Rear Roundhouse')

// Page 55's phone: 390 wide; the zone between the top bar and the round + clock is 322 tall.
const ZONE_BOX = { width: 390, height: 322 }

test('the cue shows at the bell and in rest, for the first 20 s of a round only', () => {
  assert.equal(CUE_SHOW_SEC, 20)
  assert.equal(cueShown('ready', 0), true)
  assert.equal(cueShown('fighting', 0), true)
  assert.equal(cueShown('fighting', 19), true)
  assert.equal(cueShown('fighting', 19.9), true)
  assert.equal(cueShown('fighting', 20), false)
  assert.equal(cueShown('fighting', 170), false)
  assert.equal(cueShown('rest', 0), true)
  assert.equal(cueShown('rest', 55), true, 'all through rest')
  assert.equal(cueShown('fighting', Number.NaN), true, 'unknown elapsed: still at the bell')
})

test('the round clock reads M:SS', () => {
  assert.equal(roundClockText(161), '2:41')
  assert.equal(roundClockText(5), '0:05')
  assert.equal(roundClockText(180), '3:00')
  assert.equal(roundClockText(600), '10:00')
  assert.equal(roundClockText(-3), '0:00')
  assert.equal(roundClockText(Number.NaN), '0:00')
})

test('flap widths: 0.74 em a letter, 0.38 em a space, plus the gaps', () => {
  // DOUBLE JAB at page 55's 36 px measures 269 px.
  assert.ok(Math.abs(flapWidth('DOUBLE JAB', 36, 1.8) - 269.6) < 0.5)
  assert.equal(flapWidth('', 36, 2), 0)
  assert.ok(Math.abs(stackHeight(3, 36) - 174.24) < 0.01, 'three strikes and two arrows')
  assert.equal(stackHeight(0, 36), 0)
})

test('THEN wraps when it runs out of width', () => {
  const one = thenHeight([f06], 362)
  assert.ok(Math.abs(one - 17.92) < 0.01, 'one line')
  assert.ok(thenHeight([fl04], 362) > one * 2, 'the longest combo wraps to two lines')
  assert.equal(thenHeight([], 362), 0)
  assert.ok(thenHeight([f06, f02], 362) > one * 2, 'a third combo gets its own line')
})

test('one combo size per session, fitted to its longest combo (page 55: 36 px)', () => {
  // Round 3 (fl02, then f06) and its rest board (round 4: w04, then f02).
  const views: BagRoundView[] = [{ now: fl02, then: [f06] }, { now: w04, then: [f02] }]
  assert.equal(bagComboSize(views, ZONE_BOX), 36, 'the four-strike combo sets it')
  // A session of three-strike combos gets bigger tiles (page 55: about 50).
  const three = bagComboSize([{ now: fl02, then: [f06] }, { now: f02, then: [] }], ZONE_BOX)
  assert.ok(three > 36 && three >= 45, `three strikes: ${three}`)
  // Every view of the session fits at the chosen size, and the next size up does not.
  for (const v of views) assert.ok(viewFits(v, 36, ZONE_BOX.width, ZONE_BOX.height))
  assert.ok(!views.every(v => viewFits(v, 37, ZONE_BOX.width, ZONE_BOX.height)))
})

test('the stress test: five strikes and REAR ROUNDHOUSE drop the whole session to 23 px', () => {
  const views: BagRoundView[] = [{ now: d04, then: [fl04] }, { now: fl04, then: [d04] }]
  assert.equal(bagComboSize(views, ZONE_BOX), 23)
})

test('the longest word sets the size on a narrow screen', () => {
  // One strike, a long word, in a narrow tall zone: width decides, not height.
  const size = bagComboSize([{ now: ['REAR ROUNDHOUSE'], then: [] }], { width: 200, height: 600 })
  assert.ok(flapWidth('REAR ROUNDHOUSE', size, size * 0.05) <= 192)
  assert.ok(flapWidth('REAR ROUNDHOUSE', size + 1, (size + 1) * 0.05) > 192)
})

test('the combo size never goes below 16 or above 60', () => {
  assert.equal(bagComboSize([{ now: d04, then: [fl04] }], { width: 120, height: 80 }), 16)
  assert.equal(bagComboSize([{ now: ['JAB'], then: [] }], { width: 2000, height: 2000 }), 60)
  assert.equal(bagComboSize([], ZONE_BOX), 60, 'no combos: nothing to shrink for')
  assert.equal(bagComboSize([{ now: fl02, then: [] }], { width: 0, height: 0 }), 16, 'not laid out yet')
})

test('lock card: two balanced lines broken at an arrow (page 55 split2)', () => {
  assert.deepEqual(splitTwoLines(fl02), [['DOUBLE JAB'], ['CROSS', 'RIGHT KICK']])
  assert.deepEqual(splitTwoLines(w04), [['JAB', 'CROSS'], ['HOOK', 'LOW KICK']])
  assert.deepEqual(splitTwoLines(d04), [['JAB', 'CHECK', 'CROSS'], ['HOOK', 'RIGHT KICK']])
  assert.deepEqual(splitTwoLines(fl04), [['JAB', 'CROSS', 'LEAD HOOK BODY'], ['REAR ROUNDHOUSE']])
  assert.deepEqual(splitTwoLines(['TEEP']), [['TEEP']])
})

test('lock card: one line when it fits, two when long', () => {
  assert.deepEqual(lockComboLines(f06, 19), [f06], 'LEAD HOOK › CROSS fits one line')
  assert.equal(lockComboLines(fl02, 19).length, 2)
  assert.ok(lockLineWidth(['JAB', 'CROSS'], 19, true) > lockLineWidth(['JAB', 'CROSS'], 19), 'the trailing › counts')
})

test('lock card: 19 pt for page 55\'s session, 18 pt for the longest combos', () => {
  assert.equal(lockComboSize([fl02, f06, w04, f02]), 19)
  assert.equal(lockComboSize([d04, fl04]), 18)
  assert.equal(lockComboSize([]), LOCK_COMBO_MAX)
  assert.equal(lockComboSize([['REAR ROUNDHOUSE', 'REAR ROUNDHOUSE', 'REAR ROUNDHOUSE', 'REAR ROUNDHOUSE']]), LOCK_COMBO_MIN, 'never below the xs minimum')
})

test('X11: a long single strike keeps about 25 px clear at each side of a 390 pt screen', () => {
  const px = bagComboSize([{ now: ['REAR ROUNDHOUSE'], then: [] }], { width: 390, height: 420 })
  const w = flapWidth('REAR ROUNDHOUSE', px, px * 0.05)
  assert.ok(w <= 390 - 50, `${w} px wide at ${px} px`)
})

console.log(`\n${passed} bag round tests passed`)

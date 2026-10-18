// The world's pure parts: tabs to places, the camera's views and glide, time of day, the store.
import assert from 'node:assert/strict'

import { GLIDE_MS, PLACE_ORIGIN, PLACE_VIEWS, frustumFor, glideEase, mixView, placeForPath, sceneGlyphWorld, sceneLamp, sceneOf, scenesInView } from './places'
import { modeForClock, msUntilNextChange, parseOverride, resolveMode, TIME_OVERRIDES } from './timeOfDay'
import { getWorldState, sameWeeks, setWorldBare, setWorldLantern, setWorldPlace, setWorldWeeks, subscribeWorld, weeksOrDefault } from './worldStore'

let passed = 0
const test = (name: string, fn: () => void) => { fn(); passed++; void name }

test('tabs map to places; screens with no world map to none', () => {
  assert.equal(placeForPath('/today'), 'clearing')
  assert.equal(placeForPath('/'), 'clearing')
  assert.equal(placeForPath('/program'), 'road')
  assert.equal(placeForPath('/library'), 'arch')
  assert.equal(placeForPath('/history'), 'pond')
  assert.equal(placeForPath('/settings'), null)
  assert.equal(placeForPath('/session/abc'), null)
  assert.equal(sceneOf('arch'), 'clearing', 'the arch stands down the clearing\'s path')
  assert.equal(sceneOf('home'), 'home')
})

test('each place keeps its mockup framing and glyph size', () => {
  assert.equal(PLACE_VIEWS.clearing.pxPerUnit, 844 / 11)
  assert.equal(PLACE_VIEWS.road.pxPerUnit, 50)
  assert.equal(PLACE_VIEWS.home.pxPerUnit, 844 / 7.5)
  assert.ok(Math.abs(sceneGlyphWorld('clearing') - 11 / 844 * 9) < 1e-9, 'page 14: frustum 11 on 844 px, 9 px glyphs')
  // Program's road band: the look point sits 200 px down an 844 px screen, 8 units in 400 px
  const f = frustumFor(PLACE_VIEWS.road, 390, 844)
  assert.ok(Math.abs(f.top - 4) < 1e-9)
  assert.ok(Math.abs(f.top - f.bottom - 844 / 50) < 1e-9)
  assert.ok(Math.abs(f.right - f.left - 390 / 50) < 1e-9)
  // the scenes sit apart along x, one world
  assert.deepEqual(Object.values(PLACE_ORIGIN), [-14, 0, 14, 28])
  assert.equal(sceneLamp('clearing')[0], 1.58)
  assert.equal(sceneLamp('pond')[0], 28 + 1.58)
})

test('the glide eases in and out, zoom in log space, ends exactly on the target', () => {
  assert.equal(glideEase(0), 0)
  assert.equal(glideEase(1), 1)
  assert.equal(glideEase(0.5), 0.5)
  assert.ok(glideEase(0.1) < 0.1 && glideEase(0.9) > 0.9)
  assert.equal(GLIDE_MS, 1100)
  const a = PLACE_VIEWS.clearing, b = PLACE_VIEWS.home
  assert.deepEqual(mixView(a, b, 1), { ...b, pxPerUnit: mixView(a, b, 1).pxPerUnit })
  assert.ok(Math.abs(mixView(a, b, 1).pxPerUnit - b.pxPerUnit) < 1e-9)
  const mid = mixView(a, b, 0.5)
  assert.ok(Math.abs(mid.pxPerUnit - Math.sqrt(a.pxPerUnit * b.pxPerUnit)) < 1e-9)
  assert.equal(mid.x, -7)
  assert.equal(mixView(PLACE_VIEWS.clearing, PLACE_VIEWS.arch, 1).near, 20, 'the arch view clips the near oaks')
})

test('only scenes near the camera are drawn', () => {
  assert.deepEqual(scenesInView(PLACE_VIEWS.clearing, 390), ['clearing'])
  assert.deepEqual(scenesInView(PLACE_VIEWS.pond, 390), ['pond'])
  // half way between clearing and road, both
  assert.deepEqual(scenesInView(mixView(PLACE_VIEWS.clearing, PLACE_VIEWS.road, 0.5), 390).sort(), ['clearing', 'road'])
})

test('time of day follows the clock unless Settings says otherwise', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m)
  assert.equal(modeForClock(at(5, 59)), 'night')
  assert.equal(modeForClock(at(6)), 'misty')
  assert.equal(modeForClock(at(10)), 'sun')
  assert.equal(modeForClock(at(15, 59)), 'sun')
  assert.equal(modeForClock(at(16)), 'misty')
  assert.equal(modeForClock(at(19)), 'night')
  assert.equal(resolveMode('clock', at(12)), 'sun')
  assert.equal(resolveMode('night', at(12)), 'night')
  assert.equal(resolveMode('misty', at(23)), 'misty')
  assert.equal(parseOverride('sun'), 'sun')
  assert.equal(parseOverride('garbage'), 'clock')
  assert.equal(parseOverride(null), 'clock')
  assert.deepEqual(TIME_OVERRIDES.map(o => o.label), ['FOLLOW THE CLOCK', 'ALWAYS MISTY', 'ALWAYS DAY', 'ALWAYS NIGHT'])
  assert.equal(msUntilNextChange(at(9, 30)), 30 * 60 * 1000, 'to 10:00')
  assert.equal(msUntilNextChange(at(20)), 10 * 3600 * 1000, 'to 06:00 tomorrow')
})

test('the store tells the world only what changed', () => {
  let calls = 0
  const off = subscribeWorld(() => calls++)
  setWorldPlace('home'); setWorldPlace('home')
  assert.equal(getWorldState().place, 'home')
  assert.equal(calls, 1, 'same value: no notice')
  setWorldLantern(4); assert.equal(getWorldState().lantern, 1)
  setWorldLantern(Number.NaN); assert.equal(getWorldState().lantern, 1)
  setWorldWeeks([{ state: 'done', notches: 14 }, { state: 'now', notches: 2.4 }])
  assert.deepEqual(getWorldState().weeks, [{ state: 'done', notches: 10 }, { state: 'now', notches: 2 }])
  const before = calls
  setWorldWeeks([{ state: 'done', notches: 10 }, { state: 'now', notches: 2 }])
  assert.equal(calls, before, 'same weeks: no rebuild')
  setWorldBare(true); assert.equal(getWorldState().bare, true); setWorldBare(false)
  assert.equal(weeksOrDefault(null).length, 6)
  assert.equal(sameWeeks(null, null), true)
  off()
})

console.log(`world.test: ${passed} passed`)

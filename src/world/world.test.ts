// The world's pure parts: tabs to places, the camera's views and glide, time of day, the store.
import assert from 'node:assert/strict'

import { SPLASH_HOLD_MS, SPLASH_TIMELINE, SPLASH_TITLE_AT, splashGesture, splashSkip } from './splashSkip'
import { GLIDE_MS, PLACE_ORIGIN, PLACE_VIEWS, TODAY_ZOOM, frustumFor, glideEase, lampK, mixView, placeForPath, sceneGlyphWorld, sceneLamp, sceneOf, scenesInView, viewGlyphWorld } from './places'
import { modeForClock, msUntilNextChange, parseOverride, resolveMode, TIME_OVERRIDES } from './timeOfDay'
import { getWorldState, pondLook, sameWeeks, setWorldPond, setWorldBackdrop, setWorldBare, setWorldLantern, setWorldPlace, setWorldWeather, setWorldWeeks, subscribeWorld, weeksOrDefault } from './worldStore'
import { LIGHTNING_MIN_GAP_S, NO_WEATHER, WX, nextBoltIn, weatherMode, weatherParams } from './weather'

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
  // Today: page 14's world enlarged as Today's mockups show it (the .stillbg: 150% wide, 42% down)
  assert.ok(Math.abs(TODAY_ZOOM - 1.27174) < 1e-4)
  assert.ok(Math.abs(PLACE_VIEWS.clearing.pxPerUnit - (844 / 11) * TODAY_ZOOM) < 1e-9 && Math.abs(PLACE_VIEWS.clearing.glyph - 9 * TODAY_ZOOM) < 1e-9)
  assert.ok(Math.abs(PLACE_VIEWS.clearing.anchor * 844 - 410.43) < 0.01, 'the look point 410 px down, as in the still')
  assert.equal(PLACE_VIEWS.road.pxPerUnit, 50)
  assert.equal(PLACE_VIEWS.home.pxPerUnit, 844 / 7.5)
  assert.ok(Math.abs(sceneGlyphWorld('clearing') - 11 / 844 * 9) < 1e-9, 'page 14: frustum 11 on 844 px, 9 px glyphs')
  // Program's road band: the 400 px render drawn into the 46% band (cover), so its look point sits 194 px down
  const f = frustumFor(PLACE_VIEWS.road, 390, 844)
  assert.ok(Math.abs(f.top - 194 / 50) < 1e-9)
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
  assert.equal(GLIDE_MS, 900, 'page 59: the glide is 900 ms (was 1100)')
  const a = PLACE_VIEWS.clearing, b = PLACE_VIEWS.home
  assert.deepEqual(mixView(a, b, 1), { ...b, pxPerUnit: mixView(a, b, 1).pxPerUnit, glyph: mixView(a, b, 1).glyph })
  assert.ok(Math.abs(mixView(a, b, 1).glyph - b.glyph) < 1e-9)
  assert.ok(Math.abs(mixView(a, b, 1).pxPerUnit - b.pxPerUnit) < 1e-9)
  const mid = mixView(a, b, 0.5)
  assert.ok(Math.abs(mid.pxPerUnit - Math.sqrt(a.pxPerUnit * b.pxPerUnit)) < 1e-9)
  assert.equal(mid.x, -7)
  // page 14b exactly: frustum 4.2 on the phone, the look point centred, nothing clipped, a slow sway
  const arch = PLACE_VIEWS.arch
  assert.ok(Math.abs(arch.pxPerUnit - 844 / 4.2) < 1e-9 && arch.anchor === 0.5 && arch.near === 0.1 && arch.orbit === 0.04, "the arch view is page 14b's close-up")
  assert.ok(Math.abs(arch.x - (0.25 + Math.sin(-7.4 * 0.42) * 0.75)) < 1e-9 && arch.lookY === 1.4 && arch.lookZ === -7.4 && arch.camY === 3.2, 'looking at the arch down the path')
  // glyphs keep their view's size at any zoom: a card built for the clearing scales by the glyph-world ratio (world.ts uK)
  assert.ok(Math.abs(viewGlyphWorld(arch) / sceneGlyphWorld('clearing') - 4.2 / 11) < 1e-9, "the clearing's glyph cards shrink to 4.2/11 at the arch (9 px there)")
  assert.ok(Math.abs(viewGlyphWorld(PLACE_VIEWS.clearing) - sceneGlyphWorld('clearing')) < 1e-12, 'at its own view a scene prints at its built size')
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
  assert.equal(getWorldState().backdrop, null, 'no backdrop by default')
  setWorldBackdrop('clearing'); assert.equal(getWorldState().backdrop, 'clearing', 'the MT class log shows the forest behind its card (page 31)')
  setWorldBackdrop(null); assert.equal(getWorldState().backdrop, null)
  assert.equal(weeksOrDefault(null).length, 6)
  assert.equal(sameWeeks(null, null), true)
  assert.equal(getWorldState().pond, 0.5, 'the pond is neutral by default')
  setWorldPond(2 / 3); assert.equal(getWorldState().pond, 0.67)
  setWorldPond(null); assert.equal(getWorldState().pond, 0.5)
  assert.deepEqual(pondLook(0.5), { water: 1, flies: 1 }, 'neutral = the water as page 32 draws it')
  assert.ok(pondLook(0).water < 1 && pondLook(0).flies < 1 && pondLook(1).water > 1, 'a slow week is darker and stiller; a good one brighter')
  off()
})

// the lantern: readiness dims it by day; at night it never burns below page 14 #c (night clearing)
{
  assert.equal(lampK('misty', 1), 1)
  assert.equal(lampK('misty', 0), 0.45)
  assert.equal(lampK('sun', 0.85), 0.45 + 0.55 * 0.85)
  assert.equal(lampK('night', 0), 1)
  assert.equal(lampK('night', 0.85), 1)
  assert.equal(lampK('night', 1), 1)
}

// page 58: the injury weather over the whole world
test('the weather follows the pattern; quieter after GOT IT / DO IT; offline stays grey; green wins', () => {
  const p1 = weatherParams({ level: 1, quiet: false, clearing: false }, false)
  assert.deepEqual([p1.green, p1.rain, p1.grade, p1.lightning], [WX.rain1.green, WX.rain1.rain, WX.rain1.grade, 0], "green rain: page 58's rain1")
  const p2 = weatherParams({ level: 2, quiet: false, clearing: false }, false)
  assert.ok(p2.rain > p1.rain && p2.puddles > p1.puddles && p2.dark > p1.dark, 'a downpour: heavier rain, glowing puddles, darker sky')
  const p3 = weatherParams({ level: 3, quiet: false, clearing: false }, false)
  assert.ok(p3.lightning === 1 && p3.wind > 0.9 && p3.leaves === 1, 'a storm: wind, torn leaves, lightning')
  const q1 = weatherParams({ level: 1, quiet: true, clearing: false }, false)
  assert.equal(q1.rain, WX.held.rain, "the quieter fall is page 58's held")
  const q3 = weatherParams({ level: 3, quiet: true, clearing: false }, false)
  assert.ok(q3.rain < p3.rain && Math.abs(q3.rain / p3.rain - 0.62) < 0.01 && q3.lightning === 0, 'a settled storm: about 60% of the rain, no lightning')
  const c = weatherParams({ level: 0, quiet: false, clearing: true }, false)
  assert.ok(c.rain === 0 && c.shafts === 1 && c.sprouts === 1 && c.glints === 1 && c.dust === 1, 'the clearing: no rain; shafts, glints, shoots, dust')
  assert.equal(weatherParams(NO_WEATHER, true).grey, 1, 'offline alone: the grey rain')
  const both = weatherParams({ level: 1, quiet: false, clearing: false }, true)
  assert.ok(both.grey === 0 && both.rain > 0 && both.green > 0, 'offline and green rain: green wins')
  assert.equal(weatherParams(NO_WEATHER, false).rain, 0, 'no weather, no rain')
  assert.equal(weatherMode('misty', { level: 0, quiet: false, clearing: true }), 'sun', "the clearing brings the sun's shafts")
  assert.equal(weatherMode('night', { level: 1, quiet: false, clearing: false }), 'night')
  assert.ok(nextBoltIn(0) >= LIGHTNING_MIN_GAP_S && nextBoltIn(1) >= LIGHTNING_MIN_GAP_S && nextBoltIn(-5) === 4, 'lightning: at most one flash every 4 s')
  let n = 0
  const off = subscribeWorld(() => n++)
  setWorldWeather({ level: 1, quiet: false, clearing: false })
  setWorldWeather({ level: 1, quiet: false, clearing: false })
  assert.equal(n, 1, 'the same weather emits once')
  setWorldWeather(null)
  assert.deepEqual(getWorldState().weather, NO_WEATHER)
  off()
})

test('the splash: one tap skips to the title screen, a hold skips it all (page 38 A, changed by Josh)', () => {
  assert.equal(splashGesture(0), 'tap')
  assert.equal(splashGesture(SPLASH_HOLD_MS - 1), 'tap')
  assert.equal(splashGesture(SPLASH_HOLD_MS), 'hold')
  assert.ok(SPLASH_TITLE_AT > SPLASH_TIMELINE.flareOff - 0.01 && SPLASH_TITLE_AT >= SPLASH_TIMELINE.word, 'the title: the crest whole, the flare done, WAYMARK showing')
  assert.ok(SPLASH_TITLE_AT < SPLASH_TIMELINE.leave, 'and before the lift')
  // a tap 1 s in: the crest jumps to the title, and the rest plays from there
  const t = splashSkip('tap', 1, SPLASH_TIMELINE)
  assert.equal(t.crestAt, SPLASH_TITLE_AT)
  assert.equal(t.word, 0, 'WAYMARK at once')
  assert.ok(Math.abs(t.leave - (SPLASH_TIMELINE.leave - SPLASH_TITLE_AT)) < 1e-9)
  assert.ok(Math.abs(t.end - (SPLASH_TIMELINE.end - SPLASH_TITLE_AT)) < 1e-9)
  assert.ok(t.end < 3, 'a tap reaches the app in under 3 s, not 10')
  // a tap once the title is up changes nothing
  const late = splashSkip('tap', 8, SPLASH_TIMELINE)
  assert.equal(late.crestAt, null)
  assert.ok(Math.abs(late.leave - (SPLASH_TIMELINE.leave - 8)) < 1e-9)
  // a hold: straight into the app
  const h = splashSkip('hold', 2, SPLASH_TIMELINE)
  assert.equal(h.leave, 0)
  assert.ok(h.end <= 0.3, 'the app at once (a 0.3 s fade)')
  assert.ok(h.gone <= h.end)
})

console.log(`world.test: ${passed} passed`)

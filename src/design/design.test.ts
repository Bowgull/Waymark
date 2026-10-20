import assert from 'node:assert/strict'

import { FLIP, changeFrames, fitFlapSize, fitsOnFlap, flapCells, flapStaggerMs, flapWidth, flipFrames, frameAt, openFrames, openStartMs, planFlip } from './flap'
import { markBusy, motionBusy } from './busy'
import { popParts } from './popFlap'
import { sessionIconFor } from './sessionIconKeys'
import { easeOut, sceneAt, SCENE, windowHeight } from './sceneScroll'

// ─── flap cells: never truncate, gaps are clear, padding is tiles ──
{
  const cells = flapCells('next round', 12)
  assert.equal(cells.length, 12, 'pads to len')
  assert.equal(cells.map(c => c.char).join(''), 'NEXT ROUND  ', 'upper-cased')
  assert.equal(cells[4].kind, 'gap', 'a space between words is a gap')
  assert.equal(cells[10].kind, 'pad', 'trailing padding stays a tile')
  assert.equal(cells[11].kind, 'pad')
  assert.equal(flapCells('A VERY LONG LABEL', 4).length, 17, 'a set length never cuts')
  assert.equal(flapCells('ab  ').filter(c => c.kind === 'pad').length, 2, 'trailing spaces are padding, not gaps')
}

// ─── flips: digits through digits the short way, letters through letters ──
{
  assert.deepEqual(flipFrames('9', '8'), ['8'], 'a countdown ticks one digit')
  assert.deepEqual(flipFrames('8', '9'), ['9'])
  assert.deepEqual(flipFrames('0', '9'), ['9'], '0 -> 9 goes back one, not forward nine')
  assert.deepEqual(flipFrames('2', '5'), ['3', '4', '5'])
  for (const f of flipFrames(' ', '7')) assert.match(f, /^[0-9]$/, 'a digit never shows a letter')
  const letters = flipFrames('A', 'Z', 5)
  assert.equal(letters[letters.length - 1], 'Z')
  assert.ok(letters.length <= 5)
  for (const f of letters) assert.match(f, /^[A-Z]$/, 'a letter only flips through letters')
  assert.deepEqual(flipFrames('X', '·'), ['·'], 'other glyphs just land')
  assert.deepEqual(flipFrames('Q', 'Q'), ['Q'])
}

// ─── a whole label lands within 0.9 s ──
{
  const stagger = flapStaggerMs(20, 5)
  assert.ok(19 * stagger + 5 * 55 <= 900)
  assert.equal(flapStaggerMs(1, 5), 0)
  assert.equal(flapStaggerMs(4, 2), 28, 'short labels keep the preferred stagger')
}

// ─── no truncation: step down a size until it fits ──
{
  assert.ok(flapWidth('AB', 'md') < flapWidth('A B C', 'md') + 100)
  assert.ok(flapWidth('NEXT ROUND', 'sm') < flapWidth('NEXTXROUND', 'sm'), 'a gap is narrower than a tile')
  assert.equal(fitFlapSize('SAVE', 300, 'md'), 'md')
  assert.equal(fitFlapSize("THE PROGRAM DIDN'T LOAD", 340, 'md'), 'sm')
  assert.equal(fitFlapSize('A REALLY VERY LONG LABEL THAT WILL NOT FIT ANYWHERE', 100, 'md'), 'xs', 'never smaller than xs')
}

// ─── pop-ups: short words on the flap, long ones as plain words ──
{
  assert.deepEqual(popParts('Logged.'), { title: 'Logged', text: null })
  assert.deepEqual(popParts("Couldn't save. Check your connection."), { title: "Couldn't save", text: 'Check your connection.' }, "page 35 A: COULDN'T SAVE on the flap")
  assert.deepEqual(popParts('No connection. Set saved on this phone. It syncs when you are back online.'), { title: 'No connection', text: 'Set saved on this phone. It syncs when you are back online.' })
  assert.deepEqual(popParts('Bag work moved to Thursday evening because Wednesday is full.'), { title: null, text: 'Bag work moved to Thursday evening because Wednesday is full.' }, 'no short first sentence: plain words only')
  assert.deepEqual(popParts('Saved.', 'SAVED'), { title: 'SAVED', text: null }, 'a title equal to the message is not repeated')
  assert.deepEqual(popParts('Week 2 back.', 'NOT TODAY'), { title: 'NOT TODAY', text: 'Week 2 back.' })
  assert.ok(fitsOnFlap('RESUME'))
  assert.ok(!fitsOnFlap(''))
}

// ─── session icons per app type ──
{
  assert.equal(sessionIconFor('strength'), 'strength')
  assert.equal(sessionIconFor('mobility'), 'foundation', 'the internal type stays mobility; the icon is Foundation')
  assert.equal(sessionIconFor('active_recovery'), 'reset')
  assert.equal(sessionIconFor('foundation_run'), 'zone2')
  assert.equal(sessionIconFor('running', 'zone2'), 'zone2')
  assert.equal(sessionIconFor('running', 'progression'), 'run')
  assert.equal(sessionIconFor('mt_class'), 'mt')
  assert.equal(sessionIconFor('bag_work'), 'bag')
  assert.equal(sessionIconFor('skip_rope'), 'rope')
}

// ─── the flap engine's plan (page 59 §5.2): one pass, only what changes, inside 0.9 s ──
{
  // a screen opening: blank -> a nearby glyph -> the glyph, two flips a tile
  assert.deepEqual(openFrames('P'), ['O', 'P'])
  assert.deepEqual(openFrames('A'), ['Z', 'A'], 'wraps round the alphabet')
  assert.deepEqual(openFrames('7'), ['6', '7'], 'a digit through digits')
  assert.deepEqual(openFrames('0'), ['9', '0'])
  assert.deepEqual(openFrames(' '), [], 'a gap stays clear')
  assert.deepEqual(openFrames('·'), ['·'], 'other glyphs land in one')
  for (const ch of 'WAYMARK0123456789') assert.ok(openFrames(ch).length <= 2, 'never more than two flips on open')

  // a change: at most three flips for a letter, digits the short way
  for (const [a, b] of [['A', 'Z'], ['B', 'Q'], [' ', 'M'], ['Z', 'A']]) {
    const f = changeFrames(a, b)
    assert.ok(f.length >= 1 && f.length <= FLIP.changeFlips, `${a} -> ${b} in at most three`)
    assert.equal(f[f.length - 1], b)
  }
  assert.deepEqual(changeFrames('9', '8'), ['8'], 'the clock ticks one flip')
  assert.deepEqual(changeFrames('2', '5'), ['3', '4', '5'])

  // the plan: 55 ms a flip, 14 ms a column, left to right; tiles with no frames are left alone
  const plan = planFlip([['O', 'P'], [], ['Q', 'R']], 1000)
  assert.deepEqual(plan.map(s => [s.cell, s.at, s.glyph]), [[0, 1000, 'O'], [0, 1055, 'P'], [2, 1028, 'Q'], [2, 1083, 'R']])
  // a long label still lands inside its budget
  const long = planFlip(Array.from({ length: 30 }, () => openFrames('W')), 0, FLIP.openMaxMs)
  assert.ok(Math.max(...long.map(s => s.at)) + FLIP.stepMs <= FLIP.openMaxMs, 'an opening label lands within 400 ms')
  const change = planFlip(Array.from({ length: 24 }, () => changeFrames('A', 'Z')), 0)
  assert.ok(Math.max(...change.map(s => s.at)) + FLIP.stepMs <= FLIP.maxMs, 'a change lands within 0.9 s')
  assert.equal(new Set(long.map(s => s.cell)).size, 30, 'every tile flips')
  assert.ok(long.filter(s => s.cell === 0).length === 2, 'each tile writes twice on open, no more')

  // time-based: a phone that falls behind skips frames, it never stretches the flip
  assert.equal(frameAt(100, 55, 2, 99), -1, 'not started')
  assert.equal(frameAt(100, 55, 2, 100), 0)
  assert.equal(frameAt(100, 55, 2, 154), 0)
  assert.equal(frameAt(100, 55, 2, 155), 1)
  assert.equal(frameAt(100, 55, 2, 5000), 1, 'a frame 5 s late lands on the last glyph')
  assert.equal(frameAt(0, 55, 0, 10), -1)

  // the screen's stagger (page 59 §5.1): boards 60 ms apart, at most four, labels 120 ms after their board
  assert.equal(openStartMs(560, 0, 0), 680, 'the header flips 120 ms after it rises at 560 ms')
  assert.equal(openStartMs(560, 1, 0), 740)
  assert.equal(openStartMs(560, 3, 0), 860)
  assert.equal(openStartMs(560, 9, 0), 860, 'the 4th board and everything after it together')
  assert.equal(openStartMs(560, 0, 2000), 2000, 'a late label starts now, never in the past')
  // the whole switch: the last board's labels flip from 860 ms and land by about 1.3 s
  const lastBoard = planFlip(Array.from({ length: 16 }, () => openFrames('M')), openStartMs(560, 3, 0), FLIP.openMaxMs)
  assert.ok(Math.max(...lastBoard.map(s => s.at)) + FLIP.stepMs <= 1300, 'all landed by about 1.3 s')

  // the busy flag the world's quality ladder reads
  markBusy(1000)
  assert.ok(motionBusy(), 'busy while the UI moves')
  assert.ok(!motionBusy(performance.now() + 5000), 'calm after')
}

// ─── scroll reveals (page 67): parallax 0.4, the veil to 60%, the backing, covered, the window ──
{
  assert.equal(SCENE.boardsAt, 0.46)
  assert.equal(SCENE.boardsAtToday, 0.4)
  assert.deepEqual(sceneAt(0, 272, false), { shift: 0, veil: 0, solid: false, covered: false }, 'at the window: the scene open')
  const half = sceneAt(136, 272, false)
  assert.equal(half.shift, -0.4 * 136, 'the scene follows at 40% of the scroll')
  assert.ok(Math.abs(half.veil - 0.3) < 1e-9 && !half.solid && !half.covered)
  assert.ok(sceneAt(233, 272, false).solid, 'the backing fades in 40 px before the boards reach the header')
  assert.ok(!sceneAt(232, 272, false).solid)
  const full = sceneAt(600, 272, false)
  assert.ok(Math.abs(full.veil - 0.6) < 1e-9 && full.solid && full.covered, 'covered: 60% veil, the world idles')
  assert.equal(sceneAt(600, 272, true).shift, 0, 'Reduce Motion: no parallax')
  assert.ok(Math.abs(sceneAt(600, 272, true).veil - 0.6) < 1e-9, 'Reduce Motion: the darkening only')
  assert.deepEqual(sceneAt(-60, 272, false), { shift: 0, veil: 0, solid: false, covered: false }, 'a pull down at the top only bounces')
  assert.deepEqual(sceneAt(10, 0, false), { shift: 0, veil: 0, solid: true, covered: false }, 'no window: the header backs once anything slides under it')
  // 390 × 844: the boards 388 px down (46%), Today 338 (40%), under a 116 px header with a 10 px gap
  assert.equal(windowHeight({ at: 0.46, shellH: 844, viewH: 746, top: 116, gap: 10 }), 262)
  assert.equal(windowHeight({ at: 0.4, shellH: 844, viewH: 746, top: 116, gap: 10 }), 212)
  // a short screen: the first board's edge stays above the tab bar
  assert.equal(windowHeight({ at: 0.46, shellH: 240, viewH: 160, top: 66, gap: 0 }), 160 - SCENE.peekPx - 66)
  assert.equal(windowHeight({ at: 0.46, shellH: 200, viewH: 120, top: 100, gap: 0 }), 0)
  assert.equal(easeOut(0), 0)
  assert.ok(Math.abs(easeOut(1) - 1) < 1e-6)
  assert.ok(easeOut(0.3) > 0.7, '--ease-out arrives early')
}

console.log('design tests passed')

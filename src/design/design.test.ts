import assert from 'node:assert/strict'

import { fitFlapSize, fitsOnFlap, flapCells, flapStaggerMs, flapWidth, flipFrames } from './flap'
import { popParts } from './popFlap'
import { sessionIconFor } from './sessionIconKeys'

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

console.log('design tests passed')

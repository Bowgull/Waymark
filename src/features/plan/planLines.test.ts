// Page 94 (approved 2026-10-29): every opened session is a logbook. Foundation, runs and bag.
import assert from 'node:assert/strict'

import { foundationLog, planLines, plainName } from './planLines'

const MON = 20755
const row = (type: string, extra: Record<string, unknown> = {}) => ({ id: 'x', type, label: null, status: 'planned', scheduledDate: MON, timeSlot: 'am', blockType: 'block_zero', blockWeek: 1, notes: null, ...extra }) as never

// Names read plainly, short caps and inner capitals kept.
assert.equal(plainName('Goblet Squat'), 'Goblet squat')
assert.equal(plainName('McGill Curl-Up'), 'McGill curl-up')
assert.equal(plainName('Side Plank (Knees)'), 'Side plank (knees)')
assert.equal(plainName('Landmine RDL'), 'Landmine RDL')
assert.equal(plainName('Thoracic Extension (Foam Roller)'), 'Thoracic extension (foam roller)')
assert.equal(plainName('Prone Y-T Raise'), 'Prone Y-T raise')

// Foundation, before its rows are written: the routine at his level, back first, then neck and shoulders.
{
  const lines = planLines(row('mobility'), null, { weekNumber: 1 })
  assert.deepEqual(lines.filter(l => l.head).map(l => l.label), ['Back', 'Neck and shoulders'])
  assert.deepEqual(lines.find(l => l.label === 'Crocodile breathing')?.move, { sets: '45s', load: null, note: null })
  assert.deepEqual(lines.find(l => l.label === 'McGill curl-up')?.move, { sets: '5', load: null, note: 'hold 6 s' })
  assert.deepEqual(lines.find(l => l.label === 'Bird dog')?.move, { sets: '5', load: null, note: 'each side, hold 5 s' })
  assert.ok(lines.every(l => l.move || l.head), 'every line a move or a head')
}
// Foundation's own rows once written.
assert.deepEqual(foundationLog([{ name: 'Prone Y-T Raise', sets: 2, holdSec: null, reps: 8, section: 'upper' }]).map(l => [l.label, l.move?.sets]), [['Neck and shoulders', undefined], ['Prone Y-T raise', '2×8']])

// His Saturday run: 15 min straight, the heart's top, the treadmill, the talk test.
{
  const dose = JSON.stringify({ run: { runSec: 900, walkSec: 0, rounds: 1, totalSec: 900, hrCeilingBpm: 147, walkOnly: false, talkTestDue: true } })
  const lines = planLines(row('foundation_run', { label: 'Zone 2 Run', doseJson: dose }), { kind: 'run', plan: { targetDurSec: 900, z2CeilingBpm: 147, easyKmh: 7.8 } as never, run: null }, { unit: 'kmh' })
  assert.deepEqual(lines.map(l => [l.label, l.move?.load ?? null]), [['Easy run', '15 min'], ['Heart rate', 'max 147'], ['Treadmill', '7.8 km/h'], ['Outside pace', null], ['Talk test', null]])
  assert.ok(!lines.some(l => /run-walk/i.test(l.label)), 'a straight run never reads Run-Walk')
  assert.match(lines.find(l => l.label === 'Outside pace')?.move?.note ?? '', /^\d+:\d\d \/km$/, 'the outside pace too: where he runs is his call')
}

// Bag: each round with its combos, then the rest.
{
  const lines = planLines(row('bag_work'), { kind: 'bag', rounds: 2, plannedMin: 8, plannedSecs: [180, 180], roundSecs: null, restSec: 60, roundCombos: [['Jab · Cross'], ['Teep · Cross · Lead Hook']] })
  assert.deepEqual(lines.map(l => [l.label, l.move?.sets, l.move?.note]), [['Round 1', '3 min', 'Jab · Cross'], ['Round 2', '3 min', 'Teep · Cross · Lead Hook'], ['Rest', '1 min', 'between rounds']])
}

console.log('plan lines tests passed')

// Run: tsx src/lib/coach/bagArc.test.ts
// Bag sessions three ways (page 80): the kru's arc (no round repeated, a new
// combo in technique first), Hybrid's fill, Custom's passthrough, routines.
import assert from 'node:assert/strict'

import {
  builderFromRoutine,
  kruArc,
  parseBagSpec,
  parseRoutineRow,
  pickerGroups,
  planCoachRounds,
  planCustomRounds,
  planHybridRounds,
  poolTag,
  roundsForSpec,
  routineFromBuilder,
  type PoolCombo,
} from './bagArc'

const NOW = 1_800_000_000
const DAY = 86400
const c = (id: string, text: string, tier: string, masteryScore: number, ageDays: number, source: string | null = null): PoolCombo =>
  ({ id, text, tier, masteryScore, createdAt: NOW - ageDays * DAY, source })

// his bag, like the mockup's
const BAG: PoolCombo[] = [
  c('c1', 'Jab → Cross → Switch Kick', 'weapons', 0, 0, 'mine'),
  c('c2', 'Jab → Cross → Lead Hook → Low Kick', 'flow', 7, 90),
  c('c3', 'Teep → Cross → Rear Knee', 'weapons', 8, 90),
  c('c4', 'Jab → Cross', 'foundation', 15, 300),
  c('c5', 'Double Jab → Cross → Body Kick', 'weapons', 4, 90),
  c('c6', 'Lead Hook → Rear Elbow → Switch Knee', 'deception', 3, 90),
  c('c7', 'Round Kick', 'foundation', 12, 300),
  c('c8', 'Jab → Rear Uppercut → Lead Hook → Rear Elbow → Switch Knee', 'mastery', 1, 90),
  c('c9', 'Teep → Teep', 'foundation', 13, 300),
]
const key = (ids: string[]) => [...ids].sort().join('|')

// ─── tags and the picker's order ──
{
  assert.equal(poolTag(BAG[0], NOW), 'new', 'his, today, not mastered')
  assert.equal(poolTag(BAG[2], NOW), 'close', '8 of 15')
  assert.equal(poolTag(BAG[3], NOW), null)
  assert.equal(poolTag(c('old', 'Jab → Cross', 'foundation', 0, 30, 'class'), NOW), null, 'two weeks on: not new')
  const g = pickerGroups(BAG, NOW)
  assert.deepEqual(g.new.map(x => x.id), ['c1'])
  assert.deepEqual(g.close.map(x => x.id), ['c3', 'c2'], 'closest to mastered first')
  assert.equal(g.all[0].tier, 'foundation', 'then easiest first')
  assert.deepEqual(pickerGroups(BAG, NOW, 'elbow').all.map(x => x.id).sort(), ['c6', 'c8'], 'search the strikes')
}

// ─── the kru's arc ──
{
  assert.deepEqual(kruArc(6), ['warmup', 'technique', 'technique', 'pressure', 'pressure', 'finisher'])
  assert.deepEqual(kruArc(4, false), ['warmup', 'technique', 'technique', 'pressure'], 'no finisher today')
  assert.deepEqual(kruArc(1), ['warmup'])
  assert.deepEqual(kruArc(2), ['warmup', 'technique'])
  assert.deepEqual(kruArc(0), [])
}

// ─── COACH: every round different, the new combo in technique first ──
{
  const rounds = planCoachRounds(BAG, { rounds: 6, finishers: true, nowSec: NOW })
  assert.equal(rounds.length, 6)
  assert.deepEqual(rounds.map(r => r.stage), kruArc(6))
  const keys = rounds.map(r => key(r.comboIds))
  assert.equal(new Set(keys).size, 6, 'no two rounds the same')
  assert.ok(rounds.every(r => r.comboIds.length > 0 && !r.mine))
  assert.ok(rounds.every(r => r.comboIds.every(id => BAG.some(b => b.id === id))), 'only his own combos: none made up')
  // warm-up: basics, not the new one
  assert.ok(!rounds[0].comboIds.includes('c1'))
  assert.ok(rounds[0].comboIds.every(id => ['c4', 'c7', 'c9'].includes(id)), 'the easiest he knows best')
  // technique: the new combo alone, then with one more he's learning
  assert.deepEqual(rounds[1].comboIds, ['c1'])
  assert.equal(rounds[2].comboIds[0], 'c1')
  assert.equal(rounds[2].comboIds.length, 2)
  // pressure: the hardest at pace, distinct between rounds
  assert.ok(rounds[3].comboIds.includes('c8'), 'the hardest first')
  const p1 = new Set(rounds[3].comboIds), p2 = rounds[4].comboIds
  assert.ok(p2.every(id => !p1.has(id)), 'pressure rounds share no combo')
  assert.ok(!rounds.slice(3).some(r => r.comboIds.includes('c1')), 'the new one is not at pace yet')
  // finisher: kicks
  assert.ok(rounds[5].comboIds.every(id => /Kick|Teep|Knee/.test(BAG.find(b => b.id === id)!.text)))

  // no new combo: technique works the ones he's learning
  const noNew = planCoachRounds(BAG.filter(b => b.id !== 'c1'), { rounds: 5, finishers: false, nowSec: NOW })
  assert.deepEqual(noNew.map(r => r.stage), ['warmup', 'technique', 'technique', 'pressure', 'pressure'])
  assert.equal(new Set(noNew.map(r => key(r.comboIds))).size, 5)
  // a long session still repeats no round
  const long = planCoachRounds(BAG, { rounds: 12, finishers: true, nowSec: NOW })
  assert.equal(new Set(long.map(r => key(r.comboIds))).size, 12)
  // nothing unlocked: empty rounds, nothing invented
  assert.ok(planCoachRounds([], { rounds: 3, finishers: true, nowSec: NOW }).every(r => r.comboIds.length === 0))
}

// ─── HYBRID: his rounds kept, the coach fills the rest on the arc ──
{
  const rounds = planHybridRounds(BAG, { rounds: 6, finishers: true, nowSec: NOW, picked: { 1: ['c1'], 4: ['c4', 'c9'] } })
  assert.deepEqual(rounds[1], { stage: 'technique', comboIds: ['c1'], mine: true })
  assert.deepEqual(rounds[4], { stage: 'pressure', comboIds: ['c4', 'c9'], mine: true })
  assert.ok([0, 2, 3, 5].every(i => !rounds[i].mine && rounds[i].comboIds.length > 0), 'empty rounds: the coach fills')
  assert.equal(new Set(rounds.map(r => key(r.comboIds))).size, 6, 'the coach repeats none of his rounds')
  assert.deepEqual(rounds.map(r => r.stage), kruArc(6))
}

// ─── CUSTOM: exactly his; an empty round stays empty ──
{
  const rounds = planCustomRounds({ rounds: 4, picked: { 0: ['c4'], 1: ['c2'] } })
  assert.deepEqual(rounds, [
    { stage: null, comboIds: ['c4'], mine: true },
    { stage: null, comboIds: ['c2'], mine: true },
    { stage: null, comboIds: [], mine: false },
    { stage: null, comboIds: [], mine: false },
  ])
  const spec = parseBagSpec({ mode: 'custom', rounds: 4, roundSec: 120, restSec: 60, picked: { 0: ['c4'], 1: ['c2', 'gone'] } })!
  const written = roundsForSpec(spec, BAG, { finishers: true, nowSec: NOW })
  assert.deepEqual(written.map(r => [r.comboIds, r.durationSec, r.restSec, r.roundType]), [
    [['c4'], 120, 60, 'combo_practice'],
    [['c2'], 120, 60, 'combo_practice'],
    [[], 120, 60, 'combo_practice'],
    [[], 120, 60, 'combo_practice'],
  ], 'his length and rest; a combo no longer in his pool drops; nothing added')
}

// ─── the stored choice ──
{
  assert.equal(parseBagSpec(null), null)
  assert.equal(parseBagSpec({ mode: 'freestyle' }), null)
  const s = parseBagSpec({ mode: 'hybrid', rounds: 40, roundSec: 9999, restSec: 1, picked: { 0: ['a', 'a', 'b'], 99: ['x'], foo: ['y'], 2: 'no' } })!
  assert.equal(s.rounds, 12)
  assert.equal(s.roundSec, 300)
  assert.equal(s.restSec, 60)
  assert.deepEqual(s.picked, { 0: ['a', 'b'] })
  assert.deepEqual(parseBagSpec({ mode: 'coach', rounds: 5, picked: { 0: ['a'] } })!.picked, {}, 'coach: nothing of his')
  const hy = roundsForSpec(parseBagSpec({ mode: 'hybrid', rounds: 5, roundSec: 180, restSec: 60, picked: { 1: ['c1'] } })!, BAG, { finishers: false, nowSec: NOW })
  assert.deepEqual(hy.map(r => r.roundType), ['warmup', 'technical_flow', 'technical_flow', 'combo_practice', 'combo_practice'])
}

// ─── routines: saved with his name, started with everything still his ──
{
  const r = routineFromBuilder('r1', '  Tuesday   kicks ', { mode: 'hybrid', rounds: 6, roundSec: 180, restSec: 60, picked: { 1: ['c1'], 3: ['c2', 'c6'] } })!
  assert.equal(r.name, 'Tuesday kicks')
  assert.deepEqual(r.rounds, [[], ['c1'], [], ['c2', 'c6'], [], []])
  assert.equal(routineFromBuilder('r2', '   ', { mode: 'custom', rounds: 2, roundSec: 120, restSec: 60, picked: {} }), null, 'a name is needed')
  assert.equal(routineFromBuilder('r3', 'x', { mode: 'coach', rounds: 2, roundSec: 120, restSec: 60, picked: {} }), null, 'only Hybrid or Custom')
  // stored and read back
  const row = { id: r.id, name: r.name, mode: r.mode, roundsJson: JSON.stringify(r.rounds), roundSec: r.roundSec, restSec: r.restSec }
  const back = parseRoutineRow(row)!
  assert.deepEqual(back, r)
  const started = builderFromRoutine(back)
  assert.deepEqual(started, { mode: 'hybrid', rounds: 6, roundSec: 180, restSec: 60, picked: { 1: ['c1'], 3: ['c2', 'c6'] }, routineId: 'r1' })
  assert.deepEqual(parseBagSpec(started), started, 'a started routine is a valid choice as it is')
  assert.equal(parseRoutineRow({ ...row, mode: 'coach' }), null)
  assert.equal(parseRoutineRow({ ...row, roundsJson: 'nope' }), null)
}

console.log('bagArc tests passed')

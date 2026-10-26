// Run: tsx src/lib/coach/bagArc.test.ts
// Bag sessions three ways (page 80) with the kru's round plan inside (page 93):
// rhythm, learn A, learn B, link, pressure, free; two focus combos kept about
// 3 sessions or until both rate SHARP; a NEW combo learnt first. Hybrid's fill,
// Custom's passthrough, routines.
import assert from 'node:assert/strict'

import {
  builderFromRoutine,
  focusOf,
  kruArc,
  pickFocus,
  roundCue,
  roundPlan,
  stageOfRoundType,
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

// ─── the round plan (page 93) ──
{
  assert.deepEqual(roundPlan(6), ['rhythm', 'learn', 'learn', 'pace', 'pressure', 'free'], 'early: A at pace before the pressure round')
  assert.deepEqual(roundPlan(6, true), ['rhythm', 'learn', 'learn', 'link', 'pressure', 'free'], 'further in: A and B as one string')
  assert.deepEqual(roundPlan(5), ['rhythm', 'learn', 'learn', 'pressure', 'free'], 'shorter: the link goes first')
  assert.deepEqual(roundPlan(4), ['rhythm', 'learn', 'learn', 'pressure'], 'then the free round')
  assert.deepEqual(roundPlan(3), ['rhythm', 'learn', 'learn'])
  assert.deepEqual(roundPlan(8, true).slice(6), ['free', 'free'], 'longer: more free rounds')
  assert.deepEqual(roundPlan(0), [])
  // the app's stage words stay; no finisher round (the finisher is page 86's sets)
  assert.deepEqual(kruArc(6), ['warmup', 'technique', 'technique', 'pressure', 'pressure', 'pressure'])
  assert.deepEqual(kruArc(5), ['warmup', 'technique', 'technique', 'pressure', 'pressure'])
  assert.equal(stageOfRoundType('link'), 'technique')
  assert.equal(stageOfRoundType('free'), 'pressure')
  assert.equal(stageOfRoundType('technical_flow'), 'technique', 'older sessions still read')
  assert.equal(stageOfRoundType('custom'), null, 'Custom: no stage word')
  // one cue a round: the combo's own on a learn round, the round's job otherwise
  assert.equal(roundCue('learn', 'TURN THE HIP'), 'TURN THE HIP')
  assert.equal(roundCue('warmup', 'X'), 'RELAX, BOUNCE')
  assert.equal(roundCue('free', 'X'), 'CHECK AFTER EACH')
  assert.equal(roundCue('pressure', 'X'), 'LAST 30 S ALL OUT')
  for (const t of ['warmup', 'link', 'pressure', 'free']) assert.ok(roundCue(t, '').length <= 20, 'fits the flap')
}

// ─── COACH: two focus combos drilled, a NEW one learnt first ──
{
  const rounds = planCoachRounds(BAG, { rounds: 6, nowSec: NOW })
  assert.equal(rounds.length, 6)
  assert.ok(rounds.every(r => !r.mine))
  assert.ok(rounds.every(r => r.comboIds.every(id => BAG.some(b => b.id === id))), 'only his own combos: none made up')
  const [a, b] = focusOf(rounds)
  assert.equal(a, 'c1', 'the NEW combo is A')
  assert.ok(b && b !== 'c1')
  assert.deepEqual(rounds[1].comboIds, [a], 'learn A alone')
  assert.deepEqual(rounds[2].comboIds, [b], 'learn B alone')
  assert.deepEqual(rounds[3].comboIds, [a, b], 'A and B 3+ strikes: linked')
  assert.equal(rounds[3].focus, 'link')
  assert.deepEqual(rounds[4].comboIds, [a, b], 'pressure: A and B at pace')
  assert.equal(rounds[5].focus, 'free')
  const distinct = new Set(rounds.slice(1).flatMap(r => r.comboIds))
  assert.equal(distinct.size, 2, '2 combos the whole session, repeated')
  // warm-up: the basics (singles he owns), never the new one
  assert.ok(!rounds[0].comboIds.includes('c1'))
  assert.ok(rounds[0].comboIds.every(id => ['c4', 'c7', 'c9'].includes(id)), 'the easiest he knows best')
  // the NEW one is learnt before any round at pace
  const firstLearn = rounds.findIndex(r => r.focus === 'learn' && r.comboIds.includes('c1'))
  const firstPace = rounds.findIndex(r => (r.focus === 'pressure' || r.focus === 'pace' || r.focus === 'free') && r.comboIds.includes('c1'))
  assert.ok(firstLearn >= 0 && firstLearn < firstPace)

  // early: pairs (2 strikes) are not linked; round 4 is A at pace
  const pairs: PoolCombo[] = [c('p1', 'Jab → Body Kick', 'weapons', 2, 90), c('p2', 'Hook → Low Kick', 'weapons', 3, 90), c('s1', 'Jab', 'foundation', 12, 300), c('s2', 'Lead Teep', 'foundation', 12, 300), c('s3', 'Body Kick', 'foundation', 12, 300)]
  const early = planCoachRounds(pairs, { rounds: 6, nowSec: NOW })
  assert.equal(early[3].focus, 'pace')
  assert.deepEqual(early[3].comboIds, [early[1].comboIds[0]])
  assert.deepEqual(early[0].comboIds, ['s1', 's2', 's3'], 'rhythm: jab, lead teep, body kick')
  // nothing unlocked: empty rounds, nothing invented
  assert.ok(planCoachRounds([], { rounds: 3, nowSec: NOW }).every(r => r.comboIds.length === 0))
  // one combo: it is learnt and pressured alone
  const lone = planCoachRounds([BAG[3]], { rounds: 5, nowSec: NOW })
  assert.ok(lone.every(r => r.comboIds.length > 0 && r.comboIds.every(id => id === 'c4')))
}

// ─── the pair carries on: about 3 sessions, or until both rate SHARP ──
{
  const pool = BAG.filter(b => b.id !== 'c1')
  const first = pickFocus(pool, NOW)
  assert.equal(first.length, 2)
  const h1 = { ids: first, ratings: { [first[0]]: 2, [first[1]]: 3 } }
  assert.deepEqual(pickFocus(pool, NOW, [h1]), first, 'kept: one SHARP is not both')
  assert.deepEqual(pickFocus(pool, NOW, [h1, h1]), first, 'kept: 2 sessions')
  const third = pickFocus(pool, NOW, [h1, h1, h1])
  assert.equal(third.filter(id => first.includes(id)).length, 1, 'after 3 sessions one is swapped')
  assert.ok(!third.includes(first[1]), 'the sharper one goes')
  const sharp = pickFocus(pool, NOW, [{ ids: first, ratings: { [first[0]]: 3, [first[1]]: 3 } }])
  assert.equal(sharp.filter(id => first.includes(id)).length, 1, 'both SHARP: one is swapped at once')
  // a NEW combo comes in as A, beside one of the kept pair
  const withNew = pickFocus(BAG, NOW, [h1])
  assert.equal(withNew[0], 'c1')
  assert.ok(first.includes(withNew[1]))
  // the coach's unlock card makes a combo NEW too (0060)
  const opened = { ...c('w9', 'Jab → Switch Kick', 'weapons', 0, 90), unlockedAt: NOW - 2 * DAY }
  assert.equal(poolTag(opened, NOW), 'new')
  assert.equal(poolTag({ ...opened, unlockedAt: NOW - 20 * DAY }, NOW), null)
  assert.equal(pickFocus([...pool, opened], NOW, [h1])[0], 'w9')
}

// ─── HYBRID: his rounds kept, the coach fills the rest on the same plan ──
{
  const rounds = planHybridRounds(BAG, { rounds: 6, nowSec: NOW, picked: { 1: ['c1'], 4: ['c4', 'c9'] } })
  assert.deepEqual(rounds[1], { stage: 'technique', comboIds: ['c1'], mine: true, focus: 'learn' })
  assert.deepEqual(rounds[4], { stage: 'pressure', comboIds: ['c4', 'c9'], mine: true, focus: 'pressure' })
  assert.ok([0, 2, 3, 5].every(i => !rounds[i].mine && rounds[i].comboIds.length > 0), 'empty rounds: the coach fills')
  assert.deepEqual(rounds.map(r => r.stage), kruArc(6).map((st, i) => (i === 3 ? 'technique' : st)), 'the link sits under TECHNIQUE')
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
  const written = roundsForSpec(spec, BAG, { nowSec: NOW })
  assert.deepEqual(written.map(r => [r.comboIds, r.durationSec, r.restSec, r.roundType]), [
    [['c4'], 120, 60, 'custom'],
    [['c2'], 120, 60, 'custom'],
    [[], 120, 60, 'custom'],
    [[], 120, 60, 'custom'],
  ], 'his length and rest; a combo no longer in his pool drops; nothing added; no stage words')
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
  const hy = roundsForSpec(parseBagSpec({ mode: 'hybrid', rounds: 5, roundSec: 180, restSec: 60, picked: { 1: ['c1'] } })!, BAG, { nowSec: NOW })
  assert.deepEqual(hy.map(r => r.roundType), ['warmup', 'learn', 'learn', 'pressure', 'free'])
  assert.ok(hy.every(r => r.durationSec === 180 && r.restSec === 60), 'every round 3 min, 1 min rest (the warm-up too)')
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

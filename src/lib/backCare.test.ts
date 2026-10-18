import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BACK_CARE_RED_FLAG_NOTE, backCareTemplate, estimateRoutineSec, mobilitySteps } from './backCare'
import { hasRedFlag, injuryActionFor, injuryFlag } from './coach/injury'
import { DAILY_MOBILITY_TEMPLATE, FR_WARMUP_TEMPLATE, LEGACY_FR_STATIC_WARMUP_TEMPLATE, legacyMobilityTemplates } from './mobilityTemplate'

const ids = (rows: { exerciseId: string }[]) => rows.map(r => r.exerciseId)
const row = (rows: ReturnType<typeof backCareTemplate>, id: string) => rows.find(r => r.exerciseId === id)

// Back Care is back work, not the desk-posture routine.
const w1 = backCareTemplate({ week: 1 })
const w5 = backCareTemplate({ week: 5 })
for (const id of ['ex-cat-cow', 'ex-bird-dogs', 'ex-mcgill-curl-up', 'ex-dead-bugs', 'ex-glute-bridges', 'ex-hip-hinge-dowel', 'ex-hip-flexor-stretch']) {
  assert.ok(ids(w1).includes(id), `week 1 has ${id}`)
}
assert.ok(!ids(w1).some(id => ['ex-band-pull-aparts', 'ex-band-external-rotation', 'ex-prone-cobra', 'ex-couch-stretch'].includes(id)), 'no desk-posture moves')

// Progression: side plank knees -> full in week 5; holds and reps rise.
assert.ok(row(w1, 'ex-side-plank-knees') && !row(w1, 'ex-side-plank'), 'week 1 side plank from the knees')
assert.ok(row(w5, 'ex-side-plank') && !row(w5, 'ex-side-plank-knees'), 'week 5 full side plank')
assert.ok(row(w5, 'ex-bird-dogs')!.holdSec! > row(w1, 'ex-bird-dogs')!.holdSec!, 'bird dog hold rises')
assert.ok(row(w5, 'ex-bird-dogs')!.reps! > row(w1, 'ex-bird-dogs')!.reps!, 'bird dog reps rise')
assert.ok(row(w5, 'ex-mcgill-curl-up')!.holdSec! > row(w1, 'ex-mcgill-curl-up')!.holdSec!, 'curl-up hold rises')
assert.ok(row(w5, 'ex-dead-bugs')!.reps! > row(w1, 'ex-dead-bugs')!.reps!, 'dead bug reps rise')
assert.ok(row(backCareTemplate({ week: 4 }), 'ex-side-plank-knees')!.holdSec! > row(w1, 'ex-side-plank-knees')!.holdSec!, 'knees side plank hold rises before the switch')
assert.deepEqual(backCareTemplate({ week: 7 }), w5, 'extension weeks hold week 5')

// 10-15 minutes.
for (const w of [1, 3, 5, 6]) {
  const min = estimateRoutineSec(backCareTemplate({ week: w })) / 60
  assert.ok(min >= 10 && min <= 15, `week ${w} back care is 10-15 min (got ${min.toFixed(1)})`)
}

// Back today 2 or less: gentler (shorter holds, fewer reps, knees plank, no hinge drill).
const gentle = backCareTemplate({ week: 5, backToday: 2 })
assert.ok(row(gentle, 'ex-side-plank-knees') && !row(gentle, 'ex-side-plank'), 'gentle: knees side plank')
assert.ok(!row(gentle, 'ex-hip-hinge-dowel'), 'gentle: no hinge drill')
assert.ok(row(gentle, 'ex-bird-dogs')!.reps! < row(w5, 'ex-bird-dogs')!.reps!, 'gentle: fewer reps')
assert.ok(/Gentle day/.test(gentle[0].notes ?? ''), 'gentle day says so')
assert.deepEqual(backCareTemplate({ week: 5, backToday: 3 }), w5, 'back 3 is a normal day')

// Red flag: no loaded moves, one line to a clinician.
const red = backCareTemplate({ week: 3, redFlag: true })
assert.deepEqual(ids(red), ['ex-crocodile-breathing'])
assert.equal(red[0].notes, BACK_CARE_RED_FLAG_NOTE)
assert.ok(/clinician/.test(BACK_CARE_RED_FLAG_NOTE))

// The plan's stop line is a red flag: sharp pain, pain or tingling down a leg.
for (const t of ['sharp pain in my low back', 'back went sharp bending over', 'tingling down my left leg', 'pain shooting down the leg', 'numbness down into my foot', 'sciatica again']) {
  assert.ok(hasRedFlag(t), `red flag: ${t}`)
}
for (const t of ['lower back stiff after deadlifts', 'tight hamstrings', 'felt sharp on the pads', 'achy back, better after walking']) {
  assert.ok(!hasRedFlag(t), `not a red flag: ${t}`)
}
const flag = injuryFlag([], [{ epochDay: 100, text: 'tingling down my right leg this morning' }], 101)
assert.ok(flag?.redFlag, 'back note with tingling down a leg sets the red flag')
assert.equal(injuryActionFor('strength', flag).action, 'stop', 'and loading stops')

// Mobility timer steps.
assert.deepEqual(mobilitySteps({ holdSec: 30, reps: null, perSide: true }).map(s => [s.side, s.holdSec]), [['Left', 30], ['Right', 30]], 'each-side hold times both sides')
const cobra = mobilitySteps({ holdSec: 3, reps: 10 })
assert.equal(cobra.length, 10, 'prone cobra 10 reps x 3s runs as 10 timed holds')
assert.deepEqual([cobra[0].rep, cobra[9].rep, cobra[0].holdSec], [1, 10, 3])
assert.equal(mobilitySteps({ holdSec: 5, reps: 6, perSide: 1 }).length, 12, 'bird dog 6 each side with holds')
assert.deepEqual(mobilitySteps({ holdSec: null, reps: 8, perSide: true }).map(s => s.kind), ['reps'], 'plain reps are one tap')
assert.deepEqual(mobilitySteps({ holdSec: 60, reps: null }).map(s => s.side), [null])

// Run-walk warm-up is dynamic: no static floor stretches, no toe-touch fold.
const warmIds = ids(FR_WARMUP_TEMPLATE)
for (const id of ['ex-toe-touch-forward-fold', 'ex-butterfly-stretch', 'ex-pigeon-stretch']) assert.ok(!warmIds.includes(id), `no ${id} before a run`)
for (const id of ['ex-brisk-walk', 'ex-leg-swings', 'ex-ankle-rocks', 'ex-hip-circles']) assert.ok(warmIds.includes(id), `warm-up has ${id}`)
assert.ok(FR_WARMUP_TEMPLATE.every(r => r.section === 'dynamic'))
const warmMin = estimateRoutineSec(FR_WARMUP_TEMPLATE) / 60
assert.ok(warmMin >= 3 && warmMin <= 7, `warm-up is about 5 min (got ${warmMin.toFixed(1)})`)

// Legacy lookup: the session's own template wins for shared exercises.
const firstPigeon = legacyMobilityTemplates('foundation_run').find(r => r.exerciseId === 'ex-pigeon-stretch')
assert.equal(firstPigeon?.holdSec, LEGACY_FR_STATIC_WARMUP_TEMPLATE.find(r => r.exerciseId === 'ex-pigeon-stretch')?.holdSec, 'pigeon on a run reads the warm-up row (45s), not the cooldown (60s)')
const firstDeadBug = legacyMobilityTemplates('mobility').find(r => r.exerciseId === 'ex-dead-bugs')
assert.equal(firstDeadBug?.reps, DAILY_MOBILITY_TEMPLATE.find(r => r.exerciseId === 'ex-dead-bugs')?.reps, 'dead bugs on a mobility day read the daily row (8), not the cooldown (10)')

// Every exercise these routines name exists in the library.
const library = ['src/db/seed.ts', 'drizzle/0022_road_bootcamp.sql', 'drizzle/0026_block_zero_phase_b.sql', 'drizzle/0028_logging_safety.sql'].map(f => readFileSync(f, 'utf8')).join('\n')
const known = new Set([...library.matchAll(/'(ex-[a-z0-9-]+)'/g)].map(m => m[1]))
for (const id of new Set([...ids(w1), ...ids(w5), ...ids(gentle), ...warmIds])) assert.ok(known.has(id), `${id} exists in the library`)

console.log('backCare tests passed')

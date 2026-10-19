import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import {
  BAD_BACK_WALK_NOTE,
  CLINCH_NECK_DOW,
  FOUNDATION_ROWS,
  estimateRoutineSec,
  foundationLevel,
  foundationTemplate,
  mobilitySteps,
  strengthKindFromLabel,
  type FoundationInput,
  type StrengthKind,
} from './foundation'
import { injuryFlag } from './coach/injury'
import { DAILY_MOBILITY_TEMPLATE, FR_WARMUP_TEMPLATE, LEGACY_FR_STATIC_WARMUP_TEMPLATE, legacyMobilityTemplates } from './mobilityTemplate'

type Rows = ReturnType<typeof foundationTemplate>
const ids = (rows: { exerciseId: string }[]) => rows.map(r => r.exerciseId)
const row = (rows: Rows, id: string) => rows.find(r => r.exerciseId === id)
const minutes = (input: FoundationInput) => estimateRoutineSec(foundationTemplate(input)) / 60

// Foundation is the back block plus the neck & shoulder block (research routine).
const w1 = foundationTemplate({ week: 1 })
const w3 = foundationTemplate({ week: 3 })
const w5 = foundationTemplate({ week: 5 })
for (const id of ['ex-crocodile-breathing', 'ex-cat-cow', 'ex-mcgill-curl-up', 'ex-bird-dogs', 'ex-side-plank-knees', 'ex-glute-bridges', 'ex-hip-hinge-dowel']) {
  assert.ok(ids(w1).includes(id), `back block has ${id}`)
}
for (const id of ['ex-chin-tucks', 'ex-foam-roll-thoracic', 'ex-doorway-pec-stretch', 'ex-ytw-raises']) {
  assert.ok(ids(w1).includes(id), `neck & shoulder block has ${id}`)
}
assert.equal(row(w1, 'ex-chin-tucks')!.reps, 10, 'chin tucks 10 holds')
assert.equal(row(w1, 'ex-chin-tucks')!.holdSec, 10, 'of 10 s')
assert.ok(/lying/i.test(row(w1, 'ex-chin-tucks')!.notes ?? '') && /gentle nod/i.test(row(w1, 'ex-chin-tucks')!.notes ?? ''), 'chin tucks start lying, a gentle nod')
assert.ok(/shoulder height/.test(row(w1, 'ex-doorway-pec-stretch')!.notes ?? ''), 'pec stretch: elbow at shoulder height')
for (const id of ['ex-dead-bugs', 'ex-hip-flexor-stretch', 'ex-band-pull-aparts', 'ex-sciatic-nerve-glide', 'ex-toe-touch-forward-fold']) {
  for (const w of [1, 3, 5]) assert.ok(!ids(foundationTemplate({ week: w })).includes(id), `no ${id} (week ${w})`)
}
assert.ok(w1.every(r => r.section !== 'dynamic'), 'no run warm-up rows')

// Levels: weeks 1-2, 3-4, 5+; Fighter (no week) holds level 3.
assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(foundationLevel), [1, 1, 2, 2, 3, 3, 3, 3])
assert.equal(foundationLevel(null), 3, 'Fighter default: level 3')
assert.deepEqual(foundationTemplate({ week: 2 }), w1, 'week 2 is level 1')
assert.deepEqual(foundationTemplate({ week: 4 }), w3, 'week 4 is level 2')
assert.deepEqual(foundationTemplate({ week: 7 }), w5, 'extension weeks hold level 3')
// Fighter phase (no week): level 3 plus the world's greatest stretch and band
// external rotations; Block Zero never gets them.
const fighter = foundationTemplate({})
const fighterOnly = ['ex-worlds-greatest-stretch', 'ex-band-external-rotation']
assert.deepEqual(ids(fighter).filter(id => !fighterOnly.includes(id)), ids(w5), 'Fighter phase runs the level 3 moves')
for (const id of fighterOnly) {
  assert.ok(ids(fighter).includes(id), `Fighter has ${id}`)
  for (const w of [1, 2, 3, 4, 5, 6, 7, 8]) for (const s of [null, 'A', 'B', 'C'] as const) assert.ok(!ids(foundationTemplate({ week: w, strengthDay: s })).includes(id), `Block Zero week ${w} ${s ?? 'rest'}: no ${id}`)
}
assert.ok(ids(fighter).indexOf('ex-worlds-greatest-stretch') < ids(fighter).indexOf('ex-chin-tucks'), 'stretch closes the back block')
assert.ok(ids(fighter).indexOf('ex-band-external-rotation') > ids(fighter).indexOf('ex-ytw-raises'), 'rotations close the neck block')
assert.deepEqual([row(fighter, 'ex-worlds-greatest-stretch')!.reps, row(fighter, 'ex-worlds-greatest-stretch')!.perSide], [3, true], "world's greatest stretch 3 each side")
assert.deepEqual([row(fighter, 'ex-band-external-rotation')!.sets, row(fighter, 'ex-band-external-rotation')!.reps, row(fighter, 'ex-band-external-rotation')!.perSide], [1, 8, true], 'external rotations 1 x 8 each arm')
for (const s of ['push', 'pull'] as const) {
  const f = ids(foundationTemplate({ strengthDay: s }))
  assert.ok(!f.includes('ex-band-external-rotation') && !f.includes('ex-ytw-raises'), `Fighter ${s} (face pulls): no rotations, no Y-T`)
  assert.ok(f.includes('ex-worlds-greatest-stretch'), `Fighter ${s}: the stretch stays`)
}
assert.ok(!ids(foundationTemplate({ backToday: 2 })).some(id => fighterOnly.includes(id)), 'Fighter bad-back day: neither')
assert.deepEqual(foundationTemplate({ backToday: 2 }), foundationTemplate({ week: 5, backToday: 2 }), 'Fighter bad-back day is the usual short version')
assert.ok(!ids(foundationTemplate({ neckFlag: true })).includes('ex-band-external-rotation'), 'Fighter bad-neck day: no rotations')
assert.equal(row(fighter, 'ex-doorway-pec-stretch')!.reps, 1, 'Fighter: pec stretch once per side to make room')
assert.equal(row(fighter, 'ex-ytw-raises')!.reps, 6, 'Fighter: Y-T 2 x 6')
assert.ok(minutes({}) <= 16, `Fighter rest day is at most 16 min (got ${minutes({}).toFixed(1)})`)
for (const s of ['push', 'pull'] as const) assert.ok(minutes({ strengthDay: s }) <= 14, `Fighter ${s} day is shorter`)
assert.ok(row(w1, 'ex-side-plank-knees') && !row(w1, 'ex-side-plank'), 'L1 side plank from the knees')
assert.ok(row(w3, 'ex-side-plank-knees')!.holdSec! > row(w1, 'ex-side-plank-knees')!.holdSec!, 'L2 knees hold rises')
assert.ok(row(w5, 'ex-side-plank') && !row(w5, 'ex-side-plank-knees'), 'L3 full side plank')
assert.ok(row(w3, 'ex-mcgill-curl-up')!.holdSec! > row(w1, 'ex-mcgill-curl-up')!.holdSec! && row(w5, 'ex-mcgill-curl-up')!.holdSec! > row(w3, 'ex-mcgill-curl-up')!.holdSec!, 'curl-up hold rises each level')
assert.ok(row(w5, 'ex-bird-dogs')!.holdSec! > row(w3, 'ex-bird-dogs')!.holdSec! && row(w3, 'ex-bird-dogs')!.holdSec! > row(w1, 'ex-bird-dogs')!.holdSec!, 'bird dog hold rises each level')
assert.ok(!row(w1, 'ex-glute-bridges')!.perSide && row(w5, 'ex-glute-bridges')!.perSide, 'L3 bridge goes single-leg')
assert.ok(/head about 2 cm/.test(row(w3, 'ex-chin-tucks')!.notes ?? ''), 'L2 chin tucks add the head lift')
assert.equal(w5.filter(r => r.exerciseId === 'ex-chin-tucks').length, 2, 'L3: seated chin tucks plus head-lift holds')
assert.ok(/wall/.test(w5.find(r => r.exerciseId === 'ex-chin-tucks')!.notes ?? ''), 'L3 chin tucks against a wall')
assert.equal(w1.filter(r => r.exerciseId === 'ex-chin-tucks').length, 1)
assert.ok(/overhead/.test(row(w5, 'ex-foam-roll-thoracic')!.notes ?? ''), 'L3 thoracic extension adds arms overhead')
assert.ok(/kettlebell/.test(row(w5, 'ex-hip-hinge-dowel')!.notes ?? ''), 'L3 hinge adds a light kettlebell RDL')

// De-duplication against the strength day.
const day = (strengthDay: StrengthKind | null, week = 3) => ids(foundationTemplate({ week, strengthDay }))
for (const s of ['A', 'B', 'C'] as const) {
  assert.ok(!day(s).includes('ex-glute-bridges'), `Strength ${s}: no bridge (in the warm-up)`)
  assert.ok(!day(s).includes('ex-ytw-raises'), `Strength ${s}: no Y-T (band work and rows that day)`)
  assert.ok(!day(s).includes('ex-dead-bugs'), `Strength ${s}: no dead bug`)
  assert.ok(day(s).includes('ex-chin-tucks') && day(s).includes('ex-doorway-pec-stretch'), `Strength ${s}: neck block stays`)
}
assert.ok(!day('B').includes('ex-hip-hinge-dowel'), 'Strength B (hinge day): no hinge drill')
assert.ok(day('A').includes('ex-hip-hinge-dowel') && day('C').includes('ex-hip-hinge-dowel'), 'A and C keep the hinge drill')
assert.ok(day(null).includes('ex-glute-bridges') && day(null).includes('ex-ytw-raises') && day(null).includes('ex-hip-hinge-dowel'), 'non-strength day: bridge, Y-T and hinge')
assert.ok(day('push').includes('ex-glute-bridges') && !day('push').includes('ex-ytw-raises'), 'Fighter push: no bridges in its warm-up, so the bridge stays; Y-T goes')
assert.ok(!day('pull').includes('ex-hip-hinge-dowel'), 'Fighter pull (deadlift): no hinge drill')
assert.deepEqual(['Strength A', 'Strength B', 'Strength C', 'Strength: Push', 'Strength: Pull', 'Zone 2'].map(strengthKindFromLabel), ['A', 'B', 'C', 'push', 'pull', null])

// About 12 minutes (estimate includes ~15 s changeover per exercise). Strength
// days drop the bridge and Y-T, so they run shorter than run-walk and rest days.
for (const w of [1, 3, 5, 6]) {
  for (const s of [null, 'A', 'B', 'C'] as const) {
    const min = minutes({ week: w, strengthDay: s })
    const [lo, hi] = s ? [9, 13] : [11, 16]
    assert.ok(min >= lo && min <= hi, `week ${w} ${s ?? 'non-strength'} day is ${lo}-${hi} min (got ${min.toFixed(1)})`)
  }
}
assert.ok(minutes({ week: 1, strengthDay: 'A' }) < minutes({ week: 1 }), 'strength days are shorter')

// Bad-back day (back today <= 2): the short version, then an easy walk.
const badBack = foundationTemplate({ week: 5, backToday: 2 })
assert.deepEqual(ids(badBack), ['ex-crocodile-breathing', 'ex-cat-cow', 'ex-mcgill-curl-up', 'ex-bird-dogs', 'ex-side-plank-knees', 'ex-chin-tucks', 'ex-doorway-pec-stretch'], 'bad-back routine')
assert.equal(row(badBack, 'ex-crocodile-breathing')!.holdSec, 90, 'longer breathing')
assert.ok(row(badBack, 'ex-bird-dogs')!.holdSec! < row(w5, 'ex-bird-dogs')!.holdSec!, 'shorter bird dog holds')
assert.ok(/Bad-back day/.test(badBack[0].notes ?? ''), 'bad-back day says so')
assert.ok(badBack[badBack.length - 1].notes!.endsWith(BAD_BACK_WALK_NOTE), 'ends with the easy walk')
assert.ok(minutes({ week: 5, backToday: 1 }) <= 10, 'bad-back day is short (~8-10 min)')
assert.deepEqual(foundationTemplate({ week: 5, backToday: 3 }), w5, 'back 3 is a normal day')
assert.deepEqual(foundationTemplate({ week: 1, backToday: 2, strengthDay: 'B' }), foundationTemplate({ week: 5, backToday: 2 }), 'bad-back version is the same any week or day')

// Bad-neck day (neck injury flag): pain-free chin tucks, pec stretch, shoulder rolls; back block unchanged.
const badNeck = foundationTemplate({ week: 5, neckFlag: true })
const neckIds = ids(badNeck)
for (const id of ['ex-ytw-raises', 'ex-foam-roll-thoracic', 'ex-neck-iso-4way']) assert.ok(!neckIds.includes(id), `bad neck: no ${id}`)
assert.ok(neckIds.includes('ex-shoulder-rolls') && neckIds.includes('ex-doorway-pec-stretch'), 'bad neck: shoulder rolls and pec stretch')
assert.equal(badNeck.filter(r => r.exerciseId === 'ex-chin-tucks').length, 1, 'bad neck: no head-lift holds')
assert.ok(/pain-free/.test(row(badNeck, 'ex-chin-tucks')!.notes ?? '') && /lying/.test(row(badNeck, 'ex-chin-tucks')!.notes ?? ''), 'bad neck: lying, pain-free chin tucks')
const backIds = (rows: Rows) => ids(rows).filter(id => !['ex-chin-tucks', 'ex-foam-roll-thoracic', 'ex-doorway-pec-stretch', 'ex-shoulder-rolls', 'ex-ytw-raises', 'ex-neck-iso-4way'].includes(id))
assert.deepEqual(backIds(badNeck), backIds(w5), 'bad neck: back block unchanged')
assert.ok(/Bad-neck day/.test(badNeck[0].notes ?? ''))
assert.ok(!ids(w5).includes('ex-shoulder-rolls'), 'shoulder rolls only on a bad-neck day')
const both = foundationTemplate({ week: 5, backToday: 1, neckFlag: true })
assert.ok(ids(both).includes('ex-shoulder-rolls') && !ids(both).includes('ex-hip-hinge-dowel') && !ids(both).includes('ex-ytw-raises'), 'bad back and neck together')

// Clinch add-on: Wednesday only, only once the ramp allows clinch, never on a bad-neck day.
const clinch = (x: Partial<FoundationInput>) => ids(foundationTemplate({ week: 5, dayOfWeek: CLINCH_NECK_DOW, clinchAllowed: true, ...x })).includes('ex-neck-iso-4way')
assert.ok(clinch({}), 'clinch allowed on Wednesday: neck isometrics added')
assert.ok(clinch({ strengthDay: 'B' }), 'also next to Strength B (A and C already have neck isometrics)')
assert.ok(!clinch({ clinchAllowed: false }), 'ramp not at clinch yet: no add-on')
assert.ok(!clinch({ dayOfWeek: 1 }) && !clinch({ dayOfWeek: 5 }), 'not on other days')
assert.ok(!clinch({ neckFlag: true }), 'not on a bad-neck day')
assert.ok(!ids(w5).includes('ex-neck-iso-4way'), 'not by default')
const iso = foundationTemplate({ week: 1, dayOfWeek: CLINCH_NECK_DOW, clinchAllowed: true }).find(r => r.exerciseId === 'ex-neck-iso-4way')!
assert.deepEqual([iso.sets, iso.holdSec, iso.reps], [2, 20, 4], '2 x 20 s per direction')

const neckInjury = injuryFlag([{ epochDay: 100, skipReason: 'injury', detail: 'neck', notes: 'stiff after gaming' }], 101)
assert.ok(neckInjury && neckInjury.region === 'neck', 'a neck injury skip is a neck flag (bad-neck day)')

// Mobility timer steps.
assert.deepEqual(mobilitySteps({ holdSec: 30, reps: null, perSide: true }).map(s => [s.side, s.holdSec]), [['Left', 30], ['Right', 30]], 'each-side hold times both sides')
const cobra = mobilitySteps({ holdSec: 3, reps: 10 })
assert.equal(cobra.length, 10, 'prone cobra 10 reps x 3s runs as 10 timed holds')
assert.deepEqual([cobra[0].rep, cobra[9].rep, cobra[0].holdSec], [1, 10, 3])
assert.equal(mobilitySteps({ holdSec: 5, reps: 6, perSide: 1 }).length, 12, 'bird dog 6 each side with holds')
assert.deepEqual(mobilitySteps({ holdSec: null, reps: 8, perSide: true }).map(s => s.kind), ['reps'], 'plain reps are one tap')
assert.deepEqual(mobilitySteps({ holdSec: 60, reps: null }).map(s => s.side), [null])
assert.equal(mobilitySteps(row(w1, 'ex-doorway-pec-stretch')!).length, 4, 'pec stretch 2 x 30 s each side times 4 holds')
assert.equal(mobilitySteps(row(w1, 'ex-chin-tucks')!).length, 10, 'chin tucks time 10 holds')

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

// Every exercise id the routines name is inserted by the seed or a migration
// (an UPDATE does not count: it would hit nothing on a fresh database).
const seedIds = [...readFileSync('src/db/seed.ts', 'utf8').matchAll(/id: '(ex-[a-z0-9-]+)'/g)].map(m => m[1])
const migrationIds = readdirSync('drizzle').filter(f => f.endsWith('.sql'))
  .flatMap(f => [...readFileSync(`drizzle/${f}`, 'utf8').matchAll(/\(\s*'(ex-[a-z0-9-]+)',\s*'/g)].map(m => m[1]))
const known = new Set([...seedIds, ...migrationIds])
const referenced = new Set<string>([...warmIds])
for (const r of FOUNDATION_ROWS) {
  referenced.add(r.exerciseId)
  for (const slot of [...r.levels, r.badBack, r.badNeck]) if (slot && slot !== 'skip' && slot.exerciseId) referenced.add(slot.exerciseId)
}
for (const id of referenced) assert.ok(known.has(id), `${id} exists in the library`)
for (const id of ['ex-chin-tucks', 'ex-foam-roll-thoracic', 'ex-doorway-pec-stretch', 'ex-ytw-raises', 'ex-shoulder-rolls', 'ex-neck-iso-4way']) assert.ok(known.has(id), `${id} in the library`)

// Over-claiming cues are gone from the routine copy.
const copy = [...FOUNDATION_ROWS.map(r => r.note), ...DAILY_MOBILITY_TEMPLATE.map(r => r.notes ?? '')].join(' ')
for (const claim of [/desk kyphosis/i, /resets the diaphragm/i, /switch(?:es)? off/i, /weak from forward head/i, /turn off/i, /pull shoulders back/i]) {
  assert.ok(!claim.test(copy), `no over-claim: ${claim}`)
}
// Library cues (0029 and 0030): what to do and how it should feel, no posture
// fixes, nothing sitting "locks" or "closes off", no APT counters. seed.ts,
// seed.sql and the migrations carry the same text.
const seedTs = readFileSync('src/db/seed.ts', 'utf8')
const seedSql = readFileSync('src/db/seed.sql', 'utf8')
const migration30 = readFileSync('drizzle/0030_honest_cues.sql', 'utf8')
const cueClaims = [/posture/i, /desk/i, /sitting/i, /\bAPT\b/, /counter/i, /\bfights?\b/i, /locked/i, /\blost\b/i, /closes off/i, /\bopens\b|flexor open/i, /non-negotiable/i, /lengthens/i, /releases\b|release (?:the|tight|tension)/i, /\bfix/i, /\bcure/i]
/** The formCues string of each seed.ts entry with this id (seed.ts writes \' for an apostrophe). */
const seedCues = (id: string) => seedTs.split(`id: '${id}',`).slice(1).map(chunk => {
  const m = chunk.match(/formCues: (['"])((?:\\.|(?!\1).)*)\1/)
  assert.ok(m, `${id} has formCues`)
  return m[2].replace(/\\'/g, "'")
})
for (const id of ['ex-bent-over-row', 'ex-face-pulls', 'ex-pullup', 'ex-pigeon-stretch', 'ex-90-90-hip-switches', 'ex-walking-knee-hugs', 'ex-butterfly-stretch', 'ex-standing-quad-stretch']) {
  const cues = seedCues(id)
  assert.equal(cues.length, 1, `${id}: one entry in seed.ts`)
  const cue = cues[0]
  for (const claim of cueClaims) assert.ok(!claim.test(cue), `${id} cue, no over-claim: ${claim}`)
  const sql = cue.replace(/'/g, "''")
  assert.ok(migration30.includes(`UPDATE exercises SET form_cues = '${sql}' WHERE id = '${id}';`), `0030 updates ${id} to the seed.ts cue`)
  const sqlRows = seedSql.split('\n').filter(l => l.includes(`VALUES ('${id}', `))
  assert.equal(sqlRows.length, 1, `${id}: one row in seed.sql`)
  assert.ok(sqlRows[0].includes(`'${sql}'`), `seed.sql carries the ${id} cue`)
}
assert.ok(!/^\s*(?:UPDATE|DELETE)\s+(?!exercises\b)/im.test(migration30), '0030 only touches library rows')
assert.ok(!/^\s*(?:DELETE|DROP|ALTER|INSERT|CREATE)/im.test(migration30), '0030 is cue UPDATEs only')
const migration = readFileSync('drizzle/0029_foundation_track.sql', 'utf8')
assert.ok(!/^\s*(?:UPDATE|DELETE)\s+(?!exercises\b)/im.test(migration), '0029 only touches library rows')
for (const claim of [/desk kyphosis/i, /weak from forward head/i, /"turn off"/i, /compressed from sitting/i, /main driver of pelvic tilt/i, /brace harder/i]) {
  assert.ok(!claim.test(migration), `0029 cue fix: ${claim}`)
}

console.log('foundation tests passed')

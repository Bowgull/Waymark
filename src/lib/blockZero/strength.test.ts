// Run: tsx src/lib/blockZero/strength.test.ts
import { readFileSync } from 'node:fs'
import { backFriendlyVariation, BACK_FRIENDLY_SWAPS, defaultMainLift, getStrengthWeekTarget, mainLiftHardSets, nextLoad, STRENGTH_WEEK_TARGETS } from './strength'
import { brzycki, e1rmFromRir, e1rmFromRpe, epley, rirFromRpe } from './e1rm'
import { getStrengthTemplate } from '../strengthTemplates'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// ─── Week targets (R1, R2, R4, R16) ─────────────────────────────

const t = (w: number) => getStrengthWeekTarget(w)
assert(t(1).phase === 'test' && t(1).reps === 8 && t(1).rpe[0] === 6 && t(1).rpe[1] === 7, 'week 1: test, sets of 8 at RPE 6-7')
assert(t(1).loadPct >= 0.5 && t(1).loadPct <= 0.6, 'week 1 anchor sits in 50-60% of the stored max')
assert(t(2).rpe.join('-') === '6-7', 'week 2: RPE 6-7')
assert([3, 4, 5].every(w => t(w).rpe.join('-') === '7-8'), 'weeks 3-5: RPE 7-8')
assert(t(3).checkSet?.rpe === 8 && t(3).checkSet.repRange.join('-') === '3-5', 'week 3: e1RM check set of 3-5 at RPE ~8')
assert(t(6).checkSet != null && t(6).phase === 'consolidate', 'week 6: retest set')
assert(STRENGTH_WEEK_TARGETS.every(x => x.rpe[1] <= 8 && x.rir[0] >= 2), 'never to failure: RPE ceiling 8, at least 2 RIR')
assert(STRENGTH_WEEK_TARGETS.every(x => mainLiftHardSets(x) >= 2 && mainLiftHardSets(x) <= 3), '2-3 hard sets per main lift every week (R2)')
assert(t(1).rir.join('-') === '3-4', 'RPE 6-7 = 3-4 reps in reserve')
assert(t(7).phase === 'extension' && t(7).loadPct === t(5).loadPct && t(7).mainSets === t(5).mainSets, 'week 7 uses week-5 targets, flagged extension')
assert(t(6).loadPct === t(5).loadPct, 'week 6 holds intensity')
for (let w = 2; w <= 5; w++) assert(t(w).loadPct >= t(w - 1).loadPct, `week ${w} anchor never below week ${w - 1}`)
assert(STRENGTH_WEEK_TARGETS.every(x => x.note.length > 0 && !x.note.includes('!') && !x.note.includes('—')), 'notes in house voice (no ! or em dash)')

// ─── Load steps (R3) ────────────────────────────────────────────

const target78 = { reps: 8, rpe: [7, 8] as [number, number] }
const up1 = nextLoad({ weightKg: 60, reps: 8, rpe: 6 }, target78, 'lower')
assert(up1.change === 'increase' && up1.weightKg === 63, 'lower body, 1 RPE easy: +5%')
const up2 = nextLoad({ weightKg: 60, reps: 8, rpe: 5 }, target78, 'lower')
assert(up2.change === 'increase' && up2.weightKg === 66, 'lower body, 2 RPE easy: +10%')
const upU = nextLoad({ weightKg: 40, reps: 8, rpe: 6 }, target78, 'upper')
assert(upU.change === 'increase' && upU.weightKg === 41, 'upper body, 1 RPE easy: +2.5%')
const upU2 = nextLoad({ weightKg: 40, reps: 8, rpe: 5 }, target78, 'upper')
assert(upU2.weightKg === 42, 'upper body, 2 RPE easy: +5%')
const tiny = nextLoad({ weightKg: 10, reps: 8, rpe: 6 }, target78, 'upper')
assert(tiny.weightKg === 10.5, 'small loads still step by at least 0.5 kg')
for (const rpe of [7, 7.5, 8]) {
  const r = nextLoad({ weightKg: 60, reps: 8, rpe }, target78, 'lower')
  assert(r.change === 'hold' && r.weightKg === 60, `RPE ${rpe} inside the band: hold`)
}
assert(nextLoad({ weightKg: 60, reps: 8, rpe: 8.5 }, target78, 'lower').change === 'hold', 'half a point over: hold, not drop')
const down = nextLoad({ weightKg: 60, reps: 8, rpe: 9 }, target78, 'lower')
assert(down.change === 'decrease' && down.weightKg === 57, 'RPE 9 against 7-8: down 5%')
assert(nextLoad({ weightKg: 60, reps: 6, rpe: 6 }, target78, 'lower').change === 'decrease', 'reps short: down even if RPE looks easy')
assert(nextLoad({ weightKg: 60, reps: 8, rir: 4 }, target78, 'lower').change === 'increase', 'RIR 4 (= RPE 6) counts as easier')
assert(nextLoad({ weightKg: 60, reps: 8, rir: 2 }, target78, 'lower').change === 'hold', 'RIR 2 (= RPE 8) holds')
assert(nextLoad({ weightKg: 60, reps: 10, inferredStatus: 'rep_surplus' }, target78, 'lower').change === 'increase', 'no RPE, rep surplus: small step up')
assert(nextLoad({ weightKg: 60, reps: 8, inferredStatus: 'normal' }, target78, 'lower').change === 'hold', 'no RPE, on target: hold')
assert(nextLoad({ weightKg: 60, reps: 8, inferredStatus: 'rep_shortfall' }, target78, 'lower').change === 'decrease', 'no RPE, shortfall: down')
assert(nextLoad({ weightKg: 60, reps: 8 }, target78, 'lower').change === 'hold', 'no effort info at all: hold')
assert(nextLoad({ weightKg: 0, reps: 8, rpe: 5 }, target78, 'lower').change === 'hold', 'no load logged: hold')
// Property: load never goes up when the top set was at or above the target's low end.
for (const rpe of [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
  for (const region of ['upper', 'lower'] as const) {
    const r = nextLoad({ weightKg: 50, reps: 8, rpe }, { reps: 8, rpe: [6, 7] }, region)
    assert(r.weightKg <= 50, `RPE ${rpe} vs 6-7 (${region}): no increase`)
  }
}
assert(!up1.reason.includes('!') && !down.reason.includes('—'), 'load reasons in house voice')

// ─── Variations ─────────────────────────────────────────────────

assert(defaultMainLift('squat', 1).exerciseId === 'ex-goblet-squat' && defaultMainLift('squat', 3).exerciseId === 'ex-front-squat', 'squat: goblet weeks 1-2, front squat from 3')
assert(defaultMainLift('hinge', 2).exerciseId === 'ex-db-rdl' && defaultMainLift('hinge', 7).exerciseId === 'ex-block-pull', 'hinge: DB RDL early, block pull later (week 7 = week 5)')
assert(defaultMainLift('row', 1).exerciseId === 'ex-db-row' && defaultMainLift('row', 4).exerciseId === 'ex-bent-over-row', 'row: supported DB row early')

const v2 = backFriendlyVariation('ex-front-squat', 2)
assert(v2.swapped && v2.exerciseId === 'ex-goblet-squat' && v2.reason?.includes('2'), 'back 2: front squat swaps to goblet')
assert(backFriendlyVariation('ex-block-pull', 1).exerciseId === 'ex-glute-bridges', 'back 1: block pull swaps to glute bridges')
assert(backFriendlyVariation('ex-bent-over-row', 2).exerciseId === 'ex-db-row', 'back 2: bent-over row swaps to supported DB row')
assert(!backFriendlyVariation('ex-front-squat', 3).swapped, 'back 3: no swap')
assert(!backFriendlyVariation('ex-front-squat', null).swapped, 'no back score: no swap')
assert(!backFriendlyVariation('ex-bench-press', 1).swapped, 'bench has no swap (no spinal load)')

// Every id the rules reference must exist in the seed or migrations.
const library = readFileSync('src/db/seed.ts', 'utf8') + readFileSync('drizzle/0022_road_bootcamp.sql', 'utf8')
const knownIds = new Set([...library.matchAll(/'(ex-[a-z0-9-]+)'/g)].map(m => m[1]))
const referenced = new Set<string>()
for (const [from, to] of Object.entries(BACK_FRIENDLY_SWAPS)) { referenced.add(from); referenced.add(to.exerciseId) }
for (const slot of ['squat', 'hinge', 'row'] as const) for (const w of [1, 3]) referenced.add(defaultMainLift(slot, w).exerciseId)
for (const w of [1, 2, 3, 4, 5, 6, 7]) {
  for (const dow of [1, 3, 5]) {
    for (const e of getStrengthTemplate(dow, w, 'block_zero').exercises) referenced.add(e.exerciseId)
  }
}
for (const id of referenced) assert(knownIds.has(id), `exercise ${id} exists in the library`)

// ─── e1RM (R4) ──────────────────────────────────────────────────

assert(epley(100, 5) === 116.7, 'Epley 100 x 5 = 116.7')
assert(epley(100, 1) === 100, 'Epley single = the weight')
assert(brzycki(100, 5) === 112.5, 'Brzycki 100 x 5 = 112.5')
assert(epley(100, 10) != null && brzycki(100, 10) != null, '10 reps still valid')
assert(epley(100, 11) === null && brzycki(100, 12) === null, 'over 10 reps returns null')
assert(epley(100, 0) === null && epley(0, 5) === null && epley(-5, 5) === null, 'zero or negative input returns null')
assert(e1rmFromRir(100, 5, 2) === epley(100, 7), 'RIR-adjusted = Epley on reps + RIR')
assert(e1rmFromRpe(100, 5, 8) === epley(100, 7), 'RPE 8 = 2 RIR')
assert(e1rmFromRir(100, 8, 3) === null, '8 reps with 3 left (11 to failure) is out of range')
assert(e1rmFromRir(100, 5, -1) === null && e1rmFromRpe(100, 5, 11) === null, 'bad RIR/RPE returns null')
assert(rirFromRpe(7) === 3 && rirFromRpe(10) === 0, 'RPE to RIR')

console.log('\nAll Block Zero strength tests passed')

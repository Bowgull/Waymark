// Run: tsx src/lib/blockZero/strength.test.ts
import { readFileSync } from 'node:fs'
import { backFriendlyVariation, BACK_FRIENDLY_SWAPS, blockZeroWorkingLoad, defaultMainLift, effectiveRir, getStrengthWeekTarget, latestRirTopSet, liftRegion, LIFT_REGION, mainLiftHardSets, nextLoad, restateSetCount, STRENGTH_WEEK_TARGETS, type LoggedWorkingSet } from './strength'
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
const library = ['src/db/seed.ts', 'drizzle/0022_road_bootcamp.sql', 'drizzle/0026_block_zero_phase_b.sql', 'drizzle/0028_logging_safety.sql', 'drizzle/0057_fighter_strength_rows.sql', 'drizzle/0058_landmine_rows.sql'].map(f => readFileSync(f, 'utf8')).join('\n')
const knownIds = new Set([...library.matchAll(/'(ex-[a-z0-9-]+)'/g)].map(m => m[1]))
const referenced = new Set<string>()
for (const [from, to] of Object.entries(BACK_FRIENDLY_SWAPS)) { referenced.add(from); referenced.add(to.exerciseId) }
for (const slot of ['squat', 'hinge', 'row'] as const) for (const w of [1, 3]) referenced.add(defaultMainLift(slot, w).exerciseId)
for (const w of [1, 2, 3, 4, 5, 6, 7]) {
  for (const dow of [1, 3, 5]) {
    for (const e of getStrengthTemplate(dow, w, 'block_zero').exercises) referenced.add(e.exerciseId)
  }
}
for (const id of Object.keys(LIFT_REGION)) referenced.add(id)
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

// ─── Working load from logged RIR (Phase B) ─────────────────────

assert(effectiveRir(0) === 0 && effectiveRir(2) === 2 && effectiveRir(3) === 3.5, 'RIR 3 means "3 or more" and reads as 3.5')
assert(liftRegion('ex-goblet-squat') === 'lower' && liftRegion('ex-bench-press') === 'upper' && liftRegion('ex-unknown') === 'upper', 'lift regions; unknown lifts take the smaller upper step')

const set = (weightKg: number | null, reps: number, rir: number | null, completedAt: number | null, setNumber = 1, plannedReps: number | null = 8): LoggedWorkingSet =>
  ({ weightKg, reps, rir, completedAt, setNumber, plannedReps })
const T1 = getStrengthWeekTarget(1)
const T2 = getStrengthWeekTarget(2)
const T3 = getStrengthWeekTarget(3)

assert(blockZeroWorkingLoad({ exerciseId: 'ex-goblet-squat', history: [], target: T2 }) === null, 'no history: null (TM x % fallback)')
assert(blockZeroWorkingLoad({ exerciseId: 'ex-goblet-squat', history: [set(20, 8, null, 1000)], target: T2 }) === null, 'sets without RIR: null (TM x % fallback)')
const workUp = blockZeroWorkingLoad({ exerciseId: 'ex-goblet-squat', history: [set(12, 8, 3, 1000, 1), set(16, 8, 3, 1100, 2), set(20, 8, 3, 1200, 3)], target: T2 })
assert(workUp?.weightKg === 20 && workUp.change === 'hold', 'week-1 work-up: the top set of 8 at 3+ left is the starting load')
assert(blockZeroWorkingLoad({ exerciseId: 'ex-goblet-squat', history: [set(20, 8, 2, 1000)], target: T1 })?.change === 'decrease', 'RIR 2 in the RPE 6-7 weeks is harder than target: down')
const w3 = blockZeroWorkingLoad({ exerciseId: 'ex-front-squat', history: [set(40, 8, 3, 1000)], target: T3 })
assert(w3?.change === 'increase' && w3.weightKg === 42, 'RIR 3+ against the RPE 7-8 band: small lower-body step (+5%)')
const w3u = blockZeroWorkingLoad({ exerciseId: 'ex-bench-press', history: [set(40, 8, 3, 1000)], target: T3 })
assert(w3u?.change === 'increase' && w3u.weightKg === 41, 'RIR 3+ against RPE 7-8, upper body: +2.5%')
assert(blockZeroWorkingLoad({ exerciseId: 'ex-front-squat', history: [set(40, 8, 2, 1000)], target: T3 })?.change === 'hold', 'RIR 2 inside RPE 7-8: hold')
assert(blockZeroWorkingLoad({ exerciseId: 'ex-front-squat', history: [set(40, 8, 0, 1000)], target: T3 })?.weightKg === 38, 'RIR 0 (failure): down 5%')
assert(blockZeroWorkingLoad({ exerciseId: 'ex-front-squat', history: [set(40, 6, 3, 1000)], target: T3 })?.change === 'decrease', 'reps short: down')
assert(blockZeroWorkingLoad({ exerciseId: 'ex-front-squat', history: [set(40, 8, 3, 1000)], target: T3, eased: true })?.weightKg === 40, 'eased day: load never goes up')
// Latest session wins; check sets (planned 5) never count as the top set.
const top = latestRirTopSet([set(30, 8, 3, 1000), set(45, 5, 2, 90000, 1, 5), set(40, 8, 2, 90100, 2), set(40, 8, 1, 90200, 3)], 8)
assert(top?.weightKg === 40 && top.setNumber === 3, 'top set: latest session, heaviest working set, last on a tie; check set ignored')
assert(latestRirTopSet([set(40, 8, 2, null)], 8) === null, 'unfinished sets do not count')
// Two sessions the same day: the session id decides, not the clock.
const sameDay = [
  { ...set(40, 8, 2, 5000, 2), sessionId: 'am' },
  { ...set(40, 8, 3, 9000, 2), sessionId: 'pm' },
  { ...set(44, 5, 2, 8900, 1, 5), sessionId: 'pm' },
]
assert(latestRirTopSet(sameDay, 8)?.rir === 3, 'same-day sessions: the later session is the one read')
// Property: RIR at or under the band's top never raises the load.
for (const rir of [0, 1, 2]) {
  for (const tw of [T1, T2, T3]) {
    const r = blockZeroWorkingLoad({ exerciseId: 'ex-front-squat', history: [set(50, 8, rir, 1000)], target: tw })
    assert(r != null && r.weightKg <= 50, `RIR ${rir} vs RPE ${tw.rpe.join('-')}: no increase`)
  }
}

// E2E minor 13: an eased lift's week note says the sets that are left.
assert(restateSetCount('2 sets of 8 at RPE 6-7, 3-4 reps left. Never to failure.', 1) === '1 set of 8 at RPE 6-7, 3-4 reps left. Never to failure.', 'eased note: one set of 8, not 2')
assert(restateSetCount('First set is a check: 3-5 reps at about RPE 8, 2 left. Then 2 sets of 8 at RPE 7-8.', 1)!.endsWith('Then 1 set of 8 at RPE 7-8.'), 'week 3: the working sets after the check')
assert(restateSetCount('Week 1. Work up to a set of 8 at RPE 6-7.', 1) === 'Week 1. Work up to a set of 8 at RPE 6-7.', 'no count to restate')
assert(restateSetCount(null, 1) === null, 'no note')
// E2E minor 14: a one-number target reads "7", never "6-6".
assert(nextLoad({ weightKg: 40, reps: 8, rpe: 7 }, { reps: 8, rpe: [7, 7] }, 'lower').reason === 'Top set landed at RPE 7. Target is 7. Hold.', 'one-number RPE target')
assert(nextLoad({ weightKg: 40, reps: 8, rpe: 6 }, { reps: 8, rpe: [6, 7] }, 'lower').reason === 'Top set landed at RPE 6. Target is 6-7. Hold.', 'a range stays a range')
console.log('\nAll Block Zero strength tests passed')

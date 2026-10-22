// Run: tsx src/lib/blockZero/endGate.test.ts
import { readFileSync } from 'node:fs'
import {
  FIGHTER_DEFAULT_TOTAL_WEEKS,
  NEXT_BLOCK_NAME,
  backTrend,
  keySessionCompletionRate,
  longestGapInWindow,
  retestE1rms,
  isRetestSetWeek,
  GATE_SQUAT_ID,
} from './endGate'
import { FIGHTER_MAIN_LIFT_IDS, resolveCalibrationStarts, resolveLiftId, selectMainLifts } from './lifts'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// The end gate and its extensions are gone (coach-brain §8): lib/brain/readinessParts.test.ts covers readiness.
assert(NEXT_BLOCK_NAME === 'Fighter Block 1' && FIGHTER_DEFAULT_TOTAL_WEEKS === 12, 'the hand-off: Fighter Block 1, 12 weeks')

// ─── Gate inputs ────────────────────────────────────────────────

const sess = [
  { type: 'strength', status: 'completed', scheduledDate: 10 },
  { type: 'foundation_run', status: 'missed', scheduledDate: 11 },
  { type: 'strength', status: 'skipped', scheduledDate: 12 },
  { type: 'strength', status: 'planned', scheduledDate: 13 },
  { type: 'strength', status: 'planned', scheduledDate: 20 },
  { type: 'mobility', status: 'completed', scheduledDate: 13 },
  { type: 'mobility', status: 'missed', scheduledDate: 14 },
]
assert(keySessionCompletionRate(sess, 15) === 0.25, 'completion: key sessions only, past planned counts as due, future does not')
assert(keySessionCompletionRate([], 15) === null, 'nothing due: null')

assert(longestGapInWindow([0, 1, 2, 3, 4, 5, 7, 8], 8, 0, 21) === 1, 'Sunday rest is a 1-day gap')
assert(longestGapInWindow([0, 1, 2, 10, 11], 11, 0, 21) === 7, '7 days between completions')
assert(longestGapInWindow([0, 1, 2, 10, 11], 40, 0, 21) === 29, 'open gap to today counts')
assert(longestGapInWindow([0, 1, 2, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], 31, 0, 21) === 0, 'gap older than the window is ignored')
assert(longestGapInWindow([3, 4, 5], 5, 0, 21) === 0, 'slow start of the block is not a gap')
assert(longestGapInWindow([], 10, 0, 21) === 11, 'nothing done: the whole block is a gap')

const back = (vals: number[], start: number) => vals.map((v, i) => ({ epochDay: start + i, backToday: v }))
assert(backTrend([...back([3, 3, 3, 3, 3, 3, 3], 0), ...back([4, 4, 4, 4, 4, 4, 4], 35)], 0, 41) === 'better', 'back better')
assert(backTrend([...back([4, 4, 4, 4, 4, 4, 4], 0), ...back([3, 3, 3, 3, 3, 3, 3], 35)], 0, 41) === 'worse', 'back worse')
assert(backTrend([...back([4, 4, 4, 4, 4, 4, 4], 0), ...back([4, 4, 2, 2, 2, 4, 4], 35)], 0, 41) === 'worse', 'a 3-day flare at the end reads worse')
assert(backTrend([...back([4, 4, 4, 4, 4, 4, 4], 0), ...back([4, 4, 4, 3, 4, 4, 4], 35)], 0, 41) === 'stable', 'small dip: stable')
assert(backTrend(back([4, 4], 0), 0, 41) === 'unknown', 'too little data: unknown')

const e1 = retestE1rms([
  { exerciseId: 'ex-bench-press', weightKg: 60, reps: 5 },
  { exerciseId: 'ex-bench-press', weightKg: 50, reps: 8 },
  { exerciseId: 'ex-front-squat', weightKg: 70, reps: 12 },
  { exerciseId: 'ex-ohp', weightKg: null, reps: 5 },
])
assert(e1.get('ex-bench-press') === 70 && !e1.has('ex-front-squat') && !e1.has('ex-ohp'), 'retest e1RM: best valid set, >10 reps and empty sets ignored')
const withRir = retestE1rms([{ exerciseId: 'ex-front-squat', weightKg: 60, reps: 8, rir: 2 }])
assert(withRir.get('ex-front-squat') === 80, 'with RIR logged: reps + RIR to failure (8 + 2 = 10, Epley 80)')
assert(retestE1rms([{ exerciseId: 'ex-front-squat', weightKg: 60, reps: 8, rir: 3 }]).get('ex-front-squat') === 76, 'reps + RIR past 10: plain Epley on the reps done (errs low)')

// ─── "Retest done" with no test week (2026-10-18) ──────────────
assert(GATE_SQUAT_ID === 'ex-front-squat', 'the gate reads the front squat')
assert(isRetestSetWeek(5) && isRetestSetWeek(6) && !isRetestSetWeek(4) && !isRetestSetWeek(null), 'week 5 and 6 sets (and extension weeks, stamped 5) feed the estimates')

// ─── Lift matching (bug 1c) ─────────────────────────────────────

// Read the real seed so this tracks renames.
const seedText = readFileSync('src/db/seed.ts', 'utf8')
const seedExercises = [...seedText.matchAll(/id: '(ex-[a-z0-9-]+)',\s*name: (?:'([^']*)'|"([^"]*)")/g)].map(m => ({ id: m[1], name: m[2] ?? m[3] }))
assert(seedExercises.length > 40, `parsed ${seedExercises.length} seed exercises`)
const main = selectMainLifts(seedExercises)
assert(main.length === FIGHTER_MAIN_LIFT_IDS.length, `all ${FIGHTER_MAIN_LIFT_IDS.length} Fighter main lifts found by id`)
for (const id of ['ex-front-squat', 'ex-deadlift', 'ex-bench-press', 'ex-ohp', 'ex-bent-over-row']) {
  assert(main.some(e => e.id === id), `${id} is recalibrated`)
}
const OLD_NAMES = ['Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Barbell Row']
assert(seedExercises.filter(e => OLD_NAMES.includes(e.name)).length === 2, 'regression: the old name list only matched 2 of 5')

assert(resolveLiftId('Squat', seedExercises) === 'ex-front-squat', '"Squat" resolves to front squat')
assert(resolveLiftId('Barbell Row', seedExercises) === 'ex-bent-over-row', '"Barbell Row" resolves to bent-over row')
assert(resolveLiftId('Deadlift', seedExercises) === 'ex-deadlift', '"Deadlift" resolves to conventional deadlift')
assert(resolveLiftId('romanian deadlift', seedExercises) === 'ex-rdl', 'exact name match is case-insensitive')
assert(resolveLiftId('OHP', seedExercises) === 'ex-ohp', 'abbreviation resolves')
assert(resolveLiftId('Goblet Squat', seedExercises) === null, 'alias to an id not in this library: null')
assert(resolveLiftId('Zercher Squat', seedExercises) === null && resolveLiftId('', seedExercises) === null, 'unknown: null')

// ─── Assessment persistence mapping (bug 1d) ────────────────────

const writes = resolveCalibrationStarts([
  { exerciseName: 'Squat', startingWeightKg: 60 },
  { exerciseName: 'Front Squat', startingWeightKg: 70 },
  { exerciseName: 'Bench Press', startingWeightKg: 50 },
  { exerciseName: 'Barbell Row', startingWeightKg: 45 },
  { exerciseName: 'Turkish Get-Up', startingWeightKg: 20 },
  { exerciseName: 'Overhead Press', startingWeightKg: 0 },
], seedExercises)
assert(writes.length === 3, 'unknown lifts and zero weights dropped, duplicates collapsed')
assert(writes[0].exerciseId === 'ex-front-squat' && writes[0].weightKg === 60, 'first estimate for an id wins')
assert(writes.some(w => w.exerciseId === 'ex-bent-over-row' && w.weightKg === 45), 'Barbell Row saved against ex-bent-over-row')

console.log('\nAll Block Zero end gate tests passed')

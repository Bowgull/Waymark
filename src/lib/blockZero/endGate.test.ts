// Run: tsx src/lib/blockZero/endGate.test.ts
import { readFileSync } from 'node:fs'
import {
  FIGHTER_DEFAULT_TOTAL_WEEKS,
  NEXT_BLOCK_NAME,
  backTrend,
  evaluateEndGate,
  keySessionCompletionRate,
  longestGapInWindow,
  planTransition,
  retestE1rms,
  type EndGateInput,
} from './endGate'
import { FIGHTER_MAIN_LIFT_IDS, resolveCalibrationStarts, resolveLiftId, selectMainLifts } from './lifts'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

const clean: EndGateInput = { completionRate: 0.85, longestRecentGapDays: 1, backTrend: 'stable', retestDone: true, extensionsUsed: 0 }

// ─── Gate ───────────────────────────────────────────────────────

assert(evaluateEndGate(clean).decision === 'proceed', 'clean block: proceed')
assert(evaluateEndGate({ ...clean, backTrend: 'unknown' }).decision === 'proceed', 'no back data yet: does not block')
assert(evaluateEndGate({ ...clean, backTrend: 'better' }).decision === 'proceed', 'back better: proceed')
const low = evaluateEndGate({ ...clean, completionRate: 0.65 })
assert(low.decision === 'extend' && low.extendWeeks === 1 && low.reasons[0] === '65% of sessions done. The floor is 70%.', 'completion 65%: extend 1 with reason')
assert(evaluateEndGate({ ...clean, completionRate: 0.7 }).decision === 'proceed', 'completion exactly 70%: proceed')
assert(evaluateEndGate({ ...clean, completionRate: 0.4 }).extendWeeks === 2, 'completion under 50%: extend 2')
assert(evaluateEndGate({ ...clean, completionRate: 0.4, extensionsUsed: 1 }).extendWeeks === 1, 'extend never past the 2-extension limit')
assert(evaluateEndGate({ ...clean, longestRecentGapDays: 7 }).decision === 'extend', '7-day recent gap: extend')
assert(evaluateEndGate({ ...clean, longestRecentGapDays: 6 }).decision === 'proceed', '6-day gap: proceed')
assert(evaluateEndGate({ ...clean, backTrend: 'worse' }).decision === 'extend', 'back worse: extend')
assert(evaluateEndGate({ ...clean, retestDone: false }).decision === 'extend', 'no retest: extend')
assert(evaluateEndGate({ ...clean, completionRate: null }).decision === 'extend' && evaluateEndGate({ ...clean, completionRate: null }).reasons[0] === 'No sessions logged yet.', 'no data at all: extend, says so')
const forced = evaluateEndGate({ ...clean, completionRate: 0.3, extensionsUsed: 2 })
assert(forced.decision === 'proceed' && forced.forced && forced.reasons.some(r => r.includes('Two extensions used')), 'two extensions used: forced proceed')
assert([low, forced].every(g => g.reasons.every(r => !r.includes('!') && !r.includes('—'))), 'gate reasons in house voice')

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

// ─── Transition plan (bug 1e) ───────────────────────────────────

const retest = new Map([['ex-bench-press', 70], ['ex-front-squat', 90], ['ex-goblet-squat', 40]])
const go = planTransition({ gate: clean, aiDecision: 'proceed', aiTargets: [], retestE1rms: retest, totalWeeks: 6, atEndBoundary: true })
assert(go.decision === 'proceed' && go.reportedDecision === 'proceed', 'gate + AI proceed: proceed')
assert(go.nextBlock?.blockType === 'fighter' && go.nextBlock.name === NEXT_BLOCK_NAME && go.nextBlock.totalWeeks === FIGHTER_DEFAULT_TOTAL_WEEKS, 'proceed creates Fighter Block 1 at the Fighter default length')
assert(go.calibration.find(c => c.exerciseId === 'ex-bench-press')?.weightKg === 63 && go.calibration.find(c => c.exerciseId === 'ex-front-squat')?.weightKg === 81, 'retest e1RMs become maxes at 90%')
assert(!go.calibration.some(c => c.exerciseId === 'ex-goblet-squat'), 'only Fighter main lifts are recalibrated from the retest')
const offline = planTransition({ gate: clean, aiDecision: null, aiTargets: [], retestE1rms: retest, totalWeeks: 6, atEndBoundary: true })
assert(offline.decision === 'proceed' && offline.nextBlock != null, 'AI offline: rules alone still proceed')
const withAi = planTransition({ gate: clean, aiDecision: 'adjust', aiTargets: [{ exerciseId: 'ex-bench-press', estimatedMaxKg: 60 }], retestE1rms: retest, totalWeeks: 6, atEndBoundary: true })
assert(withAi.decision === 'adjust' && withAi.nextBlock != null, 'AI adjust: moves on with modified loads')
assert(withAi.calibration.find(c => c.exerciseId === 'ex-bench-press')?.source === 'ai' && withAi.calibration.filter(c => c.exerciseId === 'ex-bench-press').length === 1, 'AI target wins for a lift it covered')
assert(withAi.calibration.find(c => c.exerciseId === 'ex-front-squat')?.weightKg === 76.5, 'adjust uses 85% for retest-derived maxes')
const aiOver = planTransition({ gate: { ...clean, completionRate: 0.6 }, aiDecision: 'proceed', aiTargets: [], retestE1rms: retest, totalWeeks: 6, atEndBoundary: true })
assert(aiOver.decision === 'extend' && aiOver.reportedDecision === 'hold' && aiOver.newTotalWeeks === 7 && aiOver.nextBlock === null, 'AI says proceed at 60% completion: rules extend, no next block')
assert(aiOver.reasons.some(r => r.includes('rules hold the line')), 'override is explained')
assert(aiOver.calibration.length === 0, 'no retest recalibration while extending')
const aiHold = planTransition({ gate: clean, aiDecision: 'hold', aiTargets: [], retestE1rms: retest, totalWeeks: 6, atEndBoundary: true })
assert(aiHold.decision === 'extend' && aiHold.extendWeeks === 1, 'AI may be more cautious: hold extends 1 week')
const aiHoldMax = planTransition({ gate: { ...clean, extensionsUsed: 2 }, aiDecision: 'hold', aiTargets: [], retestE1rms: retest, totalWeeks: 8, atEndBoundary: true })
assert(aiHoldMax.decision === 'proceed' && aiHoldMax.nextBlock != null, 'AI hold after 2 extensions: proceeds anyway')
const forcedPlan = planTransition({ gate: { ...clean, completionRate: 0.5, extensionsUsed: 2 }, aiDecision: 'hold', aiTargets: [], retestE1rms: retest, totalWeeks: 8, atEndBoundary: true })
assert(forcedPlan.decision === 'adjust' && forcedPlan.newTotalWeeks === 8 && forcedPlan.nextBlock != null, 'gate fails at 8 weeks: forced proceed with adjust semantics')
const early = planTransition({ gate: { ...clean, retestDone: false }, aiDecision: 'hold', aiTargets: [], retestE1rms: new Map(), totalWeeks: 6, atEndBoundary: false })
assert(early.decision === 'not_yet' && early.extendWeeks === 0 && early.newTotalWeeks === 6, 'checked mid-block: nothing extends early')
for (let used = 0; used <= 2; used++) {
  const p = planTransition({ gate: { ...clean, completionRate: 0.2, extensionsUsed: used }, aiDecision: 'hold', aiTargets: [], retestE1rms: retest, totalWeeks: 6 + used, atEndBoundary: true })
  assert(p.newTotalWeeks <= 8, `extensions used ${used}: total never past 8 weeks (${p.newTotalWeeks})`)
}

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

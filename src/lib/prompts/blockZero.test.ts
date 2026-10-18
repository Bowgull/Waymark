// Run: tsx src/lib/prompts/blockZero.test.ts
//
// Block Zero assessment and transition prompt assembly, with and without test
// data, plus the test-data math they read (week-1 baselines, ceilings,
// week 1 vs retest deltas) and the assessment guard. Pure: no DB, no API.

import { buildAssessmentPrompt, buildTransitionPrompt, type BlockZeroAssessmentOutput, type TransitionPromptData } from './blockZero'
import { calibrationCeilingKg, fixedResults, hasWeek1Tests, retestCeilingKg, testDeltas, week1LiftBaselines, workupE1rm, type TestRow, type WorkupSet } from '../blockZero'
import { assessmentTestData, guardAssessment, transitionTestData } from '../../server/routes/blockZero'
import type { BlockTestData } from '../../server/blockZeroData'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

// ─── Test-data math ─────────────────────────────────────────────

const workups: WorkupSet[] = [
  { exerciseId: 'ex-bench-press', weightKg: 40, reps: 8, plannedReps: 8, rir: 3, completedAt: 1000, setNumber: 1, sessionId: 's1' },
  { exerciseId: 'ex-bench-press', weightKg: 50, reps: 8, plannedReps: 8, rir: 3, completedAt: 1200, setNumber: 2, sessionId: 's1' },
  { exerciseId: 'ex-ohp', weightKg: 30, reps: 8, plannedReps: 8, rir: 2, completedAt: 1300, setNumber: 1, sessionId: 's2' },
  { exerciseId: 'ex-goblet-squat', weightKg: 24, reps: 8, plannedReps: 8, rir: null, completedAt: 1300, setNumber: 1, sessionId: 's2' },
]
const rows: TestRow[] = [
  { week: 1, testKey: 'e1rm:ex-rdl', value: 80, unit: 'kg' },
  { week: 1, testKey: 'pushups_max', value: 22, unit: 'reps' },
  { week: 1, testKey: 'fixed_effort_hr', value: 151, unit: 'bpm' },
  { week: 1, testKey: 'talk_test_hr', value: 142, unit: 'bpm' },
  { week: 1, testKey: 'side_plank_sec_l', value: 45, unit: 's' },
  { week: 1, testKey: 'mobility:thoracic', value: 3, unit: 'score' },
  { week: 6, testKey: 'pushups_max', value: 28, unit: 'reps' },
  { week: 6, testKey: 'fixed_effort_hr', value: 144, unit: 'bpm' },
  { week: 6, testKey: 'e1rm:ex-bench-press', value: 72, unit: 'kg' },
]

const base = week1LiftBaselines(rows, workups)
assert(workupE1rm(50, 8, 3) === 66.7, 'work-up 50 x 8 with 3+ left: reps to failure capped at 10, e1RM 66.7')
assert(base.get('ex-bench-press')?.source === 'workup' && base.get('ex-bench-press')?.workup?.weightKg === 50, 'bench baseline from the heaviest RIR-logged work-up set')
assert(base.get('ex-rdl')?.source === 'test' && base.get('ex-rdl')?.e1rmKg === 80, 'a logged week-1 e1RM wins')
assert(!base.has('ex-goblet-squat'), 'a work-up with no RIR gives no baseline')
assert(calibrationCeilingKg(base.get('ex-bench-press')!) === 60 && calibrationCeilingKg(base.get('ex-rdl')!) === 72, 'ceilings: 90% of the week-1 e1RM')
assert(retestCeilingKg(80, 'proceed') === 72 && retestCeilingKg(80, 'adjust') === 68, 'retest ceilings: 90%, 85% on adjust')
assert(hasWeek1Tests(rows, base) && !hasWeek1Tests([], new Map()), 'tests exist once any week-1 result is in')
assert(fixedResults(rows, w => w === 1).map(r => r.key).join(',') === 'pushups_max,side_plank_sec_l,talk_test_hr,fixed_effort_hr,mobility:thoracic', 'week-1 fixed results in a stable order')

const names = new Map([['ex-bench-press', 'Bench Press'], ['ex-ohp', 'Overhead Press'], ['ex-rdl', 'Romanian Deadlift']])
const deltas = testDeltas(rows, base, new Map([['ex-bench-press', 72]]), names)
const bench = deltas.find(d => d.key === 'e1rm:ex-bench-press')
assert(bench?.week1 === 66.7 && bench.retest === 72 && bench.change === 5.3, 'bench e1RM 66.7 -> 72 (+5.3)')
assert(deltas.find(d => d.key === 'fixed_effort_hr')?.change === -7 && deltas.find(d => d.key === 'pushups_max')?.change === 6, 'fixed-effort HR -7 bpm, push-ups +6')
assert(deltas.find(d => d.key === 'side_plank_sec_l')?.retest === null, 'a test with no retest shows none')

// ─── Assessment prompt ──────────────────────────────────────────

const profile = { trainingHistory: 'Lifted 3 years, stopped 8 months ago.', goals: 'Fight fit.' }
const plain = buildAssessmentPrompt(profile)
assert(plain.startsWith('Block Zero is starting.') && !plain.includes('Week 1 test results'), 'no tests: the starting assessment prompt')
assert(plain.includes('Reply with only the blockZeroAssessment JSON object.'), 'structured-output instruction kept')
assert(buildAssessmentPrompt({ trainingHistory: null, goals: null }).includes('No onboarding data available.'), 'no onboarding and no tests: defaults line')

const testData: BlockTestData = {
  rows: rows.map(r => ({ ...r, unit: r.unit ?? '' })),
  baselines: base,
  names,
  testsExist: true,
  ceilings: new Map([...base.values()].map(b => [b.exerciseId, calibrationCeilingKg(b)])),
}
const tests = assessmentTestData(testData)
assert(tests != null && tests.lifts.length === 3, 'assessment test data: one line per baseline lift')
const withTests = buildAssessmentPrompt(profile, tests)
assert(withTests.startsWith('Block Zero week 1 tests are in.'), 'with tests: reassessment framing')
assert(withTests.includes('Bench Press (id: ex-bench-press): work-up 50 kg x 8, 3+ left, e1RM about 66.7 kg. Ceiling 60 kg.'), 'work-up line with the ceiling')
assert(withTests.includes('Romanian Deadlift (id: ex-rdl): logged e1RM 80 kg. Ceiling 72 kg.'), 'logged e1RM line with the ceiling')
assert(withTests.includes('Push-ups 22 reps') && withTests.includes('HR at fixed effort 151 bpm') && withTests.includes('Talk-test HR 142 bpm') && withTests.includes('Mobility thoracic 3 score'), 'fixed tests listed')
assert(withTests.includes('HARD LIMIT: no calibrationStart above its lift\'s ceiling'), 'the ceiling is stated as a hard limit')
assert(withTests.includes('They are not saved until tested.'), 'untested lifts: told they wait for a test')
assert(withTests.indexOf('Week 1 test results') < withTests.indexOf('Reply with only'), 'tests come before the JSON instruction')
assert(!withTests.includes('No onboarding data'), 'no defaults line when tests exist')
assert(assessmentTestData({ ...testData, testsExist: false }) === null, 'no tests: no test block')

// ─── Assessment guard ───────────────────────────────────────────

const exerciseRows = [
  { id: 'ex-bench-press', name: 'Bench Press' },
  { id: 'ex-rdl', name: 'Romanian Deadlift' },
  { id: 'ex-front-squat', name: 'Front Squat' },
]
const aiAssessment: BlockZeroAssessmentOutput = {
  narrative: 'Six weeks — build it right!',
  weekThemes: [],
  calibrationStarts: [
    { exerciseName: 'Bench Press', startingWeightKg: 85, rationale: 'Old best.' },
    { exerciseName: 'Romanian Deadlift', startingWeightKg: 70, rationale: 'Test 80 e1RM.' },
    { exerciseName: 'Front Squat', startingWeightKg: 90, rationale: 'Guess.' },
  ],
  mtCapPerWeek: 5,
}
const g = guardAssessment(aiAssessment, exerciseRows, testData)
assert(g.output.calibrationStarts[0].startingWeightKg === 60 && g.output.calibrationStarts[1].startingWeightKg === 70, 'bench 85 clamped to its 60 kg ceiling; RDL 70 under 72 kept')
assert(g.writes.map(w => w.exerciseId).join(',') === 'ex-bench-press,ex-rdl', 'only test-backed maxes are written once tests exist')
assert(g.mtCap === 3 && g.output.mtCapPerWeek === 3, 'MT cap clamped to 3')
assert(!/[!—]/.test(g.output.narrative), 'narrative in the house voice')
const fresh = guardAssessment(aiAssessment, exerciseRows, { ceilings: new Map(), testsExist: false })
assert(fresh.writes.length === 0, 'before any test: no untested max is written (map #8)')

// ─── Transition prompt ──────────────────────────────────────────

const data: TransitionPromptData = {
  weeks: [{ weekNumber: 1, planned: 21, completed: 18, avgRpe: 5.5, avgDifficulty: 2, avgSleepHours: 7.2, avgSoreness: 2.5 }],
  mainLifts: [{ id: 'ex-bench-press', name: 'Bench Press', currentMaxKg: 60 }],
  adherence: {
    blockCompletionRate: 0.86, blockPlannedSoFar: 100, blockCompleted: 86, blockMissed: 10, blockSkipped: 4,
    last7DaysCompletionRate: 0.9, last14DaysCompletionRate: 0.88, last28DaysCompleted: 60,
    daysSinceLastCompleted: 1, longestGapDays: 3, currentGapDays: 1, acuteChronicRatio: 1.05, label: 'strong',
  },
  guidance: { returnDeload: 'none', blockProgression: 'proceed', rationale: 'On track.' },
  hrBlock: null,
}
const t0 = buildTransitionPrompt(data)
assert(t0.includes('Week 1: 18/21 sessions completed.') && !t0.includes('Week 1 vs retest'), 'no tests: the existing transition prompt')
assert(t0.includes('A rules gate') && t0.includes('Reply with only the blockTransition JSON object.'), 'gate note and JSON instruction')

const tt = transitionTestData(testData, new Map([['ex-bench-press', 72]]), 'better')
assert(tt != null && tt.ceilings.length === 1 && tt.ceilings[0].ceilingKg === 65 && tt.ceilings[0].adjustCeilingKg === 61, 'retest ceilings 90% / 85% of 72')
const t1 = buildTransitionPrompt(data, tt)
assert(t1.includes('Week 1 vs retest (real test numbers):'), 'with tests: deltas block')
assert(t1.includes('Bench Press e1RM: 66.7 -> 72 kg (+5.3).') && t1.includes('HR at fixed effort: 151 -> 144 bpm (-7).') && t1.includes('Push-ups: 22 -> 28 reps (+6).'), 'e1RM, fixed-effort HR and push-up deltas')
assert(t1.includes('Back today trend (first week vs last week): better.'), 'back trend')
assert(t1.includes('Bench Press (id: ex-bench-press): e1RM 72 kg. Ceiling 65 kg, 61 kg on adjust.') && t1.includes('HARD LIMIT: no calibrationTarget above its ceiling.'), 'retest ceilings stated as a hard limit')
assert(t1.includes('Set calibrationTargets from the retest e1RMs above'), 'targets anchored to the retest')
assert(transitionTestData({ ...testData, rows: [], baselines: new Map() }, new Map(), 'unknown') === null, 'no test data at all: no test block')

console.log('\nBlock Zero prompt assembly passed')

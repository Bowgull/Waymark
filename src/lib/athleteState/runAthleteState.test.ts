// Run: tsx src/lib/athleteState/runAthleteState.test.ts
import { buildAthleteState } from './runAthleteState'
import type { AthleteContext } from './types'
import type { AthleteAssessmentOutput } from '../prompts/tools'

let failures = 0
function check(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`) } else { console.log(`ok: ${label}`) }
}

const ctx: AthleteContext = {
  todayEpochDay: 20250, todayDow: 3, weekStart: 20247, weekEnd: 20253,
  lifts: [
    { exerciseId: 'sq', exerciseName: 'Back Squat', direction: 'regressing', verdict: 'deload', loadFactor: 0.9,
      sessions: [{ epochDay: 20249, signal: 'short' }] },
  ],
  effort: [], wellness: [], notes: [], runs: [],
  adherenceBlock: null, hrBlock: null, comboRatings: [], bodyweightKg: null, trainingMaxes: [], priorState: null,
}

const output: AthleteAssessmentOutput = {
  readiness: 'taxed',
  readinessRationale: 'Effort high — sleep low this week.',
  lifts: [
    { exerciseId: 'sq', verdict: 'deload', loadFactor: 0.5, rationale: 'Two short squat sessions — back off.' },
    { exerciseId: 'unknown_ex', verdict: 'push', loadFactor: 1.2, rationale: 'good' },
  ],
  weekShape: 'pull_back',
  weekShapeRationale: 'Pull volume back this week.',
  flags: [{ kind: 'pain', detail: 'hip — left side' }],
  note: 'Eased the week — squat backs off.',
}

const state = buildAthleteState(output, ctx, 'session_completed', 1700000000)

check('clamps low loadFactor to floor 0.85', state.lifts[0].loadFactor === 0.85)
check('clamps high loadFactor to ceiling 1.05', state.lifts[1].loadFactor === 1.05)
check('joins exerciseName from context', state.lifts[0].exerciseName === 'Back Squat')
check('unknown exercise falls back to id', state.lifts[1].exerciseName === 'unknown_ex')
check('trendSummary from context', state.lifts[0].trendSummary.includes('direction=regressing'))
check('unknown lift has no-baseline summary', state.lifts[1].trendSummary === 'no baseline trend')
check('strips em dash in rationale', !state.lifts[0].rationale.includes('—') && state.lifts[0].rationale.includes(','))
check('strips em dash in note', !state.note.includes('—'))
check('strips em dash in readinessRationale', !state.readinessRationale.includes('—'))
check('strips em dash in flag detail', !state.flags[0].detail.includes('—') && state.flags[0].detail.includes('left side'))
check('carries readiness + weekShape', state.readiness === 'taxed' && state.weekShape === 'pull_back')
check('records trigger + timestamp + version', state.trigger === 'session_completed' && state.computedAtEpoch === 1700000000 && state.modelVersion === 'athlete-state-v1')
check('flags default-safe', Array.isArray(state.flags) && state.flags.length === 1)

// flags omitted -> empty array
const noFlags = buildAthleteState({ ...output, flags: undefined }, ctx, 'rollover', 1)
check('missing flags -> empty array', Array.isArray(noFlags.flags) && noFlags.flags.length === 0)

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1) }
console.log('\nAll runAthleteState tests passed')

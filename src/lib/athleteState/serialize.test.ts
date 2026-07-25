// Run: tsx src/lib/athleteState/serialize.test.ts
import { serializeAthleteContext } from './serialize'
import type { AthleteContext } from './types'

let failures = 0
function check(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`) } else { console.log(`ok: ${label}`) }
}

const base: AthleteContext = {
  todayEpochDay: 20250,
  todayDow: 3,
  weekStart: 20247,
  weekEnd: 20253,
  lifts: [
    { exerciseId: 'sq', exerciseName: 'Back Squat', direction: 'regressing', verdict: 'deload', loadFactor: 0.9,
      sessions: [{ epochDay: 20249, signal: 'short' }, { epochDay: 20246, signal: 'short' }] },
    { exerciseId: 'bp', exerciseName: 'Bench Press', direction: 'progressing', verdict: 'push', loadFactor: 1.05,
      sessions: [{ epochDay: 20248, signal: 'over' }, { epochDay: 20245, signal: 'over' }] },
  ],
  effort: [{ epochDay: 20249, type: 'strength', rpe: 9, difficulty: null }],
  wellness: [{ epochDay: 20249, sleepHours: 5.5, soreness: 4, alcoholScale: null }],
  notes: [{ epochDay: 20249, source: 'session', text: 'left hip tight on squats' }],
  runs: [{ epochDay: 20248, completionStatus: 'shortened', paceSecKm: 330, avgHr: 158, maxHr: 172, shortReason: 'legs heavy' }],
  adherenceBlock: 'ADHERENCE: 4/6 sessions completed this block.',
  hrBlock: 'HR: zone-2 compliance on target.',
  comboRatings: [{ epochDay: 20247, rating: 4 }, { epochDay: 20247, rating: 2 }],
  bodyweightKg: 78.5,
  trainingMaxes: [{ exerciseName: 'Back Squat', weightKg: 120 }],
  priorState: null,
}

const out = serializeAthleteContext(base)

check('includes lift directions', out.includes('Back Squat') && out.includes('direction=regressing'))
check('includes baseline verdict + loadFactor', out.includes('baseline verdict=deload') && out.includes('loadFactor 0.9'))
check('includes effort RPE', out.includes('RPE 9/10'))
check('includes wellness sleep + soreness', out.includes('sleep 5.5h') && out.includes('soreness 4/5'))
check('includes the pain note', out.includes('left hip tight on squats'))
check('includes run completion', out.includes('shortened'))
check('includes combo avg', out.includes('avg 3'))
check('includes bodyweight + maxes', out.includes('78.5 kg') && out.includes('Back Squat 120kg'))
check('includes reused adherence + hr blocks', out.includes('ADHERENCE:') && out.includes('HR:'))
check('includes the compound instruction', out.includes('Compound the signals'))
check('no prior-state block when null', !out.includes('Your previous read'))

// prior-state branch
const withPrior: AthleteContext = {
  ...base,
  priorState: {
    readiness: 'taxed', readinessRationale: 'r', weekShape: 'pull_back', weekShapeRationale: 'w',
    lifts: [{ exerciseId: 'sq', exerciseName: 'Back Squat', verdict: 'hold', loadFactor: 1, rationale: 'x', trendSummary: 'y' }],
    flags: [], note: 'eased off after a taxed week', computedAtEpoch: 1, trigger: 'rollover', modelVersion: 'v1',
  },
}
const out2 = serializeAthleteContext(withPrior)
check('prior-state block present when set', out2.includes('Your previous read') && out2.includes('eased off after a taxed week'))
check('prior lift verdicts rendered', out2.includes('Back Squat=hold'))

// empty lifts
const empty: AthleteContext = { ...base, lifts: [] }
check('empty lifts -> no-data line', serializeAthleteContext(empty).includes('No completed strength sessions in window'))

if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1) }
console.log('\nAll serialize tests passed')

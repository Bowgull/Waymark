import { buildLocalSessionReview, buildSessionReviewPrompt } from './sessionReviewAI'

function assertMatch(value: string, pattern: RegExp): void {
  if (!pattern.test(value)) {
    throw new Error(`Expected value to match ${pattern.toString()}`)
  }
}

const runPrompt = buildSessionReviewPrompt(
  {
    type: 'running',
    rpe: 7,
    notes: 'Felt harder after the hill.',
    durationSec: 1086,
  },
  [{ type: 'strength', rpe: 6 }],
  {
    run: {
      runType: 'zone2',
      targetHrLine: 'Zone 2. 114 to 133 bpm.',
      distanceKm: 2.66,
      durationSec: 1086,
      plannedDurationSec: 2100,
      completionRatio: 0.52,
      completionStatus: 'shortened',
      paceSecKm: 408,
      avgHr: 143,
      maxHr: 160,
      zoneSeconds: '{"z2":900,"z3":120}',
      elevationGainM: 6,
      source: 'strava',
      stravaActivityId: 123456,
      splits: [
        { kmIndex: 2, durationSec: 413, avgHr: 146, elevationGainM: 3 },
        { kmIndex: 1, durationSec: 405, avgHr: 140, elevationGainM: 2 },
      ],
    },
    strength: null,
  },
)

assertMatch(runPrompt, /Run evidence:/)
assertMatch(runPrompt, /Source: strava \(Strava\)\./)
assertMatch(runPrompt, /2\.66 km, 18 min, 6:48\/km, avg HR 143 bpm, max 160\./)
assertMatch(runPrompt, /Prescribed: Zone 2\. 114 to 133 bpm\./)
assertMatch(runPrompt, /Planned duration: 35 min\. Completion: shortened \(52%\)\./)
assertMatch(runPrompt, /Elevation: 6 m\./)
assertMatch(runPrompt, /HR zones: \{"z2":900,"z3":120\}\./)
assertMatch(runPrompt, /Splits: km 1: 6:45, HR 140; km 2: 6:53, HR 146\./)
assertMatch(runPrompt, /Recent sessions for context:\n {2}strength - Effort 6\/10/)
assertMatch(runPrompt, /If prescribed easy but HR ran high, say that plainly and set intensity_mismatch\./)

const strengthPrompt = buildSessionReviewPrompt(
  {
    type: 'strength',
    rpe: 8,
    notes: 'Kept it tight.',
    durationSec: 1800,
  },
  [],
  {
    run: null,
    strength: {
      exercises: [
        {
          name: 'DB Romanian Deadlift',
          section: 'main',
          workingSets: 3,
          warmupSets: 1,
          topWeightKg: 24,
          totalReps: 24,
          changedSets: 1,
        },
        {
          name: 'Dead Bug',
          section: 'core',
          workingSets: 2,
          warmupSets: 0,
          topWeightKg: null,
          totalReps: 20,
          changedSets: 0,
        },
      ],
    },
  },
)

assertMatch(strengthPrompt, /Strength evidence:/)
assertMatch(strengthPrompt, /DB Romanian Deadlift \(main\): 3 working sets, 1 warmup, 24 reps, top 53 lb\. 1 changed set\./)
assertMatch(strengthPrompt, /Dead Bug \(core\): 2 working sets, 0 warmups, 20 reps, top bodyweight or unloaded\./)

const mismatchReview = buildLocalSessionReview(
  { type: 'foundation_run', rpe: 7, durationSec: 1086 },
  {
    run: {
      runType: 'zone2',
      targetHrLine: 'Zone 2. 114 to 133 bpm.',
      distanceKm: 2.66,
      durationSec: 1086,
      plannedDurationSec: 2100,
      completionRatio: 0.52,
      completionStatus: 'shortened',
      paceSecKm: 408,
      avgHr: 143,
      maxHr: 160,
      zoneSeconds: '{"z2":900,"z3":120}',
      elevationGainM: 6,
      source: 'strava',
      stravaActivityId: 123456,
      splits: [],
    },
    strength: null,
  },
)

if (mismatchReview.flag !== 'intensity_mismatch') {
  throw new Error(`Expected intensity_mismatch, got ${mismatchReview.flag}`)
}
if (mismatchReview.line !== 'Prescribed easy. Heart said hard. Easier next time.') {
  throw new Error(`Unexpected local mismatch line: ${mismatchReview.line}`)
}

const strengthReview = buildLocalSessionReview(
  { type: 'strength', rpe: 8, durationSec: 1800 },
  {
    run: null,
    strength: {
      exercises: [
        { name: 'Back Squat', section: 'main', workingSets: 3, warmupSets: 1, topWeightKg: 80, totalReps: 15, changedSets: 0 },
      ],
    },
  },
)

if (strengthReview.line !== 'Strength logged. Effort 8/10.') {
  throw new Error(`Unexpected local strength line: ${strengthReview.line}`)
}

console.info('sessionReviewAI tests passed')

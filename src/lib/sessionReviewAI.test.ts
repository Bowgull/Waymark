import { buildSessionReviewPrompt } from './sessionReviewAI'

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
      distanceKm: 2.66,
      durationSec: 1086,
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
assertMatch(runPrompt, /Elevation: 6 m\./)
assertMatch(runPrompt, /HR zones: \{"z2":900,"z3":120\}\./)
assertMatch(runPrompt, /Splits: km 1: 6:45, HR 140; km 2: 6:53, HR 146\./)
assertMatch(runPrompt, /Recent sessions for context:\n {2}strength - Effort 6\/10/)
assertMatch(runPrompt, /Use the evidence above before generic training advice\./)

const strengthPrompt = buildSessionReviewPrompt(
  {
    type: 'strength',
    rpe: 8,
    notes: 'Hotel gym. Kept it tight.',
    durationSec: 1800,
  },
  [],
  {
    run: null,
    strength: {
      roadBootcamp: {
        timeAvailable: '30',
        prescribedTime: '30',
        equipment: 'hotel_gym',
        adaptationLine: '30 minutes. Hotel gym. Main work stays, accessories drop.',
      },
      exercises: [
        {
          name: 'DB Romanian Deadlift',
          section: 'main',
          workingSets: 3,
          warmupSets: 1,
          topWeightKg: 24,
          totalReps: 24,
        },
        {
          name: 'Dead Bug',
          section: 'core',
          workingSets: 2,
          warmupSets: 0,
          topWeightKg: null,
          totalReps: 20,
        },
      ],
    },
  },
)

assertMatch(strengthPrompt, /Strength evidence:/)
assertMatch(strengthPrompt, /Road Bootcamp context: time 30, equipment hotel_gym\./)
assertMatch(strengthPrompt, /Adaptation: 30 minutes\. Hotel gym\. Main work stays, accessories drop\./)
assertMatch(strengthPrompt, /DB Romanian Deadlift \(main\): 3 working sets, 1 warmup, 24 reps, top 53 lb\./)
assertMatch(strengthPrompt, /Dead Bug \(core\): 2 working sets, 0 warmups, 20 reps, top bodyweight or unloaded\./)

console.info('sessionReviewAI tests passed')

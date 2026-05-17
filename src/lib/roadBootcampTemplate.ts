import type { TemplateSession } from './weeklyTemplate'
import type { HrSnapshot } from './hrAnalysis'

export interface RoadBootcampRunPrescription {
  weekNumber: number
  runType: string
  targetDesc: string
  targetDurSec: number | null
  targetDistKm: number | null
  z2CeilingBpm?: number | null
}

const DAILY_MOBILITY: TemplateSession = {
  timeSlot: 'am',
  type: 'mobility',
  label: 'Mobility',
  estimatedMin: 10,
}

const WEEK_LABELS = [
  'Baseline and rhythm',
  'Add easy volume',
  'Controlled intensity',
  'Deload',
  'Build again',
  'Strongest week',
  'Density and consistency',
  'Consolidate',
] as const

const QUALITY_LABELS = [
  'Baseline Run',
  'Steady Finish Run',
  'Controlled Intervals',
  'Easy Progression',
  'Progression Run',
  'Hill or Tempo Run',
  'Density Run',
  'Benchmark Run',
] as const

function qualityRun(weekNumber: number): TemplateSession {
  const index = Math.min(Math.max(weekNumber, 1), 8) - 1
  return {
    timeSlot: 'am',
    type: 'running',
    label: QUALITY_LABELS[index],
    estimatedMin: weekNumber === 4 ? 25 : weekNumber >= 6 ? 40 : 30,
    runCategory: 'progression',
  }
}

export function getRoadBootcampWeekLabel(weekNumber: number): string {
  const index = Math.min(Math.max(weekNumber, 1), 8) - 1
  return WEEK_LABELS[index]
}

const EASY_RUN_PRESCRIPTIONS: RoadBootcampRunPrescription[] = [
  { weekNumber: 1, runType: 'zone2', targetDesc: '35 min easy. Talk test first. Keep it boring on purpose.', targetDurSec: 2100, targetDistKm: null },
  { weekNumber: 2, runType: 'zone2', targetDesc: '35 min easy. Stay conversational. Do not chase pace.', targetDurSec: 2100, targetDistKm: null },
  { weekNumber: 3, runType: 'zone2', targetDesc: '35 min easy. Smooth cadence, relaxed shoulders, no finish push.', targetDurSec: 2100, targetDistKm: null },
  { weekNumber: 4, runType: 'zone2', targetDesc: '25 min easy. Deload week. Finish fresher than you started.', targetDurSec: 1500, targetDistKm: null },
  { weekNumber: 5, runType: 'zone2', targetDesc: '40 min easy. Hold the same effort the whole way.', targetDurSec: 2400, targetDistKm: null },
  { weekNumber: 6, runType: 'zone2', targetDesc: '40 min easy. Aerobic work, not a hidden tempo run.', targetDurSec: 2400, targetDistKm: null },
  { weekNumber: 7, runType: 'zone2', targetDesc: '40 min easy. Keep the first 10 minutes almost too easy.', targetDurSec: 2400, targetDistKm: null },
  { weekNumber: 8, runType: 'zone2', targetDesc: '30 min easy. Consolidate. Leave some in the tank.', targetDurSec: 1800, targetDistKm: null },
]

const QUALITY_RUN_PRESCRIPTIONS: RoadBootcampRunPrescription[] = [
  { weekNumber: 1, runType: 'easy', targetDesc: '25 min baseline run. Easy enough to repeat tomorrow. Record how it felt.', targetDurSec: 1500, targetDistKm: null },
  { weekNumber: 2, runType: 'easy', targetDesc: '30 min steady finish. First 20 easy, last 10 slightly firmer but still controlled.', targetDurSec: 1800, targetDistKm: null },
  { weekNumber: 3, runType: 'intervals', targetDesc: '10 min easy, then 6 rounds of 1 min strong / 1 min easy, then 8 min easy.', targetDurSec: 1800, targetDistKm: null },
  { weekNumber: 4, runType: 'easy', targetDesc: '25 min easy progression. No testing. Deload week stays honest.', targetDurSec: 1500, targetDistKm: null },
  { weekNumber: 5, runType: 'easy_strides', targetDesc: '30 min easy, then 4 relaxed strides. Fast but not frantic.', targetDurSec: 2100, targetDistKm: null },
  { weekNumber: 6, runType: 'tempo', targetDesc: '10 min easy, 12 min tempo, 10 min easy. Tempo means hard but repeatable.', targetDurSec: 1920, targetDistKm: null },
  { weekNumber: 7, runType: 'intervals', targetDesc: '10 min easy, then 8 rounds of 45 sec strong / 75 sec easy, then 8 min easy.', targetDurSec: 2100, targetDistKm: null },
  { weekNumber: 8, runType: '5k_test', targetDesc: '5K benchmark if recovered. Otherwise 30 min steady and call that the test.', targetDurSec: 2100, targetDistKm: 5 },
]

function clampRoadWeek(weekNumber: number): number {
  return Math.min(Math.max(weekNumber, 1), 8)
}

function applyHrGuidance(
  prescription: RoadBootcampRunPrescription,
  category: 'zone2' | 'progression',
  hr: HrSnapshot | null,
): RoadBootcampRunPrescription {
  if (!hr || hr.runsWithHr === 0) return prescription
  const z2CeilingBpm = hr.z2CeilingBpm

  if (category === 'zone2') {
    if (hr.z2Compliance === 'over_paced') {
      return {
        ...prescription,
        z2CeilingBpm,
        targetDesc: `${prescription.targetDesc} Cap it at ${z2CeilingBpm} bpm. Walk if HR climbs above the ceiling.`,
      }
    }
    if (hr.z2Compliance === 'slightly_high') {
      return {
        ...prescription,
        z2CeilingBpm,
        targetDesc: `${prescription.targetDesc} Watch the ceiling. HR over ${z2CeilingBpm} bpm means slow down now, not later.`,
      }
    }
  }

  if (category === 'progression' && hr.driftAssessment === 'clear_fatigue') {
    return {
      weekNumber: prescription.weekNumber,
      runType: 'easy',
      targetDesc: 'HR drift is high. Replace the quality work with 25-30 min easy. Keep the weekly rhythm.',
      targetDurSec: 1800,
      targetDistKm: null,
    }
  }

  if (category === 'progression' && hr.driftAssessment === 'mild_fatigue') {
    return {
      ...prescription,
      targetDesc: `${prescription.targetDesc} Keep the hard parts one notch controlled. Do not race the workout.`,
    }
  }

  return prescription
}

export function getRoadBootcampRunPrescription(
  weekNumber: number,
  category: 'zone2' | 'progression',
  hr: HrSnapshot | null = null,
): RoadBootcampRunPrescription {
  const index = clampRoadWeek(weekNumber) - 1
  const base = category === 'zone2'
    ? EASY_RUN_PRESCRIPTIONS[index]
    : QUALITY_RUN_PRESCRIPTIONS[index]
  return applyHrGuidance(base, category, hr)
}

export function getRoadBootcampTemplate(weekNumber: number): Record<number, TemplateSession[]> {
  const easyRunMin = weekNumber === 4 ? 25 : weekNumber >= 5 ? 40 : 35
  const strengthMin = weekNumber === 4 ? 30 : 45
  const ropeMin = weekNumber === 4 ? 8 : 10

  return {
    0: [
      DAILY_MOBILITY,
    ],
    1: [
      DAILY_MOBILITY,
      { timeSlot: 'am', type: 'foundation_run', label: 'Easy Run', estimatedMin: easyRunMin },
    ],
    2: [
      DAILY_MOBILITY,
      { timeSlot: 'am', type: 'strength', label: 'Road Strength A', estimatedMin: strengthMin },
      { timeSlot: 'pm', type: 'skip_rope', label: 'Rope Primer', estimatedMin: ropeMin },
    ],
    3: [
      DAILY_MOBILITY,
      { timeSlot: 'am', type: 'foundation_run', label: 'Easy Run', estimatedMin: easyRunMin },
    ],
    4: [
      DAILY_MOBILITY,
      { timeSlot: 'am', type: 'strength', label: 'Road Strength B', estimatedMin: strengthMin },
      { timeSlot: 'pm', type: 'skip_rope', label: 'Rope Primer', estimatedMin: ropeMin },
    ],
    5: [
      DAILY_MOBILITY,
    ],
    6: [
      DAILY_MOBILITY,
      qualityRun(weekNumber),
    ],
  }
}

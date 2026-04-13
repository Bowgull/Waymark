export interface RunPlanWeekTemplate {
  weekNumber: number
  dayOfWeek: number // 6 = Saturday (progression runs)
  runType: string
  targetDesc: string
  targetDurSec: number | null
  targetDistKm: number | null
}

/**
 * 12-week progressive running plan. All progression runs are Saturday AM.
 * Zone 2 runs (M/W/F) use a separate static prescription.
 */
export const RUNNING_PLAN_TEMPLATE: RunPlanWeekTemplate[] = [
  // Weeks 1-3: Build the habit. Easy pace, no distance pressure
  {
    weekNumber: 1, dayOfWeek: 6, runType: 'easy',
    targetDesc: '20 min easy run, conversational pace. Focus on form: upright posture, relaxed shoulders, short strides.',
    targetDurSec: 1200, targetDistKm: null,
  },
  {
    weekNumber: 2, dayOfWeek: 6, runType: 'easy',
    targetDesc: '22 min easy run. Keep it conversational. If you can sing, you\'re in the zone.',
    targetDurSec: 1320, targetDistKm: null,
  },
  {
    weekNumber: 3, dayOfWeek: 6, runType: 'easy',
    targetDesc: '25 min easy run. Settle into your rhythm. Breathe through the nose when you can.',
    targetDurSec: 1500, targetDistKm: null,
  },

  // Weeks 4-6: Introduce distance tracking
  {
    weekNumber: 4, dayOfWeek: 6, runType: 'easy',
    targetDesc: '25 min easy run. Aim for ~3 km. Don\'t chase pace, just cover the distance.',
    targetDurSec: 1500, targetDistKm: 3.0,
  },
  {
    weekNumber: 5, dayOfWeek: 6, runType: 'easy',
    targetDesc: '28 min easy run. ~3 km. You should finish feeling like you could do more.',
    targetDurSec: 1680, targetDistKm: 3.0,
  },
  {
    weekNumber: 6, dayOfWeek: 6, runType: 'easy',
    targetDesc: '30 min easy run. ~3 km. Build aerobic base. Steady, controlled breathing.',
    targetDurSec: 1800, targetDistKm: 3.0,
  },

  // Weeks 7-8: Easy + strides (speed introduction)
  {
    weekNumber: 7, dayOfWeek: 6, runType: 'easy_strides',
    targetDesc: '25 min easy + 4x100m strides after. Strides: accelerate to 80% over 100m, then walk back. Feel the speed.',
    targetDurSec: 1800, targetDistKm: 3.5,
  },
  {
    weekNumber: 8, dayOfWeek: 6, runType: 'easy_strides',
    targetDesc: '25 min easy + 6x100m strides. Open up your stride a bit. This is controlled speed, not sprinting.',
    targetDurSec: 1800, targetDistKm: 3.5,
  },

  // Weeks 9-10: Tempo runs (sustained effort)
  {
    weekNumber: 9, dayOfWeek: 6, runType: 'tempo',
    targetDesc: '10 min easy \u2192 10 min tempo (~6:30/km pace) \u2192 10 min easy cooldown. Tempo = comfortably hard.',
    targetDurSec: 1800, targetDistKm: 4.0,
  },
  {
    weekNumber: 10, dayOfWeek: 6, runType: 'tempo',
    targetDesc: '10 min easy \u2192 12 min tempo (~6:15/km pace) \u2192 8 min easy cooldown. Push the tempo a touch faster.',
    targetDurSec: 1800, targetDistKm: 4.0,
  },

  // Week 11: Intervals (VO2max stimulus)
  {
    weekNumber: 11, dayOfWeek: 6, runType: 'intervals',
    targetDesc: '10 min easy warmup \u2192 6x(1 min hard / 1 min easy jog) \u2192 10 min cooldown. Hard = can\'t hold a conversation.',
    targetDurSec: 2040, targetDistKm: 4.5,
  },

  // Week 12: 5K time trial
  {
    weekNumber: 12, dayOfWeek: 6, runType: '5k_test',
    targetDesc: '5K time trial. 5 min warmup jog, then give it everything for 5 km. This is your benchmark.',
    targetDurSec: 2100, targetDistKm: 5.0,
  },
]

/** Static Zone 2 prescription for M/W/F morning runs. */
export const ZONE2_PRESCRIPTION = {
  weekNumber: 0,
  runType: 'zone2',
  targetDesc: 'Zone 2 easy run, 15-20 min at conversational pace. HR target: 130-145 bpm. Nasal breathing if possible.',
  targetDurSec: 1200,
  targetDistKm: null,
} as const

export function getRunPlanForWeek(weekNumber: number): RunPlanWeekTemplate | null {
  return RUNNING_PLAN_TEMPLATE.find(r => r.weekNumber === weekNumber) ?? null
}

export const RUN_TYPE_LABELS: Record<string, string> = {
  zone2: 'Zone 2 Run',
  easy: 'Easy Run',
  easy_strides: 'Easy + Strides',
  tempo: 'Tempo Run',
  intervals: 'Intervals',
  '5k_test': '5K Test',
}

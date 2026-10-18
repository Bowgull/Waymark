// Same-pattern swaps for missing equipment (trap bar taken, no cable, no
// hamstring-curl machine). The swap keeps the movement pattern and needs less
// kit; where the back-friendly table already has a sensible swap it is used.
// Every id here exists in seed.ts or the migrations. Pure.

import { BACK_FRIENDLY_SWAPS } from './blockZero/strength'

export const EQUIPMENT_SWAPS: Readonly<Record<string, { exerciseId: string; label: string }>> = {
  'ex-front-squat': { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat' },
  'ex-goblet-squat': { exerciseId: 'ex-reverse-lunge', label: 'Reverse Lunge' },
  'ex-bench-press': { exerciseId: 'ex-db-bench-press', label: 'DB Bench Press' },
  'ex-db-bench-press': { exerciseId: 'ex-push-up', label: 'Push-Up' },
  'ex-incline-db-press': { exerciseId: 'ex-push-up', label: 'Push-Up' },
  'ex-ohp': { exerciseId: 'ex-db-ohp', label: 'DB Overhead Press' },
  'ex-deadlift': { exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift' },
  'ex-block-pull': { exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift' },
  'ex-trap-bar-deadlift': { exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift' },
  'ex-rdl': { exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift' },
  'ex-db-rdl': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-bent-over-row': { exerciseId: 'ex-db-row', label: 'Dumbbell Row' },
  'ex-db-row': { exerciseId: 'ex-band-row', label: 'Band Row' },
  'ex-lat-pulldown': { exerciseId: 'ex-pullup-band', label: 'Band-Assisted Pull-Up' },
  'ex-hamstring-curl': { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges' },
  'ex-face-pulls': { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts' },
  'ex-tricep-pushdown': { exerciseId: 'ex-push-up', label: 'Push-Up' },
  'ex-ez-curl': { exerciseId: 'ex-hammer-curl', label: 'Hammer Curl' },
  'ex-cable-woodchop': { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs' },
  'ex-pallof-press': { exerciseId: 'ex-dead-bugs', label: 'Dead Bugs' },
  'ex-lateral-raise': { exerciseId: 'ex-band-pull-aparts', label: 'Band Pull-Aparts' },
}

/** A substitute that exists in the library, or null when there is none. */
export function swapForMissingEquipment(exerciseId: string, knownIds: ReadonlySet<string>): { exerciseId: string; label: string } | null {
  for (const pick of [EQUIPMENT_SWAPS[exerciseId], BACK_FRIENDLY_SWAPS[exerciseId]]) {
    if (pick && pick.exerciseId !== exerciseId && knownIds.has(pick.exerciseId)) return pick
  }
  return null
}

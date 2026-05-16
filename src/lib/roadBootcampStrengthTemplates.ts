import type { ExerciseSection, TemplateExercise, TemplateSet } from './strengthTemplates'
import { getDeadliftExerciseId, STRENGTH_A_BUILDER, STRENGTH_B_BUILDER } from './strengthTemplates'

export const ROAD_BOOTCAMP_TIMES = ['15', '30', '45_plus'] as const
export const ROAD_BOOTCAMP_EQUIPMENT = ['no_gym', 'hotel_gym', 'full_gym'] as const

export type RoadBootcampTime = typeof ROAD_BOOTCAMP_TIMES[number]
export type RoadBootcampEquipment = typeof ROAD_BOOTCAMP_EQUIPMENT[number]
export type RoadBootcampStrengthDay = 'strength_a' | 'strength_b'

export interface RoadBootcampStrengthContext {
  dayType: RoadBootcampStrengthDay
  timeAvailable: RoadBootcampTime
  equipment: RoadBootcampEquipment
  blockWeek?: number
}

export interface RoadBootcampStrengthTemplate {
  id: string
  blockType: 'road_bootcamp'
  label: string
  adaptationLine: string
  exercises: TemplateExercise[]
}

function sets(count: number, reps: number, restSec: number, isWarmup = false): TemplateSet[] {
  return Array.from({ length: count }, () => ({ isWarmup, targetReps: reps, restSec }))
}

function ex(
  exerciseId: string,
  label: string,
  section: ExerciseSection,
  count: number,
  reps: number,
  restSec: number,
  notes?: string,
): TemplateExercise {
  return { exerciseId, label, section, sets: sets(count, reps, restSec), notes }
}

function warmup(exerciseId: string, label: string, notes?: string): TemplateExercise {
  return { exerciseId, label, section: 'warmup', sets: sets(1, 12, 30, true), notes }
}

function adaptationLine(timeAvailable: RoadBootcampTime, equipment: RoadBootcampEquipment): string {
  const timeLabel = timeAvailable === '45_plus' ? '45+ minutes' : `${timeAvailable} minutes`
  const equipmentLabel = equipment === 'no_gym'
    ? 'No gym'
    : equipment === 'hotel_gym'
      ? 'Hotel gym'
      : 'Full gym'

  if (timeAvailable === '15') return `${timeLabel}. ${equipmentLabel}. Main work only.`
  if (timeAvailable === '30') return `${timeLabel}. ${equipmentLabel}. Main work stays, accessories drop.`
  return `${timeLabel}. ${equipmentLabel}. Full strength session.`
}

function template(
  dayType: RoadBootcampStrengthDay,
  timeAvailable: RoadBootcampTime,
  equipment: RoadBootcampEquipment,
  label: string,
  exercises: TemplateExercise[],
): RoadBootcampStrengthTemplate {
  return {
    id: `road_bootcamp_${dayType}_${timeAvailable}_${equipment}`,
    blockType: 'road_bootcamp',
    label,
    adaptationLine: adaptationLine(timeAvailable, equipment),
    exercises,
  }
}

function noGymA(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-bulgarian-split-squat', 'Split Squat', 'main', 3, 8, 60, '8 each side. Bodyweight or band-loaded.'),
    ex('ex-push-up', 'Push-Up', 'main', 3, 8, 60, 'Stop 1-2 reps before form breaks.'),
    ex('ex-band-row', 'Band Row', 'main', 3, 12, 60),
  ]
  if (timeAvailable === '15') return base
  base.push(
    ex('ex-side-plank-lift', 'Side Plank Hip Lift', 'core', 2, 8, 45, '8 each side.'),
  )
  if (timeAvailable === '30') return base
  return [
    ...base.slice(0, 2),
    ex('ex-tempo-squat', 'Tempo Squat', 'main', 3, 10, 60, '3 seconds down.'),
    ...base.slice(2),
    ex('ex-lateral-lunges', 'Lateral Lunge', 'accessory', 2, 8, 60, '8 each side.'),
  ]
}

function noGymB(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-band-good-morning', 'Band Good Morning', 'main', 3, 12, 60),
    ex('ex-band-chest-press', 'Band Chest Press', 'main', 3, 10, 60),
    ex('ex-band-row', 'Seated Band Row', 'main', 3, 12, 60),
  ]
  if (timeAvailable === '15') return base
  base.splice(2, 0, ex('ex-reverse-lunge', 'Reverse Lunge', 'main', 3, 8, 60, '8 each side.'))
  base.push(ex('ex-dead-bugs', 'Dead Bugs', 'core', 2, 10, 45, '10 each side.'))
  if (timeAvailable === '30') return base
  return [
    ...base.slice(0, 3),
    ex('ex-single-leg-rdl', 'Single-Leg RDL', 'accessory', 2, 8, 60, '8 each side.'),
    ...base.slice(3, -1),
    ex('ex-pike-push-up', 'Pike Push-Up', 'accessory', 2, 6, 60),
    ex('ex-band-curl', 'Band Curl', 'accessory', 2, 12, 45),
    base[base.length - 1],
  ]
}

function hotelGymA(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-goblet-squat', 'Goblet Squat', 'main', 3, 8, 90),
    ex('ex-db-bench-press', 'DB Bench Press', 'main', 3, 8, 90),
    ex('ex-db-row', 'Dumbbell Row', 'main', 3, 10, 75, '10 each arm.'),
  ]
  if (timeAvailable === '15') return base
  base.push(
    ex('ex-lateral-raise', 'Lateral Raise', 'accessory', 2, 12, 45),
    ex('ex-face-pulls', 'Face Pulls', 'accessory', 2, 15, 45),
  )
  if (timeAvailable === '30') return base
  return [
    ...base,
    ex('ex-incline-db-press', 'Incline DB Press', 'accessory', 2, 10, 75),
    ex('ex-side-plank-lift', 'Side Plank Hip Lift', 'core', 2, 8, 45, '8 each side.'),
  ]
}

function hotelGymB(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-db-rdl', 'DB Romanian Deadlift', 'main', 3, 8, 90),
    ex('ex-db-ohp', 'DB Overhead Press', 'main', 3, 8, 90),
    ex('ex-lat-pulldown', 'Lat Pulldown', 'main', 3, 10, 75),
  ]
  if (timeAvailable === '15') return base
  base.push(
    ex('ex-bulgarian-split-squat', 'Bulgarian Split Squat', 'accessory', 2, 8, 75, '8 each side.'),
    ex('ex-dead-bugs', 'Dead Bugs', 'core', 2, 10, 45, '10 each side.'),
  )
  if (timeAvailable === '30') return base
  return [
    ...base.slice(0, -1),
    ex('ex-hamstring-curl', 'Hamstring Curl', 'accessory', 2, 12, 60),
    ex('ex-hammer-curl', 'Hammer Curl', 'accessory', 2, 10, 45),
    base[base.length - 1],
  ]
}

function fullGymA(timeAvailable: RoadBootcampTime, blockWeek: number): TemplateExercise[] {
  const full = STRENGTH_A_BUILDER(blockWeek).exercises
  if (timeAvailable === '45_plus') return full
  if (timeAvailable === '30') return full.filter((exercise) => {
    return exercise.section === 'warmup' ||
      ['ex-front-squat', 'ex-bench-press', 'ex-bent-over-row', 'ex-face-pulls'].includes(exercise.exerciseId)
  })
  return full.filter((exercise) => {
    return exercise.section === 'warmup' ||
      ['ex-front-squat', 'ex-bench-press', 'ex-bent-over-row'].includes(exercise.exerciseId)
  })
}

function fullGymB(timeAvailable: RoadBootcampTime, blockWeek: number): TemplateExercise[] {
  const deadliftId = getDeadliftExerciseId(blockWeek)
  const full = STRENGTH_B_BUILDER(blockWeek).exercises
    .filter((exercise) => exercise.exerciseId !== 'ex-suitcase-carry')
  if (timeAvailable === '45_plus') {
    return [
      ...full,
      ex('ex-dead-bugs', 'Dead Bugs', 'core', 2, 10, 45, '10 each side.'),
    ]
  }
  if (timeAvailable === '30') {
    return full.filter((exercise) => {
      return exercise.section === 'warmup' ||
        [deadliftId, 'ex-ohp', 'ex-pullup-band', 'ex-bulgarian-split-squat'].includes(exercise.exerciseId)
    })
  }
  return full.filter((exercise) => {
    return exercise.section === 'warmup' ||
      [deadliftId, 'ex-ohp', 'ex-pullup-band'].includes(exercise.exerciseId)
  })
}

export function getRoadBootcampStrengthTemplate({
  dayType,
  timeAvailable,
  equipment,
  blockWeek = 1,
}: RoadBootcampStrengthContext): RoadBootcampStrengthTemplate {
  if (!ROAD_BOOTCAMP_TIMES.includes(timeAvailable)) {
    throw new Error(`Invalid Road Bootcamp time: ${timeAvailable}`)
  }
  if (!ROAD_BOOTCAMP_EQUIPMENT.includes(equipment)) {
    throw new Error(`Invalid Road Bootcamp equipment: ${equipment}`)
  }

  if (equipment === 'no_gym') {
    return template(dayType, timeAvailable, equipment, dayType === 'strength_a' ? 'Road Strength A' : 'Road Strength B', dayType === 'strength_a' ? noGymA(timeAvailable) : noGymB(timeAvailable))
  }
  if (equipment === 'hotel_gym') {
    return template(dayType, timeAvailable, equipment, dayType === 'strength_a' ? 'Hotel Strength A' : 'Hotel Strength B', dayType === 'strength_a' ? hotelGymA(timeAvailable) : hotelGymB(timeAvailable))
  }
  return template(dayType, timeAvailable, equipment, dayType === 'strength_a' ? 'Full Gym Strength A' : 'Full Gym Strength B', dayType === 'strength_a' ? fullGymA(timeAvailable, blockWeek) : fullGymB(timeAvailable, blockWeek))
}

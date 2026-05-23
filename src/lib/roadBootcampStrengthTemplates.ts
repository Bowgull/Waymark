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

interface RoadSetOptions {
  suggestedWeightKg?: number | null
  bandColor?: string | null
}

function lbToKg(lb: number): number {
  return Math.round(lb * 0.45359237 * 100) / 100
}

function sets(count: number, reps: number, restSec: number, isWarmup = false, options: RoadSetOptions = {}): TemplateSet[] {
  return Array.from({ length: count }, () => ({
    isWarmup,
    targetReps: reps,
    restSec,
    suggestedWeightKg: options.suggestedWeightKg ?? null,
    bandColor: options.bandColor ?? null,
  }))
}

function ex(
  exerciseId: string,
  label: string,
  section: ExerciseSection,
  count: number,
  reps: number,
  restSec: number,
  notes?: string,
  options: RoadSetOptions = {},
): TemplateExercise {
  return { exerciseId, label, section, sets: sets(count, reps, restSec, false, options), notes }
}

function warmup(exerciseId: string, label: string, notes?: string, options: RoadSetOptions = {}): TemplateExercise {
  return { exerciseId, label, section: 'warmup', sets: sets(1, 12, 30, true, options), notes }
}

const HAPBEAR_BANDS: Record<string, string> = {
  mobility: 'HAPBEAR yellow or orange band. Yellow is listed at 5-10 lb. Purple is listed at 100-125 lb. Stay smooth.',
  light: 'HAPBEAR yellow band. Listed at 5-10 lb. Move clean. No strain.',
  medium: 'HAPBEAR red band. If it snaps form, use orange.',
  heavy: 'HAPBEAR blue band. If the hinge shifts into your low back, use red.',
  max: 'HAPBEAR purple band. Listed at 100-125 lb. Use only if position stays solid.',
}

const BAND_DEFAULT_EXERCISES = new Set([
  'ex-band-pull-aparts',
  'ex-face-pulls',
  'ex-band-row',
  'ex-band-chest-press',
  'ex-band-curl',
  'ex-band-good-morning',
])

function bandTier(exerciseId: string): keyof typeof HAPBEAR_BANDS | null {
  switch (exerciseId) {
    case 'ex-band-pull-aparts':
    case 'ex-face-pulls':
      return 'light'
    case 'ex-band-row':
    case 'ex-band-chest-press':
    case 'ex-band-curl':
      return 'medium'
    case 'ex-band-good-morning':
    case 'ex-tempo-squat':
    case 'ex-reverse-lunge':
      return 'heavy'
    case 'ex-bulgarian-split-squat':
    case 'ex-single-leg-rdl':
      return 'mobility'
    default:
      return null
  }
}

function bandColorForTier(tier: keyof typeof HAPBEAR_BANDS | null): string | null {
  if (tier === 'light') return 'yellow'
  if (tier === 'medium') return 'red'
  if (tier === 'heavy') return 'blue'
  if (tier === 'max') return 'purple'
  if (tier === 'mobility') return 'yellow'
  return null
}

function withBandCue(exercise: TemplateExercise): TemplateExercise {
  const hasPrescribedBand = exercise.sets.some(set => set.bandColor)
  if (!hasPrescribedBand && !BAND_DEFAULT_EXERCISES.has(exercise.exerciseId)) return exercise

  const tier = bandTier(exercise.exerciseId)
  const cue = tier ? HAPBEAR_BANDS[tier] : null
  if (!cue) return exercise
  const color = bandColorForTier(tier)
  return {
    ...exercise,
    notes: exercise.notes ? `${exercise.notes} ${cue}` : cue,
    sets: exercise.sets.map(set => ({ ...set, bandColor: set.bandColor ?? color })),
  }
}

function withBandCues(exercises: TemplateExercise[]): TemplateExercise[] {
  return exercises.map(withBandCue)
}

export function getRoadBootcampAdaptationLine(timeAvailable: RoadBootcampTime, equipment: RoadBootcampEquipment): string {
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
    adaptationLine: getRoadBootcampAdaptationLine(timeAvailable, equipment),
    exercises: withBandCues(exercises),
  }
}

function noGymA(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-bulgarian-split-squat', 'Split Squat', 'main', 3, 8, 75, '8 each side. Bodyweight first. Add yellow band only if position stays clean.', { bandColor: 'yellow' }),
    ex('ex-push-up', 'Push-Up', 'main', 3, 8, 60, 'Stop 1-2 reps before form breaks.'),
    ex('ex-band-row', 'Seated Band Row', 'main', 3, 10, 75, 'Band around both feet. Sit tall. Pause at ribs.'),
  ]
  if (timeAvailable === '15') return base
  base.push(
    ex('ex-side-plank-lift', 'Side Plank Hip Lift', 'core', 2, 8, 45, '8 each side.'),
  )
  if (timeAvailable === '30') return base
  return [
    ...base.slice(0, 2),
    ex('ex-tempo-squat', 'Tempo Squat', 'main', 3, 10, 75, '3 seconds down. Hold posture.', { bandColor: 'blue' }),
    ...base.slice(2),
    ex('ex-lateral-lunges', 'Lateral Lunge', 'accessory', 2, 8, 60, '8 each side.'),
  ]
}

function noGymB(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-band-good-morning', 'Band Good Morning', 'main', 3, 10, 90, 'Band under feet and behind shoulders. Hinge only as far as spine stays long.'),
    ex('ex-pike-push-up', 'Pike Push-Up', 'main', 3, 6, 75, 'Controlled reps. Shorten range before form breaks.'),
    ex('ex-band-row', 'Seated Band Row', 'main', 3, 10, 75, 'Band around both feet. Pause at ribs.'),
  ]
  if (timeAvailable === '15') return base
  base.splice(2, 0, ex('ex-reverse-lunge', 'Reverse Lunge', 'main', 3, 8, 60, '8 each side.', { bandColor: 'blue' }))
  base.push(ex('ex-dead-bugs', 'Dead Bugs', 'core', 2, 10, 45, '10 each side.'))
  if (timeAvailable === '30') return base
  return [
    ...base.slice(0, 3),
    ex('ex-single-leg-rdl', 'Single-Leg RDL', 'accessory', 2, 8, 60, '8 each side. Slow reach. This is lower-back control, not max loading.', { bandColor: 'yellow' }),
    ...base.slice(3, -1),
    ex('ex-band-chest-press', 'Band Chest Press', 'accessory', 2, 10, 60, 'Band around upper back. No door anchor.'),
    ex('ex-band-curl', 'Band Curl', 'accessory', 2, 12, 45),
    base[base.length - 1],
  ]
}

function hotelGymA(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-goblet-squat', 'Goblet Squat', 'main', 3, 8, 120, 'Start around 35 lb. Add load only if depth and knees stay clean.', { suggestedWeightKg: lbToKg(35) }),
    ex('ex-db-bench-press', 'DB Bench Press', 'main', 3, 8, 120, 'Start around 25 lb per hand. Leave 1-2 reps in reserve.', { suggestedWeightKg: lbToKg(25) }),
    ex('ex-db-row', 'Dumbbell Row', 'main', 3, 10, 90, '10 each arm. Start around 30 lb. Pause at ribs.', { suggestedWeightKg: lbToKg(30) }),
  ]
  if (timeAvailable === '15') return base
  base.push(
    ex('ex-lateral-raise', 'Lateral Raise', 'accessory', 2, 12, 45, 'Start around 10 lb per hand. No swing.', { suggestedWeightKg: lbToKg(10) }),
    ex('ex-face-pulls', 'Band Face Pulls', 'accessory', 2, 15, 45, 'Use the band. No cable assumed.'),
  )
  if (timeAvailable === '30') return base
  return [
    ...base,
    ex('ex-incline-db-press', 'Incline DB Press', 'accessory', 2, 10, 90, 'Start around 25 lb per hand. Controlled stretch.', { suggestedWeightKg: lbToKg(25) }),
    ex('ex-side-plank-lift', 'Side Plank Hip Lift', 'core', 2, 8, 45, '8 each side.'),
  ]
}

function hotelGymB(timeAvailable: RoadBootcampTime): TemplateExercise[] {
  const base = [
    warmup('ex-band-pull-aparts', 'Band Pull-Aparts'),
    ex('ex-db-rdl', 'DB Romanian Deadlift', 'main', 3, 8, 120, 'Start around 35 lb per hand. Stop before low back takes over.', { suggestedWeightKg: lbToKg(35) }),
    ex('ex-db-ohp', 'DB Overhead Press', 'main', 3, 8, 120, 'Start around 20 lb per hand. Ribs down. Glutes tight.', { suggestedWeightKg: lbToKg(20) }),
    ex('ex-db-row', 'Chest-Supported DB Row', 'main', 3, 10, 90, 'Bench incline if available. Otherwise one hand on bench. Start around 30 lb.', { suggestedWeightKg: lbToKg(30) }),
  ]
  if (timeAvailable === '15') return base
  base.push(
    ex('ex-bulgarian-split-squat', 'Bulgarian Split Squat', 'accessory', 2, 8, 90, '8 each side. Start bodyweight, then 15 lb per hand.', { suggestedWeightKg: lbToKg(15) }),
    ex('ex-dead-bugs', 'Dead Bugs', 'core', 2, 10, 45, '10 each side.'),
  )
  if (timeAvailable === '30') return base
  return [
    ...base.slice(0, -1),
    ex('ex-single-leg-rdl', 'Single-Leg RDL', 'accessory', 2, 8, 75, '8 each side. Use bodyweight or 15 lb DBs.', { suggestedWeightKg: lbToKg(15) }),
    ex('ex-hammer-curl', 'Hammer Curl', 'accessory', 2, 10, 45, 'Start around 15 lb per hand.', { suggestedWeightKg: lbToKg(15) }),
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
  if (timeAvailable === '45_plus') return full
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

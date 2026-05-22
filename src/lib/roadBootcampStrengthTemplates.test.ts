import {
  getRoadBootcampAdaptationLine,
  getRoadBootcampStrengthTemplate,
  ROAD_BOOTCAMP_EQUIPMENT,
  ROAD_BOOTCAMP_TIMES,
} from './roadBootcampStrengthTemplates'
import { readFileSync } from 'node:fs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`)
  }
}

const REQUIRED_VIDEO_EXERCISES = new Set([
  'ex-band-row',
  'ex-band-good-morning',
  'ex-band-chest-press',
  'ex-band-curl',
  'ex-db-bench-press',
  'ex-goblet-squat',
  'ex-db-rdl',
  'ex-db-ohp',
  'ex-push-up',
  'ex-pike-push-up',
  'ex-tempo-squat',
  'ex-reverse-lunge',
  'ex-single-leg-rdl',
])

function testAllEighteenVariants() {
  const seen = new Set<string>()

  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      for (const equipment of ROAD_BOOTCAMP_EQUIPMENT) {
        const template = getRoadBootcampStrengthTemplate({ dayType, timeAvailable, equipment })
        seen.add(template.id)
        assertEqual(template.blockType, 'road_bootcamp')
        assert(template.exercises.length >= 3, `${template.id} has too few exercises`)
        assert(template.adaptationLine.length > 0, `${template.id} is missing adaptation copy`)
      }
    }
  }

  assertEqual(seen.size, 18)
}

function testNoGymPullingWork() {
  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      const template = getRoadBootcampStrengthTemplate({
        dayType,
        timeAvailable,
        equipment: 'no_gym',
      })

      const hasBandPull = template.exercises.some((exercise) => {
        return exercise.exerciseId.includes('band-row') ||
          exercise.exerciseId.includes('pull-apart') ||
          exercise.exerciseId.includes('face-pulls')
      })

      assert(hasBandPull, `${template.id} must include band pulling work`)
    }
  }
}

function testHotelGymAvoidsBarbells() {
  const unavailableExerciseIds = new Set([
    'ex-front-squat',
    'ex-bench-press',
    'ex-bent-over-row',
    'ex-ohp',
    'ex-rdl',
    'ex-deadlift',
    'ex-block-pull',
    'ex-lat-pulldown',
    'ex-hamstring-curl',
    'ex-pullup-band',
  ])

  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      const template = getRoadBootcampStrengthTemplate({
        dayType,
        timeAvailable,
        equipment: 'hotel_gym',
      })

      const unavailable = template.exercises.find((exercise) => unavailableExerciseIds.has(exercise.exerciseId))
      assertEqual(unavailable, undefined, `${template.id} includes equipment not assumed in a hotel gym`)
    }
  }
}

function testHotelGymHasDumbbellPrescriptions() {
  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      const template = getRoadBootcampStrengthTemplate({
        dayType,
        timeAvailable,
        equipment: 'hotel_gym',
      })

      const dumbbellExercises = template.exercises.filter(exercise => exercise.exerciseId.includes('db') || exercise.exerciseId === 'ex-goblet-squat')
      assert(dumbbellExercises.length > 0, `${template.id} should include dumbbell work`)
      for (const exercise of dumbbellExercises) {
        assert(
          exercise.sets.every(set => set.suggestedWeightKg != null),
          `${template.id} ${exercise.exerciseId} is missing prescribed DB loading`,
        )
      }
    }
  }
}

function testWarmupsAreMarkedWarmupSets() {
  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      for (const equipment of ROAD_BOOTCAMP_EQUIPMENT) {
        const template = getRoadBootcampStrengthTemplate({ dayType, timeAvailable, equipment })
        const warmupExercises = template.exercises.filter(exercise => exercise.section === 'warmup')

        assert(warmupExercises.length > 0, `${template.id} is missing a warmup`)
        for (const exercise of warmupExercises) {
          assert(exercise.sets.every(set => set.isWarmup), `${template.id} has a warmup stored as work`)
        }
      }
    }
  }
}

function testNewExercisesHaveVideosPlanned() {
  const used = new Set<string>()

  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      for (const equipment of ROAD_BOOTCAMP_EQUIPMENT) {
        for (const exercise of getRoadBootcampStrengthTemplate({ dayType, timeAvailable, equipment }).exercises) {
          used.add(exercise.exerciseId)
        }
      }
    }
  }

  for (const exerciseId of REQUIRED_VIDEO_EXERCISES) {
    assert(used.has(exerciseId), `${exerciseId} is not used by the Road Bootcamp matrix`)
  }
}

function testEveryTemplateExerciseHasSeededVideo() {
  const seedSql = [
    readFileSync('src/db/seed.sql', 'utf8'),
    readFileSync('drizzle/0022_road_bootcamp.sql', 'utf8'),
  ].join('\n')
  const used = new Set<string>()

  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      for (const equipment of ROAD_BOOTCAMP_EQUIPMENT) {
        for (const exercise of getRoadBootcampStrengthTemplate({ dayType, timeAvailable, equipment }).exercises) {
          used.add(exercise.exerciseId)
        }
      }
    }
  }

  for (const exerciseId of used) {
    const rowPattern = new RegExp(`\\('${exerciseId}'[\\s\\S]*?'https?://[^']+'`)
    assert(rowPattern.test(seedSql), `${exerciseId} is missing a seeded form video URL`)
  }
}

function testHapbearBandCues() {
  const noGym = getRoadBootcampStrengthTemplate({
    dayType: 'strength_b',
    timeAvailable: '30',
    equipment: 'no_gym',
  })

  const bandExercises = noGym.exercises.filter(exercise => exercise.exerciseId.includes('band'))
  assert(bandExercises.length > 0, 'no-gym template should include band exercises')
  for (const exercise of bandExercises) {
    assert(exercise.notes?.includes('HAPBEAR'), `${exercise.exerciseId} is missing HAPBEAR band guidance`)
    assert(exercise.sets.every(set => set.bandColor), `${exercise.exerciseId} is missing prescribed band color`)
  }

  const hotelWarmup = getRoadBootcampStrengthTemplate({
    dayType: 'strength_a',
    timeAvailable: '15',
    equipment: 'hotel_gym',
  }).exercises.find(exercise => exercise.exerciseId === 'ex-band-pull-aparts')
  assert(hotelWarmup?.notes?.includes('HAPBEAR yellow'), 'hotel warmup should carry light HAPBEAR guidance')
}

function testAdaptationLineIsReusable() {
  assertEqual(
    getRoadBootcampAdaptationLine('15', 'no_gym'),
    '15 minutes. No gym. Main work only.',
  )
  assertEqual(
    getRoadBootcampAdaptationLine('30', 'hotel_gym'),
    '30 minutes. Hotel gym. Main work stays, accessories drop.',
  )
  assertEqual(
    getRoadBootcampAdaptationLine('45_plus', 'full_gym'),
    '45+ minutes. Full gym. Full strength session.',
  )
}

testAllEighteenVariants()
testNoGymPullingWork()
testHotelGymAvoidsBarbells()
testHotelGymHasDumbbellPrescriptions()
testWarmupsAreMarkedWarmupSets()
testNewExercisesHaveVideosPlanned()
testEveryTemplateExerciseHasSeededVideo()
testHapbearBandCues()
testAdaptationLineIsReusable()

console.log('roadBootcampStrengthTemplates tests passed')

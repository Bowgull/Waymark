import {
  getRoadBootcampAdaptationLine,
  getRoadBootcampStrengthPreviewOptions,
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

function testHotelGymDoesNotLeakBandCuesOntoDumbbellWork() {
  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      const template = getRoadBootcampStrengthTemplate({
        dayType,
        timeAvailable,
        equipment: 'hotel_gym',
      })

      const dumbbellOnly = template.exercises.filter(exercise =>
        exercise.exerciseId === 'ex-bulgarian-split-squat' ||
        exercise.exerciseId === 'ex-single-leg-rdl',
      )
      for (const exercise of dumbbellOnly) {
        assert(!exercise.notes?.includes('HAPBEAR'), `${template.id} leaked band cue onto ${exercise.exerciseId}`)
        assert(exercise.sets.every(set => !set.bandColor), `${template.id} leaked band color onto ${exercise.exerciseId}`)
      }
    }
  }
}

function testHotelGymDoesNotRequireBands() {
  for (const dayType of ['strength_a', 'strength_b'] as const) {
    for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
      const template = getRoadBootcampStrengthTemplate({
        dayType,
        timeAvailable,
        equipment: 'hotel_gym',
      })

      for (const exercise of template.exercises) {
        assert(!exercise.exerciseId.includes('band'), `${template.id} includes a band exercise`)
        assert(exercise.exerciseId !== 'ex-face-pulls', `${template.id} includes face pulls without an anchor`)
        assert(!exercise.notes?.includes('HAPBEAR'), `${template.id} includes band-specific notes`)
        assert(exercise.sets.every(set => !set.bandColor), `${template.id} includes band color prescription`)
      }
    }
  }
}

function testFullGymBDoesNotDuplicateDeadBugPattern() {
  const template = getRoadBootcampStrengthTemplate({
    dayType: 'strength_b',
    timeAvailable: '45_plus',
    equipment: 'full_gym',
  })
  const deadBugLike = template.exercises.filter(exercise =>
    exercise.exerciseId === 'ex-dead-bugs' ||
    exercise.exerciseId === 'ex-weighted-dead-bug',
  )

  assert(deadBugLike.length === 1, 'full-gym Strength B should not duplicate dead bug patterns')
}

function movementRole(exerciseId: string): Set<string> {
  const roles = new Set<string>()
  if ([
    'ex-front-squat',
    'ex-goblet-squat',
    'ex-bulgarian-split-squat',
    'ex-tempo-squat',
  ].includes(exerciseId)) roles.add('squat')
  if ([
    'ex-rdl',
    'ex-block-pull',
    'ex-deadlift',
    'ex-db-rdl',
    'ex-band-good-morning',
    'ex-single-leg-rdl',
  ].includes(exerciseId)) roles.add('hinge')
  if ([
    'ex-bench-press',
    'ex-db-bench-press',
    'ex-incline-db-press',
    'ex-push-up',
    'ex-band-chest-press',
  ].includes(exerciseId)) roles.add('push')
  if ([
    'ex-ohp',
    'ex-db-ohp',
    'ex-pike-push-up',
  ].includes(exerciseId)) roles.add('press')
  if ([
    'ex-bent-over-row',
    'ex-db-row',
    'ex-band-row',
    'ex-pullup-band',
    'ex-face-pulls',
  ].includes(exerciseId)) roles.add('pull')
  if ([
    'ex-bulgarian-split-squat',
    'ex-reverse-lunge',
    'ex-single-leg-rdl',
    'ex-lateral-lunges',
  ].includes(exerciseId)) roles.add('single_leg')
  return roles
}

function testRoadStrengthDoctrineRoles() {
  for (const timeAvailable of ROAD_BOOTCAMP_TIMES) {
    for (const equipment of ROAD_BOOTCAMP_EQUIPMENT) {
      const strengthA = getRoadBootcampStrengthTemplate({ dayType: 'strength_a', timeAvailable, equipment })
      const aRoles = new Set(strengthA.exercises.flatMap(exercise => Array.from(movementRole(exercise.exerciseId))))
      assert(aRoles.has('squat'), `${strengthA.id} is missing squat pattern`)
      assert(aRoles.has('push'), `${strengthA.id} is missing push pattern`)
      assert(aRoles.has('pull'), `${strengthA.id} is missing pull pattern`)

      const strengthB = getRoadBootcampStrengthTemplate({ dayType: 'strength_b', timeAvailable, equipment })
      const bRoles = new Set(strengthB.exercises.flatMap(exercise => Array.from(movementRole(exercise.exerciseId))))
      assert(bRoles.has('hinge'), `${strengthB.id} is missing hinge pattern`)
      assert(bRoles.has('press'), `${strengthB.id} is missing press pattern`)
      assert(bRoles.has('pull'), `${strengthB.id} is missing pull pattern`)
      if (timeAvailable !== '15') assert(bRoles.has('single_leg'), `${strengthB.id} is missing single-leg work`)
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
}

function testStrengthPreviewOptionsExposeMovesOnly() {
  const previews = getRoadBootcampStrengthPreviewOptions({
    dayType: 'strength_a',
    timeAvailable: '45_plus',
    blockWeek: 1,
  })

  assertEqual(previews.length, 3, 'Road preview should expose the three equipment paths')
  assertEqual(previews[0].label, 'Room')
  assertEqual(previews[1].label, 'Hotel gym')
  assertEqual(previews[2].label, 'Full gym')

  const hotel = previews.find(preview => preview.equipment === 'hotel_gym')
  assert(hotel, 'Hotel gym preview missing')
  assert(hotel.exercises.length > 0, 'Hotel gym preview needs exact moves')
  assert(hotel.exercises.every(move => !/\d|lb|kg|×|x\s*\d/i.test(move)), 'Preview should not expose sets, reps, or load')
  assert(hotel.exercises.every(move => !/band|face pull/i.test(move)), 'Hotel gym preview should not require bands or anchors')
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
testHotelGymDoesNotLeakBandCuesOntoDumbbellWork()
testHotelGymDoesNotRequireBands()
testFullGymBDoesNotDuplicateDeadBugPattern()
testRoadStrengthDoctrineRoles()
testWarmupsAreMarkedWarmupSets()
testNewExercisesHaveVideosPlanned()
testEveryTemplateExerciseHasSeededVideo()
testHapbearBandCues()
testStrengthPreviewOptionsExposeMovesOnly()
testAdaptationLineIsReusable()

console.log('roadBootcampStrengthTemplates tests passed')

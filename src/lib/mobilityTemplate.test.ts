import { DAILY_MOBILITY_TEMPLATE } from './mobilityTemplate'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function ids() {
  return new Set(DAILY_MOBILITY_TEMPLATE.map(exercise => exercise.exerciseId))
}

function testDailyMobilityOwnsPostureBandWork() {
  const exerciseIds = ids()

  assert(exerciseIds.has('ex-band-pull-aparts'), 'Daily Mobility should include band pull-aparts for posture')
  assert(exerciseIds.has('ex-band-external-rotation'), 'Daily Mobility should include band external rotations for rotator cuff')
  assert(
    exerciseIds.has('ex-dead-bugs') || exerciseIds.has('ex-bird-dogs'),
    'Daily Mobility should include trunk control for lower-back position',
  )
}

function testDailyMobilityAvoidsRoadUnfriendlyTools() {
  for (const exercise of DAILY_MOBILITY_TEMPLATE) {
    assert(!exercise.exerciseId.includes('foam-roll'), `${exercise.exerciseId} assumes a foam roller on the road`)
  }
}

testDailyMobilityOwnsPostureBandWork()
testDailyMobilityAvoidsRoadUnfriendlyTools()

console.log('mobilityTemplate tests passed')

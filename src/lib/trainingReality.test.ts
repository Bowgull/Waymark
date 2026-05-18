import { assessRunCompletion, assessStrengthSet, shouldShowRunRealityMark, shouldShowStrengthRealityMark } from './trainingReality'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function testRunCompletionStatus() {
  const normal = assessRunCompletion({ plannedDurationSec: 2100, completedDurationSec: 1800 })
  assert(normal.completionStatus === 'complete', '80%+ run is complete')
  assert(normal.completionRatio === 0.86, 'ratio is rounded')
  assert(!shouldShowRunRealityMark(normal.completionStatus), 'complete run does not show mark')

  const shortened = assessRunCompletion({ plannedDurationSec: 2100, completedDurationSec: 1200 })
  assert(shortened.completionStatus === 'shortened', '50-79% run is shortened')
  assert(shouldShowRunRealityMark(shortened.completionStatus), 'shortened run shows mark')

  const partial = assessRunCompletion({ plannedDurationSec: 2100, completedDurationSec: 900 })
  assert(partial.completionStatus === 'partial', 'under 50% run is partial')
  assert(shouldShowRunRealityMark(partial.completionStatus), 'partial run shows mark')
}

function testStrengthSetStatus() {
  assert(
    assessStrengthSet({ plannedWeightKg: 40, actualWeightKg: 40, plannedReps: 10, actualReps: 10 }) === 'normal',
    'matching set is normal',
  )
  assert(
    assessStrengthSet({ plannedWeightKg: 40, actualWeightKg: 30, plannedReps: 10, actualReps: 10 }) === 'lighter',
    'large weight drop is lighter',
  )
  assert(
    assessStrengthSet({ plannedWeightKg: 40, actualWeightKg: 46, plannedReps: 10, actualReps: 10 }) === 'heavier',
    'large weight increase is heavier',
  )
  assert(
    assessStrengthSet({ plannedWeightKg: 40, actualWeightKg: 40, plannedReps: 10, actualReps: 6 }) === 'rep_shortfall',
    'rep miss is shortfall',
  )
  assert(
    assessStrengthSet({ plannedWeightKg: 40, actualWeightKg: 40, plannedReps: 10, actualReps: 14 }) === 'rep_surplus',
    'large rep surplus is surplus',
  )
  assert(
    shouldShowStrengthRealityMark('rep_shortfall'),
    'non-normal strength status shows mark',
  )
}

testRunCompletionStatus()
testStrengthSetStatus()

console.log('trainingReality tests passed')

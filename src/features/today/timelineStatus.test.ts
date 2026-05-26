import { canReplaceOrSkipTodaySession, isActionableTodaySession } from './timelineStatus'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function testMissedSessionsStillDrillIntoToday() {
  assert(isActionableTodaySession('missed', false), 'missed Today sessions should still open actions')
  assert(canReplaceOrSkipTodaySession('missed'), 'missed Today sessions should still be replaceable or skippable')
}

function testAutoPendingRowsKeepStravaConfirmationPath() {
  assert(!isActionableTodaySession('planned', true), 'auto-pending rows use Strava confirmation instead of normal actions')
}

testMissedSessionsStillDrillIntoToday()
testAutoPendingRowsKeepStravaConfirmationPath()

console.log('timelineStatus tests passed')

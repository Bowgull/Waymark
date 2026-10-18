import assert from 'node:assert/strict'
import { confirmedRunTimes, isDismissed, matchManualRun, type ManualRunCandidate } from './stravaMatch'

const START = 1_760_000_000
const act = { startSec: START, movingSec: 1800, elapsedSec: 1900 }

// Logged by hand 20 minutes after finishing, 30 min typed: same run.
const manual: ManualRunCandidate = { sessionId: 's1', runSessionId: 'r1', completedAt: START + 1900 + 1200, durationSec: 1800 }
assert.equal(matchManualRun(act, [manual])?.sessionId, 's1', 'manual run + Strava sync of the same run match')

// Duration within tolerance (25% or 10 min) still matches; way off doesn't.
assert.ok(matchManualRun(act, [{ ...manual, durationSec: 1500 }]), '5 min off is the same run')
assert.equal(matchManualRun(act, [{ ...manual, durationSec: 600 }]), null, '10 min typed vs 30 min moving: a different run')

// Saved long before the run started or many hours after: a different run.
assert.equal(matchManualRun(act, [{ ...manual, completedAt: START - 3 * 3600 }]), null, 'morning log vs evening activity')
assert.equal(matchManualRun(act, [{ ...manual, completedAt: START + 10 * 3600 }]), null)

// No time and no duration on the manual row: too weak to merge.
assert.equal(matchManualRun(act, [{ ...manual, completedAt: null, durationSec: null }]), null)
// Duration only (no completion time) can match.
assert.ok(matchManualRun(act, [{ ...manual, completedAt: null }]))

// Closest duration wins when two fit.
const two = matchManualRun(act, [{ ...manual, sessionId: 'far', durationSec: 2200 }, { ...manual, sessionId: 'near', durationSec: 1750 }])
assert.equal(two?.sessionId, 'near')

// Dismissed activities stay dismissed.
assert.ok(isDismissed(42, [7, 42]))
assert.ok(!isDismissed(43, new Set([42])))

// Confirm stamps the run's own time, not the tap.
const tap = START + 2 * 86400
assert.deepEqual(confirmedRunTimes({ activityStartAt: START, activityEndAt: START + 1900, durationSec: 1800 }, tap), { startedAt: START, completedAt: START + 1900 })
assert.deepEqual(confirmedRunTimes({ activityStartAt: START, activityEndAt: null, durationSec: 1800 }, tap), { startedAt: START, completedAt: START + 1800 })
assert.deepEqual(confirmedRunTimes({ activityStartAt: null, activityEndAt: null, durationSec: 1800 }, tap), { startedAt: null, completedAt: tap }, 'rows from before 0028 fall back to the tap')

console.log('stravaMatch tests passed')

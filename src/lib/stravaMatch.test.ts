import assert from 'node:assert/strict'
import { confirmedRunTimes, isDismissed, isZone2Run, matchManualRun, overCapBpm, stravaPlanLine, stravaReadouts, type ManualRunCandidate } from './stravaMatch'

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

// ─── page 40: the Strava card on Today ───
{
  const z2 = { type: 'running', notes: 'zone2', blockType: 'fighter' }
  const prog = { type: 'running', notes: 'progression', blockType: 'fighter' }
  assert.equal(isZone2Run(z2), true)
  assert.equal(isZone2Run({ type: 'foundation_run', notes: null, blockType: 'block_zero' }), true)
  assert.equal(isZone2Run({ type: 'running', notes: null, blockType: 'block_zero' }), true, 'every Block Zero run is easy')
  assert.equal(isZone2Run(prog), false)
  assert.equal(isZone2Run({ type: 'strength', notes: null, blockType: 'block_zero' }), false)
  // The mockup's numbers: max 190, cap 133.
  assert.equal(stravaPlanLine(z2, 190, 133), 'Zone 2. 114 to 133 bpm.')
  // The line's top is the cap the chip reads (a talk test can set it).
  assert.equal(stravaPlanLine(z2, 190, 142), 'Zone 2. 114 to 142 bpm.')
  assert.equal(stravaPlanLine(z2, 190, null), 'Zone 2. 114 to 133 bpm.', 'no cap: 70% of max')
  assert.equal(stravaPlanLine(z2, null, 133), null, 'no max HR: no line')
  assert.equal(stravaPlanLine(prog, 190, 133), 'Zone 2 to 4. 114 to 171 bpm.')
  assert.equal(stravaPlanLine({ type: 'running', notes: null, blockType: 'fighter' }, 190, 133), null)
  assert.equal(overCapBpm(142, 133), 9)
  assert.equal(overCapBpm(133, 133), null, 'at the cap is not over')
  assert.equal(overCapBpm(120, 133), null)
  assert.equal(overCapBpm(142, null), null)
  assert.equal(overCapBpm(null, 133), null)
  assert.deepEqual(stravaReadouts({ distanceKm: 5.02, paceSecKm: 370, avgHr: 142, maxHr: 168 }).map(r => `${r.label} ${r.value} ${r.unit}`), ['DISTANCE 5.02 km', 'PACE 6:10 /km', 'AVG HR 142 bpm', 'MAX HR 168 bpm'])
  assert.equal(stravaReadouts({ distanceKm: 12.345, paceSecKm: 359.6, avgHr: null, maxHr: null }).map(r => r.value).join(' '), '12.3 6:00', 'pace never reads 5:60')
  assert.deepEqual(stravaReadouts({ distanceKm: null, paceSecKm: null, avgHr: null, maxHr: null }), [])
  console.log('stravaMatch page-40 tests passed')
}

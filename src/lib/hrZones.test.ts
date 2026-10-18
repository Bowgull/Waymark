import assert from 'node:assert/strict'
import { bucketZones, maxHrAfterRun, maxHrCap, sustainedMaxHr, zoneFor, zoneUpperBounds } from './hrZones'
import { zone2CeilingBpm } from './hrAnalysis'

// A run held exactly at the zone-2 ceiling charts as zone 2.
{
  const maxHr = 190
  const ceiling = zone2CeilingBpm(maxHr)
  assert.equal(ceiling, 133)
  assert.equal(zoneUpperBounds(maxHr)[1], ceiling, 'Z2 top bound = the prescribed ceiling')
  assert.equal(zoneFor(133, maxHr), 'z2', '133 bpm at max 190 is zone 2')
  assert.equal(zoneFor(134, maxHr), 'z3')
  assert.equal(zoneFor(114, maxHr), 'z2', '60% bpm starts zone 2')
  assert.equal(zoneFor(113, maxHr), 'z1')
  const time = Array.from({ length: 2401 }, (_, i) => i)
  const zones = bucketZones(time.map(() => 133), time, maxHr)
  assert.equal(zones.z2, 2401, '40 min at the ceiling is all zone 2')
  assert.equal(zones.z3, 0)
}

// Auto-pause: paused samples don't count; without a moving stream a gap is capped.
{
  const time = [...Array.from({ length: 1201 }, (_, i) => i), ...Array.from({ length: 600 }, (_, i) => 1800 + i)]
  const hr = time.map(() => 140)
  const noMoving = bucketZones(hr, time, 190)
  const total = Object.values(noMoving).reduce((a, b) => a + b, 0)
  assert.ok(total <= 1801 + 30, `pause gap is capped (got ${total})`)
  const moving = time.map((_, i) => i !== 1200)
  const withMoving = bucketZones(hr, time, 190, moving)
  const movingTotal = Object.values(withMoving).reduce((a, b) => a + b, 0)
  assert.equal(movingTotal, 1200 + 600, 'moving stream: zone time = moving time')
}

// One spike can't raise max HR; a sustained effort can, up to the age cap.
{
  const time = Array.from({ length: 600 }, (_, i) => i)
  const spike = time.map(i => (i === 300 ? 214 : 165))
  assert.equal(sustainedMaxHr(spike, time), 165, 'single 214 sample ignored')
  assert.equal(maxHrAfterRun({ currentMaxHr: 185, sustainedHr: sustainedMaxHr(spike, time), ageYears: 35 }), null, 'spike leaves max HR alone')

  const hard = time.map(i => (i >= 500 && i < 530 ? 192 : 170))
  assert.equal(sustainedMaxHr(hard, time), 192, '30 s at 192 is sustained')
  assert.equal(maxHrAfterRun({ currentMaxHr: 185, sustainedHr: 192, ageYears: 35 }), 192, 'sustained and plausible: max HR moves')
  assert.equal(maxHrAfterRun({ currentMaxHr: 195, sustainedHr: 192, ageYears: 35 }), null, 'never lowers')
  assert.equal(maxHrCap(35), 200)
  assert.equal(maxHrAfterRun({ currentMaxHr: 185, sustainedHr: 205, ageYears: 35 }), null, 'above 220 - age + 15 needs a manual entry')
  assert.equal(maxHrCap(null), 215, 'unknown age: the noise clamp')
  assert.equal(maxHrAfterRun({ currentMaxHr: null, sustainedHr: 216, ageYears: null }), null)
  assert.equal(sustainedMaxHr([], []), null)
  assert.equal(sustainedMaxHr([180], [0]), null, 'one sample is not sustained')
}

console.log('hrZones tests passed')

import assert from 'node:assert/strict'
import { enteredOver, heartState, nextZone, OVER_SEC, ZONE_START, type ZoneTracker } from './hrZoneState'

const L = 147
const step = (prev: ZoneTracker, hr: number | null, t: number) => nextZone(prev, hr, L, t)

// No strap: none. No line: teal.
assert.equal(step(ZONE_START, null, 0).zone, 'none')
assert.equal(nextZone(ZONE_START, 160, null, 0).zone, 'in')

// Teal under the band, gold within 5 bpm of the line (inclusive at both ends).
assert.equal(step(ZONE_START, 138, 0).zone, 'in')
assert.equal(step(ZONE_START, 141, 0).zone, 'in')
assert.equal(step(ZONE_START, 142, 0).zone, 'gold')
assert.equal(step(ZONE_START, 147, 0).zone, 'gold')

// Just over: gold for under 30 s, ember from 30 s.
{
  let z = step(ZONE_START, 150, 0)
  assert.equal(z.zone, 'gold')
  z = step(z, 151, 29_000)
  assert.equal(z.zone, 'gold')
  const before = z.zone
  z = step(z, 152, OVER_SEC * 1000)
  assert.equal(z.zone, 'over')
  assert.ok(enteredOver(before, z.zone))
  assert.ok(!enteredOver(z.zone, step(z, 153, 31_000).zone))
  // Back under: the clock resets.
  z = step(z, 140, 32_000)
  assert.equal(z.zone, 'in')
  assert.equal(z.overSinceMs, null)
  z = step(z, 150, 33_000)
  assert.equal(z.zone, 'gold')
}

// A dropout resets the over clock too.
{
  let z = step(ZONE_START, 150, 0)
  z = step(z, null, 10_000)
  z = step(z, 150, 35_000)
  assert.equal(z.zone, 'gold')
}

assert.equal(heartState('in'), 'under')
assert.equal(heartState('none'), 'idle')
assert.equal(heartState('over'), 'over')

console.log('hrZoneState tests passed')

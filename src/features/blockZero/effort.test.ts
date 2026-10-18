import assert from 'node:assert/strict'

import { normaliseClassType } from '../../lib/blockZero/muayThai'
import { strengthSetPatchSchema, mtClassLogPatchSchema, userProfilePatchSchema } from '../../lib/validators/schemas'
import { CLASS_TYPE_TILES, formTypeFor } from './classType'
import { EFFORT_TILES, asksEffort, effortWrite, labelForRir, rirFromLabel } from './effort'
import { stripWeeks, weekLine, weekName } from './program'
import { readinessLine } from './readinessLine'

// ─── effort tiles map to RIR 3 / 2 / 1 / 0 ──
{
  assert.deepEqual(EFFORT_TILES.map(t => t.label), ['3+', '2', '1', '0'])
  assert.deepEqual(EFFORT_TILES.map(t => t.rir), [3, 2, 1, 0])
  assert.equal(rirFromLabel('3+'), 3)
  assert.equal(rirFromLabel('0'), 0)
  assert.equal(rirFromLabel('4'), null)
  assert.equal(labelForRir(5), '3+', 'anything 3 or more reads 3+')
  assert.equal(labelForRir(1), '1')
  assert.equal(labelForRir(null), null)
  for (const t of EFFORT_TILES) {
    assert.ok(strengthSetPatchSchema.safeParse({ rir: t.rir }).success, `rir ${t.rir} passes the set PATCH schema`)
  }
  assert.equal(asksEffort({ isWarmup: 1, reps: 8 }), false, 'warm-ups skip it')
  assert.equal(asksEffort({ isWarmup: 0, reps: 8, section: 'main' }), true)
  assert.equal(asksEffort({ isWarmup: false, reps: 30, section: 'core' }), false, 'core holds skip it')
  assert.equal(asksEffort({ isWarmup: 0, reps: 10, section: 'accessory' }), true)
  const w = effortWrite('set-1', 2, 'sess-1')
  assert.equal(w.path, '/api/strength-sets/set-1')
  assert.deepEqual(w.body, { rir: 2 })
  assert.equal(w.key, 'set-rir-set-1-2', 'a stable key: a retry never doubles it')
}

// ─── class types asked at log time are ones the server knows ──
{
  for (const t of CLASS_TYPE_TILES) {
    assert.ok(mtClassLogPatchSchema.safeParse({ classType: t.value }).success, `${t.value} passes the PATCH schema`)
    assert.ok(normaliseClassType(t.value), `${t.value} normalises for the Block Zero ramp`)
  }
  assert.equal(formTypeFor('technique'), 'technical')
  assert.equal(formTypeFor('bag'), 'padwork')
  assert.equal(formTypeFor('sparring'), 'sparring')
}

// ─── the readiness line on the hero card ──
{
  assert.equal(readinessLine(null), null)
  assert.equal(readinessLine({ checkedIn: false, ease: false, reason: null }), null, 'nothing to say before a check-in')
  const eased = readinessLine({ checkedIn: true, ease: true, worseItems: ['sleepHours', 'backToday'], reason: 'Sleep and your back are off your 7-day trend for 2 days.' })
  assert.equal(eased?.tone, 'bad')
  assert.equal(eased?.text, 'Easing today. Sleep and back off trend.')
  assert.equal(eased?.why, 'Sleep and your back are off your 7-day trend for 2 days.')
  const load = readinessLine({ checkedIn: true, ease: true, worseItems: [], reason: 'Load jumped 30%.' })
  assert.equal(load?.text, 'Easing today. Load is up.')
  const oneOff = readinessLine({ checkedIn: true, ease: false, worseItems: ['energy'], reason: null })
  assert.equal(oneOff?.tone, 'good')
  assert.match(oneOff!.why, /^Energy is off your 7-day trend today/)
  const fresh = readinessLine({ checkedIn: true, ease: false, worseItems: [], reason: null, items: [] })
  assert.match(fresh!.why, /Not enough check-ins yet/)
  const steady = readinessLine({ checkedIn: true, ease: false, worseItems: [], reason: null, items: [{ item: 'sleepHours', today: 7, mean7: 7, worse: false }] })
  assert.equal(steady?.why, 'Everything is near your 7-day average.')
}

// ─── the six-week strip ──
{
  const s = stripWeeks(2, 6)
  assert.deepEqual(s.map(w => w.letter).join(''), 'TBBBBR', 'Test · Build x4 · Retest')
  assert.deepEqual(s.map(w => w.state), ['done', 'now', 'ahead', 'ahead', 'ahead', 'ahead'])
  const ext = stripWeeks(7, 8)
  assert.equal(ext.length, 8, 'extension weeks join the strip')
  assert.equal(ext[6].letter, '+')
  assert.equal(ext[6].state, 'now')
  assert.equal(weekName(1), 'TEST')
  assert.equal(weekName(6), 'RETEST')
  assert.match(weekLine(7), /week-5 levels/)
}

// ─── Settings: the coach's fields ──
{
  assert.ok(userProfilePatchSchema.safeParse({ dob: '1990-04-12' }).success)
  assert.ok(userProfilePatchSchema.safeParse({ maxHr: 188, injuries: 'Lower back stiff' }).success)
  assert.ok(userProfilePatchSchema.safeParse({ maxHr: null }).success, 'null clears it')
  assert.ok(!userProfilePatchSchema.safeParse({}).success, 'nothing to update is refused')
  assert.ok(!userProfilePatchSchema.safeParse({ maxHr: 300 }).success)
  assert.ok(!userProfilePatchSchema.safeParse({ dob: '2999-01-01' }).success, 'a future birth date is refused')
  assert.ok(!userProfilePatchSchema.safeParse({ dob: '12/04/1990' }).success)
}

console.log('effort / readiness / program tests passed')

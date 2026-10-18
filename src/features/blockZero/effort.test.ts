import assert from 'node:assert/strict'

import { normaliseClassType } from '../../lib/blockZero/muayThai'
import { strengthSetPatchSchema, mtClassLogPatchSchema, userProfilePatchSchema } from '../../lib/validators/schemas'
import { CLASS_TYPES, clampClassMinutes, classLogPatch, defaultClassType } from './classType'
import { EFFORT_TILES, asksEffort, effortWrite, labelForRir, rirFromLabel } from './effort'
import { readinessLine } from './readinessLine'

// ─── effort tiles map to RIR 3 / 2 / 1 / 0 ──
{
  assert.deepEqual(EFFORT_TILES.map(t => t.label), ['3+', '2', '1', '0'])
  assert.deepEqual(EFFORT_TILES.map(t => t.rir), [3, 2, 1, 0])
  assert.deepEqual(EFFORT_TILES.map(t => t.sub), ['easy', 'solid', 'hard', 'limit'], "page 17's words under the tiles")
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

// ─── the MT class log (page 31): types the server knows, one note, the length ──
{
  assert.deepEqual(CLASS_TYPES.map(t => t.label), ['TECHNICAL', 'SPARRING', 'PADWORK', 'CLINCH', 'GENERAL'], "page 31's chips, in order")
  for (const t of CLASS_TYPES) {
    assert.ok(mtClassLogPatchSchema.safeParse({ classType: t.value }).success, `${t.value} passes the PATCH schema`)
    assert.ok(normaliseClassType(t.value), `${t.value} normalises for the Block Zero ramp`)
  }
  assert.equal(defaultClassType(null, true), 'technical', 'quick add in Block Zero starts on TECHNICAL')
  assert.equal(defaultClassType(null, false), 'general')
  assert.equal(defaultClassType('technique', false), 'technical', 'older Block Zero names still map')
  assert.equal(defaultClassType('pads', true), 'padwork')
  assert.equal(defaultClassType('Sparring', true), 'sparring')
  assert.equal(clampClassMinutes(62), 60)
  assert.equal(clampClassMinutes(0), 5)
  assert.equal(clampClassMinutes(999), 300)
  assert.equal(clampClassMinutes(Number.NaN), 60)
  const body = classLogPatch({ classType: 'padwork', minutes: 75, note: '  Guard dropping after combos ' })
  assert.deepEqual(body, { classType: 'padwork', durationMin: 75, weakness: 'Guard dropping after combos' }, 'the one note is the weakness field')
  assert.ok(mtClassLogPatchSchema.safeParse(body).success, 'the save body passes the PATCH schema')
  assert.deepEqual(classLogPatch({ classType: 'technical', minutes: 60, note: ' ' }), { classType: 'technical', durationMin: 60 }, 'an empty note leaves the field alone')
}

// ─── the readiness line (a line of Today's Coach board) ──
{
  assert.equal(readinessLine(null), null)
  assert.equal(readinessLine({ checkedIn: false, ease: false, reason: null }), null, 'nothing to say before a check-in')
  const eased = readinessLine({ checkedIn: true, ease: true, worseItems: ['sleepHours', 'backToday'], reason: 'Sleep and your back are off your 7-day trend for 2 days.' })
  assert.equal(eased?.tone, 'bad')
  assert.equal(eased?.text, 'Easing today. Sleep and back off trend.')
  assert.equal(eased?.why, 'Sleep and your back are off your 7-day trend for 2 days.')
  assert.equal(eased?.lead, 'Easing today.', 'the bold lead, as the why line writes it (page 36)')
  assert.equal(eased?.rest, 'Sleep and back off trend.')
  const load = readinessLine({ checkedIn: true, ease: true, worseItems: [], reason: 'Load jumped 30%.' })
  assert.equal(load?.text, 'Easing today. Load is up.')
  const oneOff = readinessLine({ checkedIn: true, ease: false, worseItems: ['energy'], reason: null })
  assert.equal(oneOff?.tone, 'good')
  assert.equal(oneOff?.lead, 'Good to go.')
  assert.equal(oneOff?.rest, '', 'a one-sentence line is all lead')
  assert.match(oneOff!.why, /^Energy is off your 7-day trend today/)
  const fresh = readinessLine({ checkedIn: true, ease: false, worseItems: [], reason: null, items: [] })
  assert.match(fresh!.why, /Not enough check-ins yet/)
  const steady = readinessLine({ checkedIn: true, ease: false, worseItems: [], reason: null, items: [{ item: 'sleepHours', today: 7, mean7: 7, worse: false }] })
  assert.equal(steady?.why, 'Everything is near your 7-day average.')
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

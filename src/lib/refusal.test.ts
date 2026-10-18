import assert from 'node:assert/strict'

import { describeAlternative, parseRefusal, refusalMessage } from './refusal'
import { volumeKeyLabel } from './weeklyTemplate'

// A 409 from the placement rules (insert-ad-hoc / replace / move / accept).
const body = JSON.stringify({
  error: 'Legs need 24 h between hard sessions',
  code: 'legs_24h',
  reason: 'Legs need 24 h between hard sessions',
  safeAlternatives: [
    { kind: 'day', epochDay: 20380, date: '2025-10-21', timeSlot: 'am' },
    { kind: 'swap', type: 'active_recovery', label: 'Reset', epochDay: 20379, date: '2025-10-20', timeSlot: 'pm' },
    { kind: 'day', epochDay: 20382, date: '2025-10-23', timeSlot: 'pm' },
    { kind: 'day', epochDay: 20383, date: '2025-10-24', timeSlot: 'am' },
  ],
})
const r = parseRefusal({ status: 409, body })
assert.ok(r)
assert.equal(r!.code, 'legs_24h')
assert.equal(r!.safeAlternatives.length, 4)
assert.equal(describeAlternative(r!.safeAlternatives[0]), 'Tue AM')
assert.equal(describeAlternative(r!.safeAlternatives[1]), 'Reset Mon PM')
assert.equal(
  refusalMessage(r!),
  'Legs need 24 h between hard sessions. Safe options: Tue AM, Reset Mon PM, Thu PM.',
  'reason plus the first three safe options',
)
// No alternatives: the reason alone, one full stop.
assert.equal(refusalMessage({ reason: 'Run cap reached this week.', code: 'run_cap', safeAlternatives: [] }), 'Run cap reached this week.')
// Error-only bodies, other statuses, garbage: handled.
assert.equal(parseRefusal({ status: 400, body: JSON.stringify({ error: 'Unknown session type.' }) })?.reason, 'Unknown session type.')
assert.equal(parseRefusal({ status: 500, body }), null)
assert.equal(parseRefusal({ status: 409, body: 'not json' }), null)
assert.equal(parseRefusal({ status: 409, body: '' }), null)
assert.equal(parseRefusal(new Error('network')), null)
assert.equal(parseRefusal(null), null)

// Week Intelligence chips: labels, not type codes.
assert.equal(volumeKeyLabel('strength'), 'Strength')
assert.equal(volumeKeyLabel('foundation_run'), 'Zone 2')
assert.equal(volumeKeyLabel('mobility'), 'Foundation')
assert.equal(volumeKeyLabel('active_recovery'), 'Reset')
assert.equal(volumeKeyLabel('mt_class'), 'MT Class')
assert.equal(volumeKeyLabel('running:progression'), 'Progression Run')
assert.equal(volumeKeyLabel('running:zone2'), 'Zone 2 Run')
assert.ok(!volumeKeyLabel('bag_work').includes('_'))

console.log('refusal tests passed')

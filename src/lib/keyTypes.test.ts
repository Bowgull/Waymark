// Run: tsx src/lib/keyTypes.test.ts
// One KEY_TYPES (coach-brain P0, §1.4.4): the coach rules, the end gate, the
// Consistency board, the starter status and the guardrails all read the same
// set, so a type added or removed changes every reader at once.
import assert from 'node:assert/strict'
import { KEY_TYPES } from './keyTypes'
import { KEY_TYPES as COACH_KEY_TYPES } from './coach'
import { KEY_SESSION_TYPES, HARD_TYPES } from './blockZero'
import { COUNTED_TYPES } from './ledgerConsistency'

assert.deepEqual([...KEY_TYPES].sort(), ['bag_work', 'foundation_run', 'mt_class', 'running', 'skip_rope', 'strength'])
assert.equal(COACH_KEY_TYPES, KEY_TYPES, 'the coach rules read lib/keyTypes')
assert.equal(KEY_SESSION_TYPES, KEY_TYPES, 'the end gate reads lib/keyTypes')
assert.equal(HARD_TYPES, KEY_TYPES, 'the guardrails read lib/keyTypes')
assert.equal(COUNTED_TYPES, KEY_TYPES, 'the Consistency board reads lib/keyTypes')
for (const t of ['mobility', 'active_recovery']) assert.ok(!KEY_TYPES.has(t), `${t} is a habit, not a dose`)
console.log('ok: one KEY_TYPES')

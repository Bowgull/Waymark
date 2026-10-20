// Run: tsx src/lib/waybookLock.test.ts
import assert from 'node:assert/strict'

import { WAYBOOK_WINDOW_MS, gateEnabledFrom, needsFaceId, outcomeForError } from './waybookLock'

const NOW = 1_800_000_000_000
const on = { enabled: true, native: true }

assert.equal(needsFaceId({ ...on, lastOpenAt: null }, NOW), true, 'first open asks')
assert.equal(needsFaceId({ ...on, lastOpenAt: NOW - 60_000 }, NOW), false, 'open a minute ago: no ask')
assert.equal(needsFaceId({ ...on, lastOpenAt: NOW - WAYBOOK_WINDOW_MS }, NOW), false, 'exactly 3 minutes: still inside')
assert.equal(needsFaceId({ ...on, lastOpenAt: NOW - WAYBOOK_WINDOW_MS - 1 }, NOW), true, 'past 3 minutes asks again')
assert.equal(WAYBOOK_WINDOW_MS, 180_000)
assert.equal(needsFaceId({ enabled: true, native: false, lastOpenAt: null }, NOW), false, 'web build: opens without a prompt')
assert.equal(needsFaceId({ enabled: false, native: true, lastOpenAt: null }, NOW), false, 'switched off')

assert.equal(gateEnabledFrom(null), true, 'on by default')
assert.equal(gateEnabledFrom('1'), true)
assert.equal(gateEnabledFrom('0'), false)

assert.equal(outcomeForError('userCancel'), 'stay', 'cancel leaves it closed')
assert.equal(outcomeForError('authenticationFailed'), 'stay')
assert.equal(outcomeForError('biometryLockout'), 'stay')
assert.equal(outcomeForError('passcodeNotSet'), 'open-unprotected', 'no passcode: opens, never locks him out')
assert.equal(outcomeForError('noDeviceCredential'), 'open-unprotected')

console.log('waybookLock tests passed')

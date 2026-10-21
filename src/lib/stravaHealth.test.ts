import assert from 'node:assert/strict'

import { needsReconnect, stravaNeedsReconnect } from './stravaHealth'

assert.equal(needsReconnect('strava_403'), true)
assert.equal(needsReconnect('strava_401'), true)
assert.equal(needsReconnect('refresh_failed'), true)
assert.equal(needsReconnect('strava_500'), false, 'a Strava outage is not a reconnect')
assert.equal(needsReconnect(undefined), false)

const at = Date.UTC(2026, 9, 21)
const flagged = JSON.stringify({ error: 'strava_403', at })
assert.equal(stravaNeedsReconnect(at - 86_400_000, flagged), true, 'connected before the failure: reconnect')
assert.equal(stravaNeedsReconnect(at + 60_000, flagged), false, 'reconnected since (ms): fine')
assert.equal(stravaNeedsReconnect(Math.floor(at / 1000) + 60, flagged), false, 'reconnected since (seconds): fine')
assert.equal(stravaNeedsReconnect(500, null), false)
assert.equal(stravaNeedsReconnect(500, '{bad'), false)

console.log('stravaHealth tests passed')

import assert from 'node:assert/strict'
import { parseDurationToSec } from './duration'
import { isLoggedSet, isLoggedWorkSet, loggedWorkSets } from './loggedSets'

assert.equal(parseDurationToSec('1:05:30'), 3930, 'h:mm:ss')
assert.equal(parseDurationToSec('0:45:00'), 2700)
assert.equal(parseDurationToSec('45:30'), 2730, 'mm:ss')
assert.equal(parseDurationToSec('65:30'), 3930, 'minutes past 59 in mm:ss')
assert.equal(parseDurationToSec('45'), 2700, 'plain minutes')
assert.equal(parseDurationToSec(' 42.5 '), 2550, 'decimal minutes')
assert.equal(parseDurationToSec(''), null)
assert.equal(parseDurationToSec('abc'), null)
assert.equal(parseDurationToSec('45:75'), null, 'seconds over 59')
assert.equal(parseDurationToSec('1:65:00'), null, 'minutes over 59 in h:mm:ss')
assert.equal(parseDurationToSec('1:2:3:4'), null)
assert.equal(parseDurationToSec('0:00'), null, 'zero is no duration')

// Logged-set filter: pre-filled sets never count, warm-ups never count.
const sets = [
  { id: 'w', completedAt: 100, isWarmup: 1 },
  { id: 'a', completedAt: 200, isWarmup: 0 },
  { id: 'b', completedAt: null, isWarmup: 0 },
]
assert.ok(isLoggedSet(sets[0]) && !isLoggedSet(sets[2]))
assert.ok(!isLoggedWorkSet(sets[0]) && isLoggedWorkSet(sets[1]))
assert.deepEqual(loggedWorkSets(sets).map(s => s.id), ['a'], 'only the logged working set counts')

console.log('duration and logged-set tests passed')

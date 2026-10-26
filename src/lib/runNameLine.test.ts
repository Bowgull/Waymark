import assert from 'node:assert/strict'
import { runNameLine } from './runNameLine'

// Page 93's four lines, word for word.
assert.equal(runNameLine('Zone 2 Run'), 'Easy and steady. You can talk in full sentences the whole way.')
assert.equal(runNameLine('TEMPO'), 'Steady and hard. A few words, but no chatting. 15 to 20 minutes of it in the middle.')
assert.equal(runNameLine('Intervals'), 'Short hard runs with easy jogs between. Too hard to talk on the hard parts.')
assert.equal(runNameLine('Run-Walk'), 'Run a few minutes, walk one, again. It builds you to running the whole way.')
// No line for anything else (the test, a walk, a lift, no name).
for (const n of ['5K Test', 'Easy walk', 'Strength A', '', null, undefined]) assert.equal(runNameLine(n), null, String(n))

console.log('runNameLine: ok')

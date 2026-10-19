// Run: tsx src/features/session/narutoCard.test.ts
import assert from 'node:assert/strict'
import { narutoWatchedLine } from './narutoCard'
import { narutoEpisodesWatched, narutoNextEp } from '../../lib/naruto'

// page 46: "NOW ON EP 33?" after a 46-minute run from ep 31, and its one line
assert.equal(narutoEpisodesWatched(46 * 60), 2)
assert.equal(narutoNextEp(31, 2), 33)
assert.equal(narutoWatchedLine(2), 'You watched about two episodes on that run.')
assert.equal(narutoWatchedLine(1), 'You watched about one episode on that run.')
assert.equal(narutoWatchedLine(12), 'You watched about 12 episodes on that run.')
console.log('narutoCard tests passed')

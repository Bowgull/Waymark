import assert from 'node:assert/strict'

import { validateWorkoutRecovery } from './workoutRecovery'

const fresh = Date.now()

assert.equal(
  validateWorkoutRecovery(
    { sessionId: 's1', exerciseIdx: 1, setIdx: 2, roundIdx: 0, phase: 'exercise', savedAt: fresh },
    { sessionId: 's1', exerciseSetCounts: [3, 4], maxAgeMs: 4 * 60 * 60 * 1000, nowMs: fresh },
  )?.phase,
  'exercise',
  'valid same-session strength recovery should be accepted',
)

assert.equal(
  validateWorkoutRecovery(
    { sessionId: 's1', exerciseIdx: 9, setIdx: 0, roundIdx: 0, phase: 'exercise', savedAt: fresh },
    { sessionId: 's1', exerciseSetCounts: [3, 4], maxAgeMs: 4 * 60 * 60 * 1000, nowMs: fresh },
  ),
  null,
  'stale exercise index should be rejected before render',
)

assert.equal(
  validateWorkoutRecovery(
    { sessionId: 's1', exerciseIdx: 1, setIdx: 9, roundIdx: 0, phase: 'exercise', savedAt: fresh },
    { sessionId: 's1', exerciseSetCounts: [3, 4], maxAgeMs: 4 * 60 * 60 * 1000, nowMs: fresh },
  ),
  null,
  'stale set index should be rejected before render',
)

assert.equal(
  validateWorkoutRecovery(
    { sessionId: 's1', exerciseIdx: 0, setIdx: 0, roundIdx: 0, phase: 'complete', savedAt: fresh },
    { sessionId: 's1', exerciseSetCounts: [3, 4], maxAgeMs: 4 * 60 * 60 * 1000, nowMs: fresh },
  ),
  null,
  'terminal phases should not be restored',
)

assert.equal(
  validateWorkoutRecovery(
    { sessionId: 'old', exerciseIdx: 0, setIdx: 0, roundIdx: 0, phase: 'exercise', savedAt: fresh },
    { sessionId: 's1', exerciseSetCounts: [3, 4], maxAgeMs: 4 * 60 * 60 * 1000, nowMs: fresh },
  ),
  null,
  'different session recovery should be rejected',
)

assert.equal(
  validateWorkoutRecovery(
    { sessionId: 's1', exerciseIdx: 0, setIdx: 0, roundIdx: 0, phase: 'unknown', savedAt: fresh },
    { sessionId: 's1', exerciseSetCounts: [3, 4], maxAgeMs: 4 * 60 * 60 * 1000, nowMs: fresh },
  ),
  null,
  'unknown phases should not be restored',
)

console.log('workoutRecovery tests passed')

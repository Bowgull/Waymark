import assert from 'node:assert/strict'

import { pageSavedLines, pendingSetCount, savedSetLines } from './savedSets'

const kg = (lb: number) => lb / 2.20462

const exercises = [
  {
    exercise: { name: 'Back Squat' },
    sets: [
      { id: 'w1', weightKg: kg(95), reps: 5, isWarmup: 1, completedAt: 100 },
      { id: 's1', weightKg: kg(140), reps: 8, isWarmup: 0, completedAt: 110 },
      { id: 's2', weightKg: kg(140), reps: 8, isWarmup: 0, completedAt: 120 },
    ],
  },
  {
    exercise: { name: 'RDL' },
    sets: [
      { id: 'r1', weightKg: kg(115), reps: 7, isWarmup: 0, completedAt: 130 },
      { id: 'r2', weightKg: kg(115), reps: 7, isWarmup: 0, completedAt: null },
    ],
  },
  {
    exercise: { name: 'Split Squat' },
    sets: [
      { id: 'q1', weightKg: null, reps: 10, isWarmup: 0, completedAt: null },
      { id: 'q2', weightKg: null, reps: 10, isWarmup: 0, completedAt: null },
    ],
  },
  { exercise: { name: 'Pallof Press' }, sets: [{ id: 'p1', weightKg: null, reps: 12, isWarmup: 0, completedAt: null }] },
]

// The server has squat (both sets) and one RDL set; the phone still holds the
// second RDL set and the first split squat (not synced yet).
const pending = [
  { path: '/api/strength-sets/r2', body: JSON.stringify({ weightKg: kg(115), reps: 7, completedAt: 140 }) },
  { path: '/api/strength-sets/q1', body: JSON.stringify({ weightKg: null, reps: 10, completedAt: 150 }) },
  { path: '/api/strength-sets/q1', body: JSON.stringify({ rir: 2 }) },
  { path: '/api/sessions/x/complete', body: '{}' },
]

const lines = savedSetLines(exercises, pending)
assert.deepEqual(lines, [
  { name: 'Back Squat', detail: '2×8 · 140' },
  { name: 'RDL', detail: '2×7 · 115' },
  { name: 'Split Squat', detail: '1 of 2 sets' },
], 'warm-ups never count; pending writes on the phone count as logged; untouched lifts are left out')

assert.deepEqual(savedSetLines(exercises), [
  { name: 'Back Squat', detail: '2×8 · 140' },
  { name: 'RDL', detail: '1 of 2 sets' },
])
assert.deepEqual(savedSetLines([{ exercise: null, sets: [{ id: 'z', weightKg: 0, reps: 10, isWarmup: false, completedAt: 1 }] }]), [{ name: 'Exercise', detail: '1×10' }], 'bodyweight: no weight shown')
assert.equal(pendingSetCount(pending), 2, 'two sets wait on the phone (an effort write is the same set)')
assert.equal(savedSetLines([], [{ path: '/api/strength-sets/a', body: 'not json' }]).length, 0)

console.log('savedSets tests passed')

// ─── the page error's NOTHING LOST lines (page 38, "A page") ──
{
  assert.deepEqual(pageSavedLines([]), [{ name: 'Sessions', detail: 'all saved' }, { name: 'Morning reports', detail: 'all saved' }], 'as mocked: SESSIONS all saved, MORNING REPORTS all saved')
  const two = pageSavedLines([{ sessionId: 's1' }, { sessionId: 's1' }, { sessionId: 's2' }])
  assert.equal(two[0].detail, '2 sessions waiting on this phone')
  assert.equal(pageSavedLines([{ sessionId: 's1' }])[0].detail, '1 session waiting on this phone')
}

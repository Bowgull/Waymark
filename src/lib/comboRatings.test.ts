// Run: tsx src/lib/comboRatings.test.ts
// Page 93: one rating per combo per session, however many rounds it was in.
import assert from 'node:assert/strict'
import { masteryFromRatings, oneRatingPerCombo } from './comboRatings'

// a combo in 3 rounds rated once: one row, not three
const tonight = [
  { roundId: 'r2', comboId: 'a', rating: 3 },
  { roundId: 'r4', comboId: 'a', rating: 3 },
  { roundId: 'r5', comboId: 'a', rating: 3 },
  { roundId: 'r3', comboId: 'b', rating: 2 },
  { roundId: 'r4', comboId: 'b', rating: 2 },
]
const one = oneRatingPerCombo(tonight)
assert.equal(one.length, 2, 'two combos, two ratings')
assert.deepEqual(one.find(r => r.comboId === 'a'), { comboId: 'a', roundId: 'r2', rating: 3 }, 'kept with its first round')

// the last tap wins; junk is dropped
assert.deepEqual(oneRatingPerCombo([{ roundId: 'r1', comboId: 'a', rating: 1 }, { roundId: 'r2', comboId: 'a', rating: 3 }]), [{ comboId: 'a', roundId: 'r1', rating: 3 }])
assert.deepEqual(oneRatingPerCombo([{ roundId: 'r1', comboId: 'a', rating: 7 }, { roundId: 'r1', comboId: '', rating: 2 }, { roundId: 'r1', comboId: 'c', rating: 2.5 }]), [])

// mastery: the newest five sessions, one rating each (old per-round rows count once)
const rows = [
  { sessionId: 's1', rating: 3, createdAt: 10 }, { sessionId: 's1', rating: 3, createdAt: 10 }, { sessionId: 's1', rating: 3, createdAt: 10 },
  { sessionId: 's2', rating: 2, createdAt: 20 },
]
assert.equal(masteryFromRatings(rows), 5, 'old triple rows count once: 3 + 2')
const six = Array.from({ length: 6 }, (_, i) => ({ sessionId: `s${i}`, rating: i === 0 ? 1 : 2, createdAt: i * 10 }))
assert.equal(masteryFromRatings(six), 10, 'the oldest session falls out of the five')
assert.equal(masteryFromRatings([]), 0)
// mastered at 9 still takes most of five sessions (no threshold change)
assert.equal(masteryFromRatings([3, 3, 3].map((r, i) => ({ sessionId: `x${i}`, rating: r, createdAt: i }))), 9, 'three SHARP sessions reach 9, not one')

console.log('comboRatings: ok')

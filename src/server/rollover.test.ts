// Run: tsx src/server/rollover.test.ts
// Josh, 2026-10-19 (decision a): a session left in progress whose day has
// passed becomes done (partial) with what was logged. No missed rune, no
// missed fix; the logged sets are real work. Also covers earlier bug 17
// (a Foundation ended with x stayed in progress for weeks).
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { exercises, sessions, strengthSessionExercises, strengthSets, weekAdjustments } from '../db/schema'
import { startedAtForLocalDay } from '../lib/coach'
import { isoToEpochDay } from '../lib/dates'
import { createTrainingBlock } from './blocks'
import { rolloverAndFix } from './changes'
import { testDb } from './testDb'
import { LIVE_GRACE_SEC, closeStaleInProgress } from '../lib/sessionRollover'

const FRI = isoToEpochDay('2026-10-23')
const db = testDb()
await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: (FRI - 30) * 86400, startedAt: startedAtForLocalDay(FRI - 32) })
const started = FRI * 86400 + 7 * 3600
await db.insert(sessions).values([
  { id: 'str', type: 'strength', label: 'Strength C', scheduledDate: FRI, timeSlot: 'am', status: 'in_progress', startedAt: started, blockType: 'block_zero', createdAt: started },
  { id: 'fnd', type: 'mobility', label: 'Foundation', scheduledDate: FRI, timeSlot: 'am', status: 'in_progress', startedAt: started, blockType: 'block_zero', createdAt: started },
  { id: 'run', type: 'foundation_run', scheduledDate: FRI, timeSlot: 'pm', status: 'planned', blockType: 'block_zero', createdAt: started },
  { id: 'today', type: 'strength', label: 'Strength A', scheduledDate: FRI + 1, timeSlot: 'am', status: 'in_progress', startedAt: started + 86400, blockType: 'block_zero', createdAt: started },
])
await db.insert(exercises).values({ id: 'row', name: 'Bent-Over Row', category: 'strength', createdAt: 1 })
await db.insert(strengthSessionExercises).values({ id: 'sx', sessionId: 'str', exerciseId: 'row', orderIndex: 0 })
await db.insert(strengthSets).values([
  { id: 's1', sessionExerciseId: 'sx', setNumber: 1, weightKg: 40, reps: 8, completedAt: started + 600, createdAt: started },
  { id: 's2', sessionExerciseId: 'sx', setNumber: 2, weightKg: 40, reps: 8, completedAt: started + 900, createdAt: started },
  { id: 's3', sessionExerciseId: 'sx', setNumber: 3, weightKg: 40, reps: 8, completedAt: null, createdAt: started },
])

await rolloverAndFix(db, FRI + 1)
const get = async (id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]
const str = await get('str')
assert.equal(str.status, 'completed', 'decision a: an unfinished strength session is done once its day passes')
assert.equal(str.completedAt, started + 900, 'its finish is the last logged set')
assert.equal(str.durationSec, 900)
assert.deepEqual(JSON.parse(str.contextJson ?? '{}').partial, { closedBy: 'rollover', loggedSets: 2 }, 'it is marked partial with what was logged')
assert.equal((await get('fnd')).status, 'completed', 'bug 17: a Foundation left open is done too, not in progress for weeks')
assert.equal((await get('run')).status, 'missed', 'a planned session that never started is still missed')
assert.equal((await get('today')).status, 'in_progress', 'today\'s session stays open')
const missedRows = await db.select().from(weekAdjustments).where(eq(weekAdjustments.kind, 'missed'))
assert.ok(!missedRows.some(r => r.targetSessionId === 'str' || r.targetSessionId === 'fnd'), 'decision a: no missed record (no Algiz) for a partial session')
// M7 (page 61): a session still going past midnight is not closed under him.
{
  const late = FRI * 86400 + 23 * 3600 + 40 * 60
  await db.insert(sessions).values({ id: 'late', type: 'bag_work', scheduledDate: FRI + 1, timeSlot: 'pm', status: 'in_progress', startedAt: late, blockType: 'block_zero', createdAt: late })
  const afterMidnight = (FRI + 2) * 86400 + 20 * 60
  assert.ok(!(await closeStaleInProgress(db, FRI + 2, late + 50 * 60)).includes('late'), 'started 50 min ago, past midnight: stays open')
  assert.equal((await get('late')).status, 'in_progress')
  const closed = await closeStaleInProgress(db, FRI + 2, afterMidnight + LIVE_GRACE_SEC)
  assert.ok(closed.includes('late'), 'quiet for 6 h: done (partial) as before')
  assert.equal((await get('late')).status, 'completed')
}
console.log('rollover tests passed')

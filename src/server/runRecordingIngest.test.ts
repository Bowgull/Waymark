import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'

import { testDb } from './testDb'
import { runSessions, runSplits, sessions, strengthSessionExercises, strengthSets, exercises, userProfile } from '../db/schema'
import { ingestRecording } from './runRecordingIngest'
import { discardSession } from './discardSession'
import type { RunRecording } from '../lib/runRecording'

const db = testDb()
const now = 1_800_000_000

await db.insert(userProfile).values({ id: 'default', maxHr: 180, dob: '1992-01-01', createdAt: now, updatedAt: now })
await db.insert(sessions).values({ id: 's1', type: 'running', status: 'in_progress', startedAt: now - 1300, createdAt: now })
await db.insert(runSessions).values({ id: 'r1', sessionId: 's1', plannedDurationSec: 1200, isIndoor: 0 })

// 20 min: 138 bpm, a sustained 185 for 20 s (a new max), 2.5 m/s.
const n = 1200
const rec: RunRecording = {
  runId: 'rec-1', sessionId: 's1', runSessionId: 'r1', startedAt: now - 1300, endedAt: now - 100, outdoor: true,
  series: {
    t: Array.from({ length: n }, (_, i) => i),
    hr: Array.from({ length: n }, (_, i) => (i >= 900 && i < 920 ? 185 : 138)),
    moving: Array.from({ length: n }, () => 1 as const),
    distM: Array.from({ length: n }, (_, i) => (i + 1) * 2.5),
  },
}

const out = await ingestRecording(db, 'r1', rec, now)
assert.ok(out)
const [row] = await db.select().from(runSessions).where(eq(runSessions.id, 'r1'))
assert.equal(row.source, 'waymark')
assert.equal(row.attachmentStatus, 'confirmed')
assert.equal(row.distanceKm, 3)
assert.equal(row.durationSec, 1200)
assert.equal(row.paceSecKm, 400)
assert.equal(row.maxHr, 185)
assert.equal(row.isIndoor, 0)
const zones = JSON.parse(row.zoneSeconds!)
assert.equal(zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5, 1200, 'zone time is all moving time')
assert.ok(zones.z3 > 1000, '138 at max 180 sits in zone 3')
// The sustained 185 (20 s) raises max HR, under the age cap.
assert.deepEqual(out!.maxHrBumped, { from: 180, to: 185 })
const [p] = await db.select().from(userProfile)
assert.equal(p.maxHr, 185)

// Replay: the same splits, not doubled.
await ingestRecording(db, 'r1', rec, now)
const splits = await db.select().from(runSplits).where(eq(runSplits.runSessionId, 'r1'))
assert.equal(splits.length, 3)

// Unknown run: null.
assert.equal(await ingestRecording(db, 'nope', rec, now), null)

// DISCARD: back to planned, the run and its splits gone; a finished session refuses.
{
  const r = await discardSession(db, 's1')
  assert.deepEqual(r, { ok: true, status: 'discarded' })
  const [s] = await db.select().from(sessions).where(eq(sessions.id, 's1'))
  assert.equal(s.status, 'planned')
  assert.equal(s.startedAt, null)
  assert.equal((await db.select().from(runSessions).where(eq(runSessions.sessionId, 's1'))).length, 0)
  assert.equal((await db.select().from(runSplits)).length, 0)
  assert.deepEqual(await discardSession(db, 's1'), { ok: true, status: 'noop' })
  assert.deepEqual(await discardSession(db, 'missing'), { ok: false, status: 'not_found' })
  await db.insert(sessions).values({ id: 'done', type: 'running', status: 'completed', createdAt: now })
  assert.deepEqual(await discardSession(db, 'done'), { ok: false, status: 'completed' })
}

// DISCARD a strength session: its logged sets go with it.
{
  const [ex] = await db.select().from(exercises).limit(1)
  await db.insert(sessions).values({ id: 's2', type: 'strength', status: 'in_progress', startedAt: now, createdAt: now })
  await db.insert(strengthSessionExercises).values({ id: 'e1', sessionId: 's2', exerciseId: ex?.id ?? 'x', orderIndex: 0 })
  await db.insert(strengthSets).values({ id: 'set1', sessionExerciseId: 'e1', setNumber: 1, reps: 5, weightKg: 60, completedAt: now, createdAt: now })
  await discardSession(db, 's2')
  assert.equal((await db.select().from(strengthSets)).length, 0)
  assert.equal((await db.select().from(strengthSessionExercises)).length, 0)
}

console.log('runRecordingIngest + discardSession tests passed')

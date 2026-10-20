// Run: tsx src/lib/weeklyPlanAI.test.ts
// The body-issue window (coach-brain P0, §1.4.6): the planner reads body
// issues from the 4 weeks before last week, not every row ever written. The
// window start is unix seconds, built from an epoch day.
import assert from 'node:assert/strict'
import { and, eq, gte } from 'drizzle-orm'
import { bodyIssuesSinceSec } from './weeklyPlanAI'
import { coachingOutputs } from '../db/schema'
import { testDb } from '../server/testDb'
import { isoToEpochDay } from './dates'

const prevWeekStart = isoToEpochDay('2026-10-12') // last week's Monday
const since = bodyIssuesSinceSec(prevWeekStart)
assert.equal(since, isoToEpochDay('2026-09-14') * 86400, '4 weeks before last Monday, as unix seconds')
assert.ok(since > 1_700_000_000, 'a real timestamp, not a negative number')

const db = testDb()
const row = (id: string, iso: string) => ({ id, kind: 'body_issues', model: 'm', outputJson: '{"weekNumber":1,"detections":[]}', createdAt: isoToEpochDay(iso) * 86400 + 3600 })
await db.insert(coachingOutputs).values([row('old', '2026-06-01'), row('edge', '2026-09-14'), row('new', '2026-10-15')])
const read = await db.select({ id: coachingOutputs.id }).from(coachingOutputs).where(and(eq(coachingOutputs.kind, 'body_issues'), gte(coachingOutputs.createdAt, since)))
assert.deepEqual(read.map(r => r.id).sort(), ['edge', 'new'], 'a June row is outside the window')
// The old arithmetic (days minus seconds) let every row in.
const old = prevWeekStart - 28 * 86400
const readOld = await db.select({ id: coachingOutputs.id }).from(coachingOutputs).where(and(eq(coachingOutputs.kind, 'body_issues'), gte(coachingOutputs.createdAt, old)))
assert.equal(readOld.length, 3, 'the old window read all three')
console.log('ok: the body-issue window is 4 weeks')

// Run: tsx src/server/blocks.test.ts
// E2E 2026-10-19b majors on a real (in-memory) database:
// M1: a mid-week Block Zero start: its own week is week 1 (no lead-in since coach
//     brain P2) and next week is a plan of its own.
// M2: restarting Block Zero (not fresh) takes the old block's planned
//     sessions with it, so the new week has no doubles.
import assert from 'node:assert/strict'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { sessions, weekPlans } from '../db/schema'
import { mondayOf, startedAtForLocalDay } from '../lib/coach'
import { isoToEpochDay } from '../lib/dates'
import { createTrainingBlock, dropEndedBlockPlans, endActiveBlocks } from './blocks'
import { latestWeekPlan } from './coachData'
import { prepareWeek } from './weeklyPass'
import { testDb } from './testDb'

const WED = isoToEpochDay('2026-10-21')
const MON = mondayOf(WED)
const NEXT = MON + 7
const nowSec = WED * 86400 + 18 * 3600

// ─── M1 ──────────────────────────────────────────────────────
{
  const db = testDb()
  const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec, startedAt: startedAtForLocalDay(WED) })
  await prepareWeek(db, '', { blockId: block.id, monday: MON, todayDay: WED, nowSec, useAi: false })
  // Next week is prepared during the lead-in (the Sunday pass, or Program's Next ›).
  await prepareWeek(db, '', { blockId: block.id, monday: NEXT, todayDay: WED, nowSec: nowSec + 60, useAi: false })
  const plans = await db.select().from(weekPlans).where(eq(weekPlans.blockId, block.id))
  assert.equal(plans.filter(p => p.weekNumber === 1).length, 2, 'two plans are numbered week 1')

  const daysOf = async (id: string) => (await db.select({ d: sessions.scheduledDate }).from(sessions).where(eq(sessions.weekPlanId, id))).map(r => r.d as number)
  // Coach brain P2: no lead-in. The start week holds Wednesday to Sunday; next week its own plan.
  const ids = plans.filter(p => p.weekNumber === 1).map(p => p.id)
  const days = await Promise.all(ids.map(daysOf))
  assert.ok(days.some(ds => ds.length > 0 && ds.every(d => d >= WED && d < NEXT)), 'M1: the start week holds this week from Wednesday')
  assert.ok(days.some(ds => ds.length > 0 && ds.every(d => d >= NEXT && d <= NEXT + 6)), 'M1: next Monday to Sunday is its own plan')
  assert.equal(await latestWeekPlan(db, block.id, 1, { leadIn: true }), null, 'no lead-in plan any more')
  console.log('ok: M1 lead-in and week 1 read apart')
}

// ─── M2 ──────────────────────────────────────────────────────
{
  const db = testDb()
  const old = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec - 30 * 86400, startedAt: startedAtForLocalDay(MON - 21) })
  await prepareWeek(db, '', { blockId: old.id, monday: MON, todayDay: MON, nowSec: MON * 86400, useAi: false })
  const before = await db.select().from(sessions).where(gte(sessions.scheduledDate, WED))
  assert.ok(before.length > 0, 'the old block has sessions planned from Wednesday')
  // One was started already: it stays.
  const keep = before[0]
  await db.update(sessions).set({ status: 'in_progress' }).where(eq(sessions.id, keep.id))

  // Restart Block Zero on Wednesday, not fresh.
  await endActiveBlocks(db, nowSec, WED)
  const fresh = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec, startedAt: startedAtForLocalDay(WED) })
  await prepareWeek(db, '', { blockId: fresh.id, monday: MON, todayDay: WED, nowSec, useAi: false })

  const oldPlans = (await db.select({ id: weekPlans.id }).from(weekPlans).where(eq(weekPlans.blockId, old.id))).map(p => p.id)
  const leftover = await db.select().from(sessions).where(and(inArray(sessions.weekPlanId, oldPlans), gte(sessions.scheduledDate, WED), eq(sessions.status, 'planned')))
  assert.equal(leftover.length, 0, 'M2: no planned session of the ended block is left from today on')
  assert.ok((await db.select().from(sessions).where(eq(sessions.id, keep.id))).length === 1, 'M2: a started session stays')
  const oldEarlier = await db.select().from(sessions).where(and(inArray(sessions.weekPlanId, oldPlans), eq(sessions.scheduledDate, MON)))
  assert.ok(oldEarlier.length > 0, 'M2: days before the restart keep their history')

  const live = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, WED), eq(sessions.status, 'planned')))
  const keys = live.map(s => `${s.scheduledDate}:${s.timeSlot}:${s.type}`)
  assert.equal(new Set(keys).size, keys.length, `M2: no session shows twice (${keys.join(' ')})`)
  // m16: an ended block's planned rows (made before this fix) are not today's.
  const ghost = { id: 'ghost', status: 'planned', weekPlanId: oldPlans[0] }
  const kept = await dropEndedBlockPlans(db, [ghost, { ...ghost, id: 'done', status: 'completed' }])
  assert.deepEqual(kept.map(r => r.id), ['done'], "m16: an ended block's planned session is dropped, its history kept")
  console.log('ok: M2 restart leaves no doubles')
}

console.log('block restart and lead-in DB tests passed')

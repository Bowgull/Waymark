// One creation path for training blocks. POST /api/blocks and the Block Zero
// transition both go through here so a Fighter block made by "proceed" is the
// same as one made by hand.

import { and, eq, gte, inArray } from 'drizzle-orm'
import { mtClassLogs, postureSessionExercises, runSessions, sessions, strengthSessionExercises, trainingBlocks, weekAdjustments, weekPlans } from '../db/schema'
import { FIGHTER_DEFAULT_TOTAL_WEEKS } from '../lib/blockZero'
import { startedAtForLocalDay } from '../lib/coach/leadIn'
import { isChoosableStart, isPendingStart, startDayOf } from '../lib/coach/startDay'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

export const FIGHTER_DEFAULT_NAME = '12-Week Base Build'
export { FIGHTER_DEFAULT_TOTAL_WEEKS }

export async function createTrainingBlock(
  db: DB,
  params: { name: string; blockType: 'fighter' | 'block_zero'; totalWeeks: number; nowSec: number; startedAt?: number | null },
) {
  const id = crypto.randomUUID()
  await db.insert(trainingBlocks).values({
    id,
    name: params.name,
    blockType: params.blockType,
    totalWeeks: params.totalWeeks,
    // The start is the athlete's local day when the client sent it (noon UTC
    // of that date, D4); else now.
    startedAt: params.startedAt ?? params.nowSec,
    status: 'active',
    createdAt: params.nowSec,
  })
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, id))
  return block
}

/**
 * End every active block. Used before a new block takes over. The ended
 * block's sessions still planned from `todayDay` on go with it (never
 * started, so nothing is lost), with their change rows: otherwise the new
 * block's week shows every session twice and both roll to missed.
 */
export async function endActiveBlocks(db: DB, nowSec: number, todayDay = Math.floor(nowSec / 86400)): Promise<void> {
  const activeBlocks = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
  for (const active of activeBlocks) {
    await db.update(trainingBlocks)
      .set({ status: 'ended', endedAt: nowSec })
      .where(eq(trainingBlocks.id, active.id))
    await dropPlannedSessions(db, active.id, todayDay)
  }
}

/**
 * A block's sessions still planned from `fromDay` on, never opened (no
 * exercise rows, run, or class log), go, with their change rows. Used when a
 * block ends and when a waiting Block Zero moves its start day (page 64).
 */
export async function dropPlannedSessions(db: DB, blockId: string, fromDay: number): Promise<number> {
  const plans = await db.select({ id: weekPlans.id }).from(weekPlans).where(eq(weekPlans.blockId, blockId))
  if (plans.length === 0) return 0
  const doomed = await db.select({ id: sessions.id }).from(sessions)
    .where(and(inArray(sessions.weekPlanId, plans.map(p => p.id)), eq(sessions.status, 'planned'), gte(sessions.scheduledDate, fromDay)))
  // A session opened before (exercise rows, a run, a class log) stays.
  const opened = new Set<string>()
  for (let i = 0; i < doomed.length; i += 50) {
    const chunk = doomed.slice(i, i + 50).map(r => r.id)
    for (const t of [strengthSessionExercises, postureSessionExercises, runSessions, mtClassLogs]) {
      for (const r of await db.select({ id: t.sessionId }).from(t).where(inArray(t.sessionId, chunk))) opened.add(r.id)
    }
  }
  const ids = doomed.map(r => r.id).filter(id => !opened.has(id))
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    // sessions.adjustment_id points at week_adjustments: unlink, then children first.
    const changeIds = (await db.select({ id: weekAdjustments.id }).from(weekAdjustments).where(inArray(weekAdjustments.targetSessionId, chunk))).map(r => r.id)
    if (changeIds.length > 0) await db.update(sessions).set({ adjustmentId: null }).where(inArray(sessions.adjustmentId, changeIds))
    await db.delete(sessions).where(inArray(sessions.id, chunk))
    if (changeIds.length > 0) await db.delete(weekAdjustments).where(inArray(weekAdjustments.id, changeIds))
  }
  return ids.length
}

export type MoveStartResult =
  | { ok: true; block: typeof trainingBlocks.$inferSelect }
  | { ok: false; status: 400 | 404 | 409; error: string }

/**
 * CHANGE DAY (page 64): a Block Zero still waiting for its start moves to
 * another day (today up to six days on). Its sessions planned so far go (none
 * can have started), and the start is stored as the local day at noon UTC.
 * The caller prepares the new start's week, as BEGIN does.
 */
export async function moveBlockZeroStart(db: DB, blockId: string, startDay: number, todayDay: number): Promise<MoveStartResult> {
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, blockId))
  if (!block || block.status !== 'active' || block.blockType !== 'block_zero') return { ok: false, status: 404, error: 'no waiting block zero' }
  if (!isPendingStart(startDayOf(block.startedAt), todayDay)) return { ok: false, status: 409, error: 'block zero has started' }
  if (!isChoosableStart(startDay, todayDay)) return { ok: false, status: 400, error: 'start must be today or one of the next six days' }
  await dropPlannedSessions(db, block.id, todayDay)
  await db.update(trainingBlocks).set({ startedAt: startedAtForLocalDay(startDay) }).where(eq(trainingBlocks.id, block.id))
  const [moved] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, block.id))
  return { ok: true, block: moved }
}

/**
 * m16: an ended block's sessions still planned are not anyone's plan any more.
 * Done, started, skipped and missed ones stay as history.
 */
export async function dropEndedBlockPlans<T extends { status: string; weekPlanId: string | null }>(db: DB, rows: T[]): Promise<T[]> {
  const planIds = [...new Set(rows.filter(r => r.status === 'planned' && r.weekPlanId).map(r => r.weekPlanId as string))]
  if (planIds.length === 0) return rows
  const plans = await db.select({ id: weekPlans.id, blockId: weekPlans.blockId }).from(weekPlans).where(inArray(weekPlans.id, planIds))
  const blockIds = [...new Set(plans.map(p => p.blockId))]
  const ended = new Set((await db.select({ id: trainingBlocks.id, status: trainingBlocks.status }).from(trainingBlocks).where(inArray(trainingBlocks.id, blockIds)))
    .filter(b => b.status !== 'active').map(b => b.id))
  const deadPlans = new Set(plans.filter(p => ended.has(p.blockId)).map(p => p.id))
  return rows.filter(r => !(r.status === 'planned' && r.weekPlanId && deadPlans.has(r.weekPlanId)))
}

// One creation path for training blocks. POST /api/blocks and the Block Zero
// transition both go through here so a Fighter block made by "proceed" is the
// same as one made by hand.

import { eq } from 'drizzle-orm'
import { trainingBlocks } from '../db/schema'
import { FIGHTER_DEFAULT_TOTAL_WEEKS } from '../lib/blockZero'
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

/** End every active block. Used before a new block takes over. */
export async function endActiveBlocks(db: DB, nowSec: number): Promise<void> {
  const activeBlocks = await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active'))
  for (const active of activeBlocks) {
    await db.update(trainingBlocks)
      .set({ status: 'ended', endedAt: nowSec })
      .where(eq(trainingBlocks.id, active.id))
  }
}

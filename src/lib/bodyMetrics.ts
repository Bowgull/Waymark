import { desc, isNotNull, gte, and } from 'drizzle-orm'

import { bodyMetrics } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const THIRTY_DAYS_MS = 30 * 86400 * 1000

/**
 * Returns the most recent logged bodyweight (kg) within the last 30 days,
 * or null if nothing fresh exists. Stale weights are not returned — a
 * three-month-old number is worse than no number when the coach is reasoning
 * about current load.
 */
export async function getLatestBodyweightKg(db: DB): Promise<number | null> {
  const cutoff = Date.now() - THIRTY_DAYS_MS
  const rows = await db
    .select({ weightKg: bodyMetrics.weightKg })
    .from(bodyMetrics)
    .where(and(isNotNull(bodyMetrics.weightKg), gte(bodyMetrics.loggedAt, cutoff)))
    .orderBy(desc(bodyMetrics.loggedAt))
    .limit(1)
  return rows[0]?.weightKg ?? null
}

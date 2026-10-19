import { isNotNull } from 'drizzle-orm'

import { bodyMetrics } from '../db/schema'
import type { createDB } from '../db/client'
import { loggedAtSec } from './units'

type DB = ReturnType<typeof createDB>

const THIRTY_DAYS_SEC = 30 * 86400

/**
 * Returns the most recent logged bodyweight (kg) within the last 30 days,
 * or null if nothing fresh exists. Stale weights are not returned — a
 * three-month-old number is worse than no number when the coach is reasoning
 * about current load.
 */
export async function getLatestBodyweightKg(db: DB): Promise<number | null> {
  // logged_at mixes ms (old Body page) and seconds: normalise before the cutoff.
  const cutoff = Math.floor(Date.now() / 1000) - THIRTY_DAYS_SEC
  const rows = await db
    .select({ weightKg: bodyMetrics.weightKg, loggedAt: bodyMetrics.loggedAt })
    .from(bodyMetrics)
    .where(isNotNull(bodyMetrics.weightKg))
  const fresh = rows
    .map(r => ({ weightKg: r.weightKg, at: loggedAtSec(r.loggedAt) }))
    .filter(r => r.at >= cutoff)
    .sort((a, b) => b.at - a.at)
  return fresh[0]?.weightKg ?? null
}

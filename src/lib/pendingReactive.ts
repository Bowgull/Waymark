// Deferred reactive fires. Some signals — an injury skip, a "too sore" skip —
// are strong enough to warrant a mid-day coach reshape, but firing the
// moment the athlete taps skip fights them when they change their mind and
// add a replacement 30 min later. We stash a pending fire with a fireAt
// timestamp; the next Today read after that timestamp runs the coach, unless
// the athlete canceled it in the meantime by replacing the session.
//
// Storage: reuses coaching_outputs with kind='pending_reactive'. No migration.
// outputJson: { trigger, fireAt } — sessionId lives on scope_session_id.

import { and, eq, lte } from 'drizzle-orm'
import { coachingOutputs } from '../db/schema'
import { runReactiveReplan, type ReactiveTrigger } from './reactiveCoach'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

export const STRONG_SKIP_REASONS = new Set(['injury', 'too_sore', 'sick'])

// 4 hours. Long enough to cover normal "I'll add something later today"
// flip-flop windows, short enough to still react same-day on a real injury.
export const GRACE_SEC = 4 * 60 * 60

export async function schedulePendingFire(
  db: DB,
  trigger: ReactiveTrigger,
  sessionId: string,
  fireAtSec: number,
): Promise<void> {
  // Replace any existing pending row for the same session so repeated skip
  // taps don't stack up.
  await db.delete(coachingOutputs).where(
    and(
      eq(coachingOutputs.kind, 'pending_reactive'),
      eq(coachingOutputs.scopeSessionId, sessionId),
    ),
  )
  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'pending_reactive',
    model: 'pending',
    scopeWeekPlanId: null,
    scopeSessionId: sessionId,
    inputHash: null,
    outputJson: JSON.stringify({ trigger, fireAt: fireAtSec }),
    tokensIn: 0,
    tokensOut: 0,
    cachedTokensIn: 0,
    createdAt: fireAtSec - GRACE_SEC,
  })
}

export async function cancelPendingFires(db: DB, sessionId: string): Promise<void> {
  await db.delete(coachingOutputs).where(
    and(
      eq(coachingOutputs.kind, 'pending_reactive'),
      eq(coachingOutputs.scopeSessionId, sessionId),
    ),
  )
}

// Called from hot read paths (eg /api/sessions/today). Pulls pending rows
// whose fireAt has passed, deletes them, and kicks off the coach. The actual
// Anthropic call is fire-and-forget so the read path stays snappy.
export async function processPendingFires(
  db: DB,
  apiKey: string,
  nowSec: number,
  todayEpochDay: number,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<void> {
  // Read fireAt from outputJson. D1's JSON support is thin, so pull candidate
  // rows by createdAt (which equals fireAt - GRACE_SEC) and filter in JS.
  const candidates = await db
    .select()
    .from(coachingOutputs)
    .where(
      and(
        eq(coachingOutputs.kind, 'pending_reactive'),
        lte(coachingOutputs.createdAt, nowSec - GRACE_SEC),
      ),
    )
  if (candidates.length === 0) return

  for (const row of candidates) {
    let parsed: { trigger?: ReactiveTrigger; fireAt?: number } = {}
    try {
      parsed = JSON.parse(row.outputJson)
    } catch {
      // Malformed row — drop it so it can't block future processing.
      await db.delete(coachingOutputs).where(eq(coachingOutputs.id, row.id))
      continue
    }
    const fireAt = parsed.fireAt ?? row.createdAt + GRACE_SEC
    if (fireAt > nowSec) continue

    // Delete first so a second concurrent read path doesn't double-fire.
    await db.delete(coachingOutputs).where(eq(coachingOutputs.id, row.id))

    const trigger = parsed.trigger ?? 'session_skipped'
    const run = runReactiveReplan(db, apiKey, {
      trigger,
      sessionId: row.scopeSessionId ?? undefined,
      todayEpochDay,
    }).catch(err => console.warn('[pendingReactive] fire failed', err))
    try {
      waitUntil(run)
    } catch {
      void run
    }
  }
}

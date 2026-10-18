/**
 * Cloudflare Worker entry (Wrangler `main` in wrangler.jsonc).
 * React uses `main.tsx`; this file is bundled only by Wrangler.
 */
import app from './server/app'
import { createDB } from './db/client'
import { runReactiveReplan } from './lib/reactiveCoach'
import { rolloverStaleSessionIds } from './lib/sessionRollover'
import { backfillCurrentWeek, createMissedAsks, expireAsks } from './server/coachData'
import { pruneIdempotencyKeys } from './server/idempotency'
import { isoToEpochDay } from './lib/dates'
import { installDemoFetchGuard } from './lib/demoFetch'
import { generateDemoSql, DEMO_WIPE_STATEMENTS } from './db/demoSeed'

interface Env {
  DB: D1Database
  ANTHROPIC_API_KEY: string
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  STRAVA_WEBHOOK_VERIFY_TOKEN: string
  WAYMARK_API_KEY: string
  DEMO_MODE?: string
}

let demoGuardInstalled = false

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    if (env.DEMO_MODE === 'true' && !demoGuardInstalled) {
      installDemoFetchGuard()
      demoGuardInstalled = true
    }
    return app.fetch(req, env, ctx)
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.DEMO_MODE === 'true') {
      ctx.waitUntil(runDemoReset(env))
      return
    }
    ctx.waitUntil(runNightlyReplan(env))
  },
}

async function runDemoReset(env: Env): Promise<void> {
  console.log('[demo] reset start')
  const start = Date.now()
  try {
    const wipeStmts = DEMO_WIPE_STATEMENTS.map((s) => env.DB.prepare(s))
    await env.DB.batch(wipeStmts)

    const seedLines = generateDemoSql()
    const seedStmts = seedLines
      .map((l) => l.trim().replace(/;$/, ''))
      .filter((l) => l.length > 0)
      .map((l) => env.DB.prepare(l))

    const CHUNK = 50
    for (let i = 0; i < seedStmts.length; i += CHUNK) {
      await env.DB.batch(seedStmts.slice(i, i + CHUNK))
    }
    console.log(`[demo] reset done in ${Date.now() - start}ms (${seedStmts.length} statements)`)
  } catch (err) {
    console.error('[demo] reset failed', err)
  }
}

// Nightly (10:00 UTC, the same calendar date across the Americas, so "today"
// is the athlete's today and today's sessions are never marked missed):
// 1. days of this week never opened get their template sessions,
// 2. stale planned sessions roll over to missed,
// 3. last week's open questions lapse, then each missed session gets one,
// 4. the reactive coach runs on the real state,
// 5. stored Idempotency-Key replies older than 7 days are pruned.
async function runNightlyReplan(env: Env): Promise<void> {
  const db = createDB(env)
  const todayEpochDay = isoToEpochDay(new Date().toISOString().split('T')[0])
  const nowSec = Math.floor(Date.now() / 1000)
  try {
    const backfilled = await backfillCurrentWeek(db, todayEpochDay, nowSec)
    const rolled = await rolloverStaleSessionIds(db, todayEpochDay)
    const expired = await expireAsks(db, nowSec)
    const asked = await createMissedAsks(db, todayEpochDay, nowSec)
    console.log(`[cron] backfilled=${backfilled} missed=${rolled.length} expired=${expired} asks=${asked}`)
  } catch (err) {
    console.warn('[cron] nightly rollover failed', err)
  }
  try {
    await runReactiveReplan(db, env.ANTHROPIC_API_KEY, {
      trigger: 'rollover',
      todayEpochDay,
    })
  } catch (err) {
    console.warn('[cron] nightly reactive replan failed', err)
  }
  try {
    await pruneIdempotencyKeys(db, nowSec)
  } catch (err) {
    console.warn('[cron] idempotency key prune failed', err)
  }
}

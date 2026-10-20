/**
 * Cloudflare Worker entry (Wrangler `main` in wrangler.jsonc).
 * React uses `main.tsx`; this file is bundled only by Wrangler.
 */
import app from './server/app'
import { createDB } from './db/client'
import { runReactiveReplan } from './lib/reactiveCoach'
import { rolloverStaleSessionIds } from './lib/sessionRollover'
import { backfillCurrentWeek } from './server/coachData'
import { fixMissed } from './server/changes'
import { pruneIdempotencyKeys } from './server/idempotency'
import { applyFeltHard, maybeRampUp } from './server/coachAsks'
import { runWeeklyPass } from './server/weeklyPass'
import { runLinkCheck } from './server/linkHealth'
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
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (env.DEMO_MODE === 'true') {
      ctx.waitUntil(runDemoReset(env))
      return
    }
    // scheduledTime: the cron's own time. Local test: wrangler dev --test-scheduled, then
    // /cdn-cgi/handler/scheduled?time=<ms> sets it. /__scheduled?time= ignores the time
    // (wrangler's middleware), so that path runs with the real clock (e2e tooling 27).
    ctx.waitUntil(runNightlyReplan(env, event.scheduledTime || Date.now()))
    // The Library's videos (page 60): the links not checked this week, about one a second.
    ctx.waitUntil(runLinkCheck(createDB(env), (url, init) => fetch(url, init), Math.floor((event.scheduledTime || Date.now()) / 1000))
      .catch(err => console.warn('[links] check failed', err)))
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
// 3. each missed session gets the coach's fix (never a question),
// 4. the reactive coach runs on the real state,
// 5. the weekly pass on the athlete's Sunday prepares next week (Monday
//    catches up a missed run; idempotent per block and week),
// 6. how sessions felt (effort, next-morning soreness) eases the next similar
//    one, and a fresh streak gets one push (at most once a week),
// 7. stored Idempotency-Key replies older than 7 days are pruned.
async function runNightlyReplan(env: Env, nowMs: number = Date.now()): Promise<void> {
  const db = createDB(env)
  const todayEpochDay = isoToEpochDay(new Date(nowMs).toISOString().split('T')[0])
  const nowSec = Math.floor(nowMs / 1000)
  await nightlyRollover(db, env, todayEpochDay, nowSec)
  // The pass first, so a felt-hard ease can land on next week's sessions.
  try {
    const pass = await runWeeklyPass(db, env.ANTHROPIC_API_KEY, todayEpochDay, nowSec)
    console.log(`[cron] weekly pass ran=${pass.ran} ${pass.key ?? ''} ${pass.reason ?? `source=${pass.source} applied=${pass.applied?.length ?? 0}`}`)
  } catch (err) {
    console.warn('[cron] weekly pass failed', err)
  }
  try {
    const eased = await applyFeltHard(db, todayEpochDay, nowSec)
    const ramp = await maybeRampUp(db, todayEpochDay, nowSec)
    console.log(`[cron] felt-hard eases=${eased} ramp-up=${ramp ? 'yes' : 'no'}`)
  } catch (err) {
    console.warn('[cron] session-feel rules failed', err)
  }
  try {
    await pruneIdempotencyKeys(db, nowSec)
  } catch (err) {
    console.warn('[cron] idempotency key prune failed', err)
  }
}

async function nightlyRollover(db: ReturnType<typeof createDB>, env: Env, todayEpochDay: number, nowSec: number): Promise<void> {
  try {
    const backfilled = await backfillCurrentWeek(db, todayEpochDay, nowSec)
    const rolled = await rolloverStaleSessionIds(db, todayEpochDay)
    const fixed = await fixMissed(db, todayEpochDay, nowSec)
    console.log(`[cron] backfilled=${backfilled} missed=${rolled.length} fixed=${fixed}`)
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
}

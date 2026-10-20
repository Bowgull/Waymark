/**
 * Cloudflare Worker entry (Wrangler `main` in wrangler.jsonc).
 * React uses `main.tsx`; this file is bundled only by Wrangler.
 */
import app from './server/app'
import { createDB } from './db/client'
import { runLinkCheck } from './server/linkHealth'
import { runNightlyReplan } from './server/nightly'
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

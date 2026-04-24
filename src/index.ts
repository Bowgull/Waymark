/**
 * Cloudflare Worker entry (Wrangler `main` in wrangler.jsonc).
 * React uses `main.tsx`; this file is bundled only by Wrangler.
 */
import app from './server/app'
import { createDB } from './db/client'
import { runReactiveReplan } from './lib/reactiveCoach'
import { processPendingFires } from './lib/pendingReactive'
import { isoToEpochDay } from './lib/dates'

interface Env {
  DB: D1Database
  ANTHROPIC_API_KEY: string
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  STRAVA_WEBHOOK_VERIFY_TOKEN: string
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightlyReplan(env))
  },
}

async function runNightlyReplan(env: Env): Promise<void> {
  const db = createDB(env)
  const todayEpochDay = isoToEpochDay(new Date().toISOString().split('T')[0])
  const nowSec = Math.floor(Date.now() / 1000)

  // Flush any pending-reactive fires whose grace window elapsed but the user
  // never opened the app for a read path to pick them up. Inline here — we
  // already have up to 30s of scheduled-worker budget.
  try {
    await processPendingFires(db, env.ANTHROPIC_API_KEY, nowSec, todayEpochDay, p => { void p })
  } catch (err) {
    console.warn('[cron] pending fires flush failed', err)
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

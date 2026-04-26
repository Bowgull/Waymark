/**
 * Cloudflare Worker entry (Wrangler `main` in wrangler.jsonc).
 * React uses `main.tsx`; this file is bundled only by Wrangler.
 */
import app from './server/app'
import { createDB } from './db/client'
import { runReactiveReplan } from './lib/reactiveCoach'
import { isoToEpochDay } from './lib/dates'
import { installDemoFetchGuard } from './lib/demoFetch'

interface Env {
  DB: D1Database
  ANTHROPIC_API_KEY: string
  STRAVA_CLIENT_ID: string
  STRAVA_CLIENT_SECRET: string
  STRAVA_WEBHOOK_VERIFY_TOKEN: string
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
      console.log('[demo] skipping nightly replan')
      return
    }
    ctx.waitUntil(runNightlyReplan(env))
  },
}

async function runNightlyReplan(env: Env): Promise<void> {
  const db = createDB(env)
  const todayEpochDay = isoToEpochDay(new Date().toISOString().split('T')[0])
  try {
    await runReactiveReplan(db, env.ANTHROPIC_API_KEY, {
      trigger: 'rollover',
      todayEpochDay,
    })
  } catch (err) {
    console.warn('[cron] nightly reactive replan failed', err)
  }
}

// The nightly job (cron, wrangler.jsonc). Lives here, not in src/index.ts, so
// the replay harness (src/server/replay) runs the exact same steps on a
// scratch database with its own clock.
import { createDB } from '../db/client'
import { runReactiveReplan } from '../lib/reactiveCoach'
import { rolloverStaleSessionIds } from '../lib/sessionRollover'
import { backfillCurrentWeek } from './coachData'
import { fixMissed } from './changes'
import { pruneIdempotencyKeys } from './idempotency'
import { applyFeltHard, maybeRampUp } from './coachAsks'
import { runWeeklyPass } from './weeklyPass'
import { isoToEpochDay } from '../lib/dates'
import { refreshAthleteModel } from './athleteModel'

export interface NightlyEnv {
  DB: D1Database
  ANTHROPIC_API_KEY: string
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
// 7. the athlete model (coach brain P1) is rebuilt from the active block's
//    events and stored in athlete_estimates: shadow only, nothing reads it to
//    decide a session or a dose yet,
// 8. stored Idempotency-Key replies older than 7 days are pruned.
export async function runNightlyReplan(env: NightlyEnv, nowMs: number = Date.now()): Promise<void> {
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
    const model = await refreshAthleteModel(db, todayEpochDay, nowSec)
    console.log(`[cron] athlete model: lifts=${Object.keys(model.lifts).length} run=${model.run.state} recovery=${model.recovery.state} when=${model.adherence.state}`)
  } catch (err) {
    console.warn('[cron] athlete model failed', err)
  }
  try {
    await pruneIdempotencyKeys(db, nowSec)
  } catch (err) {
    console.warn('[cron] idempotency key prune failed', err)
  }
}

async function nightlyRollover(db: ReturnType<typeof createDB>, env: NightlyEnv, todayEpochDay: number, nowSec: number): Promise<void> {
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

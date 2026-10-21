// The nightly job (cron, wrangler.jsonc). Lives here, not in src/index.ts, so
// the replay harness (src/server/replay) runs the exact same steps on a
// scratch database with its own clock.
import { createDB } from '../db/client'
import { rolloverStaleSessionIds } from '../lib/sessionRollover'
import { backfillCurrentWeek } from './coachData'
import { fixMissed } from './changes'
import { pruneIdempotencyKeys } from './idempotency'
import { runWeeklyPass } from './weeklyPass'
import { refreshAthleteModel } from './athleteModel'
import { lastActiveDay, runBrainNight } from './brain'
import { getActiveBlock } from './blockZeroData'
import { blockStartDay } from './coachData'
import { athleteTimeZone, localDayIn } from './timeZone'

export interface NightlyEnv {
  DB: D1Database
  ANTHROPIC_API_KEY: string
}

// Nightly (cron, about 2-3 AM in the athlete's zone): the coach brain's one
// re-plan of the day (coach-brain.md §5.1). Rules only in P2: no AI call.
// 1. Skipped (but for the model and housekeeping) when nothing was logged and
//    the app wasn't opened in the last 2 days: no narration through a lapse.
// 2. Days of this week never opened get their template sessions, stale planned
//    sessions roll over to missed, each missed session gets the coach's fix.
// 3. The weekly pass on Sunday/Monday: next week's sessions (one creation
//    path), its line, the TM step at a Fighter wave end, sessions made regular.
// 4. The brain's night (server/brain.ts): the week's outline (at most 2
//    changes, runes and UNDO), then every planned session's dose for 7 days.
// 5. The athlete model is stored in athlete_estimates; stale idempotency
//    replies are pruned.
export async function runNightlyReplan(env: NightlyEnv, nowMs: number = Date.now()): Promise<void> {
  const db = createDB(env)
  const todayEpochDay = localDayIn(Math.floor(nowMs / 1000), await athleteTimeZone(db))
  const nowSec = Math.floor(nowMs / 1000)
  const block = await getActiveBlock(db)
  const last = await lastActiveDay(db)
  const inactive = block != null && blockStartDay(block) < todayEpochDay - 2 && (last == null || last < todayEpochDay - 2)
  let used = 0
  if (!inactive) {
    try {
      const backfilled = await backfillCurrentWeek(db, todayEpochDay, nowSec)
      const rolled = await rolloverStaleSessionIds(db, todayEpochDay)
      const fixed = await fixMissed(db, todayEpochDay, nowSec)
      used += fixed
      console.log(`[cron] backfilled=${backfilled} missed=${rolled.length} fixed=${fixed}`)
    } catch (err) {
      console.warn('[cron] nightly rollover failed', err)
    }
    try {
      const pass = await runWeeklyPass(db, env.ANTHROPIC_API_KEY, todayEpochDay, nowSec)
      used += pass.applied?.length ?? 0
      console.log(`[cron] weekly pass ran=${pass.ran} ${pass.key ?? ''} ${pass.reason ?? `source=${pass.source} applied=${pass.applied?.length ?? 0}`}`)
    } catch (err) {
      console.warn('[cron] weekly pass failed', err)
    }
    try {
      const night = await runBrainNight(db, todayEpochDay, nowSec, { used })
      console.log(`[cron] brain ran=${night.ran} ${night.reason ?? ''} changes=${night.changes} doses=${night.doses}`)
    } catch (err) {
      console.warn('[cron] brain night failed', err)
    }
  } else {
    console.log('[cron] quiet: nothing logged and the app not opened in 2 days; no re-plan')
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

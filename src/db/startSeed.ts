/**
 * Start seed — fresh Block Zero scaffolding anchored to tomorrow.
 *
 * Seeds the minimum needed for the Today screen to render correctly on Day 1:
 *   - one active Block Zero training_block (started_at = tomorrow)
 *   - two week_plans (Week 1 and Week 2)
 *   - planned sessions for every training day from tomorrow onward
 *
 * Week 1 is partial when Day 1 is not a Monday. It runs from Day 1 through the
 * following Sunday. Week 2 is always the next full calendar week.
 *
 * No completed sessions, no historical logs, no journal entries. The coach
 * reshapes from here as real data comes in.
 *
 * Usage:
 *   npm run db:start:seed:generate   # writes src/db/startSeed.sql
 *   npm run db:demo:wipe:remote      # reuses existing wipe (keeps libraries)
 *   npm run db:start:seed:remote     # applies startSeed.sql
 */

import { writeFileSync } from 'fs'

// Day 1 = tomorrow in the local timezone. Match the local-date convention
// used everywhere else (getTodayISO / getEpochDay in src/lib/dates.ts).
const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
const y = tomorrow.getFullYear()
const m = String(tomorrow.getMonth() + 1).padStart(2, '0')
const d = String(tomorrow.getDate()).padStart(2, '0')
const day1EpochDay = Math.floor(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000 / 86400)
const day1Sec = day1EpochDay * 86400

// 0=Sun..6=Sat -> Mon=0..Sun=6
const day1DowFromMon = (tomorrow.getDay() + 6) % 7
const w1MondayEpochDay = day1EpochDay - day1DowFromMon
const w2MondayEpochDay = w1MondayEpochDay + 7

const lines: string[] = []

const blockId = 'block-zero-start'
lines.push(
  `INSERT INTO training_blocks (id, name, block_type, total_weeks, started_at, ended_at, status, created_at) VALUES ('${blockId}', 'Block Zero', 'block_zero', 6, ${day1Sec}, NULL, 'active', ${day1Sec});`,
)

const w1Id = 'wp-start-w1'
const w2Id = 'wp-start-w2'
lines.push(
  `INSERT INTO week_plans (id, block_id, week_number, status, approved_at, auto_generated, notes, analysis_json, created_at) VALUES ('${w1Id}', '${blockId}', 1, 'approved', ${w1MondayEpochDay * 86400}, 1, NULL, NULL, ${day1Sec});`,
)
lines.push(
  `INSERT INTO week_plans (id, block_id, week_number, status, approved_at, auto_generated, notes, analysis_json, created_at) VALUES ('${w2Id}', '${blockId}', 2, 'approved', ${w2MondayEpochDay * 86400}, 1, NULL, NULL, ${day1Sec});`,
)

// Mon=0..Sun=6
const WEEK_TEMPLATE: Array<{ dowFromMon: number; type: string; timeSlot: 'am' | 'pm'; hour: number }> = [
  { dowFromMon: 0, type: 'strength',        timeSlot: 'pm', hour: 18 },
  { dowFromMon: 1, type: 'mt_class',        timeSlot: 'pm', hour: 19 },
  { dowFromMon: 2, type: 'foundation_run',  timeSlot: 'am', hour: 7 },
  { dowFromMon: 3, type: 'strength',        timeSlot: 'pm', hour: 18 },
  { dowFromMon: 4, type: 'mt_class',        timeSlot: 'pm', hour: 19 },
  { dowFromMon: 5, type: 'bag_work',        timeSlot: 'am', hour: 10 },
  { dowFromMon: 6, type: 'active_recovery', timeSlot: 'am', hour: 9 },
]

function pushSession(sid: string, type: string, wpId: string, scheduledEd: number, timeSlot: 'am' | 'pm', weekNum: number): void {
  const createdAt = scheduledEd * 86400 + 6 * 3600
  lines.push(
    `INSERT INTO sessions (id, type, week_plan_id, scheduled_date, time_slot, status, started_at, completed_at, duration_sec, rpe, difficulty, block_week, block_type, notes, review, review_flag, adjustment_id, created_at) VALUES ('${sid}', '${type}', '${wpId}', ${scheduledEd}, '${timeSlot}', 'planned', NULL, NULL, NULL, NULL, NULL, ${weekNum}, 'block_zero', NULL, NULL, NULL, NULL, ${createdAt});`,
  )
}

const weeks = [
  { num: 1, wpId: w1Id, mondayEd: w1MondayEpochDay, startEd: day1EpochDay },
  { num: 2, wpId: w2Id, mondayEd: w2MondayEpochDay, startEd: w2MondayEpochDay },
]

let sessionCount = 0

for (const wk of weeks) {
  for (const tpl of WEEK_TEMPLATE) {
    const scheduledEd = wk.mondayEd + tpl.dowFromMon
    if (scheduledEd < wk.startEd) continue
    pushSession(
      `sess-start-w${wk.num}-${tpl.dowFromMon}-${tpl.type}`,
      tpl.type,
      wk.wpId,
      scheduledEd,
      tpl.timeSlot,
      wk.num,
    )
    sessionCount++
  }
  for (let offset = 0; offset < 7; offset++) {
    const scheduledEd = wk.mondayEd + offset
    if (scheduledEd < wk.startEd) continue
    pushSession(
      `sess-start-w${wk.num}-d${offset}-mobility`,
      'mobility',
      wk.wpId,
      scheduledEd,
      'am',
      wk.num,
    )
    sessionCount++
  }
}

const sql = lines.join('\n') + '\n'
writeFileSync('src/db/startSeed.sql', sql)
console.log(`Wrote ${lines.length} statements to src/db/startSeed.sql`)
console.log(`  Day 1 = ${y}-${m}-${d} (epoch day ${day1EpochDay})`)
console.log(`  Week 1 Monday epoch day: ${w1MondayEpochDay} ${day1DowFromMon === 0 ? '(full)' : `(partial, ${7 - day1DowFromMon} days)`}`)
console.log(`  Week 2 Monday epoch day: ${w2MondayEpochDay} (full)`)
console.log(`  Sessions seeded: ${sessionCount}`)

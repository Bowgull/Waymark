/**
 * Demo seed — fills D1 with 4 weeks of Block Zero training data for recording
 * a walkthrough video. Story arcs:
 *   - Week 1: easing in; weekend weed + light alcohol
 *   - Week 2: heavy Friday bender (alcohol scale 4) → dialed-back Saturday
 *   - Week 3: clean week (no weed, no alcohol) with PRs on all main lifts
 *   - Week 4: momentum continues; today's session is planned, not completed
 *
 * Dates shift relative to "now" so re-generating always produces a fresh
 * "currently in week 4 of Block Zero" state.
 *
 * Usage:
 *   npm run db:demo:seed:generate   # writes src/db/demoSeed.sql
 *   npm run db:demo:wipe:remote     # clears user data (preserves libraries)
 *   npm run db:demo:seed:remote     # applies demoSeed.sql to remote D1
 */

export function generateDemoSql(): string[] {
const nowSec = Math.floor(Date.now() / 1000)

// Use LOCAL date (matches getTodayISO / getEpochDay in src/lib/dates.ts) so
// today's sessions align with what the user sees. UTC-based math marks today
// as completed when the seed runs past local midnight in negative-offset zones.
const localNow = new Date()
const y = localNow.getFullYear()
const m = String(localNow.getMonth() + 1).padStart(2, '0')
const d = String(localNow.getDate()).padStart(2, '0')
const todayEpochDay = Math.floor(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime() / 1000 / 86400)

const todayDate = localNow
const localDow = todayDate.getDay() // 0=Sun..6=Sat
const dowFromMon = (localDow + 6) % 7 // Mon=0..Sun=6
const thisMonday = todayEpochDay - dowFromMon
const blockStartDay = thisMonday - 21 // 3 Mondays ago → currently in week 4
const blockStartSec = blockStartDay * 86400
const todayDayIdx = todayEpochDay - blockStartDay // day index in the 28-day window (0..27)

function esc(s: string): string {
  return s.replace(/'/g, "''")
}

// Pseudo-epoch-seconds for a given session day + time-of-day hour
function dayHour(dayIdx: number, hour: number): number {
  return (blockStartDay + dayIdx) * 86400 + hour * 3600
}

const lines: string[] = []

// ─── user_profile (so Today skips onboarding) ────────────────
lines.push(
  `INSERT OR REPLACE INTO user_profile (id, goals, injuries, posture_issues, training_history, mt_gym_access_days, mt_cap_per_week, weekly_day_target, constraints, max_hr, dob, onboarded_at, created_at, updated_at) VALUES ('default', '${esc(JSON.stringify(['muay_thai_conditioning', 'posture_recovery', 'strength_baseline']))}', '${esc(JSON.stringify(['lower_back_sensitivity']))}', '${esc(JSON.stringify(['ucs_upper', 'apt_lower']))}', 'Returning after a break; has trained Muay Thai recreationally for 2 years.', '1,3,5', 3, 5, NULL, 188, '1995-07-15', ${blockStartSec}, ${blockStartSec}, ${nowSec});`
)

// ─── training_block ──────────────────────────────────────────
const blockId = 'demo-block-zero'
lines.push(
  `INSERT INTO training_blocks (id, name, block_type, total_weeks, started_at, ended_at, status, created_at) VALUES ('${blockId}', 'Block Zero', 'block_zero', 6, ${blockStartSec}, NULL, 'active', ${blockStartSec});`
)

// ─── week_plans (weeks 1-4; current week still draft-ish but we mark approved) ──
for (let w = 1; w <= 4; w++) {
  const wpId = `demo-wp-w${w}`
  const approvedAt = blockStartSec + (w - 1) * 7 * 86400
  lines.push(
    `INSERT INTO week_plans (id, block_id, week_number, status, approved_at, auto_generated, notes, analysis_json, created_at) VALUES ('${wpId}', '${blockId}', ${w}, 'approved', ${approvedAt}, 1, NULL, NULL, ${approvedAt});`
  )
}

// ─── Weekly session template ─────────────────────────────────
// Week layout (Mon=0..Sun=6):
//  Mon: strength upper     Tue: mt_class      Wed: foundation_run
//  Thu: strength lower     Fri: mt_class      Sat: bag_work (solo)
//  Sun: active_recovery

interface SessionPlan {
  dayIdx: number          // 0..27
  type: string
  timeSlot: 'am' | 'pm'
  hour: number            // 24h for completedAt
  weekNumber: number      // 1..4
  scheduled: boolean      // true always; we create planned-only rows for future
  completed: boolean      // false = leave as "planned"
  rpe?: number
  durationSec?: number
  payload?: Record<string, unknown>
}

const sessions: SessionPlan[] = []

const WEEK_TEMPLATE: Array<{ dow: number; type: string; timeSlot: 'am' | 'pm'; hour: number; baseDur: number }> = [
  { dow: 0, type: 'strength',         timeSlot: 'pm', hour: 18, baseDur: 55 * 60 }, // Mon
  { dow: 1, type: 'mt_class',         timeSlot: 'pm', hour: 19, baseDur: 75 * 60 }, // Tue
  { dow: 2, type: 'foundation_run',   timeSlot: 'am', hour: 7,  baseDur: 28 * 60 }, // Wed
  { dow: 3, type: 'strength',         timeSlot: 'pm', hour: 18, baseDur: 60 * 60 }, // Thu
  { dow: 4, type: 'mt_class',         timeSlot: 'pm', hour: 19, baseDur: 75 * 60 }, // Fri
  { dow: 5, type: 'bag_work',         timeSlot: 'am', hour: 10, baseDur: 30 * 60 }, // Sat
  { dow: 6, type: 'active_recovery',  timeSlot: 'am', hour: 9,  baseDur: 25 * 60 }, // Sun
]

for (let w = 1; w <= 4; w++) {
  for (const tpl of WEEK_TEMPLATE) {
    const dayIdx = (w - 1) * 7 + tpl.dow
    const isFuture = dayIdx > todayDayIdx
    const isToday = dayIdx === todayDayIdx

    // Today's Saturday bag_work → leave planned (hero demo session)
    // Any future days inside week 4 also planned
    const completed = !isFuture && !isToday

    let rpe: number | undefined

    // Duration scales up week-over-week, matching the volume progression story.
    // Week 1: 85% (easing back in), Week 2: 95% (building), Week 3: 110% (PR week, longer sessions),
    // Week 4: 105% (maintaining peak). Mobility stays fixed at 10 min regardless.
    const durScale = tpl.type === 'mobility' ? 1 : [0.85, 0.95, 1.1, 1.05][w - 1]
    const durationSec = Math.round(tpl.baseDur * durScale)

    if (completed) {
      // RPE story per week
      if (w === 1) rpe = 6 + (tpl.type === 'strength' ? 1 : 0) // 6-7
      if (w === 2) rpe = 7 + (tpl.type === 'strength' ? 1 : 0) // 7-8
      if (w === 3) rpe = 6 + (tpl.type === 'strength' ? 1 : 0) // clean week, better recovery → lower RPE
      if (w === 4) rpe = 6 + (tpl.type === 'strength' ? 1 : 0)
    }

    // SKIP SCENARIO: week 2 Saturday (day idx 12) — dialed back after Friday bender
    if (dayIdx === 12) {
      sessions.push({
        dayIdx, type: tpl.type, timeSlot: tpl.timeSlot, hour: tpl.hour,
        weekNumber: w, scheduled: true, completed: false,
        payload: { skipped: true },
      })
      continue
    }

    sessions.push({
      dayIdx,
      type: tpl.type,
      timeSlot: tpl.timeSlot,
      hour: tpl.hour,
      weekNumber: w,
      scheduled: true,
      completed,
      rpe,
      durationSec,
    })
  }
}

// Mark week 2 Friday (day idx 11) as completed but with higher RPE (showing accumulating fatigue)
const w2fri = sessions.find(s => s.dayIdx === 11)
if (w2fri) { w2fri.rpe = 8; w2fri.durationSec = 60 * 60 }

// ─── Daily mobility (every AM, 7 days/week across all 4 weeks) ──
// Low-effort, high-consistency habit from the new Block Zero template.
// Past days: completed. Today + future: planned so the walkthrough is reachable.
for (let d = 0; d < 28; d++) {
  const isFutureOrToday = d >= todayDayIdx
  const weekNumber = Math.floor(d / 7) + 1
  sessions.push({
    dayIdx: d,
    type: 'mobility',
    timeSlot: 'am',
    hour: 6,
    weekNumber,
    scheduled: true,
    completed: !isFutureOrToday,
    rpe: !isFutureOrToday ? 3 : undefined,
    durationSec: 10 * 60,
  })
}

// ─── Exercise data (matching existing seed IDs) ──────────────
// Progression target: PRs land in week 3.
const STRENGTH_MAIN_UPPER: Array<{ exerciseId: string; weekKg: [number, number, number, number]; reps: number; sets: number }> = [
  { exerciseId: 'ex-bench-press',    weekKg: [32.5, 37.5, 45.0, 45.0], reps: 5, sets: 4 }, // PR 45kg wk3
  { exerciseId: 'ex-bent-over-row',  weekKg: [35.0, 40.0, 45.0, 45.0], reps: 5, sets: 4 },
  { exerciseId: 'ex-ohp',            weekKg: [22.5, 25.0, 29.5, 29.5], reps: 5, sets: 3 },
  { exerciseId: 'ex-ez-curl',        weekKg: [17.5, 20.0, 22.5, 22.5], reps: 10, sets: 3 },
]
const STRENGTH_MAIN_LOWER: Array<{ exerciseId: string; weekKg: [number, number, number, number]; reps: number; sets: number }> = [
  { exerciseId: 'ex-front-squat',    weekKg: [32.5, 37.5, 42.5, 42.5], reps: 5, sets: 4 }, // PR 42.5kg wk3
  { exerciseId: 'ex-rdl',            weekKg: [45.0, 52.5, 60.0, 60.0], reps: 5, sets: 3 }, // PR 60kg wk3
  { exerciseId: 'ex-bulgarian-split-squat', weekKg: [12.5, 15.0, 17.5, 17.5], reps: 8, sets: 3 },
  { exerciseId: 'ex-hanging-leg-raise', weekKg: [0, 0, 0, 0], reps: 8, sets: 3 },
]

// Combo IDs (must match seed.ts). Foundation unlocked, rest locked.
const FOUNDATION_COMBOS = ['combo-f01', 'combo-f02', 'combo-f03', 'combo-f04', 'combo-f05', 'combo-f06']

// ─── Emit session rows + their related child tables ──────────
let sseCount = 0
let setCount = 0
let bwrCount = 0
let bwrcCount = 0

for (const s of sessions) {
  const sid = `demo-sess-d${s.dayIdx}-${s.type}`
  const scheduledDay = blockStartDay + s.dayIdx
  const wpId = `demo-wp-w${s.weekNumber}`
  const createdAt = dayHour(s.dayIdx, 6) // created morning of the day
  const completedAt = s.completed ? dayHour(s.dayIdx, s.hour + 1) : null
  const startedAt = s.completed ? dayHour(s.dayIdx, s.hour) : null
  const status = s.completed ? 'completed' : (s.payload?.skipped ? 'skipped' : 'planned')
  const rpeVal = s.rpe != null ? s.rpe : 'NULL'
  const durVal = s.completed && s.durationSec ? s.durationSec : 'NULL'
  const startVal = startedAt ?? 'NULL'
  const endVal = completedAt ?? 'NULL'

  lines.push(
    `INSERT INTO sessions (id, type, week_plan_id, scheduled_date, time_slot, status, started_at, completed_at, duration_sec, rpe, difficulty, block_week, block_type, notes, review, review_flag, adjustment_id, created_at) VALUES ('${sid}', '${s.type}', '${wpId}', ${scheduledDay}, '${s.timeSlot}', '${status}', ${startVal}, ${endVal}, ${durVal}, ${rpeVal}, NULL, ${s.weekNumber}, 'block_zero', NULL, NULL, NULL, NULL, ${createdAt});`
  )

  if (!s.completed) continue

  // ── Emit type-specific children ──
  if (s.type === 'strength') {
    const isUpper = s.dayIdx % 7 === 0 // Monday
    const exList = isUpper ? STRENGTH_MAIN_UPPER : STRENGTH_MAIN_LOWER
    exList.forEach((ex, i) => {
      const sseId = `demo-sse-${++sseCount}`
      lines.push(
        `INSERT INTO strength_session_exercises (id, session_id, exercise_id, order_index, section, notes) VALUES ('${sseId}', '${sid}', '${ex.exerciseId}', ${i + 1}, '${i < 2 ? 'main' : 'accessory'}', NULL);`
      )
      // Warmup set (lighter)
      const wkIdx = Math.min(s.weekNumber - 1, 3) as 0 | 1 | 2 | 3
      const workKg = ex.weekKg[wkIdx]
      if (workKg > 0) {
        const warmKg = Math.max(workKg * 0.5, 20)
        lines.push(
          `INSERT INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES ('demo-set-${++setCount}', '${sseId}', 1, ${warmKg}, 5, 1, 90, ${createdAt});`
        )
      }
      for (let n = 1; n <= ex.sets; n++) {
        const weight = workKg > 0 ? workKg : null
        const weightVal = weight != null ? weight : 'NULL'
        lines.push(
          `INSERT INTO strength_sets (id, session_exercise_id, set_number, weight_kg, reps, is_warmup, rest_sec, created_at) VALUES ('demo-set-${++setCount}', '${sseId}', ${n + (workKg > 0 ? 1 : 0)}, ${weightVal}, ${ex.reps}, 0, 120, ${createdAt});`
        )
      }
    })
  } else if (s.type === 'mt_class') {
    // 5 rounds, combos from foundation
    for (let r = 1; r <= 5; r++) {
      const bwrId = `demo-bwr-${++bwrCount}`
      const rationale = [
        'Start light: fundamentals only — focus on jab-cross mechanics.',
        'Add lead hook. Return guard between strikes.',
        'Body shots: drop level with the knees, not the waist.',
        'Switch kick rhythm: land on the balls of your feet.',
        'Free round: mix what felt sharp this session.',
      ][r - 1]
      lines.push(
        `INSERT INTO bag_work_rounds (id, session_id, round_number, duration_sec, rest_sec, round_type, coach_rationale, created_at) VALUES ('${bwrId}', '${sid}', ${r}, 180, 60, 'combo_practice', '${esc(rationale)}', ${createdAt});`
      )
      // 2 combos per round
      const picks = r === 1 ? ['combo-f01', 'combo-f02']
                  : r === 2 ? ['combo-f02', 'combo-f06']
                  : r === 3 ? ['combo-f05', 'combo-f04']
                  : r === 4 ? ['combo-f03', 'combo-f04']
                  :           ['combo-f06', 'combo-f02']
      picks.forEach((cid, i) => {
        lines.push(
          `INSERT INTO bag_work_round_combos (id, round_id, combo_id, order_index) VALUES ('demo-bwrc-${++bwrcCount}', '${bwrId}', '${cid}', ${i + 1});`
        )
      })
    }
    // mt_class_logs row
    lines.push(
      `INSERT INTO mt_class_logs (id, session_id, class_type, focus_skill, weakness, concept, action_items) VALUES ('demo-mtlog-${s.dayIdx}', '${sid}', 'technique', 'jab-cross timing', 'dropping rear hand', 'keep guard after cross', 'reset between combos');`
    )
  } else if (s.type === 'bag_work') {
    // Solo bag work, 4 rounds, fewer combos
    for (let r = 1; r <= 4; r++) {
      const bwrId = `demo-bwr-${++bwrCount}`
      lines.push(
        `INSERT INTO bag_work_rounds (id, session_id, round_number, duration_sec, rest_sec, round_type, coach_rationale, created_at) VALUES ('${bwrId}', '${sid}', ${r}, 180, 60, 'combo_practice', 'Solo bag: stay sharp on fundamentals.', ${createdAt});`
      )
      const picks = FOUNDATION_COMBOS.slice((r - 1) * 1, (r - 1) * 1 + 2)
      picks.forEach((cid, i) => {
        lines.push(
          `INSERT INTO bag_work_round_combos (id, round_id, combo_id, order_index) VALUES ('demo-bwrc-${++bwrcCount}', '${bwrId}', '${cid}', ${i + 1});`
        )
      })
    }
  } else if (s.type === 'foundation_run' || s.type === 'running') {
    // Progression in pace over weeks (s per km, lower = faster)
    const paceByWeek = [390, 375, 345, 348] // ~6:30 → ~5:48, week 3 peaks
    const paceSecKm = paceByWeek[s.weekNumber - 1]
    const distanceKm = s.weekNumber === 3 ? 5.2
                     : s.weekNumber === 4 ? 4.3
                     : 3.6 + s.weekNumber * 0.3
    const dur = Math.round(distanceKm * paceSecKm)
    const avgHr = 148 + (s.weekNumber - 1) * 2
    lines.push(
      `INSERT INTO run_sessions (id, session_id, plan_week, run_type, distance_km, duration_sec, pace_sec_km, is_indoor, one_pace_arc, one_pace_ep, avg_hr, max_hr, zone_seconds, elevation_gain_m, source, strava_activity_id, attachment_status) VALUES ('demo-run-${s.dayIdx}', '${sid}', ${s.weekNumber}, 'foundation_run', ${distanceKm.toFixed(2)}, ${dur}, ${paceSecKm}, 0, NULL, NULL, ${avgHr}, ${avgHr + 18}, NULL, ${Math.round(distanceKm * 8)}, 'strava', NULL, 'confirmed');`
    )
  } else if (s.type === 'active_recovery') {
    lines.push(
      `INSERT INTO active_recovery_sessions (id, session_id, hip_mobility, foam_rolling) VALUES ('demo-rec-${s.dayIdx}', '${sid}', 1, 1);`
    )
  }
}

// ─── Daily logs (wellness) — the vice-correlation story ──────
// Sleep baseline 7.5h, drops after weed/alcohol nights.
// Week 1 (days 0-6): 2 weed nights Fri/Sat, small alcohol Sat
// Week 2 (days 7-13): heavy bender Fri (day 11) — high alcohol + weed. Sat (12) rough.
// Week 3 (days 14-20): CLEAN — no weed, no alcohol
// Week 4 (days 21-26): 1 light weed Fri. Today (26) no log yet.

interface DailyLog {
  dayIdx: number
  sleepHours: number | null
  weedGrams: number | null
  alcoholScale: number | null
  soreness: number | null
  notes: string | null
}

const DAILY_LOGS: DailyLog[] = [
  // Week 1
  { dayIdx: 0,  sleepHours: 7.5, weedGrams: null, alcoholScale: null, soreness: 4, notes: 'Block Zero start. Back feels tight.' },
  { dayIdx: 1,  sleepHours: 7.8, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 2,  sleepHours: 7.2, weedGrams: null, alcoholScale: null, soreness: 3, notes: 'Easy run felt good.' },
  { dayIdx: 3,  sleepHours: 7.5, weedGrams: null, alcoholScale: null, soreness: 5, notes: 'Legs sore from squats.' },
  { dayIdx: 4,  sleepHours: 6.5, weedGrams: 0.3, alcoholScale: 1,    soreness: 4, notes: null }, // weed + light drink fri
  { dayIdx: 5,  sleepHours: 6.8, weedGrams: 0.4, alcoholScale: 2,    soreness: 4, notes: 'Social night.' }, // both sat
  { dayIdx: 6,  sleepHours: 7.2, weedGrams: 0.2, alcoholScale: 1,    soreness: 3, notes: 'Carryover from Sat.' },

  // Week 2
  { dayIdx: 7,  sleepHours: 7.6, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 8,  sleepHours: 7.4, weedGrams: null, alcoholScale: null, soreness: 4, notes: null },
  { dayIdx: 9,  sleepHours: 7.0, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 10, sleepHours: 7.0, weedGrams: 0.2, alcoholScale: null, soreness: 5, notes: null }, // thurs light smoke
  { dayIdx: 11, sleepHours: 5.2, weedGrams: 0.6, alcoholScale: 4,    soreness: 4, notes: 'Went too hard last night.' }, // BENDER fri
  { dayIdx: 12, sleepHours: 6.0, weedGrams: null, alcoholScale: 1,    soreness: 7, notes: 'Hung over. Skipped bag work.' }, // sat
  { dayIdx: 13, sleepHours: 9.1, weedGrams: null, alcoholScale: null, soreness: 5, notes: null },

  // Week 3 — CLEAN WEEK
  { dayIdx: 14, sleepHours: 7.8, weedGrams: null, alcoholScale: null, soreness: 3, notes: 'Locked in this week.' },
  { dayIdx: 15, sleepHours: 8.0, weedGrams: null, alcoholScale: null, soreness: 2, notes: null },
  { dayIdx: 16, sleepHours: 7.9, weedGrams: null, alcoholScale: null, soreness: 2, notes: null },
  { dayIdx: 17, sleepHours: 8.1, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 18, sleepHours: 7.8, weedGrams: null, alcoholScale: null, soreness: 2, notes: 'PR on front squat 42.5kg.' },
  { dayIdx: 19, sleepHours: 8.2, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 20, sleepHours: 8.4, weedGrams: null, alcoholScale: null, soreness: 2, notes: 'Best run pace yet.' },

  // Week 4
  { dayIdx: 21, sleepHours: 7.9, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 22, sleepHours: 7.5, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 23, sleepHours: 7.7, weedGrams: null, alcoholScale: null, soreness: 4, notes: null },
  { dayIdx: 24, sleepHours: 7.4, weedGrams: null, alcoholScale: null, soreness: 3, notes: null },
  { dayIdx: 25, sleepHours: 6.8, weedGrams: 0.2, alcoholScale: 1,    soreness: 3, notes: 'Small smoke + one beer, early bed.' },
  // day 26 = today, no log yet
]

for (const log of DAILY_LOGS) {
  const logEpochDay = blockStartDay + log.dayIdx
  const createdAt = dayHour(log.dayIdx, 22) // logged evening
  const sleep = log.sleepHours ?? 'NULL'
  const weed = log.weedGrams ?? 'NULL'
  const alcohol = log.alcoholScale ?? 'NULL'
  const sore = log.soreness ?? 'NULL'
  const notes = log.notes ? `'${esc(log.notes)}'` : 'NULL'
  lines.push(
    `INSERT INTO daily_logs (id, log_date, sleep_hours, weed_grams, alcohol_scale, soreness, notes, created_at) VALUES ('demo-log-${log.dayIdx}', ${logEpochDay}, ${sleep}, ${weed}, ${alcohol}, ${sore}, ${notes}, ${createdAt});`
  )
}

// ─── Weekly journals ─────────────────────────────────────────
const JOURNALS = [
  { week: 1, reflection: 'First week back. Body remembers but the engine needs rebuilding. Stay patient.' },
  { week: 2, reflection: 'Pushed too hard Friday night and paid for it Saturday. Note: one bad night undoes four good ones.' },
  { week: 3, reflection: 'Clean week. No booze, no smoke. Squat PR, bench PR, best run pace. The pattern is obvious now.' },
]
for (const j of JOURNALS) {
  const weekStartDay = blockStartDay + (j.week - 1) * 7
  const createdAt = (weekStartDay + 6) * 86400 + 22 * 3600
  lines.push(
    `INSERT INTO weekly_journals (id, week_start, reflection, prompt, created_at) VALUES ('demo-wj-${j.week}', ${weekStartDay}, '${esc(j.reflection)}', 'What did you learn this week?', ${createdAt});`
  )
}

// ─── Body metrics (one-off weight check from week 3) ─────────
const bmDay = blockStartDay + 17
lines.push(
  `INSERT INTO body_metrics (id, logged_at, weight_kg, resting_hr, bodyfat_pct, notes, created_at) VALUES ('demo-bm-1', ${bmDay * 86400 + 7 * 3600}, 78.5, 58, NULL, 'Morning check.', ${bmDay * 86400 + 7 * 3600});`
)

// ─── Settings update: last deploy timestamp for "new build" badge ──
lines.push(
  `UPDATE settings SET last_deploy = ${nowSec - 3600}, updated_at = ${nowSec} WHERE id = 'default';`
)

// ─── Today's planned bag work gets its prescribed rounds ─────
// (The hero session for the demo — walks the viewer through a ready prescription.)
const todaySid = `demo-sess-d${todayDayIdx}-bag_work`
const todayCreatedAt = dayHour(todayDayIdx, 6)

// Only add if today is Saturday (bag_work day). Otherwise skip.
if (todayDayIdx % 7 === 5) {
  // Already inserted as planned above; add pre-prescribed rounds
  for (let r = 1; r <= 4; r++) {
    const bwrId = `demo-bwr-today-${r}`
    const rationale = [
      'Open light: jab-cross mechanics only. Reset between reps.',
      'Add the lead hook. Guard returns between every strike.',
      'Body-cross level change. Knees bend, spine stays tall.',
      'Free round: run what felt sharp. Don\'t add what you haven\'t drilled.',
    ][r - 1]
    lines.push(
      `INSERT INTO bag_work_rounds (id, session_id, round_number, duration_sec, rest_sec, round_type, coach_rationale, created_at) VALUES ('${bwrId}', '${todaySid}', ${r}, 180, 60, 'combo_practice', '${esc(rationale)}', ${todayCreatedAt});`
    )
    const picks = r === 1 ? ['combo-f01', 'combo-f02']
                : r === 2 ? ['combo-f02', 'combo-f06']
                : r === 3 ? ['combo-f05', 'combo-f04']
                :           ['combo-f03', 'combo-f06']
    picks.forEach((cid, i) => {
      lines.push(
        `INSERT INTO bag_work_round_combos (id, round_id, combo_id, order_index) VALUES ('demo-bwrc-today-${r}-${i}', '${bwrId}', '${cid}', ${i + 1});`
      )
    })
  }
}

// ─── Mark a couple combos as favourites + light mastery ──────
lines.push(`UPDATE combos SET is_favourite = 1, mastery_score = 3, times_sharp = 4 WHERE id = 'combo-f02';`)
lines.push(`UPDATE combos SET is_favourite = 1, mastery_score = 2, times_sharp = 3 WHERE id = 'combo-f06';`)
lines.push(`UPDATE combos SET mastery_score = 2, times_sharp = 2 WHERE id = 'combo-f01';`)

  return lines
}

export const DEMO_WIPE_STATEMENTS: string[] = [
  'PRAGMA defer_foreign_keys = ON',
  'DELETE FROM strength_sets',
  'DELETE FROM combo_performance',
  'DELETE FROM bag_work_round_combos',
  'DELETE FROM bag_work_rounds',
  'DELETE FROM strength_session_exercises',
  'DELETE FROM run_splits',
  'DELETE FROM run_sessions',
  'DELETE FROM posture_session_exercises',
  'DELETE FROM skip_rope_sessions',
  'DELETE FROM active_recovery_sessions',
  'DELETE FROM mt_class_logs',
  'DELETE FROM coaching_outputs',
  'DELETE FROM week_adjustments',
  'DELETE FROM sessions',
  'DELETE FROM running_plan_weeks',
  'DELETE FROM week_plans',
  'DELETE FROM training_blocks',
  'DELETE FROM daily_logs',
  'DELETE FROM weekly_journals',
  'DELETE FROM journal_entries',
  'DELETE FROM body_metrics',
  'UPDATE combos SET is_favourite = 0, mastery_score = 0, times_sharp = 0',
]

const proc = (globalThis as { process?: { argv?: string[] } }).process
const isMainModule = (() => {
  try {
    const argv1 = proc?.argv?.[1]
    if (!argv1) return false
    const url = new URL(import.meta.url)
    return url.pathname === argv1 || url.pathname.endsWith(argv1.replace(/^.*\//, ''))
  } catch {
    return false
  }
})()

if (isMainModule) {
  void (async () => {
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { writeFileSync: (p: string, d: string) => void }
    const lines = generateDemoSql()
    const sql = lines.join('\n') + '\n'
    fs.writeFileSync('src/db/demoSeed.sql', sql)
    console.log(`Wrote ${lines.length} statements to src/db/demoSeed.sql`)
  })()
}

// Block Zero run-walk progression and the two run-volume guards.
//
// R7 (Frandsen 2025): no single run longer than 110% of the longest run in
//   the last 30 days. Spikes past that carried 1.5-2.3x the overuse risk.
// R8 (Buist 2008; Nielsen 2014): avoid weekly run-time jumps over ~30%.
//   The "10% rule" is a convention, not a proven threshold.
// R9 (Foster 2008; Tanaka 2001): easy work sits under the talk-test ceiling,
//   or ~60-70% HRmax with HRmax = 208 - 0.7 x age when nothing is measured.
//
// Guards work on session duration (run + walk + warm-up walk), which is what
// run_sessions records. Pure: callers pass history in.

import { blockZeroTrainingWeek } from './weeks'

export interface RunWalkWeek {
  week: number
  runSec: number
  walkSec: number
  rounds: number
  warmupSec: number
}

/**
 * Per-session run-walk for weeks 1-6. Each step grows total time by under 10%
 * so the plan itself never trips R7. Week 6 consolidates (-33%, R16).
 * Run fraction climbs from 1/3 to 4/5 of the interval.
 */
export const RUN_WALK_WEEKS: readonly RunWalkWeek[] = [
  { week: 1, runSec: 60, walkSec: 120, rounds: 6, warmupSec: 300 },  // 23 min
  { week: 2, runSec: 90, walkSec: 75, rounds: 7, warmupSec: 300 },   // ~24 min
  { week: 3, runSec: 120, walkSec: 60, rounds: 7, warmupSec: 300 },  // 26 min
  { week: 4, runSec: 210, walkSec: 60, rounds: 5, warmupSec: 300 },  // 27.5 min
  { week: 5, runSec: 240, walkSec: 60, rounds: 5, warmupSec: 300 },  // 30 min
  { week: 6, runSec: 240, walkSec: 60, rounds: 3, warmupSec: 300 },  // 20 min
]

export const RUN_SESSIONS_PER_WEEK = 3
export const SINGLE_RUN_CAP_RATIO = 1.10
export const WEEKLY_RUN_CAP_RATIO = 1.30
export const RUN_HISTORY_WINDOW_DAYS = 30

export function runWalkTotalSec(w: Pick<RunWalkWeek, 'runSec' | 'walkSec' | 'rounds' | 'warmupSec'>): number {
  return w.warmupSec + w.rounds * (w.runSec + w.walkSec)
}

/** Run-walk shape for a Block Zero week. Extension weeks repeat week 5. */
export function getRunWalkWeek(week: number): RunWalkWeek {
  const w = blockZeroTrainingWeek(week)
  return RUN_WALK_WEEKS[w - 1]
}

/** After 30+ days with no runs, restart at the week-1 session. */
export const RESTART_SESSION_SEC = runWalkTotalSec(RUN_WALK_WEEKS[0])
/** After a week with no runs, the weekly allowance restarts at week-1 volume. */
export const RESTART_WEEKLY_SEC = RESTART_SESSION_SEC * RUN_SESSIONS_PER_WEEK

/**
 * R8 weekly allowance: 130% of last week's run time, never below week-1
 * volume. Week-1 run-walk is the plan's own restart level, so a short week
 * (a lead-in run, one run-walk done) never shrinks the next full week (D2).
 * R8 guards jumps above an established base; the floor is not a jump.
 */
export function weeklyRunAllowanceSec(lastWeekRunSec: number): number {
  return Math.max(RESTART_WEEKLY_SEC, Math.floor(Math.max(0, lastWeekRunSec) * WEEKLY_RUN_CAP_RATIO))
}

/** The allowance comes from last week (not the week-1 floor). */
export function allowanceFromLastWeek(lastWeekRunSec: number): boolean {
  return Math.floor(Math.max(0, lastWeekRunSec) * WEEKLY_RUN_CAP_RATIO) > RESTART_WEEKLY_SEC
}

export interface CapResult {
  capSec: number
  reason: string | null
}

/**
 * R7: single-run cap. `longestLast30Sec` is the longest completed run in the
 * last 30 days; null or 0 means no recent running, so cap at the week-1 session.
 */
export function singleRunCap(plannedSec: number, longestLast30Sec: number | null): CapResult {
  if (longestLast30Sec == null || longestLast30Sec <= 0) {
    if (plannedSec <= RESTART_SESSION_SEC) return { capSec: plannedSec, reason: null }
    return { capSec: RESTART_SESSION_SEC, reason: 'No runs in the last 30 days. Back to the week-1 run-walk.' }
  }
  const cap = Math.floor(longestLast30Sec * SINGLE_RUN_CAP_RATIO)
  if (plannedSec <= cap) return { capSec: plannedSec, reason: null }
  return { capSec: cap, reason: `Capped at 110% of your longest run in 30 days (${Math.round(longestLast30Sec / 60)} min).` }
}

/**
 * R7 for the Block Zero run-walk: the single-run cap, never below the week-1
 * session. Week 1 is the plan's own restart level (as the weekly allowance's
 * floor), so one short or shortened run can't pin every later run-walk to its
 * length. The coach-brain replay found that ratchet: a run shortened to 11 min
 * (session time, warm-up included) held run-walks at 11 min for five weeks.
 */
export function runWalkSingleCap(plannedSec: number, longestLast30Sec: number | null): CapResult & { restart: boolean } {
  const cap = singleRunCap(plannedSec, longestLast30Sec)
  if (cap.capSec >= Math.min(plannedSec, RESTART_SESSION_SEC)) return { ...cap, restart: false }
  // History shorter than the week-1 session: the week-1 run-walk itself, its own short intervals.
  return { capSec: Math.min(plannedSec, RESTART_SESSION_SEC), reason: 'Runs are short lately. The week-1 run-walk until they build.', restart: true }
}

export interface WeeklyRunContext {
  /** Completed run time last calendar week. 0 when nothing was run. */
  lastWeekRunSec: number
  /** Completed run time this week before this session. */
  thisWeekSoFarSec: number
  /** Run sessions still to do this week, this one included (>= 1). */
  sessionsLeftThisWeek: number
}

/**
 * R8: weekly cap. This week's total may reach 130% of last week's. The budget
 * left is shared evenly across the run sessions still to come.
 */
export function weeklyRunCap(plannedSec: number, ctx: WeeklyRunContext): CapResult {
  const allowance = weeklyRunAllowanceSec(ctx.lastWeekRunSec)
  const budget = Math.max(0, allowance - ctx.thisWeekSoFarSec)
  const perSession = Math.floor(budget / Math.max(1, ctx.sessionsLeftThisWeek))
  if (plannedSec <= perSession) return { capSec: plannedSec, reason: null }
  const reason = allowanceFromLastWeek(ctx.lastWeekRunSec)
    ? 'Capped so this week stays within 30% of last week\'s run time.'
    : 'This week stays at week-1 volume.'
  return { capSec: perSession, reason }
}

export interface RunWalkPrescription extends RunWalkWeek {
  totalSec: number
  hrCeilingBpm: number | null
  capped: boolean
  reasons: string[]
  targetDesc: string
}

export interface RunWalkInput {
  week: number
  longestLast30Sec: number | null
  weekly: WeeklyRunContext
  hrCeilingBpm?: number | null
  /** Another cap on session time, e.g. the return ramp after a gap (F12, F13). */
  extraCap?: { capSec: number; reason: string } | null
}

const MIN_RUN_WALK_SEC = 300 + 2 * (60 + 120) // warm-up + two week-1 intervals

function describe(p: Omit<RunWalkPrescription, 'targetDesc'>): string {
  const ceiling = p.hrCeilingBpm != null ? ` Keep HR at or below ${p.hrCeilingBpm} bpm.` : ''
  if (p.rounds === 0) {
    return `Easy walk, ${Math.round(p.totalSec / 60)} min. Run volume is at its limit this week.${ceiling}`
  }
  const run = p.runSec >= 60 && p.runSec % 60 === 0 ? `${p.runSec / 60} min` : `${p.runSec} s`
  const walk = p.walkSec >= 60 && p.walkSec % 60 === 0 ? `${p.walkSec / 60} min` : `${p.walkSec} s`
  return `Run-walk. ${Math.round(p.warmupSec / 60)} min brisk walk, then ${p.rounds} x (${run} easy run / ${walk} walk). Talk-test pace: you can speak in full sentences.${ceiling}`
}

/**
 * The run-walk for one session after both guards. When capped, rounds drop
 * (interval shape kept); below two intervals it falls back to week-1 intervals,
 * and below that to an easy walk.
 */
export function prescribeRunWalk(input: RunWalkInput): RunWalkPrescription {
  const base = getRunWalkWeek(input.week)
  const plannedSec = runWalkTotalSec(base)
  const single = runWalkSingleCap(plannedSec, input.longestLast30Sec)
  const weekly = weeklyRunCap(plannedSec, input.weekly)
  const extra: CapResult = input.extraCap && input.extraCap.capSec < plannedSec ? { capSec: Math.max(0, Math.floor(input.extraCap.capSec)), reason: input.extraCap.reason } : { capSec: plannedSec, reason: null }
  const capSec = Math.min(single.capSec, weekly.capSec, extra.capSec)
  // A restart from no recent runs explains both caps; say it once.
  const restarting = input.longestLast30Sec == null || input.longestLast30Sec <= 0
  const reasons = [single, ...(restarting && single.capSec < plannedSec ? [] : [weekly]), extra]
    .filter(r => r.capSec < plannedSec && r.reason)
    .map(r => r.reason as string)

  let shape: RunWalkWeek = base
  if (single.restart && capSec >= RESTART_SESSION_SEC) {
    shape = { ...RUN_WALK_WEEKS[0], week: base.week }
  } else if (capSec < plannedSec) {
    const cycle = base.runSec + base.walkSec
    const rounds = Math.floor((capSec - base.warmupSec) / cycle)
    if (rounds >= 2) {
      shape = { ...base, rounds }
    } else if (capSec >= MIN_RUN_WALK_SEC) {
      const w1 = RUN_WALK_WEEKS[0]
      shape = { ...w1, week: base.week, rounds: Math.floor((capSec - w1.warmupSec) / (w1.runSec + w1.walkSec)) }
    } else {
      shape = { week: base.week, runSec: 0, walkSec: 0, rounds: 0, warmupSec: Math.max(0, capSec) }
    }
  }

  const p = {
    ...shape,
    totalSec: runWalkTotalSec(shape),
    hrCeilingBpm: input.hrCeilingBpm ?? null,
    capped: capSec < plannedSec,
    reasons,
  }
  return { ...p, targetDesc: describe(p) }
}

// ─── HR ceiling (R9) ──────────────────────────────────────────

/**
 * The run line before a talk test (coach-brain.md §4, §7, approved 2026-10-20):
 * 0.78 × HRmax (183 at 36 → 143). A rule of thumb the first talk test replaces.
 */
export const Z2_CEILING_FRACTION_OF_MAX = 0.78

export type HrCeilingSource = 'talk_test' | 'measured_max' | 'tanaka' | 'default'

/** Tanaka 2001: HRmax ≈ 208 − 0.7 × age. */
export function tanakaMaxHr(ageYears: number): number {
  return Math.round(208 - 0.7 * ageYears)
}

export function ageFromDob(dobIso: string | null | undefined, todayEpochDay: number): number | null {
  if (!dobIso || !/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) return null
  const dob = new Date(`${dobIso}T00:00:00Z`)
  const today = new Date(todayEpochDay * 86400000)
  let age = today.getUTCFullYear() - dob.getUTCFullYear()
  const beforeBirthday = today.getUTCMonth() < dob.getUTCMonth()
    || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())
  if (beforeBirthday) age -= 1
  return age > 0 && age < 120 ? age : null
}

/**
 * Easy-run HR ceiling. Talk-test value when known (best VT1 proxy), else 70%
 * of a measured HRmax, else 70% of Tanaka from age, else the app default.
 */
export function hrCeiling(input: {
  talkTestBpm?: number | null
  measuredMaxHr?: number | null
  ageYears?: number | null
  defaultBpm: number
}): { bpm: number; source: HrCeilingSource } {
  if (input.talkTestBpm != null && input.talkTestBpm > 0) return { bpm: Math.round(input.talkTestBpm), source: 'talk_test' }
  if (input.measuredMaxHr != null && input.measuredMaxHr > 0) {
    return { bpm: Math.round(input.measuredMaxHr * Z2_CEILING_FRACTION_OF_MAX), source: 'measured_max' }
  }
  if (input.ageYears != null && input.ageYears > 0) {
    return { bpm: Math.round(tanakaMaxHr(input.ageYears) * Z2_CEILING_FRACTION_OF_MAX), source: 'tanaka' }
  }
  return { bpm: input.defaultBpm, source: 'default' }
}

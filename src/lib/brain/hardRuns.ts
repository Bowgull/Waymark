// Hard runs toward the 5K (page 76, approved by Josh 2026-10-23).
//
// - Goal: 5 km under 22:00.
// - Weeks 1 to 3 of the block: every run easy (Zone 2 at his line; the run
//   keeps the name its dose gives it).
// - From week 4: two hard runs a week, the rest easy (about 80/20). One
//   TEMPO (about 15 min at a speed that's hard but holdable) and one
//   RUN HARD / EASY JOG (2 min hard, 2 min jog, 5 to 8 times).
// - A 5K test when he is ready and the week allows (Josh, 2026-10-23: not a
//   fixed slot): from week 4, about 3+ weeks after the last test (or after
//   hard runs began), his recent hard runs done at their speeds and under the
//   heart top (well under it: sooner), no rough stretch or raven plan, not
//   the day after a class or another hard day. Typically every 4 to 6 weeks.
//   It takes one hard run's place as a coach change (rune, KEEP, UNDO). Its
//   time sets the speeds (and outdoor paces) after it.
// - MT classes and bag work are hard days too: a week with two or more of
//   them is a heavy week and keeps one hard run. A tired week keeps one hard
//   run as well, never none.
// - Every piece has a treadmill speed and incline 1; outside, the same speed
//   is a pace to hold.
// - Hard runs have their own heart range: teal in range, gold near the top,
//   ember (EASE OFF, one buzz) only about 10 bpm over the top for 30 s.
//
// Pure; relative imports only so the tests run it under node.

import { BASE_INCLINE, tenth } from '../runSpeed'
import type { Level, RunDose } from './doses'

export const GOAL_5K_SEC = 22 * 60
export const HARD_FROM_WEEK = 4
export const FIVE_K_M = 5000
/** EASE OFF only this far over the top of a hard run's range (for 30 s). */
export const HARD_OVER_BY = 10
/** A first test with nothing to go on: 30:00. */
export const DEFAULT_FIVE_K_SEC = 30 * 60

export type HardKind = 'steady' | 'intervals' | 'test'
export type WeekRunKind = 'easy' | HardKind

/** sessions.notes for each hard run (the run category the rest of the app already reads). */
export const HARD_NOTES: Readonly<Record<HardKind, string>> = { steady: 'tempo', intervals: 'intervals', test: '5k_test' }
/** run_sessions.run_type of a finished 5K test. */
export const FIVE_K_RUN_TYPE = '5k_test'

/** A session's hard kind from its type and run category, or null (an easy run, or not a run). */
export function hardKindOf(s: { type: string; notes?: string | null }): HardKind | null {
  if (s.type !== 'running') return null
  if (s.notes === 'tempo') return 'steady'
  if (s.notes === 'intervals') return 'intervals'
  if (s.notes === '5k_test') return 'test'
  return null
}

/** Hard runs start in week 4. */
export function hardWeek(week: number): boolean {
  return week >= HARD_FROM_WEEK
}

// ─── When the 5K test comes ──────────────────────────────────

/** At least this long after the last test (or since hard runs began); sooner when the speeds feel easy. */
export const TEST_GAP_DAYS = 28
export const TEST_GAP_EASY_DAYS = 21
/** Past this, a test is due as soon as nothing is rough, even if the last hard runs weren't perfect. */
export const TEST_GAP_MAX_DAYS = 42

export interface RecentHard {
  day: number
  /** Done as planned (not cut short). */
  completed: boolean
  /** The highest heart rate and the run's top (null: no strap). */
  maxHr: number | null
  top: number
}

export interface TestReadyIn {
  week: number
  today: number
  /** The last 5K test's day, else the day hard runs began (null: none yet). */
  sinceDay: number | null
  /** His last hard runs (the latest last), the test excluded. */
  recent: RecentHard[]
  /** Two rough mornings, a rest day due, sore or a raven plan open. */
  rough: boolean
}

/** Ready for a 5K test, and why (in his words), or why not. */
export function testReady(inp: TestReadyIn): { ready: boolean; why: string } {
  if (!hardWeek(inp.week)) return { ready: false, why: 'Hard runs first.' }
  if (inp.rough) return { ready: false, why: 'A rough stretch: the test waits.' }
  if (inp.sinceDay == null) return { ready: false, why: 'Hard runs first.' }
  const since = inp.today - inp.sinceDay
  const last = inp.recent.slice(-2)
  const done = last.length === 2 && last.every(r => r.completed)
  const over = last.some(r => r.maxHr != null && r.maxHr > r.top)
  const easy = done && last.every(r => r.maxHr != null && r.maxHr <= r.top - 5)
  const weeks = Math.round(since / 7)
  if (since >= TEST_GAP_EASY_DAYS && easy) return { ready: true, why: `Your hard runs sit easily at their speeds, ${weeks} weeks on: a 5K test to set new ones.` }
  if (since >= TEST_GAP_DAYS && done && !over) return { ready: true, why: `${weeks} weeks of hard runs at their speeds: a 5K test to set new ones.` }
  if (since >= TEST_GAP_MAX_DAYS && !over) return { ready: true, why: `${weeks} weeks since the last speeds were set: a 5K test.` }
  return { ready: false, why: 'Not yet.' }
}

/** Weeks since the speeds were set (the last test, or the first hard run), for reps and minutes. */
export function weekIndex(weeksSince: number): number {
  return Math.max(0, Math.min(3, Math.floor(weeksSince)))
}

// ─── The week: which runs are hard ───────────────────────────

export interface WeekRun {
  id: string
  day: number
  kind: WeekRunKind
  /** planned, done (it counts as it was), gone (skipped or missed: it doesn't count). */
  status: 'planned' | 'done' | 'gone'
  /** His own pick or move, held by an UNDO, started, or a past day: the coach leaves its kind. */
  fixed: boolean
}

export interface WeekRunsIn {
  week: number
  runs: WeekRun[]
  /** Days (epoch) of the week's live MT classes and bag sessions: hard days too. */
  classDays: number[]
  bagDays: number[]
  /** A tired week (two rough mornings running, or a rest day due). */
  tired: boolean
  /**
   * A knee, ankle, shin, hip or leg plan from the raven is open: no hard runs
   * until it settles (its words). Null: none.
   */
  hold?: string | null
  /** The coach places a 5K test this week (testReady), and why. */
  test?: { why: string } | null
  /** Days (epoch) of strength and other hard work: a test never goes the day after one, or on one. */
  busyDays?: number[]
  /** Weeks since the speeds were set: one hard run alternates by it. */
  weeksSince?: number
}

export interface WeekRunsOut {
  kinds: Record<string, WeekRunKind>
  /** The same week with no heavy or tired ease: what the plan alone gives. */
  baseline: Record<string, WeekRunKind>
  hardTarget: number
  heavy: boolean
  /** The coach's reason when the week has fewer hard runs than the plan (heavy or tired), else null. */
  why: string | null
  /** The run the 5K test went on (null: none placed this week). */
  testId: string | null
}

const isHard = (k: WeekRunKind) => k !== 'easy'

/** The hard runs the week aims for: none before week 4, two, one on a heavy or tired week (never none). */
export function hardTarget(week: number, heavy: boolean, tired: boolean): number {
  if (!hardWeek(week)) return 0
  return heavy || tired ? 1 : 2
}

/** Two or more classes and bag sessions in the week: a heavy week. */
export function heavyWeek(classDays: readonly number[], bagDays: readonly number[]): boolean {
  return classDays.length + bagDays.length >= 2
}

function pickHard(runs: WeekRun[], need: number, fixedHardDays: number[], hardDays: readonly number[]): WeekRun[] {
  if (need <= 0) return []
  const free = runs.filter(r => r.status === 'planned' && !r.fixed).sort((a, b) => a.day - b.day)
  if (free.length <= need) return free
  const cost = (set: WeekRun[]) => {
    const days = [...fixedHardDays, ...set.map(r => r.day)].sort((a, b) => a - b)
    let c = 0
    for (const r of set) {
      if (hardDays.includes(r.day)) c += 2
      if (hardDays.includes(r.day - 1)) c += 1
    }
    for (let i = 1; i < days.length; i++) {
      const gap = days[i] - days[i - 1]
      if (gap < 2) c += 3
      c -= gap * 0.1
    }
    // An earlier first pick breaks a tie.
    c += set.reduce((n, r) => n + (r.day - free[0].day) * 0.001, 0)
    return c
  }
  let best: WeekRun[] = []
  let bestCost = Infinity
  if (need === 1) {
    for (const a of free) { const c = cost([a]); if (c < bestCost) { best = [a]; bestCost = c } }
  } else {
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const c = cost([free[i], free[j]])
      if (c < bestCost) { best = [free[i], free[j]]; bestCost = c }
    }
  }
  return best
}

function assign(inp: WeekRunsIn, target: number, withTest: boolean): { kinds: Record<string, WeekRunKind>; testId: string | null } {
  const out: Record<string, WeekRunKind> = {}
  const live = inp.runs.filter(r => r.status !== 'gone')
  for (const r of inp.runs) out[r.id] = r.fixed || r.status !== 'planned' ? r.kind : 'easy'
  if (target === 0) return { kinds: out, testId: null }
  const fixedHard = live.filter(r => (r.fixed || r.status === 'done') && isHard(r.kind))
  const chosen = pickHard(live, target - fixedHard.length, fixedHard.map(r => r.day), [...inp.classDays, ...inp.bagDays])
  // The kinds the week wants: steady hard, then run hard / jog; one hard run alternates week to week.
  const one: HardKind = (inp.weeksSince ?? inp.week) % 2 === 1 ? 'steady' : 'intervals'
  const want: HardKind[] = target >= 2 ? ['steady', 'intervals'] : [one]
  const have = new Set(fixedHard.map(r => r.kind))
  const left = want.filter(k => !have.has(k))
  const sorted = chosen.sort((a, b) => a.day - b.day)
  for (const r of sorted) out[r.id] = left.shift() ?? 'intervals'
  // The 5K test takes one hard run's place: the first one not on, or the day after, a class or another hard day.
  let testId: string | null = null
  if (withTest && !fixedHard.some(r => r.kind === 'test')) {
    const busy = [...inp.classDays, ...inp.bagDays, ...(inp.busyDays ?? [])]
    const hardRunDays = live.filter(r => r.status !== 'gone' && out[r.id] !== 'easy').map(r => r.day)
    const ok = (r: WeekRun) => !busy.includes(r.day) && !busy.includes(r.day - 1) && !hardRunDays.some(d => d === r.day - 1)
    const pick = sorted.find(ok)
    if (pick) {
      const replaced = out[pick.id]
      out[pick.id] = 'test'
      testId = pick.id
      // Two hard runs: the other one is run hard / jog.
      const other = sorted.find(r => r.id !== pick.id)
      if (other && replaced === 'intervals') out[other.id] = 'intervals'
    }
  }
  return { kinds: out, testId }
}

/**
 * The week's run kinds: which planned runs are hard and which kind. His own
 * and done runs keep theirs and count; a skipped or missed one doesn't. The
 * hard ones sit apart (two days or more) and away from the day of and after a
 * class or bag session where the week allows.
 */
export function planWeekRuns(inp: WeekRunsIn): WeekRunsOut {
  const heavy = heavyWeek(inp.classDays, inp.bagDays)
  const target = inp.hold ? 0 : hardTarget(inp.week, heavy, inp.tired)
  const placed = assign(inp, target, !!inp.test && target > 0)
  const baseline = assign(inp, hardTarget(inp.week, false, false), false).kinds
  const fewer = target < hardTarget(inp.week, false, false)
  const n = inp.classDays.length + inp.bagDays.length
  const why = !fewer ? null : inp.hold ? inp.hold : inp.tired
    ? 'A tired week: one hard run, the rest easy.'
    : `${n} classes and bag days this week: one hard run, the rest easy.`
  return { kinds: placed.kinds, baseline, hardTarget: target, heavy, why, testId: placed.testId }
}

// ─── Speeds, paces and the heart range ───────────────────────

export interface HardSpeeds {
  /** km/h, one decimal (a treadmill's step). */
  easy: number
  jog: number
  steady: number
  hard: number
  /** The test's start: the last 5K's speed. */
  test: number
}

/** 5K speed in km/h. */
export function fiveKKmh(sec: number): number {
  return (5 * 3600) / sec
}

/**
 * Before any test: a 5K from his easy pace at the heart line (an easy run sits
 * near 78% of 5K speed), else 30:00. Kept between 17:00 and 45:00.
 */
export function estimateFiveKSec(easyPaceSecKm: number | null | undefined): number {
  if (!easyPaceSecKm || !(easyPaceSecKm > 0)) return DEFAULT_FIVE_K_SEC
  const v = (3600 / easyPaceSecKm) / 0.78
  return Math.round(Math.min(45 * 60, Math.max(17 * 60, (5 * 3600) / v)))
}

/**
 * The speeds a 5K time sets (Daniels' bands, for a runner at this level):
 * easy ~78% of 5K speed (his own easy pace when the strap knows it), the jog
 * ~72%, steady hard ~95% (threshold), run hard ~105% (2 min reps), and the
 * test starts at the last 5K's speed.
 */
export function speedsFrom(fiveKSec: number, easyKmh?: number | null): HardSpeeds {
  const v = fiveKKmh(fiveKSec)
  const easy = tenth(easyKmh && easyKmh > 0 ? Math.min(easyKmh, v * 0.85) : v * 0.78)
  return { easy, jog: Math.min(easy, tenth(v * 0.72)), steady: tenth(v * 0.95), hard: tenth(v * 1.05), test: tenth(v) }
}

/** His max heart rate: the profile's, else from the easy line (the line sits near 79% of max). */
export function maxHrFrom(maxHr: number | null | undefined, lineBpm: number): number {
  return maxHr && maxHr > 120 ? maxHr : Math.round(lineBpm / 0.79)
}

export interface HardHeart {
  /** The bottom of the range (steady hard only). */
  low: number | null
  /** The most it should be: gold near it, EASE OFF only HARD_OVER_BY over it for 30 s. */
  top: number
  /** Run hard / jog: the jog's line. */
  jogTop: number | null
  overBy: number
}

/** The heart range for a hard run: steady 85-90% of max, run hard up to 95% (jog under the easy line + 3), the test up to max. */
export function hardHeart(kind: HardKind, maxHr: number | null | undefined, lineBpm: number): HardHeart {
  const max = maxHrFrom(maxHr, lineBpm)
  if (kind === 'steady') return { low: Math.round(max * 0.85), top: Math.round(max * 0.9), jogTop: null, overBy: HARD_OVER_BY }
  if (kind === 'intervals') return { low: null, top: Math.floor(max * 0.95), jogTop: lineBpm + 3, overBy: HARD_OVER_BY }
  return { low: null, top: max, jogTop: null, overBy: HARD_OVER_BY }
}

// ─── The pieces ──────────────────────────────────────────────

export type PieceKind = 'easy' | 'steady' | 'hard' | 'jog' | 'test'

export interface HardPiece {
  kind: PieceKind
  sec: number
  kmh: number
  /** Run hard / jog: the rep (1-based); 0 otherwise. */
  round: number
  /** The test's 5 km: it lasts as long as he takes (sec is the guess at the start speed). */
  distM?: number
}

export interface HardPlan {
  kind: HardKind
  /** Run hard reps (1 for steady and the test). */
  reps: number
  pieces: HardPiece[]
  speeds: HardSpeeds
  incline: number
  heart: HardHeart
  /** The 5K the speeds come from (null: an estimate, before the first test). */
  fiveK: { day: number; sec: number } | null
  /** The 5K time the speeds use. */
  fiveKSec: number
}

export const WARM_SEC = 600
export const COOL_SEC = 300
export const HARD_PIECE_SEC = 120
export const JOG_PIECE_SEC = 120

/** Run hard reps: 5 the first week after the speeds were set, one more each week, 8 at most. */
export function repsFor(weeksSince: number): number {
  return Math.min(8, 5 + weekIndex(weeksSince))
}

/** Steady hard minutes: 13, 15, 17, 19 through the weeks after the speeds were set. */
export function steadyMinFor(weeksSince: number): number {
  return 13 + 2 * weekIndex(weeksSince)
}

export function piecesFor(kind: HardKind, sp: HardSpeeds, reps: number, steadyMin: number, warmSec = WARM_SEC): HardPiece[] {
  const warm: HardPiece = { kind: 'easy', sec: warmSec, kmh: sp.easy, round: 0 }
  const cool: HardPiece = { kind: 'easy', sec: COOL_SEC, kmh: sp.easy, round: 0 }
  if (kind === 'steady') return [warm, { kind: 'steady', sec: steadyMin * 60, kmh: sp.steady, round: 0 }, cool]
  if (kind === 'test') return [warm, { kind: 'test', sec: Math.round((FIVE_K_M / 1000 / sp.test) * 3600), kmh: sp.test, round: 0, distM: FIVE_K_M }, cool]
  const out: HardPiece[] = [warm]
  for (let r = 1; r <= reps; r++) out.push({ kind: 'hard', sec: HARD_PIECE_SEC, kmh: sp.hard, round: r }, { kind: 'jog', sec: JOG_PIECE_SEC, kmh: sp.jog, round: r })
  out.push(cool)
  return out
}

export const totalOf = (pieces: readonly HardPiece[]) => pieces.reduce((n, p) => n + p.sec, 0)

export interface HardDoseIn {
  kind: HardKind
  /** Weeks since the speeds were set (the last test, or the first hard run). */
  weeksSince: number
  /** The latest 5K test on or before this run's day. */
  fiveK: { day: number; sec: number } | null
  easyPaceSecKm: number | null
  maxHr: number | null
  lineBpm: number
  /** EASE: one rep fewer, 3 min less steady (an amber morning, the morning after a class). */
  ease: boolean
  /** The run caps (110% of the longest run in 30 days, the week's budget): fewer reps or minutes to fit. */
  capSec: number | null
}

/** One hard run's plan: its pieces at the test's speeds, the heart range, and why it is shorter when it is. */
export function hardPlan(inp: HardDoseIn): { plan: HardPlan; why: string[] } {
  const fiveKSec = inp.fiveK?.sec ?? estimateFiveKSec(inp.easyPaceSecKm)
  const easyKmh = inp.easyPaceSecKm && inp.easyPaceSecKm > 0 ? 3600 / inp.easyPaceSecKm : null
  const speeds = speedsFrom(fiveKSec, easyKmh)
  const why: string[] = []
  let reps = repsFor(inp.weeksSince)
  let steadyMin = steadyMinFor(inp.weeksSince)
  if (inp.ease && inp.kind !== 'test') {
    reps = Math.max(3, reps - 1)
    steadyMin = Math.max(8, steadyMin - 3)
  }
  let warm = WARM_SEC
  let pieces = piecesFor(inp.kind, speeds, reps, steadyMin, warm)
  if (inp.capSec != null && inp.capSec > 0 && totalOf(pieces) > inp.capSec) {
    while (totalOf(pieces) > inp.capSec && ((inp.kind === 'intervals' && reps > 3) || (inp.kind === 'steady' && steadyMin > 8) || warm > 300)) {
      if (inp.kind === 'intervals' && reps > 3) reps--
      else if (inp.kind === 'steady' && steadyMin > 8) steadyMin--
      else warm -= 60
      pieces = piecesFor(inp.kind, speeds, reps, steadyMin, warm)
    }
    why.push('Shorter today so the week stays inside your run limits.')
  }
  if (!inp.fiveK) why.push(inp.kind === 'test' ? 'Your first 5K test: it sets the speeds for the next 4 weeks.' : 'Speeds are a guess until your first 5K test.')
  return {
    plan: { kind: inp.kind, reps: inp.kind === 'intervals' ? reps : 1, pieces, speeds, incline: BASE_INCLINE, heart: hardHeart(inp.kind, inp.maxHr, inp.lineBpm), fiveK: inp.fiveK, fiveKSec },
    why,
  }
}

/** The run's one name on its row, the ready board and the lock screen. */
export function hardLabel(p: Pick<HardPlan, 'kind' | 'reps'>): string {
  return p.kind === 'steady' ? 'Tempo' : p.kind === 'test' ? '5K Test' : 'Intervals'
}

/** The labels a hard run's dose owns. */
export function isHardLabel(label: string | null | undefined): boolean {
  return !!label && /^(tempo|intervals|steady hard|5k test|hard × \d+|hard run)$/i.test(label.trim())
}

/** The label a hard run starts with before its dose names it. */
export const HARD_START_LABEL: Readonly<Record<HardKind, string>> = { steady: 'Tempo', intervals: 'Intervals', test: '5K Test' }

/** A hard run's dose in the shape every run dose has (the rest of the app reads totalSec, runTotalSec, rounds). */
export function hardRunDose(level: Level, plan: HardPlan, why: string[]): RunDose {
  const total = totalOf(plan.pieces)
  const main = plan.pieces.find(p => p.kind === 'hard' || p.kind === 'steady' || p.kind === 'test')
  return {
    kind: 'run', level, rungSec: main?.sec ?? 0, runSec: main?.sec ?? 0, walkSec: plan.kind === 'intervals' ? JOG_PIECE_SEC : 0, rounds: plan.reps,
    warmupSec: plan.pieces[0]?.sec ?? 0, totalSec: total, walkOnly: false, holdRunSec: total, runTotalSec: total,
    hrCeilingBpm: plan.heart.top, talkTestDue: false, capped: why.some(w => w.startsWith('Shorter')), why, hard: plan,
  }
}

// ─── The 5K test's result ────────────────────────────────────

/** "27:48" */
export function fiveKText(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** How far from the goal: "5:48 to go", or "under 22:00" once there. */
export function toGoalText(sec: number): string {
  return sec <= GOAL_5K_SEC ? `under ${fiveKText(GOAL_5K_SEC)}` : `${fiveKText(sec - GOAL_5K_SEC)} to go`
}

/** The latest test on or before `day`. */
export function latestTest(tests: ReadonlyArray<{ day: number; sec: number }>, day: number): { day: number; sec: number } | null {
  let best: { day: number; sec: number } | null = null
  for (const t of tests) if (t.day <= day && t.sec > 0 && (!best || t.day >= best.day)) best = { day: t.day, sec: t.sec }
  return best
}

/** A 5K time typed or read off the clock, seconds; null unless it is a plausible 5K (12 to 60 min). */
export function parseFiveK(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null
  let sec: number
  if (typeof v === 'number') sec = v
  else {
    const m = v.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    sec = Number(m[1]) * 60 + Number(m[2])
  }
  return Number.isFinite(sec) && sec >= 12 * 60 && sec <= 60 * 60 ? Math.round(sec) : null
}

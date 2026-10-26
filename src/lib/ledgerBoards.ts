// The Ledger's boards that answer his goals (page 79, approved 2026-10-23):
// Next block in plain words, Running (the 5K first, then easy runs at his own
// heart line), Fight (bag rounds, MT classes, combos) and Strength since he
// started. Pure functions over plain rows
// so the server and the tests share them. Up is better on every graph: a
// faster 5K and a faster easy pace climb, as lifts do.

import { listWords, type PartKey, type ReadinessPart, type ReadinessReport } from './brain/readinessParts'
import { liftShort } from './brain/readinessParts'
export type { PartKey } from './brain/readinessParts'
import { patternOf } from './brain/loadLevels'
import { mondayOf, type WeeklyPoint } from './ledger'
import { kgToLbs } from './units'

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const dowOf = (day: number) => ((day % 7) + 11) % 7
const word = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const r1 = (n: number) => Math.round(n * 10) / 10

/** "25:52" (minutes:seconds). */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "today", "tomorrow", "Saturday" (this week), or "Mon 30 Nov" further out. */
export function dayWord(day: number, today: number): string {
  if (day === today) return 'today'
  if (day === today + 1) return 'tomorrow'
  if (day > today && day - today <= 6) return DAY_LONG[dowOf(day)]
  const d = new Date(day * 86400000)
  return `${DAY_LONG[dowOf(day)].slice(0, 3)} ${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()].slice(0, 3)}`
}

/** The program's week for a day: week 1 is the 7 days from the start. */
export function weekOf(day: number, start: number): number {
  return Math.floor((day - start) / 7) + 1
}

// ─── Next block in plain words (page 79 §5) ───────────────────

/** The parts' plain names (the rules are page 69 §5's, unchanged). */
export const PLAIN_NAME: Record<PartKey, string> = { habit: 'Showing up', engine: 'Running base', strength: 'Lifting', back: 'Back' }

export interface PlainPart {
  key: PartKey
  name: string
  in: boolean
  tiles: number
  /** "Done." in teal when in, then one plain line of what is left. */
  say: string
}

export interface NextBlockView {
  flap: string
  tone: 'gold' | 'teal'
  line: string
  parts: PlainPart[]
  /** The part open first: the first not done (the first when all are). */
  openKey: PartKey
  foot: string
}

export const NEXT_BLOCK_FOOT = 'All four done, and at least 4 weeks in: The Campaign starts the Monday after, with a lighter week first.'

/** One plain line per part: what is left, from the part's own numbers. `firstRunMin`: his first run's length, before any run. */
export function plainPartLine(p: ReadinessPart, ctx: { daysIn: number; firstRunMin?: number | null } = { daysIn: 1 }): string {
  const f = p.facts ?? {}
  if (p.key === 'habit') {
    if (p.in) return '4+ training days a week, 3 of the last 4 weeks.'
    const weeksOk = f.weeksOk ?? 0
    if (!f.due) return `Train 4+ days a week, 3 weeks running, without a week off.${ctx.daysIn <= 0 ? ' Week 1 starts today.' : ''}`
    if ((f.breakDays ?? 0) >= 7) return `A ${f.breakDays}-day break in the last 3 weeks. Train 4+ days a week, 3 of 4 weeks, without a week off.`
    const weeksLeft = Math.max(0, 3 - weeksOk)
    const weeksBit = weeksLeft > 0 ? `4+ training days a week in ${plural(weeksLeft, 'more week')}` : ''
    if (f.needInARow) {
      const s = `${word(f.needInARow)} more ${f.needInARow === 1 ? 'session' : 'sessions'} done in a row`
      return weeksBit ? `${s}, and ${weeksBit}.` : `${s}.`
    }
    return weeksBit ? `${weeksBit[0].toUpperCase()}${weeksBit.slice(1)}.` : '4+ training days a week, 3 of the last 4 weeks.'
  }
  if (p.key === 'engine') {
    const bpm = f.lineBpm ?? 0
    if (p.in) return `Two easy run-walks of 27 min or longer in 2 weeks, most of it at heart ${bpm} or under.`
    const good = f.goodRuns ?? 0
    if (good < 2) {
      const n = 2 - good
      const more = good > 0 || (f.runsInWindow ?? 0) > 0
      const start = !more && ctx.firstRunMin ? ` Your runs start at ${ctx.firstRunMin} min.` : ''
      return `${n} ${more ? 'more ' : ''}easy ${n === 1 ? 'run-walk' : 'run-walks'} of 27 min or longer, run pieces of 4 min, most of it at heart ${bpm} or under.${start}`
    }
    return (f.talkTests ?? 0) === 0 ? 'A talk test on an easy run-walk sets your heart line.' : 'A talk-test recheck on an easy run-walk keeps your heart line current.'
  }
  if (p.key === 'strength') {
    if (p.in) return 'Squat, hinge, press and pull at 3 × 8 with a rep to spare.'
    const missing = f.missing ?? ['squat', 'hinge', 'press', 'pull']
    const share = f.rirShare ?? 0
    if (missing.length > 0) {
      const names = listWords(missing.map(m => m[0].toUpperCase() + m.slice(1)))
      return `${names} at 3 × 8 with a rep to spare.${share < 0.9 ? ' Log reps left on 9 in 10 sets.' : ''}`
    }
    return `Log reps left on 9 in 10 sets (now ${Math.round(share * 10)} in 10).`
  }
  // back
  if (p.in) return `Back steady or better, and no back ease in ${plural(f.cleanDays ?? 10, 'day')}.`
  if (f.planOpen) return 'The raven\'s plan for your back is still open.'
  if ((f.scores ?? 0) >= 3 && f.meanOk === false && f.backNow != null && f.backWeek1 != null) return `Back averages ${r1(f.backNow)} over 3 weeks, under ${r1(f.backWeek1)} in week 1.`
  if ((f.cleanDays ?? 10) < 10 && (f.scores ?? 0) >= 3) {
    const n = 10 - (f.cleanDays ?? 0)
    return `${word(n)} more ${n === 1 ? 'day' : 'days'} without a back ease.`
  }
  return `It takes 3 back scores from your check-ins to read; you have ${f.scores ?? 0}.`
}

/** Page 69 §5's meter in plain words: "N of 4 done", the parts' plain names, one line of what is left per part. */
export function plainNextBlock(r: ReadinessReport, opts: { firstRunMin?: number | null } = {}): NextBlockView {
  const parts = r.parts.map(p => ({ key: p.key, name: PLAIN_NAME[p.key], in: p.in, tiles: p.tiles, say: plainPartLine(p, { daysIn: r.daysIn, firstRunMin: opts.firstRunMin }) }))
  const left = parts.filter(p => !p.in)
  let flap: string
  let line: string
  if (r.breakDays >= 2 && /DAY BREAK$/.test(r.flap)) {
    flap = r.flap
    line = r.line
  } else if (r.move) {
    flap = 'READY'
    line = r.line
  } else if (r.allIn) {
    flap = r.minMet ? 'READY' : '4 OF 4 DONE'
    line = r.minMet ? 'All four done. The coach sets the move tonight' : 'All four done. The move comes after week 4'
  } else {
    flap = `${r.inCount} OF 4 DONE`
    if (r.lagging) {
      const rest = left.filter(p => p.key !== r.lagging).map(p => p.name)
      line = rest.length ? `${PLAIN_NAME[r.lagging]} first, then ${listWords(rest).toLowerCase()}` : `${PLAIN_NAME[r.lagging]} is the one left`
    } else line = `${listWords(left.map(p => p.name))} to go`
  }
  return {
    flap,
    tone: r.tone,
    line,
    parts,
    openKey: (left[0] ?? parts[0]).key,
    foot: r.move ? r.foot : NEXT_BLOCK_FOOT,
  }
}

// ─── Running: the 5K first ────────────────────────────────────

/** His goal: 5 km under 22 minutes. */
export const FIVE_K_GOAL_SEC = 22 * 60
/** Chart spacing for test weeks. Tests come when he's ready (from week 4, about 4–6 weeks apart; Josh 2026-10-23), so this only lays out the axis. */
export const FIVE_K_EVERY = 4
/** No test before this week. */
export const FIVE_K_FROM_WEEK = 4

/**
 * The contract with the run builder (page 76): a completed run whose
 * run_sessions.run_type is '5k_test', with duration_sec as the time for the
 * 5 km. A GPS distance from 4.5 km scales the time to exactly 5 km (5.03 km in
 * 25:58 is 25:49). A session's context_json { "test5kSec": n } wins over both
 * (the builder can write the time it read off the treadmill).
 */
export interface FiveKSource {
  runType: string | null
  /** run_sessions.five_k_sec: the 5 km's own time (no warm-up), what the run builder saves. Wins. */
  fiveKSec?: number | null
  durationSec: number | null
  distanceKm: number | null
  contextJson?: string | null
}

export function fiveKTestSec(row: FiveKSource): number | null {
  if (row.runType === '5k_test' && row.fiveKSec != null && row.fiveKSec > 0) return Math.round(row.fiveKSec)
  const ctx = parseJson(row.contextJson)
  const own = ctx && typeof ctx.test5kSec === 'number' && ctx.test5kSec > 0 ? ctx.test5kSec : null
  if (own != null) return Math.round(own)
  if (row.runType !== '5k_test' || !(row.durationSec && row.durationSec > 0)) return null
  if (row.distanceKm != null && row.distanceKm >= 4.5) return Math.round(row.durationSec * 5 / row.distanceKm)
  return Math.round(row.durationSec)
}

export interface FiveKTest { week: number; sec: number }

export interface FiveKView {
  tests: FiveKTest[]
  goalSec: number
  currentWeek: number
  /** The week of the next test. */
  nextWeek: number
  /** The chart runs START to this week. */
  axisWeeks: number
  flap: string
  line: string
}

/** The 5K tests by week (the latest of a week counts), the next test's week and the words. */
export function fiveKBoard(tests: ReadonlyArray<{ day: number; sec: number }>, start: number, today: number, plannedDay: number | null = null): FiveKView {
  const byWeek = new Map<number, { day: number; sec: number }>()
  for (const t of tests) {
    if (t.day > today || !(t.sec > 0)) continue
    const w = Math.max(1, weekOf(t.day, start))
    const cur = byWeek.get(w)
    if (!cur || t.day >= cur.day) byWeek.set(w, t)
  }
  const list = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([week, t]) => ({ week, sec: t.sec }))
  const currentWeek = Math.max(1, weekOf(today, start))
  const lastWeek = list.length ? list[list.length - 1].week : 0
  // The next test: the one the coach (or he) planned; else a guess for the chart only, never promised in words.
  const planned = plannedDay != null && plannedDay >= today ? Math.max(1, weekOf(plannedDay, start)) : null
  let nextWeek = planned ?? Math.max(FIVE_K_FROM_WEEK, currentWeek, lastWeek ? lastWeek + FIVE_K_EVERY : 0)
  const axisWeeks = Math.max(12, Math.ceil(nextWeek / FIVE_K_EVERY) * FIVE_K_EVERY)
  const latest = list[list.length - 1]
  let flap: string
  let line: string
  const when = planned != null ? (planned === currentWeek ? 'Next test is this week.' : `Next test is planned for week ${planned}.`) : "Next test when you're ready."
  if (!latest) {
    flap = planned != null ? `5K FIRST TEST WK ${planned}` : currentWeek < FIVE_K_FROM_WEEK ? `5K FIRST TEST WK ${FIVE_K_FROM_WEEK}+` : '5K TEST WHEN READY'
    line = planned != null
      ? `Your first 5K test is planned for week ${planned}. It sets your speeds, then every test shows how far you are from ${mmss(FIVE_K_GOAL_SEC)}.`
      : `Your first 5K test comes from week ${FIVE_K_FROM_WEEK}, when the coach sees you're ready (or add one yourself). It sets your speeds, then every test shows how far you are from ${mmss(FIVE_K_GOAL_SEC)}.`
  } else {
    flap = `5K ${mmss(latest.sec)}`
    const left = latest.sec - FIVE_K_GOAL_SEC
    line = left > 0 ? `${mmss(left)} to go. ${when}` : `Under ${mmss(FIVE_K_GOAL_SEC)}. ${when}`
  }
  return { tests: list, goalSec: FIVE_K_GOAL_SEC, currentWeek, nextWeek, axisWeeks, flap, line }
}

/** Where the 5K chart draws (320 × 130): the goal line at the top, a faster time higher (up is better). */
export const FIVE_K_CHART = { w: 320, h: 130, goalY: 24, bottomY: 114, pxPerSec: 0.2, x0: 4, x1: 316 } as const

export function fiveKX(week: number, axisWeeks: number): number {
  return r1(FIVE_K_CHART.x0 + week / axisWeeks * (FIVE_K_CHART.x1 - FIVE_K_CHART.x0))
}

/** y for a time: 22:00 on the goal line, 5 s slower 1 px lower; a slow first test squeezes the scale so it fits. */
export function fiveKY(sec: number, slowest: number): number {
  const { goalY, bottomY, pxPerSec } = FIVE_K_CHART
  const span = Math.max(1, slowest - FIVE_K_GOAL_SEC)
  const k = Math.min(pxPerSec, (bottomY - goalY) / span)
  return r1(Math.max(8, goalY + (sec - FIVE_K_GOAL_SEC) * k))
}

export interface FiveKChart {
  /** The step line's corners (held level until the next test), the last one the latest test. */
  steps: { x: number; y: number }[]
  labels: { x: number; y: number; text: string }[]
  /** The next test: a dashed hold from the latest to its week, and a ring there. */
  next: { x0: number; x: number; y: number } | null
  ticks: { x: number; text: string; anchor: 'start' | 'middle' | 'end' }[]
}

export function fiveKChart(v: FiveKView): FiveKChart {
  const slowest = Math.max(...v.tests.map(t => t.sec), FIVE_K_GOAL_SEC + 1)
  const pts = v.tests.map(t => ({ x: fiveKX(t.week, v.axisWeeks), y: fiveKY(t.sec, slowest), text: mmss(t.sec) }))
  const steps: { x: number; y: number }[] = []
  pts.forEach((p, i) => {
    if (i > 0) steps.push({ x: p.x, y: pts[i - 1].y })
    steps.push({ x: p.x, y: p.y })
  })
  const last = pts[pts.length - 1]
  const tickEvery = v.axisWeeks <= 12 ? FIVE_K_EVERY : FIVE_K_EVERY * Math.ceil(v.axisWeeks / 12)
  const ticks: FiveKChart['ticks'] = [{ x: FIVE_K_CHART.x0, text: 'START', anchor: 'start' }]
  for (let w = tickEvery; w <= v.axisWeeks; w += tickEvery) ticks.push({ x: fiveKX(w, v.axisWeeks), text: `WK ${w}`, anchor: w === v.axisWeeks ? 'end' : 'middle' })
  return {
    steps,
    labels: pts.map(p => ({ x: r1(p.x + 7), y: r1(p.y - 7), text: p.text })),
    next: last ? { x0: last.x, x: fiveKX(v.nextWeek, v.axisWeeks), y: last.y } : null,
    ticks,
  }
}

// ─── Running: easy runs at his own heart line ─────────────────

/**
 * A run's pace in sec/km: the GPS pace; else time ÷ distance; else, on the
 * treadmill, the speed the coach set (km/h, from the session's dose or
 * context: run.speedKmh, speedKmh or treadmillKmh) for the run's time.
 */
export interface PaceSource {
  paceSecKm: number | null
  distanceKm: number | null
  durationSec: number | null
  speedKmh?: number | null
}

export function runPaceSecKm(r: PaceSource): number | null {
  if (r.paceSecKm != null && r.paceSecKm > 0) return r.paceSecKm
  if (r.distanceKm != null && r.distanceKm > 0.2 && r.durationSec != null && r.durationSec > 0) return Math.round(r.durationSec / r.distanceKm)
  if (r.speedKmh != null && r.speedKmh > 0 && r.durationSec != null && r.durationSec > 0) return Math.round(3600 / r.speedKmh)
  return null
}

/** The treadmill speed the coach set for a run (km/h), from the session's dose or context, when it carries one. */
export function setSpeedKmh(doseJson: string | null | undefined, contextJson: string | null | undefined): number | null {
  const dose = parseJson(doseJson)
  const run = dose && typeof dose.run === 'object' && dose.run ? dose.run as Record<string, unknown> : null
  const ctx = parseJson(contextJson)
  for (const v of [run?.speedKmh, dose?.speedKmh, ctx?.speedKmh, ctx?.treadmillKmh]) if (typeof v === 'number' && v > 0) return v
  return null
}

/** Hard runs stay off the easy line. */
const HARD_RUN = /test|tempo|interval|hard|threshold|repeat|race|steady_hard|fartlek/i
/** Easy: his average heart between 25 under and 8 over his line. */
export const EASY_BAND = { under: 25, over: 8 } as const
export const EASY_MIN_SEC = 120

export interface EasyRunRow extends PaceSource {
  epochDay: number
  avgHr: number | null
  completed: boolean
  runType?: string | null
}

export interface EasyRunsView {
  bpm: number
  points: WeeklyPoint[]
  runs: number
  /** Pace now (sec/km at his line), the latest week's. */
  now: number | null
  delta: { text: string; up: boolean } | null
}

/** One point per week: the mean pace of that week's easy runs, each scaled to his line (pace × heart ÷ line). */
export function easyRunsAtLine(rows: ReadonlyArray<EasyRunRow>, bpm: number, weeks: number, today: number): EasyRunsView {
  const lastMon = mondayOf(today)
  const firstMon = lastMon - (weeks - 1) * 7
  const byWeek = new Map<number, number[]>()
  let runs = 0
  for (const r of rows) {
    if (!r.completed || r.avgHr == null || (r.runType && HARD_RUN.test(r.runType))) continue
    if (r.durationSec != null && r.durationSec < EASY_MIN_SEC) continue
    if (r.avgHr < bpm - EASY_BAND.under || r.avgHr > bpm + EASY_BAND.over) continue
    const pace = runPaceSecKm(r)
    if (pace == null) continue
    const mon = mondayOf(r.epochDay)
    if (mon < firstMon || mon > lastMon) continue
    runs++
    byWeek.set(mon, [...(byWeek.get(mon) ?? []), pace * r.avgHr / bpm])
  }
  const points = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([weekStart, v]) => ({ weekStart, value: Math.round(v.reduce((s, x) => s + x, 0) / v.length) }))
  const latest = points[points.length - 1]
  let delta: EasyRunsView['delta'] = null
  if (latest && points.length >= 2) {
    const before = points.filter(p => p.weekStart <= latest.weekStart - 28)
    const ref = before.length ? before[before.length - 1] : points[0]
    const d = Math.round(ref.value - latest.value)
    const wks = Math.round((latest.weekStart - ref.weekStart) / 7)
    const when = wks >= 4 && wks <= 5 ? 'a month ago' : `${plural(wks, 'week')} ago`
    if (d !== 0) delta = d > 0 ? { text: `▲ ${d} s faster than ${when}`, up: true } : { text: `▼ ${-d} s slower than ${when}`, up: false }
  }
  return { bpm, points, runs, now: latest?.value ?? null, delta }
}

/** The easy-runs empty line: when his last run was, and when the next easy run is. */
export function easyRunsEmptyLine(lastRunDay: number | null, nextRunDay: number | null, firstInBlock: boolean, today: number): string {
  const since = lastRunDay == null ? 'No runs yet.' : `No easy runs since ${MONTH_LONG[new Date(lastRunDay * 86400000).getUTCMonth()]}.`
  const recent = lastRunDay != null && today - lastRunDay < 28
  const head = recent ? 'No easy runs at your heart line yet.' : since
  if (nextRunDay == null) return `${head} Treadmill runs count too.`
  return `${head} Your ${firstInBlock ? 'first' : 'next'} easy run is ${dayWord(nextRunDay, today)}; treadmill runs count too.`
}

/** "6:42 per km". */
export function perKm(sec: number): string {
  return `${mmss(sec)} per km`
}

// ─── Fight: bag rounds, MT classes, combos ────────────────────

export const FIGHT_WEEKS = 8
/** Combo mastery (the Library's rules): the last five ratings out of 15, mastered at 9. */
export const COMBO_MASTERY_MAX = 15
export const COMBO_MASTERED_AT = 9

export interface FightWeek { weekStart: number; rounds: number; label: string; now: boolean }

export interface FightView {
  weeks: FightWeek[]
  thisWeek: number
  anyRounds: boolean
  flap: string
  classes: { picked: boolean; done: number }
  combos: { learned: number; mastered: number; closest: { name: string; dots: number; words: string } | null }
}

export interface FightIn {
  /** Rounds of each completed bag session, by day. */
  rounds: ReadonlyArray<{ day: number; rounds: number }>
  /** Completed MT class days. */
  classDays: readonly number[]
  /** He has class days set in Settings. */
  classDaysPicked: boolean
  /** The unlocked combos: text and mastery score; rated: he has rated it at least once. */
  combos: ReadonlyArray<{ text: string; score: number; rated: boolean }>
}

/** "Jab → Cross → Hook" as "Jab · cross · hook". */
export function comboName(text: string): string {
  const parts = text.split(/\s*(?:→|->|›|>|,|\s-\s|·|\+)\s*/).map(s => s.trim().toLowerCase()).filter(Boolean)
  const s = parts.join(' · ')
  return s ? s[0].toUpperCase() + s.slice(1) : text
}

export function fightBoard(inp: FightIn, start: number | null, today: number): FightView {
  const lastMon = mondayOf(today)
  const anyRounds = inp.rounds.some(r => r.rounds > 0 && r.day <= today)
  const weeks: FightWeek[] = []
  for (let i = FIGHT_WEEKS - 1; i >= 0; i--) {
    const mon = lastMon - i * 7
    const rounds = inp.rounds.filter(r => r.day >= mon && r.day <= mon + 6 && r.day <= today).reduce((s, r) => s + Math.max(0, r.rounds), 0)
    const wk = start != null ? weekOf(mon + 6, start) : 0
    const now = i === 0
    weeks.push({ weekStart: mon, rounds, now, label: !anyRounds ? (now ? 'NOW' : '') : wk >= 1 ? `W${wk}` : '' })
  }
  const thisWeek = weeks[weeks.length - 1].rounds
  const learned = inp.combos.filter(c => c.rated || c.score > 0)
  const mastered = learned.filter(c => c.score >= COMBO_MASTERED_AT)
  const close = learned.filter(c => c.score < COMBO_MASTERED_AT).sort((a, b) => b.score - a.score)[0]
  return {
    weeks,
    thisWeek,
    anyRounds,
    flap: `${thisWeek} ${thisWeek === 1 ? 'ROUND' : 'ROUNDS'}`,
    classes: { picked: inp.classDaysPicked, done: inp.classDays.filter(d => d >= lastMon && d <= today).length },
    combos: {
      learned: learned.length,
      mastered: mastered.length,
      closest: close ? { name: comboName(close.text), dots: Math.min(5, Math.floor(Math.max(0, close.score) / 3)), words: `${Math.max(0, close.score)} of ${COMBO_MASTERY_MAX} to mastered` } : null,
    },
  }
}

/** Where each week's bar sits (320 wide): 40 px apart, the tallest 60 px; empty, a short strip. */
export function fightBars(weeks: readonly FightWeek[]): { x: number; w: number; h: number; value: number; label: string; now: boolean }[] {
  const max = Math.max(1, ...weeks.map(w => w.rounds))
  return weeks.map((w, i) => ({ x: 20 + i * 40, w: 22.4, h: r1(w.rounds / max * 60), value: w.rounds, label: w.label, now: w.now }))
}

// ─── Strength since you started ──────────────────────────────

/** Estimated strength from one set: weight × (1 + reps ÷ 30), so 8 at 30 lb beats 5 at 30 lb. */
export function estStrength(weight: number, reps: number): number {
  return weight * (1 + Math.max(1, reps) / 30)
}

export interface LiftSetRow { day: number; exerciseId: string; weightKg: number | null; reps: number }

export interface LiftSince {
  exerciseId: string
  name: string
  /** How much stronger (lb, whole) by week since his first week of it; the first point is 0. */
  points: { week: number; gain: number }[]
  gain: number | null
}

export interface StrengthSinceView {
  lifts: LiftSince[]
  currentWeek: number
  up: number
  started: boolean
  flap: string
  line: string
}

const PATTERN_ORDER = ['squat', 'hinge', 'pull', 'press']

/** "Goblet squat", "DB RDL", "DB row", "Bench". */
export function liftName(exerciseId: string): string {
  const s = liftShort(exerciseId)
  return s[0].toUpperCase() + s.slice(1)
}

/**
 * One line per lift he actually does (main sets, at most four: the most done,
 * in squat, hinge, pull, press order), from 0 in his first week of it: the
 * week's best estimated strength (lb) over that first week's. Before any lift,
 * the planned lifts with "from today".
 */
export function strengthSince(sets: ReadonlyArray<LiftSetRow>, start: number, today: number, planned: { exerciseIds: readonly string[]; day: number | null; label: string | null } = { exerciseIds: [], day: null, label: null }): StrengthSinceView {
  const currentWeek = Math.max(1, weekOf(today, start))
  const mine = sets.filter(s => s.day >= start && s.day <= today && s.weightKg != null && s.weightKg > 0 && s.reps >= 1)
  const counts = new Map<string, number>()
  for (const s of mine) counts.set(s.exerciseId, (counts.get(s.exerciseId) ?? 0) + 1)
  const order = (id: string) => { const p = patternOf(id); return p ? PATTERN_ORDER.indexOf(p) : 9 }
  const chosen = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id).sort((a, b) => order(a) - order(b))
  let lifts: LiftSince[] = chosen.map(id => {
    const byWeek = new Map<number, number>()
    for (const s of mine.filter(x => x.exerciseId === id)) {
      const w = weekOf(s.day, start)
      byWeek.set(w, Math.max(byWeek.get(w) ?? 0, estStrength(kgToLbs(s.weightKg!), s.reps)))
    }
    const wk = [...byWeek.entries()].sort((a, b) => a[0] - b[0])
    const base = wk[0][1]
    const points = wk.map(([week, v]) => ({ week, gain: Math.round(v - base) }))
    return { exerciseId: id, name: liftName(id), points, gain: points[points.length - 1].gain }
  })
  const started = lifts.length > 0
  if (!started) lifts = [...new Set(planned.exerciseIds)].sort((a, b) => order(a) - order(b)).slice(0, 4).map(id => ({ exerciseId: id, name: liftName(id), points: [], gain: null }))
  const up = lifts.filter(l => (l.gain ?? 0) > 0).length
  let flap: string
  let line: string
  if (!started) {
    flap = 'FROM TODAY'
    const when = planned.day != null ? ` (${dayWord(planned.day, today)}${planned.label ? `, ${planned.label}` : ''})` : ''
    line = `Each lift counts from your first session${when}. The line shows how much stronger you get, reps included.`
  } else if (up > 0) {
    flap = `${up} ${up === 1 ? 'LIFT' : 'LIFTS'} UP`
    const best = [...lifts].sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))[0]
    line = `${best.name}: about ${best.gain} lb stronger than week 1.`
  } else {
    flap = 'WEEK 1 = 0'
    line = 'Your first week sets the zero. The lines climb as the weight or the reps go up.'
  }
  return { lifts, currentWeek, up, started, flap, line }
}

/** "+15 LB", "+0 LB", or "FROM TODAY" before his first set of it. */
export function liftFlap(l: LiftSince): string {
  return l.gain == null ? 'FROM TODAY' : `${l.gain >= 0 ? '+' : '−'}${Math.abs(l.gain)} LB`
}

/** The lines' corners (320 × 130): week 1 on the left, this week on the right, 0 on the base line, the most gained at the top. */
export function strengthLines(v: StrengthSinceView): { exerciseId: string; pts: { x: number; y: number }[] }[] {
  const span = Math.max(2, v.currentWeek)
  const maxGain = Math.max(1, ...v.lifts.flatMap(l => l.points.map(p => p.gain)))
  return v.lifts.map(l => ({
    exerciseId: l.exerciseId,
    pts: l.points.map(p => ({ x: r1(10 + (p.week - 1) / (span - 1) * 300), y: r1(Math.max(4, Math.min(124, 114 - p.gain / maxGain * 100))) })),
  }))
}

function parseJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? v as Record<string, unknown> : null
  } catch { return null }
}

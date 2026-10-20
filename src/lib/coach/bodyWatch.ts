// Injury weather and the raven (page 58, approved 2026-10-19, all 17 items;
// plan 2's bikes stay at the physio stage; "Not now" waits a day).
//
// When one place on him keeps coming back in his own reports, the forest
// turns: green rain, a raven on the Morning Report with a sealed note. The
// note says what the coach noticed (his dates), why it matters, a plan with a
// set length and exactly what it changes on his week. DO IT puts the plan on
// the week as ordinary coach changes (Dagaz, UNDO); GOT IT changes nothing.
// The raven comes back the morning after the plan ends with one question:
// FEELS BETTER clears the sky and steps the runs back up; STILL SORE gets one
// readjust (7 more days, gentler). Still sore after that: see a physio. No
// third plan, nothing locked, the rain stays until it feels better.
//
// Pure. The triggers are page 57's (injury-alert.md §2): T1 keeps coming
// back, T2 slow to settle, T3 not easing, T4 picked through, and the load
// jump as context only. The server (server/bodyWatch.ts) loads the inputs,
// stores body_alerts (0036) and writes the plan's change rows.
//
// Not medical advice. Nothing here blocks anything.

import { getRunWalkWeek } from '../blockZero/running'
import { getStrengthWeekTarget } from '../blockZero/strength'
import { normaliseRegion } from './injury'
import { mondayOf } from './sessions'

// ─── Places ──────────────────────────────────────────────────

export const BODY_REGIONS = ['back', 'knee', 'hip', 'ankle', 'shin', 'shoulder', 'neck', 'elbow', 'wrist', 'rib', 'leg'] as const
export type BodyRegion = typeof BODY_REGIONS[number]

export function isBodyRegion(r: string | null | undefined): r is BodyRegion {
  return r != null && (BODY_REGIONS as readonly string[]).includes(r)
}

/** The place as one word on a line ("Knee: 4 times in 17 days."). */
export const PLACE_NAME: Readonly<Record<BodyRegion, string>> = {
  back: 'Back', knee: 'Knee', hip: 'Hip', ankle: 'Ankle', shin: 'Shin', shoulder: 'Shoulder',
  neck: 'Neck', elbow: 'Elbow', wrist: 'Wrist', rib: 'Ribs', leg: 'Leg',
}

/** The per-place plans (§3.5): five groups. Ribs load like the arms (bag work, MT). */
export type PlanGroup = 'lower' | 'back' | 'arm' | 'neck' | 'hipleg'

export function groupOf(region: BodyRegion): PlanGroup {
  switch (region) {
    case 'knee': case 'ankle': case 'shin': return 'lower'
    case 'back': return 'back'
    case 'shoulder': case 'elbow': case 'wrist': case 'rib': return 'arm'
    case 'neck': return 'neck'
    case 'hip': case 'leg': return 'hipleg'
  }
}

const RUNS = new Set(['foundation_run', 'running'])

/**
 * What the coach leaves out of its picks while a place is on watch (page 57
 * §5). His picks of these are recorded quietly (T4), never refused.
 */
export function leftOutFor(region: BodyRegion, type: string, notes: string | null = null): boolean {
  switch (groupOf(region)) {
    case 'lower': return RUNS.has(type) || type === 'skip_rope'
    case 'back': return type === 'strength'
    case 'arm': case 'neck': return type === 'bag_work' || type === 'mt_class'
    case 'hipleg': return type === 'skip_rope' || (type === 'running' && notes === 'progression')
  }
}

// ─── Reports ─────────────────────────────────────────────────

const PAIN = /\b(pain(?:ful|s)?|sore(?:ness)?|hurt(?:s|ing)?|tweak(?:ed|s)?|twinge(?:s|d)?|ach(?:e|es|ing|y)|sharp|swollen|swelling|rolled)\b/i

const REGION_WORDS: ReadonlyArray<[BodyRegion, RegExp]> = [
  ['back', /\b(back|spine|lumbar|disc|sciatic\w*)\b/i],
  ['knee', /\bknees?\b/i],
  ['hip', /\b(hips?|groin)\b/i],
  ['ankle', /\b(ankles?|achilles|foot|feet|heels?)\b/i],
  ['shin', /\b(shins?|calf|calves)\b/i],
  ['shoulder', /\bshoulders?\b/i],
  ['neck', /\bneck\b/i],
  ['elbow', /\belbows?\b/i],
  ['wrist', /\b(wrists?|hands?|fingers?|knuckles?)\b/i],
  ['rib', /\b(ribs?|chest)\b/i],
  ['leg', /\b(hamstrings?|quads?|thighs?|legs?)\b/i],
]

/** The places a note names together with a pain word ("knee sore the last two rounds"). */
export function notePain(text: string | null | undefined): BodyRegion[] {
  const t = (text ?? '').trim()
  if (!t || !PAIN.test(t)) return []
  return REGION_WORDS.filter(([, re]) => re.test(t)).map(([r]) => r)
}

/** A skip's place, from the skip sheet's word or its free text. */
export function skipRegion(detail: string | null | undefined, notes?: string | null): BodyRegion | null {
  const r = normaliseRegion(detail) ?? normaliseRegion(notes)
  return isBodyRegion(r) ? r : null
}

export interface WatchInputs {
  /** Skipped sessions (any reason; only injury with a place counts). `name`: "the run-walk", "bag work". */
  skips: ReadonlyArray<{ day: number; reason: string | null; detail: string | null; notes?: string | null; name: string }>
  /** His session notes (context_json.userNotes), with the session's name. */
  notes: ReadonlyArray<{ day: number; text: string; name: string }>
  /** Back today, 1-5 (1 bad, 2 sore, 3 stiff, 4 good, 5 fine). */
  backMornings: ReadonlyArray<{ day: number; value: number | null }>
  /** "<Place> today" from the check-in, 1-5 like Back today. */
  ratings: ReadonlyArray<{ day: number; region: string; value: number }>
  /** His picks of what the coach left out for a place (week_adjustments.against_flag). */
  picks: ReadonlyArray<{ day: number; region: string; name: string }>
  /** Runs he did: the bout (one run segment) and the whole run. */
  runs: ReadonlyArray<{ day: number; boutSec: number; totalSec: number }>
}

export type ReportKind = 'skip' | 'note' | 'back'

export interface Report {
  day: number
  kind: ReportKind
  /** The line as the note shows it; a note's own words go in `quote`. */
  text: string
  quote?: string
}

const KIND_RANK: Record<ReportKind, number> = { skip: 0, note: 1, back: 2 }

/** A place's reports, one per day (a skip first, then a note, then a sore morning), oldest first. */
export function reportsFor(region: BodyRegion, inp: WatchInputs): Report[] {
  const place = PLACE_NAME[region]
  const all: Report[] = []
  for (const s of inp.skips) {
    if (s.reason !== 'injury' || skipRegion(s.detail, s.notes) !== region) continue
    all.push({ day: s.day, kind: 'skip', text: `Skipped ${s.name}. ${place}.` })
  }
  for (const n of inp.notes) {
    if (!notePain(n.text).includes(region)) continue
    all.push({ day: n.day, kind: 'note', text: `Your note on ${n.name}: `, quote: n.text.trim() })
  }
  // The back is asked every morning: only bad or sore mornings count, never stiff.
  if (region === 'back') {
    for (const m of inp.backMornings) {
      if (m.value == null || m.value > 2) continue
      all.push({ day: m.day, kind: 'back', text: `Back today: ${m.value === 1 ? 'bad' : 'sore'}.` })
    }
  }
  const byDay = new Map<number, Report>()
  for (const r of all) {
    const prev = byDay.get(r.day)
    if (!prev || KIND_RANK[r.kind] < KIND_RANK[prev.kind]) byDay.set(r.day, r)
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day)
}

/** A place's morning ratings (the back's from Back today), oldest first. */
export function ratingsFor(region: BodyRegion, inp: WatchInputs): Array<{ day: number; value: number }> {
  const list = region === 'back'
    ? inp.backMornings.filter(m => m.value != null).map(m => ({ day: m.day, value: m.value as number }))
    : inp.ratings.filter(r => r.region === region).map(r => ({ day: r.day, value: r.value }))
  return list.filter(r => r.value >= 1 && r.value <= 5).sort((a, b) => a.day - b.day)
}

// ─── Triggers ────────────────────────────────────────────────

export type Trigger = 'comes_back' | 'slow' | 'not_easing' | 'picked_through'

export const COMES_BACK_WINDOW = 42
export const COMES_BACK_COUNT = 3
export const QUIET_GAP_DAYS = 14

/** Days after the first report before "slow to settle" (the back's curve is 6 weeks). */
export function slowDays(region: BodyRegion): number {
  return region === 'back' ? 42 : 21
}

export interface WatchEval {
  region: BodyRegion
  triggers: Trigger[]
  /** 1 green rain, 2 downpour, 3 storm. */
  level: 0 | 1 | 2 | 3
  /** This run of reports (from its first), oldest first. */
  reports: Report[]
  /** His picks against the place in this run (quiet lines on the note). */
  picks: Array<{ day: number; name: string }>
  /** Reports in the last 42 days. */
  count: number
  first: number
  latest: number
  /** The load-jump line (context only, never raises the weather). */
  contextLine: string | null
}

/** The first report of the run the latest one belongs to (a 14-day gap ends a run). */
export function runStart(reports: ReadonlyArray<Report>): number | null {
  if (reports.length === 0) return null
  let first = reports[reports.length - 1].day
  for (let i = reports.length - 2; i >= 0; i--) {
    if (first - reports[i].day >= QUIET_GAP_DAYS) break
    first = reports[i].day
  }
  return first
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Mornings of the 7 days ending `end`. */
function weekOf<T extends { day: number }>(list: ReadonlyArray<T>, end: number): T[] {
  return list.filter(r => r.day <= end && r.day > end - 7)
}

/** The back's T2 and T3 need 4 bad or sore mornings in each of two weeks running. */
function backSoreTwoWeeks(ratings: ReadonlyArray<{ day: number; value: number }>, today: number): boolean {
  const sore = (end: number) => weekOf(ratings, end).filter(r => r.value <= 2).length >= 4
  return sore(today) && sore(today - 7)
}

/** T3: this week's average rating no better than last week's (4 ratings each, at least). */
export function notEasing(region: BodyRegion, ratings: ReadonlyArray<{ day: number; value: number }>, today: number): boolean {
  const now = weekOf(ratings, today)
  const before = weekOf(ratings, today - 7)
  if (now.length < 4 || before.length < 4) return false
  if (region === 'back' && !backSoreTwoWeeks(ratings, today)) return false
  return avg(now.map(r => r.value)) <= avg(before.map(r => r.value))
}

/** The week's mornings beat the week before (one level down when there's no new report). */
export function morningsBetter(ratings: ReadonlyArray<{ day: number; value: number }>, today: number): boolean {
  const now = weekOf(ratings, today)
  const before = weekOf(ratings, today - 7)
  if (now.length < 3 || before.length < 3) return false
  return avg(now.map(r => r.value)) > avg(before.map(r => r.value))
}

/** The pattern for one place on `today`, or null when nothing fires. */
export function evaluateWatch(region: BodyRegion, inp: WatchInputs, today: number): WatchEval | null {
  const all = reportsFor(region, inp).filter(r => r.day <= today)
  const first = runStart(all)
  if (first == null) return null
  const latest = all[all.length - 1].day
  // Nothing recent: a run that went quiet raises nothing.
  if (today - latest >= QUIET_GAP_DAYS) return null
  const reports = all.filter(r => r.day >= first)
  const inWindow = all.filter(r => r.day > today - COMES_BACK_WINDOW)
  const ratings = ratingsFor(region, inp).filter(r => r.day <= today)
  const triggers: Trigger[] = []

  // T1: the same place 3 times in 42 days (old dates still count after a clearing).
  if (inWindow.length >= COMES_BACK_COUNT) triggers.push('comes_back')

  // T2: still reported (or rated bad / sore) 21 days on (42 for the back).
  const late = first + slowDays(region)
  const lateReport = reports.some(r => r.day >= late && r.day > today - QUIET_GAP_DAYS)
  const lateRating = ratings.some(r => r.day >= late && r.day > today - QUIET_GAP_DAYS && r.value <= 2)
  if ((lateReport || lateRating) && (region !== 'back' || backSoreTwoWeeks(ratings, today))) triggers.push('slow')

  // T3: not easing week to week.
  if (notEasing(region, ratings, today)) triggers.push('not_easing')

  // T4: twice in 14 days he picks what the coach left out, and it's reported again within 3 days.
  const picks = inp.picks.filter(p => p.region === region && p.day <= today).sort((a, b) => a.day - b.day)
  for (let i = 1; i < picks.length; i++) {
    const p = picks[i]
    if (p.day < today - 14 || p.day - picks[i - 1].day > 14) continue
    if (all.some(r => r.day >= p.day && r.day <= p.day + 3)) { triggers.push('picked_through'); break }
  }

  if (triggers.length === 0) return null
  return {
    region,
    triggers,
    level: levelFor(triggers),
    reports,
    picks: picks.filter(p => p.day >= first).map(p => ({ day: p.day, name: p.name })),
    count: inWindow.length,
    first,
    latest,
    contextLine: loadJumpLine(reports, inp.runs),
  }
}

/** One pattern: green rain. Two, or not easing: a downpour. Picked through: a storm. */
export function levelFor(triggers: ReadonlyArray<Trigger>): 0 | 1 | 2 | 3 {
  if (triggers.includes('picked_through')) return 3
  const base = triggers.filter(t => t === 'comes_back' || t === 'slow').length
  if (triggers.includes('not_easing') || base >= 2) return 2
  return base >= 1 ? 1 : 0
}

/** "2:00", "3:30". */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The bout went up from the week before (calendar weeks): [from, to] or null. */
function boutJump(day: number, runs: WatchInputs['runs']): [number, number] | null {
  const mon = mondayOf(day)
  const now = runs.filter(r => r.day >= mon && r.day <= day).map(r => r.boutSec)
  const before = runs.filter(r => r.day >= mon - 7 && r.day < mon).map(r => r.boutSec)
  if (now.length === 0 || before.length === 0) return null
  const a = Math.max(...before), b = Math.max(...now)
  return b > a ? [a, b] : null
}

/**
 * The load-jump line (context only, never raises the weather): the week each
 * run went longer at a time, or a run more than 10% longer than the 30-day
 * longest within the week before (Nielsen 2025). It says when, not why.
 */
export function loadJumpLine(reports: ReadonlyArray<Report>, runs: WatchInputs['runs']): string | null {
  if (reports.length === 0) return null
  const last = reports[reports.length - 1]
  const jl = boutJump(last.day, runs)
  if (jl) {
    const prev = reports.length >= 2 ? reports[reports.length - 2] : null
    const jp = prev ? boutJump(prev.day, runs) : null
    if (prev && jp && jp[0] === jl[0] && jp[1] === jl[1]) return `The last two came the week each run went from ${mmss(jl[0])} to ${mmss(jl[1])} at a time.`
    return `This one came the week each run went from ${mmss(jl[0])} to ${mmss(jl[1])} at a time.`
  }
  for (const r of runs) {
    if (r.day > last.day || r.day < last.day - 7) continue
    const longest = Math.max(0, ...runs.filter(o => o.day < r.day && o.day >= r.day - 30).map(o => o.totalSec))
    if (longest > 0 && r.totalSec > longest * 1.1) return 'It came within a week of your longest run in a month.'
  }
  return null
}

/**
 * Page 57's quiet rule: no report for 14 days, and good or fine on 5 of the
 * last 7 mornings (21 quiet days when he never rated it).
 */
export function shouldClear(region: BodyRegion, inp: WatchInputs, today: number, openedDay: number): boolean {
  const reports = reportsFor(region, inp).filter(r => r.day <= today)
  const latest = reports.length ? reports[reports.length - 1].day : -Infinity
  if (today - latest < QUIET_GAP_DAYS) return false
  const ratings = ratingsFor(region, inp).filter(r => r.day <= today && r.day >= openedDay - 7)
  if (ratings.length === 0) return today - latest >= 21
  return weekOf(ratings, today).filter(r => r.value >= 4).length >= 5
}

// ─── The lifecycle ───────────────────────────────────────────

/**
 * watch: the raven landed, the note is new. noted: GOT IT on the note.
 * plan1: DO IT. ask1: the morning after plan 1. offer2: STILL SORE, plan 2
 * on its note. noted2: GOT IT on plan 2. plan2: DO IT. ask2: the morning
 * after plan 2. physio: STILL SORE again. cleared: FEELS BETTER, or quiet.
 */
export type BodyStage = 'watch' | 'noted' | 'plan1' | 'ask1' | 'offer2' | 'noted2' | 'plan2' | 'ask2' | 'physio' | 'cleared'
export type BodyEvent = 'got' | 'doit' | 'ask_due' | 'better' | 'sore' | 'not_now' | 'quiet'

export const BODY_STAGES: ReadonlyArray<BodyStage> = ['watch', 'noted', 'plan1', 'ask1', 'offer2', 'noted2', 'plan2', 'ask2', 'physio', 'cleared']

export function isBodyStage(s: string | null | undefined): s is BodyStage {
  return s != null && (BODY_STAGES as readonly string[]).includes(s)
}

/**
 * The state machine. Null: the event does nothing in that stage. One
 * readjust, ever: STILL SORE at the second return is the physio board, and
 * nothing leads to a third plan.
 */
export function stepAfter(stage: BodyStage, event: BodyEvent): BodyStage | null {
  if (stage === 'cleared') return null
  if (event === 'quiet') return 'cleared'
  switch (stage) {
    case 'watch': return event === 'got' ? 'noted' : event === 'doit' ? 'plan1' : null
    case 'noted': return event === 'doit' ? 'plan1' : event === 'got' ? 'noted' : null
    case 'plan1': return event === 'ask_due' ? 'ask1' : event === 'got' ? 'plan1' : null
    case 'ask1': return event === 'better' ? 'cleared' : event === 'sore' ? 'offer2' : event === 'not_now' ? 'ask1' : null
    case 'offer2': return event === 'got' ? 'noted2' : event === 'doit' ? 'plan2' : null
    case 'noted2': return event === 'doit' ? 'plan2' : event === 'got' ? 'noted2' : null
    case 'plan2': return event === 'ask_due' ? 'ask2' : event === 'got' ? 'plan2' : null
    case 'ask2': return event === 'better' ? 'cleared' : event === 'sore' ? 'physio' : event === 'not_now' ? 'ask2' : null
    case 'physio': return event === 'better' ? 'cleared' : event === 'got' ? 'physio' : null
  }
}

/** Plans the coach has made this episode (never more than 2). */
export function roundOf(stage: BodyStage): 0 | 1 | 2 {
  if (stage === 'plan1' || stage === 'ask1' || stage === 'offer2' || stage === 'noted2') return 1
  if (stage === 'plan2' || stage === 'ask2' || stage === 'physio') return 2
  return 0
}

/** The raven asks today (the morning pass opened it, and "Not now" isn't waiting). */
export function askDue(stage: BodyStage, askOn: number | null, today: number): boolean {
  return (stage === 'ask1' || stage === 'ask2') && askOn != null && today >= askOn
}

// ─── The weather ─────────────────────────────────────────────

export interface BodyWeather {
  /** 1 green rain, 2 downpour, 3 storm; 0 none. */
  level: 0 | 1 | 2 | 3
  /** After GOT IT or DO IT: the quieter fall (about 60%). */
  quiet: boolean
  /** The day it clears: rain stops, sun shafts, new shoots. */
  clearing: boolean
}

/**
 * Loud while a note is new (the raven just landed, plan 2 is offered) or the
 * pattern got stronger since he last answered; quieter after GOT IT or DO IT,
 * until something changes. The rain stays at the physio stage.
 */
export function weatherFor(a: { stage: BodyStage; level: number; ackedLevel: number; clearedAt: number | null }, today: number): BodyWeather {
  if (a.stage === 'cleared') return { level: 0, quiet: false, clearing: a.clearedAt === today }
  const level = Math.max(1, Math.min(3, a.level)) as 1 | 2 | 3
  const loud = a.stage === 'watch' || a.stage === 'offer2' || a.level > a.ackedLevel
  return { level, quiet: !loud, clearing: false }
}

// ─── Words ───────────────────────────────────────────────────

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAYW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

const dateOf = (day: number) => new Date(day * 86400000)
const dow = (day: number) => dateOf(day).getUTCDay()

/** "TUE 6 OCT": a dated line on a board. */
export function dayMonth(day: number): string {
  const d = dateOf(day)
  return `${DAY3[d.getUTCDay()]} ${d.getUTCDate()} ${MON3[d.getUTCMonth()]}`
}

/** "SAT 24": a day on a change row. */
export function dayShort(day: number): string {
  return `${DAY3[dow(day)]} ${dateOf(day).getUTCDate()}`
}

/** "Fri 23", or "Tue 3 Nov" when the month isn't `ref`'s. */
export function dayWord(day: number, ref: number): string {
  const d = dateOf(day)
  const r = dateOf(ref)
  const month = d.getUTCMonth() !== r.getUTCMonth() ? ` ${MON3[d.getUTCMonth()].charAt(0)}${MON3[d.getUTCMonth()].slice(1).toLowerCase()}` : ''
  return `${DAYW[d.getUTCDay()]} ${d.getUTCDate()}${month}`
}

/** "Five", "Seven". */
export function numberWord(n: number): string {
  return NUM[n] ?? String(n)
}

function relDay(day: number, ref: number): string {
  if (day === ref + 1) return 'Tomorrow'
  if (day === ref) return 'Today'
  return DAY_LONG[dow(day)]
}

/** "the run-walk", "bag work", "Strength B": a session as a line names it. */
export function sessionWords(s: { type: string; label: string | null; notes?: string | null }): string {
  switch (s.type) {
    case 'foundation_run': return 'the run-walk'
    case 'running': return s.notes === 'zone2' ? 'the Zone 2 run' : 'the run'
    case 'bag_work': return 'bag work'
    case 'skip_rope': return 'skip rope'
    case 'mt_class': return 'MT class'
    case 'strength': return s.label?.trim() || 'strength'
    case 'mobility': return 'Foundation'
    case 'active_recovery': return s.label?.trim() || 'Reset'
    default: return s.label?.trim() || s.type.replace(/_/g, ' ')
  }
}

// ─── The plans (fixed strings per place, from the app's existing eases) ──

/** What a plan does to one session. */
export type PlanOp =
  | { kind: 'bike'; label: 'Easy Bike' | 'Easy Walk' }
  | { kind: 'reset' }
  | { kind: 'shape'; week: number }
  | { kind: 'technique' }
  | { kind: 'one_set' }
  | { kind: 'back' }
  | { kind: 'badday'; which: 'back' | 'neck' }

/** A session the plan reads: an existing row, or a day of the template not made yet (id null). */
export interface PlanSession {
  id: string | null
  day: number
  type: string
  label: string | null
  notes: string | null
  timeSlot: 'am' | 'pm'
  status: string
  /** Its training week (run-walk shape, strength sets). */
  week: number
  blockZero: boolean
  /** The body-plan change already on it, if any (this episode's). */
  plan?: { op: PlanOp['kind']; was: string; shapeWeek?: number } | null
}

export interface PlanChange {
  sessionId: string | null
  day: number
  /** The session as the plan found it (the template entry for an unmade day). */
  type: string
  label: string | null
  notes: string | null
  timeSlot: 'am' | 'pm'
  op: PlanOp
  /** The flaps: before -> after ("RUN-WALK" -> "EASY BIKE"). */
  before: string
  after: string
  /** The type after (for the icon). */
  afterType: string
  /** "was run 4:00 × 5": what the day board says it was. */
  was: string
}

export interface PlanPreview {
  /** The session type after the change (its icon). */
  type: string
  notes: string | null
  days: string
  before: string
  after: string
}

export interface RecLine { b: string; rest: string }

export interface BodyPlan {
  round: 1 | 2
  start: number
  end: number
  askOn: number
  lines: RecLine[]
  changes: PlanChange[]
  preview: PlanPreview[]
}

/** A plan as its note shows it (kept on the alert once DO IT applies it). */
export type PlanShown = Pick<BodyPlan, 'round' | 'start' | 'end' | 'askOn' | 'lines' | 'preview'>

const RUN_LIKE = (t: string) => RUNS.has(t) || t === 'skip_rope'

/** A run-walk's shape for a session (its own week, or the plan's step). */
export function shapeOf(s: Pick<PlanSession, 'week' | 'plan'>): { runSec: number; walkSec: number; rounds: number } {
  const w = getRunWalkWeek(s.plan?.op === 'shape' && s.plan.shapeWeek ? s.plan.shapeWeek : s.week)
  return { runSec: w.runSec, walkSec: w.walkSec, rounds: w.rounds }
}

/** "RUN 4:00 × 5". */
export function runFlap(week: number): string {
  const w = getRunWalkWeek(week)
  return `RUN ${mmss(w.runSec)} × ${w.rounds}`
}

/** "3 × 8" for a week's main lifts, and the one-set-lighter "2 × 8". */
export function setsFlap(week: number, minus = 0): string {
  const t = getStrengthWeekTarget(week)
  return `${Math.max(1, t.mainSets - minus)} × ${t.reps}`
}

/** The session's name on a flap ("RUN-WALK", "BAG WORK"). */
export function sessionFlap(s: Pick<PlanSession, 'type' | 'label' | 'notes'>): string {
  switch (s.type) {
    case 'foundation_run': return 'RUN-WALK'
    case 'running': return 'RUN'
    case 'skip_rope': return 'SKIP ROPE'
    case 'bag_work': return 'BAG WORK'
    case 'mt_class': return 'MT CLASS'
    case 'mobility': return 'FOUNDATION'
    case 'active_recovery': return (s.label?.trim() || 'Reset').toUpperCase()
    case 'strength': return (s.label?.trim() || 'Strength').toUpperCase()
    default: return s.type.replace(/_/g, ' ').toUpperCase()
  }
}

/** The day board's "was" words for a run ("run 4:00 × 5"), else the name. */
function wasWords(s: PlanSession): string {
  if (s.type === 'foundation_run' && s.blockZero) {
    const w = shapeOf({ week: s.week, plan: null })
    return `run ${mmss(w.runSec)} × ${w.rounds}`
  }
  return sessionWords(s)
}

function changeFor(s: PlanSession, op: PlanOp): PlanChange {
  const base = { sessionId: s.id, day: s.day, type: s.type, label: s.label, notes: s.notes, timeSlot: s.timeSlot, op }
  switch (op.kind) {
    case 'bike': return { ...base, before: sessionFlap(s), after: op.label.toUpperCase(), afterType: 'active_recovery', was: wasWords(s) }
    case 'reset': return { ...base, before: sessionFlap(s), after: 'RESET', afterType: 'active_recovery', was: sessionWords(s) }
    case 'shape': {
      const w = shapeOf({ week: s.week, plan: null })
      return { ...base, before: runFlap(s.week), after: runFlap(op.week), afterType: s.type, was: `${mmss(w.runSec)} × ${w.rounds}` }
    }
    case 'technique': return { ...base, before: sessionFlap(s), after: 'TECHNIQUE', afterType: s.type, was: sessionWords(s) }
    case 'one_set': return { ...base, before: setsFlap(s.week), after: setsFlap(s.week, 1), afterType: s.type, was: setsFlap(s.week) }
    case 'back': return { ...base, before: setsFlap(s.week), after: 'BACK-FRIENDLY', afterType: s.type, was: setsFlap(s.week) }
    case 'badday': return { ...base, before: 'FOUNDATION', after: op.which === 'back' ? 'BAD-BACK DAY' : 'BAD-NECK DAY', afterType: s.type, was: 'Foundation' }
  }
}

/** Group the changes for the note's "On your week" rows: one row per before -> after, its days joined. */
export function previewOf(changes: ReadonlyArray<PlanChange>): PlanPreview[] {
  const out: Array<PlanPreview & { first: number }> = []
  for (const c of [...changes].sort((a, b) => a.day - b.day)) {
    const hit = out.find(p => p.before === c.before && p.after === c.after && p.type === c.afterType)
    if (hit) { if (!hit.days.split(' · ').includes(dayShort(c.day))) hit.days += ` · ${dayShort(c.day)}`; continue }
    out.push({ type: c.afterType, notes: c.afterType === c.type ? c.notes : null, days: dayShort(c.day), before: c.before, after: c.after, first: c.day })
  }
  // The mockup's order: what changes inside the plan, then what comes after it.
  return out.sort((a, b) => a.first - b.first).map(({ first: _f, ...p }) => { void _f; return p })
}

const live = (s: PlanSession) => s.status === 'planned'

/** One set lighter needs a set to take (week 6 is already 1 × 8). */
const canLighten = (s: PlanSession) => !s.blockZero || getStrengthWeekTarget(s.week).mainSets > 1

/** Plan 1 starts tomorrow (5 days); plan 2 runs 7 more days from the return morning. */
export const PLAN_DAYS: Readonly<Record<1 | 2, number>> = { 1: 5, 2: 7 }

/**
 * planFor(region, round): the plan's lines and its changes on the week.
 * `today` is the day it is offered (plan 1: the note; plan 2: the return).
 * Changes start tomorrow; plan 1's runs come back at week 3's 2:00 / 1:00 × 7
 * for the next two runs after it.
 */
export function planFor(region: BodyRegion, round: 1 | 2, today: number, sessions: ReadonlyArray<PlanSession>): BodyPlan {
  const start = round === 1 ? today + 1 : today
  const end = start + PLAN_DAYS[round] - 1
  const from = today + 1
  const inPlan = sessions.filter(s => s.day >= from && s.day <= end && live(s)).sort((a, b) => a.day - b.day || (a.timeSlot === 'am' ? -1 : 1))
  const group = groupOf(region)
  const changes: PlanChange[] = []
  const add = (s: PlanSession, op: PlanOp) => changes.push(changeFor(s, op))
  const W = (d: number) => dayWord(d, today)

  for (const s of inPlan) {
    switch (group) {
      case 'lower':
        if (RUN_LIKE(s.type)) add(s, { kind: 'bike', label: 'Easy Bike' })
        // His bag work goes technique-only; a class comes off (Reset), never "go light in class".
        else if (round === 2 && s.type === 'bag_work') add(s, { kind: 'technique' })
        else if (round === 2 && s.type === 'mt_class') add(s, { kind: 'reset' })
        else if (round === 2 && s.type === 'strength' && canLighten(s)) add(s, { kind: 'one_set' })
        break
      case 'back':
        if (s.type === 'strength') add(s, { kind: 'back' })
        else if (s.type === 'mobility') add(s, { kind: 'badday', which: 'back' })
        else if (round === 2 && RUN_LIKE(s.type)) add(s, { kind: 'bike', label: 'Easy Walk' })
        break
      case 'arm':
        if (s.type === 'bag_work' || s.type === 'mt_class') add(s, { kind: 'reset' })
        else if (round === 2 && s.type === 'strength' && canLighten(s)) add(s, { kind: 'one_set' })
        break
      case 'neck':
        if (s.type === 'bag_work' || s.type === 'mt_class') add(s, { kind: 'reset' })
        else if (s.type === 'mobility') add(s, { kind: 'badday', which: 'neck' })
        else if (round === 2 && s.type === 'strength' && canLighten(s)) add(s, { kind: 'one_set' })
        break
      case 'hipleg':
        if (s.type === 'skip_rope' || (s.type === 'running' && s.notes === 'progression')) add(s, { kind: 'reset' })
        else if (round === 2 && RUNS.has(s.type)) add(s, { kind: 'bike', label: 'Easy Walk' })
        break
    }
  }
  // Plan 1, knee / ankle / shin: the next two runs after it come back at 2:00 segments.
  if (group === 'lower' && round === 1) {
    const after = sessions.filter(s => s.day > end && live(s) && s.type === 'foundation_run' && s.blockZero).sort((a, b) => a.day - b.day).slice(0, 2)
    for (const s of after) if (getRunWalkWeek(s.week).runSec > getRunWalkWeek(3).runSec) add(s, { kind: 'shape', week: 3 })
  }

  const lines = planLines(group, round, start, end, W)
  return { round, start, end, askOn: end + 1, lines, changes, preview: previewOf(changes) }
}

function planLines(group: PlanGroup, round: 1 | 2, start: number, end: number, W: (d: number) => string): RecLine[] {
  const span = ` ${W(start)} to ${W(end)}.`
  const to = ` to ${W(end)}.`
  switch (group) {
    case 'lower': return round === 1
      ? [{ b: 'No running or rope,', rest: span }, { b: 'Bike or walk instead,', rest: ' easy, 25 min.' }, { b: 'Then 2:00 run segments,', rest: ' walk 1:00 × 7.' }]
      : [{ b: 'No running or rope', rest: to }, { b: 'Bike or walk instead:', rest: ' easy, pain-free, 25 min.' }, { b: 'Bag work technique only;', rest: ' lifts one set lighter, RPE 6.' }, { b: 'Then 2:00 run segments,', rest: ' if it feels better.' }]
    case 'back': return round === 1
      ? [{ b: 'No heavy hinge or squat,', rest: span }, { b: 'Back-friendly lifts instead,', rest: ' one set less.' }, { b: "Foundation's bad-back day", rest: ' each morning.' }]
      : [{ b: 'Back-friendly lifts', rest: to }, { b: 'Walking only for conditioning:', rest: ' easy, pain-free, 25 min.' }, { b: "Foundation's bad-back day", rest: ' each morning.' }]
    case 'arm': return round === 1
      ? [{ b: 'No bag work or MT,', rest: span }, { b: 'Reset instead,', rest: ' easy, 25 min.' }, { b: 'Runs and lifts', rest: ' stay as planned.' }]
      : [{ b: 'No bag work or MT', rest: to }, { b: 'Lifts one set lighter,', rest: ' and no pressing.' }, { b: 'Runs', rest: ' stay as planned.' }]
    case 'neck': return round === 1
      ? [{ b: 'No bag work or MT,', rest: span }, { b: "Foundation's bad-neck version", rest: ' each morning.' }, { b: 'Reset instead,', rest: ' easy, 25 min.' }]
      : [{ b: 'No bag work or MT', rest: to }, { b: "Foundation's bad-neck version", rest: ' each morning.' }, { b: 'No heavy carries;', rest: ' lifts one set lighter.' }]
    case 'hipleg': return round === 1
      ? [{ b: 'No rope or progression runs,', rest: span }, { b: 'Easy run-walks', rest: ' stay as planned.' }, { b: 'Reset instead of rope,', rest: ' easy, 25 min.' }]
      : [{ b: 'Runs become walks', rest: to }, { b: 'No rope', rest: ' or progression runs.' }, { b: 'Easy, pain-free,', rest: ' 25 min.' }]
  }
}

/** A plan in a few words: "5 days of bike, no running". */
export function planWords(group: PlanGroup, days: number): string {
  switch (group) {
    case 'lower': return `${days} days of bike, no running`
    case 'back': return `${days} days of back-friendly lifts`
    case 'arm': return `${days} days without bag work or MT`
    case 'neck': return `${days} days without bag work or MT`
    case 'hipleg': return `${days} days without rope`
  }
}

/** The plan's short line on the Morning Report and Program ("bike to Tue 27"). */
function planVerb(group: PlanGroup): string {
  switch (group) {
    case 'lower': return 'bike'
    case 'back': return 'back-friendly lifts'
    case 'arm': case 'neck': return 'no bag work'
    case 'hipleg': return 'no rope'
  }
}

/** The physio stage keeps plan 2's bikes on the week (approved): new runs become bikes too. */
export function holdChanges(region: BodyRegion, from: number, sessions: ReadonlyArray<PlanSession>): PlanChange[] {
  const group = groupOf(region)
  if (group !== 'lower' && group !== 'back' && group !== 'hipleg') return []
  const out: PlanChange[] = []
  for (const s of sessions) {
    if (s.day < from || !live(s) || s.plan) continue
    if (group === 'lower' && RUN_LIKE(s.type)) out.push(changeFor(s, { kind: 'bike', label: 'Easy Bike' }))
    else if (group !== 'lower' && RUNS.has(s.type)) out.push(changeFor(s, { kind: 'bike', label: 'Easy Walk' }))
    else if (group === 'hipleg' && s.type === 'skip_rope') out.push(changeFor(s, { kind: 'reset' }))
  }
  return out
}

/** One step of stepping back up on FEELS BETTER. */
export interface StepUpChange {
  /** Null: a day whose sessions aren't made yet (it waits for them). */
  sessionId: string | null
  day: number
  /** Put back the plan's change on it first. */
  revert: boolean
  /** Then the run's shape, or null for the plan as it was. */
  shapeWeek: number | null
  before: string
  after: string
  /** Already at that step (plan 1's 2:00 run): nothing to write, but it is part of the step back up. */
  same?: boolean
}

/**
 * FEELS BETTER (or the quiet rule): the runs step back up one week at a time.
 * The first run back is 2:00 / 1:00 × 7, the second 3:30 / 1:00 × 5 (week
 * 4's), then the plan. Every other change of the episode goes back as it was.
 */
export function stepUp(region: BodyRegion, from: number, sessions: ReadonlyArray<PlanSession>): StepUpChange[] {
  const ahead = sessions.filter(s => s.day >= from && live(s)).sort((a, b) => a.day - b.day || (a.timeSlot === 'am' ? -1 : 1))
  const out: StepUpChange[] = []
  const lower = groupOf(region) === 'lower'
  const STEPS = [3, 4]
  let runIdx = 0
  for (const s of ahead) {
    const isRun = (s.type === 'foundation_run' && s.blockZero) || (s.plan?.op === 'bike' && lower)
    if (lower && isRun && s.blockZero && runIdx < STEPS.length) {
      const step = STEPS[runIdx++]
      const own = getRunWalkWeek(s.week)
      const target = own.runSec > getRunWalkWeek(step).runSec ? step : null
      const nowWeek = s.plan?.op === 'shape' ? s.plan.shapeWeek ?? null : null
      if (s.plan?.op !== 'bike' && nowWeek === target) {
        if (target != null) out.push({ sessionId: s.id, day: s.day, revert: false, shapeWeek: target, before: runFlap(target), after: runFlap(target), same: true })
        continue
      }
      out.push({
        sessionId: s.id, day: s.day, revert: s.plan != null, shapeWeek: target,
        before: s.plan?.op === 'bike' ? 'EASY BIKE' : nowWeek ? runFlap(nowWeek) : runFlap(s.week),
        after: target ? runFlap(target) : runFlap(s.week),
      })
      continue
    }
    if (s.plan && s.id) out.push({ sessionId: s.id, day: s.day, revert: true, shapeWeek: null, before: '', after: '' })
  }
  return out
}

// ─── The boards ──────────────────────────────────────────────

export interface BoardLine {
  /** "TUE 6 OCT". */
  d: string
  x: string
  /** His own words, in quotes, then the rest of the line. */
  q?: string
  tail?: string
  /** His own pick against the place: a quieter grey line. */
  mine?: boolean
}

export type BoardKey = 'plan1' | 'plan2' | 'refer' | 'clear'
export type BoardButton = 'got' | 'doit' | 'better'

export interface BoardView {
  key: BoardKey
  from: string
  head: string
  /** The teal-sealed good-news board. */
  settled: boolean
  sl1: string
  rec: BoardLine[]
  ctx: string | null
  sl2: string
  why: string
  sl3: string | null
  recs: RecLine[]
  chg: PlanPreview[]
  foot: string
  btns: BoardButton[]
}

export interface AskView {
  /** "WED 28 OCT". */
  when: string
  head: string
  line: string
}

/** What the boards and lines read about an episode (a body_alerts row, parsed). */
export interface AlertLike {
  region: BodyRegion
  stage: BodyStage
  level: number
  ackedLevel: number
  triggers: Trigger[]
  openedAt: number
  clearedAt: number | null
  clearReason: string | null
  evidence: { reports: Report[]; picks: Array<{ day: number; name: string }>; count: number; first: number; latest: number }
  contextLine: string | null
  planRound: number
  planStartedAt: number | null
  planEndsAt: number | null
  askOn: number | null
  /** Plan 1's first day (for plan 2's and the physio board's "So far"). */
  plan1Start: number | null
  answers: Array<{ on: number; answer: 'better' | 'sore' }>
  /** The day DO IT applied the current plan. */
  appliedOn: number | null
  /** The step-up lines (FEELS BETTER), kept for the good-news board. */
  stepLines: BoardLine[] | null
}

const headOf = (a: AlertLike): string => {
  const P = PLACE_NAME[a.region].toUpperCase()
  const t = a.triggers
  if (t.includes('picked_through')) return `${P} · SORE AGAIN`
  if (t.includes('comes_back')) return `${P} · ${a.evidence.count} IN ${a.evidence.latest - a.evidence.first + 1} DAYS`
  if (t.includes('slow')) return `${P} · ${numberWord(Math.max(3, Math.round((a.evidence.latest - a.evidence.first) / 7))).toUpperCase()} WEEKS ON`
  return `${P} · NOT EASING`
}

/** The note's why: the research line for the strongest pattern. */
function whyOf(a: AlertLike, today: number): string {
  const t = a.triggers
  if (t.includes('picked_through')) return 'You trained through it twice and it got sore again within days. A place that\'s been hurt is the most common place for the next injury. Small strains settle when they get room.'
  if (t.includes('slow') && !t.includes('comes_back')) return `Small strains usually settle in 2 to 5 weeks. This is week ${Math.max(1, Math.ceil((today - a.evidence.first + 1) / 7))}.`
  if (t.includes('not_easing') && !t.includes('comes_back')) return 'Mornings haven\'t got better than last week. Small strains usually settle in 2 to 5 weeks when they get room.'
  return a.region === 'back'
    ? 'A back that\'s been sore is the most likely to get sore again. Most sore backs ease a lot within 6 weeks when they get room.'
    : 'In runners, a past injury is the most common sign of the next one. Small strains usually settle in 2 to 5 weeks when they get room.'
}

function evidenceLines(a: AlertLike): BoardLine[] {
  const lines: Array<BoardLine & { day: number }> = a.evidence.reports.map(r => (r.quote != null
    ? { day: r.day, d: dayMonth(r.day), x: r.text, q: r.quote, tail: '.' }
    : { day: r.day, d: dayMonth(r.day), x: r.text }))
  for (const p of a.evidence.picks) lines.push({ day: p.day, d: dayMonth(p.day), x: `${p.name.charAt(0).toUpperCase()}${p.name.slice(1)}. Your pick.`, mine: true })
  return lines.sort((x, y) => x.day - y.day).map(({ day: _d, ...l }) => { void _d; return l })
}

/** The note with plan 1 (the raven's first board). `plan`: the plan as it would go on today. */
export function noteView(a: AlertLike, plan: PlanShown, today: number): BoardView {
  const applied = a.stage === 'plan1'
  const shown = applied && a.askOn != null ? a.askOn : plan.askOn
  return {
    key: 'plan1', from: 'From the coach', head: headOf(a), settled: false,
    sl1: 'What the coach noticed', rec: evidenceLines(a), ctx: a.contextLine,
    sl2: 'Why it matters', why: whyOf(a, today),
    sl3: `The plan · ${plan.end - plan.start + 1} days`, recs: plan.lines, chg: plan.preview,
    foot: applied
      ? `It's on your week, with UNDO on each day. The raven asks again ${dayWord(shown, today)}.`
      : `DO IT puts these on your week, with UNDO. GOT IT changes nothing. The raven asks again ${dayWord(plan.askOn, today)}.`,
    btns: applied ? ['got'] : ['got', 'doit'],
  }
}

/** Plan 2: STILL SORE at the first return. The last change the coach makes for the place. */
export function plan2View(a: AlertLike, plan: PlanShown, today: number): BoardView {
  const place = PLACE_NAME[a.region]
  const group = groupOf(a.region)
  const p1 = a.plan1Start ?? plan.start - PLAN_DAYS[1]
  const sore = a.answers.find(x => x.answer === 'sore')?.on ?? today
  const applied = a.stage === 'plan2'
  return {
    key: 'plan2', from: 'One more plan', head: `${place.toUpperCase()} · STILL SORE`, settled: false,
    sl1: 'So far',
    rec: [{ d: dayMonth(p1), x: `Plan 1: ${planWords(group, PLAN_DAYS[1])}.` }, { d: dayMonth(sore), x: 'You said: still sore.' }],
    ctx: null,
    sl2: 'Why',
    why: `${numberWord(PLAN_DAYS[1])} days wasn't enough. A longer, gentler week usually is for a small strain. This is the last change the coach makes for the ${place.toLowerCase()}.`,
    sl3: `The plan · ${PLAN_DAYS[2]} more days`, recs: plan.lines, chg: plan.preview,
    foot: applied ? `It's on your week, with UNDO on each day. The raven comes back ${dayWord(a.askOn ?? plan.askOn, today)}.` : `The raven comes back ${dayWord(plan.askOn, today)}.`,
    btns: applied ? ['got'] : ['got', 'doit'],
  }
}

/** Still sore at the second return: see a physio. No third plan, nothing locked. */
export function physioView(a: AlertLike, today: number): BoardView {
  const place = PLACE_NAME[a.region]
  const group = groupOf(a.region)
  const sores = a.answers.filter(x => x.answer === 'sore').map(x => x.on)
  const p1 = a.plan1Start ?? a.evidence.first
  const weeks = Math.max(1, Math.round((today - a.evidence.first) / 7))
  const keep = group === 'lower'
    ? 'The easy bikes stay in place of runs until you say it feels better.'
    : group === 'back' || group === 'hipleg' ? 'The easy walks stay in place of runs until you say it feels better.' : 'The week stays as it is until you say it feels better.'
  return {
    key: 'refer', from: 'See someone', head: `${place.toUpperCase()} · SEE A PHYSIO`, settled: false,
    sl1: `${numberWord(weeks)} ${weeks === 1 ? 'week' : 'weeks'}`,
    rec: [
      { d: dayMonth(a.evidence.first), x: 'The first report.' },
      { d: dayMonth(p1), x: `Plan 1: ${planWords(group, PLAN_DAYS[1])}.` },
      { d: dayMonth(sores[0] ?? today), x: `Still sore. Plan 2: ${PLAN_DAYS[2]} more days.` },
      { d: dayMonth(sores[1] ?? today), x: 'Still sore.' },
    ],
    ctx: null,
    sl2: 'Why',
    why: `Two rounds of easing off haven't settled it. Small strains usually settle in 2 to 5 weeks, and ${place.toLowerCase()} pain that isn't better within a few weeks is worth having looked at. A physio can find what rest can't.`,
    sl3: 'The coach recommends',
    recs: [
      { b: 'Book a physio or a doctor', rest: ` for the ${place.toLowerCase()}.` },
      { b: 'The coach won\'t change the plan again.', rest: ` ${keep}` },
      { b: 'Nothing is locked.', rest: ' Pick or put back anything yourself.' },
    ],
    chg: [],
    foot: `The rain stays until the ${place.toLowerCase()} feels better. Tap the raven any morning to tell it.`,
    btns: ['got', 'better'],
  }
}

/** The good-news board: FEELS BETTER (or the quiet rule), with the step back up. */
export function clearView(a: AlertLike, today: number): BoardView {
  const place = PLACE_NAME[a.region]
  const quietClear = a.clearReason === 'quiet'
  const lower = groupOf(a.region) === 'lower'
  return {
    key: 'clear', from: 'Good news', head: `${place.toUpperCase()} · ${quietClear ? 'SETTLED' : 'FEELS BETTER'}`, settled: true,
    sl1: 'Stepping back up',
    rec: a.stepLines && a.stepLines.length > 0 ? a.stepLines : [{ d: 'FROM TOMORROW', x: 'Back to the plan.' }],
    ctx: lower ? 'Rope is back in the coach\'s picks.' : 'Everything is back in the coach\'s picks.',
    sl2: 'Remember',
    why: `If the ${place.toLowerCase()} comes back within 6 weeks, these dates still count, so the raven comes sooner.`,
    sl3: null, recs: [], chg: [],
    foot: a.clearedAt != null && today > a.clearedAt ? 'The raven leaves today' : 'The raven leaves tomorrow',
    btns: ['got'],
  }
}

/** The good-news board's step lines, from the step back up. */
export function stepLinesFor(steps: ReadonlyArray<StepUpChange>, sessions: ReadonlyArray<PlanSession>, from: number): BoardLine[] {
  const shaped = steps.filter(s => s.shapeWeek != null).sort((a, b) => a.day - b.day)
  const lines: BoardLine[] = shaped.map((s, i) => {
    const w = getRunWalkWeek(s.shapeWeek as number)
    const shape = `${mmss(w.runSec)}, walk ${mmss(w.walkSec)} × ${w.rounds}`
    return { d: dayShort(s.day), x: i === 0 ? `First run back: ${shape}.` : `${shape} (week ${s.shapeWeek}'s).` }
  })
  // Then the plan: the first run after the step-up runs, as planned.
  const lastStep = shaped.length ? shaped[shaped.length - 1].day : from - 1
  const next = sessions.filter(s => s.day > lastStep && s.type === 'foundation_run' && s.blockZero && !steps.some(st => st.sessionId === s.id && st.shapeWeek != null)).sort((a, b) => a.day - b.day)[0]
  if (next) {
    const w = getRunWalkWeek(next.week)
    const label = mondayOf(next.day) > mondayOf(lastStep) ? 'NEXT WEEK' : dayShort(next.day)
    lines.push({ d: label, x: `Back to the plan: ${mmss(w.runSec)} × ${w.rounds}.` })
  }
  return lines
}

/** The return: one question, FEELS BETTER / STILL SORE. */
export function askView(a: AlertLike, today: number, nextRun: number | null): AskView {
  const place = PLACE_NAME[a.region]
  const group = groupOf(a.region)
  const second = a.stage === 'ask2'
  const days = second ? PLAN_DAYS[2] : PLAN_DAYS[1]
  const did = group === 'lower' ? `${numberWord(days)}${second ? ' more' : ''} days of bike, no running.` : `${numberWord(days)}${second ? ' more' : ''} days of ${planWords(group, days).replace(/^\d+ days (of )?/, '')}.`
  const tail = second
    ? 'Last time it was still sore.'
    : group === 'lower' && nextRun != null ? `${relDay(nextRun, today)}'s run-walk is the first one back.` : 'The plan carries on as written until you say.'
  return { when: dayMonth(today), head: `HOW'S THE ${place.toUpperCase()}?`, line: `${did} ${tail}` }
}

/** The one brass line under the readiness line on the Morning Report. */
export function morningReportLine(a: AlertLike, today: number): { text: string; settled: boolean } | null {
  const place = PLACE_NAME[a.region]
  const group = groupOf(a.region)
  switch (a.stage) {
    case 'cleared':
      if (a.clearedAt == null || today > a.clearedAt) return null
      return { text: a.clearReason === 'quiet' ? `${place} settled.` : `${place} feels better.`, settled: true }
    case 'ask1': case 'ask2':
      return { text: `The raven's back: how's the ${place.toLowerCase()}?`, settled: false }
    case 'offer2': case 'noted2':
      return { text: `${place}: still sore.`, settled: false }
    case 'physio':
      return { text: `${place}: see a physio.`, settled: false }
    case 'plan1':
      return a.planEndsAt != null && a.askOn != null
        ? { text: `${place} plan: ${planVerb(group)} to ${dayWord(a.planEndsAt, today)}. The raven's back ${dayWord(a.askOn, today)}.`, settled: false }
        : null
    case 'plan2':
      return a.planEndsAt != null ? { text: `${place} plan: ${PLAN_DAYS[2]} more days, to ${dayWord(a.planEndsAt, today)}.`, settled: false } : null
    case 'watch': case 'noted': {
      const t = a.triggers
      if (a.level >= 3 || t.includes('picked_through')) return { text: `${place}: sore again after ${group === 'lower' ? 'the run' : 'training'}.`, settled: false }
      if (t.includes('comes_back')) return { text: `${place}: ${a.evidence.count} times in ${a.evidence.latest - a.evidence.first + 1} days.`, settled: false }
      if (t.includes('not_easing')) return { text: `${place}: no better than last week.`, settled: false }
      return { text: `${place}: still sore ${numberWord(Math.max(3, Math.round((a.evidence.latest - a.evidence.first) / 7))).toLowerCase()} weeks on.`, settled: false }
    }
  }
}

/** Program's week line while a plan is on (page 58 4B). */
export function programLine(a: AlertLike, today: number): string | null {
  if ((a.stage !== 'plan1' && a.stage !== 'plan2') || a.appliedOn == null || a.planEndsAt == null || a.askOn == null) return null
  const place = PLACE_NAME[a.region].toLowerCase()
  const W = (d: number) => dayWord(d, today)
  const group = groupOf(a.region)
  const what = group === 'lower'
    ? (a.stage === 'plan1' ? `no running to ${W(a.planEndsAt)}, then 2:00 at a time` : `no running to ${W(a.planEndsAt)}`)
    : `${planVerb(group)} to ${W(a.planEndsAt)}`
  return `The ${place} plan, from ${W(a.appliedOn)}: ${what}. The raven asks ${W(a.askOn)}.`
}

/** The pop-up after DO IT ("Bike Sat and Tue. Then 2:00 runs."). */
export function planToast(region: BodyRegion, plan: BodyPlan, today: number): { title: string; text: string } {
  const group = groupOf(region)
  if (plan.round === 2) return { title: 'PLAN ON', text: `${PLAN_DAYS[2]} more days of ${group === 'lower' ? 'bike' : planVerb(group)}, to ${dayWord(plan.end, today)}.` }
  if (group === 'lower') {
    const bikes = plan.changes.filter(c => c.op.kind === 'bike').map(c => DAYW[dow(c.day)])
    const names = [...new Set(bikes)]
    const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return { title: 'PLAN ON', text: names.length ? `Bike ${list}. Then 2:00 runs.` : 'No running this week. Then 2:00 runs.' }
  }
  return { title: 'PLAN ON', text: `${planWords(group, PLAN_DAYS[1]).replace(/^./, c => c.toUpperCase())}.` }
}

/** The pop-up after FEELS BETTER ("2:00 Thu, 3:30 Sat, then the plan."). */
export function stepToast(steps: ReadonlyArray<StepUpChange>): { title: string; text: string } {
  const shaped = steps.filter(s => s.shapeWeek != null).sort((a, b) => a.day - b.day)
  if (shaped.length === 0) return { title: 'STEPPING UP', text: 'Back to the plan.' }
  const parts = shaped.map(s => `${mmss(getRunWalkWeek(s.shapeWeek as number).runSec)} ${DAYW[dow(s.day)]}`)
  return { title: 'STEPPING UP', text: `${parts.join(', ')}, then the plan.` }
}

// ─── The morning alarm's line ────────────────────────────────

/**
 * The raven's line on the morning alarm (page 58 item 14): on each return
 * morning "The raven's back: how's the knee?"; once, the morning after it
 * landed, if the note's still unread. Null otherwise.
 */
export function ravenAlarmLine(a: Pick<AlertLike, 'region' | 'stage' | 'askOn' | 'openedAt' | 'evidence' | 'triggers' | 'level'> & { seen: boolean }, alarmDay: number): string | null {
  const place = PLACE_NAME[a.region]
  if ((a.stage === 'ask1' || a.stage === 'ask2' || a.stage === 'plan1' || a.stage === 'plan2') && a.askOn != null && alarmDay >= a.askOn && (a.stage === 'ask1' || a.stage === 'ask2' || alarmDay === a.askOn)) {
    return `The raven's back: how's the ${place.toLowerCase()}?`
  }
  if (a.stage === 'watch' && !a.seen && alarmDay === a.openedAt + 1) {
    if (a.triggers.includes('comes_back')) return `${place}: ${a.evidence.count} times in ${a.evidence.latest - a.evidence.first + 1} days. Tap to see.`
    return `${place}: the raven has a note. Tap to see.`
  }
  return null
}

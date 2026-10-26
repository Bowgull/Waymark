// Block readiness (coach-brain.md §8, approved 2026-10-20; replaces the end
// gate and its extensions). Pure. "Ready for the next block" is four parts,
// all true, at least 4 weeks in. No maximum: after week 10 the coach leans on
// the part that lags and the meter names it. Nothing "fails".
//
// - Habit: 70%+ of planned key sessions done over the last 4 weeks, 4+
//   training days a week in 3 of the last 4 weeks, and no break of 7+ days in
//   the last 21.
// - Engine: the talk-test line set and rechecked in the last 21 days, and two
//   run-walks of 27 min or longer with run pieces of 4:00+ and 80%+ of the
//   running under the line, within 14 days.
// - Strength: every main pattern (squat, hinge, press, pull) KNOWN, with a
//   3 × 8 done at 1+ reps left and no missed reps, and reps left logged on
//   90%+ of main sets.
// - Back: the 21-day back mean not under the week-1 mean (half a point), no
//   open raven plan for the back, no back-related ease in the last 10 days.
//
// The meter (page 69 §5 option A) is built from the same parts: one bar of
// 4 × 6 tiles (brass as a part builds, teal when it is in), a flap, one line
// naming what is left; open, one group per part with one plain line of real
// numbers (his units: lb, km). Copy rules (page 63): never "gate", "pass line"
// or percentages on the closed board.

import { KEY_TYPES } from '../keyTypes'
import { kgToLbs } from '../units'
import { patternOf } from './loadLevels'
import { isLandmine } from '../landmine'
import { getStrengthTemplate } from '../strengthTemplates'
import { LIFT_LABELS } from './weekBuilder'
import type { AthleteModel, ModelCheckIn, ModelSession, ModelSet } from './types'

export type PartKey = 'habit' | 'engine' | 'strength' | 'back'
export const PART_KEYS: readonly PartKey[] = ['habit', 'engine', 'strength', 'back']
export const PART_NAME: Record<PartKey, string> = { habit: 'Habit', engine: 'Engine', strength: 'Strength', back: 'Back' }

export const MIN_DAYS = 28
export const LAG_AFTER_WEEK = 10
export const TILES = 6
export const HABIT_RATE = 0.7
export const HABIT_DAYS_A_WEEK = 4
export const HABIT_WEEKS = 3
export const BREAK_DAYS = 7
export const ENGINE_RUN_SEC = 27 * 60
export const ENGINE_PIECE_SEC = 240
export const ENGINE_UNDER = 0.8
export const ENGINE_WINDOW = 14
export const LINE_RECHECK_DAYS = 21
export const RIR_LOGGED_SHARE = 0.9
export const BACK_SLACK = 0.5
export const BACK_CLEAN_DAYS = 10

export interface ReadinessIn {
  today: number
  /** First day of Block Zero (local epoch day). */
  blockStart: number
  model: AthleteModel
  sessions: readonly ModelSession[]
  sets: readonly ModelSet[]
  checkIns: readonly Pick<ModelCheckIn, 'day' | 'backToday'>[]
  talkTests: ReadonlyArray<{ day: number; bpm: number }>
  /** Days with a back-related ease (a morning cap or an ease that named the back, a back swap). */
  backEaseDays: readonly number[]
  /** The move once the coach has set it: the Monday The Campaign starts. */
  move?: { monday: number; lighterFrom: number } | null
}

export interface ReadinessPart {
  key: PartKey
  name: string
  in: boolean
  /** 0-6 lit tiles (6 only when in). */
  tiles: number
  /** The open board's line (real numbers), and its small line. */
  line: string
  small: string | null
  /** The numbers behind the line, for the Ledger's plain words (page 79 §5). */
  facts?: PartFacts
}

/** What each part measured (only its own fields are set). */
export interface PartFacts {
  /** habit: key sessions due and done in the last 4 weeks, weeks with 4+ days, the longest break, sessions in a row it needs. */
  due?: number
  done?: number
  weeksOk?: number
  breakDays?: number
  needInARow?: number
  /** engine: qualifying run-walks in 14 days, runs in that window, his line, talk tests so far, line current. */
  goodRuns?: number
  runsInWindow?: number
  lineBpm?: number
  talkTests?: number
  lineOk?: boolean
  /** strength: the patterns still to go, the share of main sets with reps left logged. */
  missing?: string[]
  rirShare?: number
  /** back: scores to read from, the means, the raven's plan open, days without a back ease. */
  scores?: number
  backNow?: number | null
  backWeek1?: number | null
  meanOk?: boolean
  planOpen?: boolean
  cleanDays?: number
}

export interface ReadinessReport {
  week: number
  daysIn: number
  minMet: boolean
  parts: ReadinessPart[]
  inCount: number
  allIn: boolean
  /** All four in and at least 4 weeks done: the coach sets the move. */
  ready: boolean
  /** After week 10, the part furthest behind (the coach leans on it). */
  lagging: PartKey | null
  breakDays: number
  flap: string
  tone: 'gold' | 'teal'
  /** The closed board's one line. */
  line: string
  /** The open board's last group. */
  foot: string
  move: { monday: number; lighterFrom: number } | null
}

// ─── Words ───────────────────────────────────────────────────

const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const dowOf = (day: number) => ((day % 7) + 11) % 7
/** "Mon 30 Nov". */
export function dayLabel(day: number): string {
  const d = new Date(day * 86400000)
  return `${DAY3[dowOf(day)]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}
const word = (n: number) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const pace = (secKm: number) => `${mmss(secKm)}/km`
const r1 = (n: number) => Math.round(n * 10) / 10
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const tilesOf = (score: number, isIn: boolean) => (isIn ? TILES : Math.min(TILES - 1, Math.floor(TILES * clamp01(score) + 1e-9)))
/** "Engine and back", "Habit, engine and back". */
export function listWords(names: string[]): string {
  const low = names.map((n, i) => (i === 0 ? n : n.toLowerCase()))
  return low.length <= 1 ? (low[0] ?? '') : `${low.slice(0, -1).join(', ')} and ${low[low.length - 1]}`
}

// ─── Habit ───────────────────────────────────────────────────

const WHY_LABEL: Record<string, string> = { sick: 'sick', illness: 'sick', tired: 'tired', rough_day: 'rough day', schedule: 'time', time: 'time', no_time: 'time', injury: 'injury', too_sore: 'sore' }

/** Key sessions of the block that were due (done, missed, skipped by him, or planned on a day gone by). */
function dueSessions(inp: ReadinessIn, from: number): ModelSession[] {
  return inp.sessions.filter(s => KEY_TYPES.has(s.type) && s.day >= Math.max(from, inp.blockStart) && s.day <= inp.today
    && s.skipReason !== 'coach_rest'
    && (s.status === 'completed' || s.status === 'missed' || s.status === 'skipped' || (s.status === 'planned' && s.day < inp.today)))
}

function doneDays(inp: ReadinessIn): number[] {
  return [...new Set(inp.sessions.filter(s => KEY_TYPES.has(s.type) && s.status === 'completed' && s.day >= inp.blockStart && s.day <= inp.today).map(s => s.day))].sort((a, b) => a - b)
}

/** Longest run of days with nothing done that touches the last `window` days (the block's first days are not a break). */
export function longestBreak(days: number[], today: number, start: number, window = 21): number {
  const from = today - window + 1
  const anchors = [start - 1, ...days.filter(d => d >= start && d <= today), today + 1]
  let best = 0
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1] + 1
    const b = anchors[i] - 1
    if (b < a || b < from) continue
    if (i === 1 && anchors.length > 2) continue
    // Today not done yet is not a missed day.
    const end = anchors[i] === today + 1 ? today - 1 : b
    best = Math.max(best, end - a + 1)
  }
  return best
}

function habitPart(inp: ReadinessIn): ReadinessPart {
  const due = dueSessions(inp, inp.today - 27)
  const done = due.filter(s => s.status === 'completed').length
  const rate = due.length ? done / due.length : 0
  const days = doneDays(inp)
  let weeksOk = 0
  for (let w = 0; w < 4; w++) {
    const to = inp.today - 7 * w
    const from = to - 6
    if (from < inp.blockStart) continue
    if (days.filter(d => d >= from && d <= to).length >= HABIT_DAYS_A_WEEK) weeksOk++
  }
  const brk = longestBreak(days, inp.today, inp.blockStart, 21)
  const isIn = due.length > 0 && rate >= HABIT_RATE && weeksOk >= HABIT_WEEKS && brk < BREAK_DAYS
  const score = 0.2 * clamp01(rate / HABIT_RATE) + 0.65 * (weeksOk / HABIT_WEEKS) + 0.15 * (brk < BREAK_DAYS ? 1 : 0)
  const head = `${done} of your last ${due.length} sessions, and 4+ days a week in ${weeksOk} of the last 4 weeks.`
  let line = head
  let needInARow = 0
  if (!isIn) {
    if (due.length === 0) line = 'No sessions due yet.'
    else if (brk >= BREAK_DAYS) line = `A ${brk}-day break in the last 3 weeks. ${head}`
    else if (rate < HABIT_RATE) {
      const need = Math.max(1, Math.ceil((HABIT_RATE * due.length - done) / (1 - HABIT_RATE) - 1e-9))
      needInARow = need
      line = `${head} ${word(need)} more done in a row brings the sessions up.`
    } else line = `${head} It needs 3.`
  }
  // Page 63's details, inside Habit: the longest break, mornings vs evenings, why missed (the whole block).
  const block = dueSessions(inp, inp.blockStart)
  const am = block.filter(s => s.slot !== 'pm')
  const pm = block.filter(s => s.slot === 'pm')
  const counts = new Map<string, number>()
  for (const s of block) {
    if (s.status === 'completed') continue
    const k = s.skipReason ? WHY_LABEL[s.skipReason] ?? s.skipReason.replace(/_/g, ' ') : 'no reason'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const blockBreak = longestBreak(days, inp.today, inp.blockStart, Math.max(1, inp.today - inp.blockStart + 1))
  const bits = [
    `Longest break: ${plural(blockBreak, 'day')}.`,
    `Mornings ${am.filter(s => s.status === 'completed').length} of ${am.length}, evenings ${pm.filter(s => s.status === 'completed').length} of ${pm.length}.`,
    counts.size ? `Why missed: ${[...counts.entries()].sort((a, b) => (a[0] === 'no reason' ? 1 : 0) - (b[0] === 'no reason' ? 1 : 0)).map(([k, n]) => `${k} ${n}`).join(', ')}.` : null,
  ].filter(Boolean)
  const facts: PartFacts = { due: due.length, done, weeksOk, breakDays: brk, needInARow }
  return { key: 'habit', name: 'Habit', in: isIn, tiles: tilesOf(score, isIn), line, small: block.length ? bits.join(' ') : null, facts }
}

// ─── Engine ──────────────────────────────────────────────────

function enginePart(inp: ReadinessIn): ReadinessPart {
  const run = inp.model.run
  const tests = [...inp.talkTests].filter(t => t.day <= inp.today).sort((a, b) => a.day - b.day)
  const last = tests[tests.length - 1] ?? null
  const lineOk = run.lineSource === 'talk_test' && tests.length >= 2 && last != null && last.day > inp.today - LINE_RECHECK_DAYS
  // 4:00 pieces: done, or the 4:00 rung handled (the dose trims a piece by up to 5% while the coach is still a little unsure).
  const pieceOk = (sec: number | null) => (sec ?? 0) >= ENGINE_PIECE_SEC || (run.rungSec >= ENGINE_PIECE_SEC && (sec ?? 0) >= ENGINE_PIECE_SEC * 0.94)
  const qualifies = (o: (typeof run.recent)[number]) => (o.durationSec ?? 0) >= ENGINE_RUN_SEC && pieceOk(o.pieceSec) && (o.u ?? 0) >= ENGINE_UNDER
  const window = run.recent.filter(o => o.day > inp.today - ENGINE_WINDOW && o.day <= inp.today)
  const good = window.filter(qualifies)
  const isIn = lineOk && good.length >= 2
  const partial = Math.max(0, ...window.filter(o => !qualifies(o)).map(o => 0.9 * clamp01((o.durationSec ?? 0) / ENGINE_RUN_SEC) * clamp01((o.pieceSec ?? 0) / ENGINE_PIECE_SEC) * clamp01((o.u ?? 0) / ENGINE_UNDER)))
  const runScore = Math.min(1, (Math.min(2, good.length) + (good.length < 2 ? partial : 0)) / 2)
  const lineScore = (tests.length >= 1 ? 0.5 : 0) + (lineOk ? 0.5 : 0)
  const score = 0.35 * lineScore + 0.65 * runScore
  const bpm = run.lineBpm
  let line: string
  if (isIn) line = `Two run-walks of 27 min or longer in 2 weeks, most of the running under ${bpm}.`
  else if (good.length < 2) line = `${good.length === 1 ? 'One more run-walk' : 'Two run-walks'} of 27 min or longer, 4:00 run pieces, most of the running under ${bpm}.`
  else line = tests.length === 0 ? 'The talk-test question on an easy run-walk sets your line.' : 'A talk-test recheck on an easy run-walk keeps your line current.'
  const lastRun = [...run.recent].filter(o => o.day <= inp.today).sort((a, b) => b.day - a.day)[0]
  const bits: string[] = []
  if (lastRun && lastRun.durationSec != null) {
    bits.push(`${DAY_LONG[dowOf(lastRun.day)]}'s: ${Math.round(lastRun.durationSec / 60)} min${lastRun.pieceSec ? ` at ${mmss(lastRun.pieceSec)} run pieces` : ''}${lastRun.u != null ? `, ${Math.round(lastRun.u * 100)}% under` : ''}.`)
  }
  if (run.easyPaceSecKm != null) bits.push(`Easy pace at ${bpm}: ${pace(run.easyPaceSecKm)}.`)
  if (tests.length > 0 && !isIn && good.length >= 2) bits.push(`Last talk test: ${dayLabel(last!.day)}.`)
  const facts: PartFacts = { goodRuns: good.length, runsInWindow: window.length, lineBpm: bpm, talkTests: tests.length, lineOk }
  return { key: 'engine', name: 'Engine', in: isIn, tiles: tilesOf(score, isIn), line, small: bits.length ? bits.join(' ') : null, facts }
}

// ─── Strength ────────────────────────────────────────────────

const ALL_PATTERNS = ['squat', 'hinge', 'press', 'pull'] as const
type Pattern = (typeof ALL_PATTERNS)[number]

/**
 * The patterns the plan's two lifts train as main lifts (rebuild Phase 2:
 * Strength A and B only). A pattern no lift trains as a main lift can't hold
 * the block back; when the lifts gain it (a pull), it counts again.
 */
function planPatterns(): Pattern[] {
  const mains = LIFT_LABELS.flatMap(l => getStrengthTemplate(1, 3, 'block_zero', l).exercises.filter(e => e.section === 'main' && !isLandmine(e.exerciseId)).map(e => patternOf(e.exerciseId)))
  return ALL_PATTERNS.filter(p => mains.includes(p))
}
const PATTERNS: readonly Pattern[] = planPatterns()

/** A short name for a lift ("front squat", "DB RDL", "bench"). */
export function liftShort(exerciseId: string): string {
  const id = exerciseId.replace(/^ex-/, '')
  const map: Record<string, string> = { 'bench-press': 'bench', 'db-bench-press': 'DB bench', 'bent-over-row': 'row', 'db-row': 'DB row', 'goblet-squat': 'goblet squat' }
  if (map[id]) return map[id]
  return id.split('-').map(w => (w === 'db' || w === 'rdl' || w === 'ohp' ? w.toUpperCase() : w)).join(' ')
}

function strengthPart(inp: ReadinessIn): ReadinessPart {
  // The landmine is a helper with its own numbers (rebuild Phase 5): the big lifts carry the strength part.
  const main = inp.sets.filter(s => !s.isWarmup && s.logged && s.section === 'main' && !isLandmine(s.exerciseId) && s.day >= inp.blockStart && s.day <= inp.today)
  const status = new Map<Pattern, { in: boolean; known: boolean; kg: number | null; lift: string | null }>()
  for (const p of PATTERNS) {
    const mine = main.filter(s => patternOf(s.exerciseId) === p)
    let best: { kg: number | null; lift: string; day: number } | null = null
    const bySession = new Map<string, ModelSet[]>()
    for (const s of mine) bySession.set(`${s.sessionId}|${s.exerciseId}`, [...(bySession.get(`${s.sessionId}|${s.exerciseId}`) ?? []), s])
    for (const list of bySession.values()) {
      const ok = list.length >= 3 && list.every(s => s.reps >= 8 && (s.plannedReps == null || s.reps >= s.plannedReps) && s.rir != null && s.rir >= 1)
      if (ok && (best == null || list[0].day > best.day)) best = { kg: Math.min(...list.map(s => s.weightKg ?? 0)) || null, lift: list[0].exerciseId, day: list[0].day }
    }
    const lifts = Object.values(inp.model.lifts).filter(l => patternOf(l.exerciseId) === p && main.some(s => s.exerciseId === l.exerciseId))
    const known = lifts.some(l => l.state === 'KNOWN')
    status.set(p, { in: known && best != null, known, kg: best?.kg ?? null, lift: best?.lift ?? lifts[0]?.exerciseId ?? null })
  }
  const recent = main.filter(s => s.day > inp.today - 28)
  const share = recent.length ? recent.filter(s => s.rir != null).length / recent.length : 0
  const done = PATTERNS.filter(p => status.get(p)!.in)
  const isIn = done.length === PATTERNS.length && share >= RIR_LOGGED_SHARE
  const score = 0.8 * (done.length / PATTERNS.length) + 0.2 * clamp01(share / RIR_LOGGED_SHARE)
  const missing = PATTERNS.filter(p => !status.get(p)!.in)
  let line: string
  if (isIn) line = `${listWords([...PATTERNS]).replace(/^./, c => c.toUpperCase())} all have working weights you've done 3 × 8 at.`
  else if (missing.length > 0) line = `${listWords(missing.map(p => p[0].toUpperCase() + p.slice(1)))} to go: 3 × 8 at a weight that leaves a rep or more.`
  else line = `Reps left logged on ${Math.round(share * 100)}% of sets. It needs 9 in 10.`
  const weights = PATTERNS.map(p => status.get(p)!).filter(s => s.in && s.kg != null && s.lift).map((s, i) => `${i === 0 ? liftShort(s.lift!).replace(/^./, c => c.toUpperCase()) : liftShort(s.lift!)} ${kgToLbs(s.kg!)}${i === 0 ? ' lb' : ''}`)
  const bits = [weights.length ? `${weights.join(', ')}.` : null, recent.length ? `Reps left logged on ${Math.round(share * 100)}% of sets.` : null].filter(Boolean)
  const facts: PartFacts = { missing: [...missing], rirShare: share }
  return { key: 'strength', name: 'Strength', in: isIn, tiles: tilesOf(score, isIn), line, small: bits.length ? bits.join(' ') : null, facts }
}

// ─── Back ────────────────────────────────────────────────────

function backPart(inp: ReadinessIn): ReadinessPart {
  const scores = inp.checkIns.filter(c => c.backToday != null && c.day >= inp.blockStart && c.day <= inp.today)
  // Week 1's mean; when week 1 has fewer than 3 scores, the block's first 7 scores stand in for it.
  const wk1 = scores.filter(c => c.day < inp.blockStart + 7).map(c => c.backToday as number)
  const first = wk1.length >= 3 ? wk1 : [...scores].sort((a, b) => a.day - b.day).slice(0, 7).map(c => c.backToday as number)
  const last = scores.filter(c => c.day > inp.today - 21).map(c => c.backToday as number)
  const data = first.length >= 3 && last.length >= 3
  const fm = mean(first)
  const lm = mean(last)
  const meanOk = data && (lm as number) >= (fm as number) - BACK_SLACK
  const planOk = inp.model.back.openPlans === 0
  const eases = inp.backEaseDays.filter(d => d >= inp.blockStart && d <= inp.today)
  const lastEase = eases.length ? Math.max(...eases) : null
  const clean = lastEase == null ? inp.today - inp.blockStart + 1 : inp.today - lastEase
  const easeOk = clean >= BACK_CLEAN_DAYS
  const isIn = data && meanOk && planOk && easeOk
  const dataScore = data ? (meanOk ? 1 : 0) : 0.5 * clamp01(Math.min(first.length, last.length) / 3)
  const score = 0.5 * clamp01(clean / BACK_CLEAN_DAYS) + 0.3 * dataScore + 0.2 * (planOk ? 1 : 0)
  let line: string
  if (isIn) line = `Back steady or better, and no back ease in ${plural(clean, 'day')}.`
  else if (!planOk) line = 'The raven\'s plan for your back is still open.'
  else if (data && !meanOk) line = `Back averages ${r1(lm as number)} over 3 weeks, under ${r1(fm as number)} in week 1.`
  else if (!easeOk) line = `${word(BACK_CLEAN_DAYS - clean)} more ${BACK_CLEAN_DAYS - clean === 1 ? 'day' : 'days'} without a back ease.`
  else line = `${plural(Math.min(first.length, last.length), 'back score')} so far; it takes 3 to read.`
  const bits: string[] = []
  if (data) bits.push(`Back averages ${r1(lm as number)} over 3 weeks, ${(lm as number) > (fm as number) + 0.05 ? 'up from' : (lm as number) < (fm as number) - 0.05 ? 'down from' : 'level with'} ${r1(fm as number)} in week 1.`)
  if (lastEase != null) bits.push(`Last ease: ${dayLabel(lastEase)}.`)
  const facts: PartFacts = { scores: Math.min(first.length, last.length), backNow: lm, backWeek1: fm, meanOk, planOpen: !planOk, cleanDays: clean }
  return { key: 'back', name: 'Back', in: isIn, tiles: tilesOf(score, isIn), line, small: bits.length ? bits.join(' ') : null, facts }
}

// ─── The report ──────────────────────────────────────────────

export function readinessParts(inp: ReadinessIn): ReadinessReport {
  const parts = [habitPart(inp), enginePart(inp), strengthPart(inp), backPart(inp)]
  const daysIn = inp.today - inp.blockStart
  const week = Math.floor(Math.max(0, daysIn) / 7) + 1
  const minMet = daysIn >= MIN_DAYS
  const inCount = parts.filter(p => p.in).length
  const allIn = inCount === 4
  const ready = allIn && minMet
  const left = parts.filter(p => !p.in)
  const lagging = week > LAG_AFTER_WEEK && left.length > 0
    ? [...left].sort((a, b) => a.tiles - b.tiles || PART_KEYS.indexOf(a.key) - PART_KEYS.indexOf(b.key))[0].key : null
  // The open break (page 63's rule): it wins while it lasts.
  const days = doneDays(inp)
  const lastDone = days.filter(d => d < inp.today).pop() ?? (days.includes(inp.today) ? inp.today : inp.blockStart - 1)
  const breakDays = days.includes(inp.today) ? 0 : Math.max(0, inp.today - lastDone - 1)
  const move = inp.move ?? null
  let flap: string
  let tone: 'gold' | 'teal' = 'gold'
  let line: string
  if (breakDays >= 2 && dueSessions(inp, inp.blockStart).length > 0) {
    flap = `${breakDays} DAY BREAK`
    const by = lastDone + 7
    line = `One session by ${by - inp.today <= 6 ? DAY3[dowOf(by)] : dayLabel(by)} keeps this break under a week`
  } else if (move) {
    flap = 'READY'
    tone = 'teal'
    line = `The Campaign starts ${dayLabel(move.monday)}`
  } else if (allIn) {
    flap = minMet ? 'READY' : '4 OF 4 IN'
    tone = minMet ? 'teal' : 'gold'
    line = minMet ? 'All four in. The coach sets the move tonight' : `All four in. The move comes after week 4`
  } else if (inCount === 0 && week <= LAG_AFTER_WEEK) {
    flap = 'BUILDING'
    line = 'Everything still building'
  } else {
    flap = inCount === 0 ? 'BUILDING' : `${inCount} OF 4 IN`
    if (lagging) {
      const rest = left.filter(p => p.key !== lagging).map(p => p.name)
      line = rest.length ? `${PART_NAME[lagging]} first, then ${listWords(rest).toLowerCase()}` : `${PART_NAME[lagging]} is the one left`
    } else line = `${listWords(left.map(p => p.name))} to go`
  }
  const foot = move
    ? `The Campaign starts ${dayLabel(move.monday)}. Until then the week is lighter. UNDO on that Monday keeps you in Block Zero.`
    : 'When all four are in, The Campaign starts the Monday after, with a lighter week first. You\'ll see it as a rune on that Monday.'
  return { week, daysIn, minMet, parts, inCount, allIn, ready, lagging, breakDays, flap, tone, line, foot, move }
}

/** One plain line of the parts for the AI's packet and the nightly log ("habit in, engine 4 of 6, ..."). */
export function readinessSummary(r: ReadinessReport): string {
  return r.parts.map(p => `${p.key} ${p.in ? 'in' : `${p.tiles} of 6`}`).join(', ') + (r.lagging ? `; lagging ${r.lagging}` : '')
}

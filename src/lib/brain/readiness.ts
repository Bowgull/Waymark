// Coach brain P2 (coach-brain.md §6.1): one readiness state from the check-in,
// against his own baseline (28 days, live from 4 values in any 10 days; the
// athlete model's itemBaseline). It sets today's ceiling:
//
//   FRESH  no item worse, 2+ items better        up to PUSH
//   GREEN  at most 1 item worse, for 1 day        up to PROGRESS
//   AMBER  2+ items worse today (first day), or   HOLD at most; hard sessions
//          the same item worse 2 days running,    lose a set
//          or no check-in today and yesterday
//          was amber
//   RED    2+ items worse 2 days running, or      RECOVER or REST
//          sleep under 5 h with energy 2 or less,
//          or a "sick" skip or check-in note
//
// Before a baseline (audit 2026-10-23 #4): an item with no baseline yet can't
// be "worse", so a few plain floors stand in for it and make the day AMBER:
// soreness 5, stress 5, or sleep under 6 h with energy 2 or less.
//
// "Worse" is 1 point worse than his mean (sleep: 1 h less). Cannabis and
// alcohol are neutral inputs: they never move the state. One bad night never
// cancels a session; it only caps the dose. This replaces the old 7-day R10
// read, the weekly 15% load flag and the daily rolling-load flag. Pure.
//
// Missing inputs (approved 2026-10-21, idea 7): an item he didn't fill in, or
// one with no baseline yet, is never read as fine. A morning with fewer than
// FULL_ITEMS items read is reweighted to a full check-in (worse items x
// FULL_ITEMS / items read, so 1 worse of 2 read counts like 2 of 5) and
// carries a lower confidence: a 'partial' or 'none' read is never FRESH
// (no push on half a picture).

import { CHECKIN_ITEMS, itemBaseline, noteFlags, type CheckInItem } from './athleteModel'
import type { ModelCheckIn } from './types'
import { activeState, type TempState } from './tempStates'

export type ReadinessState = 'FRESH' | 'GREEN' | 'AMBER' | 'RED'

export const STATE_RANK: Readonly<Record<ReadinessState, number>> = { RED: 0, AMBER: 1, GREEN: 2, FRESH: 3 }

/** The lower of two states (the morning check-in can only lower the night's ceiling). */
export function lowerState(a: ReadinessState, b: ReadinessState): ReadinessState {
  return STATE_RANK[a] <= STATE_RANK[b] ? a : b
}

export const RED_SLEEP_HOURS = 5
export const RED_ENERGY = 2

/** Absolute AMBER floors, read only for items with no baseline yet. */
export const FLOOR_SORENESS = 5
export const FLOOR_STRESS = 5
export const FLOOR_SLEEP_HOURS = 6
export const FLOOR_ENERGY = 2

export interface ItemRead {
  item: CheckInItem
  today: number | null
  mean: number | null
  worse: boolean
  better: boolean
}

/** How much of a check-in could be read against his baseline. */
export type ReadConfidence = 'full' | 'partial' | 'none'

/** A full check-in: this many items read against a baseline (of the 7). */
export const FULL_ITEMS = 5
/** Worse items (reweighted for a partial check-in) at or over this: "2+ items worse". */
export const WORSE_TRIGGER = 2

export interface DayRead {
  day: number
  checkedIn: boolean
  items: ItemRead[]
  worse: CheckInItem[]
  better: CheckInItem[]
  /** Items with a value and a baseline. */
  read: number
  confidence: ReadConfidence
  /** Worse items reweighted to a full check-in (worse x FULL_ITEMS / read when read < FULL_ITEMS). */
  weightedWorse: number
}

const HIGHER_WORSE: ReadonlySet<CheckInItem> = new Set(['soreness', 'stress'])

/** One morning's items against his baseline (the 28 days before it). */
export function readDay(checkIns: readonly ModelCheckIn[], day: number): DayRead {
  const c = checkIns.find(x => x.day === day)
  const items: ItemRead[] = []
  for (const item of CHECKIN_ITEMS) {
    const v = c?.[item] ?? null
    const b = itemBaseline(checkIns as ModelCheckIn[], item, day)
    if (v == null || !b) { items.push({ item, today: v, mean: b?.mean ?? null, worse: false, better: false }); continue }
    const delta = v - b.mean
    const worse = HIGHER_WORSE.has(item) ? delta >= 1 : delta <= -1
    const better = HIGHER_WORSE.has(item) ? delta <= -1 : delta >= 1
    items.push({ item, today: v, mean: b.mean, worse, better })
  }
  const worse = items.filter(i => i.worse).map(i => i.item)
  const read = items.filter(i => i.today != null && i.mean != null).length
  const confidence: ReadConfidence = read >= FULL_ITEMS ? 'full' : read > 0 ? 'partial' : 'none'
  const weightedWorse = read === 0 ? 0 : read >= FULL_ITEMS ? worse.length : Math.round((worse.length * FULL_ITEMS / read) * 100) / 100
  // A blank row (nothing answered yet) is not a check-in.
  const checkedIn = c != null && CHECKIN_ITEMS.some(i => c[i] != null)
  return { day, checkedIn, items, worse, better: items.filter(i => i.better).map(i => i.item), read, confidence, weightedWorse }
}

/** 2+ items worse, reweighted for a partial check-in. */
export function manyWorse(d: Pick<DayRead, 'worse' | 'weightedWorse'>): boolean {
  return d.worse.length >= WORSE_TRIGGER || (d.worse.length > 0 && d.weightedWorse >= WORSE_TRIGGER)
}

export interface ReadinessRead {
  day: number
  state: ReadinessState
  /** Plain words, numbers from the check-in only ("Slept 5 h, energy 2."). */
  why: string | null
  checkedIn: boolean
  /** How much of the day's check-in was read ('none': no check-in, or no baseline yet). */
  confidence: ReadConfidence
  today: DayRead
  yesterday: DayRead
}

const WORD: Record<CheckInItem, string> = {
  sleepHours: 'sleep', sleepQuality: 'sleep quality', energy: 'energy', soreness: 'soreness', stress: 'stress', mood: 'mood', backToday: 'back',
}

function listWords(items: CheckInItem[]): string {
  const w = items.map(i => WORD[i])
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface ReadinessOpts {
  /** A session skipped as "sick" (or "illness") on this day or the day before. */
  sickSkip?: boolean
  /** Check-in notes for the day (a "sick" note makes the day RED). */
  notes?: string | null
}

/**
 * The state for `day` from the check-ins up to it. With no check-in that day
 * the state carries from yesterday's (AMBER stays AMBER; RED stays RED for
 * the day after, since 2 days running was the trigger), else GREEN.
 */
export function readinessState(checkIns: readonly ModelCheckIn[], day: number, opts: ReadinessOpts = {}): ReadinessRead {
  const today = readDay(checkIns, day)
  const yesterday = readDay(checkIns, day - 1)
  const c = checkIns.find(x => x.day === day)
  const sickNote = noteFlags(opts.notes).includes('sick')
  const base = { day, checkedIn: today.checkedIn, confidence: today.confidence, today, yesterday }

  if (opts.sickSkip || sickNote) return { ...base, state: 'RED', why: 'Sick. Recover today.' }
  if (c && c.sleepHours != null && c.sleepHours < RED_SLEEP_HOURS && c.energy != null && c.energy <= RED_ENERGY) {
    return { ...base, state: 'RED', why: `Slept ${round1(c.sleepHours)} h with energy ${c.energy}.` }
  }
  if (!today.checkedIn) {
    // No check-in today: yesterday's read carries, never a push.
    const prev = yesterday.checkedIn ? stateOfDay(yesterday, readDay(checkIns, day - 2)) : 'GREEN'
    if (prev === 'RED' || prev === 'AMBER') return { ...base, state: 'AMBER', why: yesterday.worse.length ? `${cap(listWords(yesterday.worse))} off yesterday. No check-in today.` : 'Yesterday was a rough read. No check-in today.' }
    return { ...base, state: 'GREEN', why: null }
  }
  const state = stateOfDay(today, yesterday)
  if (state === 'AMBER' && STATE_RANK[relativeState(today, yesterday)] > STATE_RANK.AMBER) {
    return { ...base, state, why: `${cap(floorHits(today).join(', '))}.` }
  }
  return { ...base, state, why: whyFor(state, today, yesterday) }
}

/**
 * The floors hit by a morning's items that have no baseline yet, in plain
 * words ("soreness 5", "slept 5.5 h with energy 2"). Empty when none.
 */
export function floorHits(d: Pick<DayRead, 'items'>): string[] {
  const it = (k: CheckInItem) => d.items.find(i => i.item === k)
  const noBase = (k: CheckInItem) => it(k)?.mean == null
  const val = (k: CheckInItem) => it(k)?.today ?? null
  const out: string[] = []
  const sore = val('soreness')
  if (sore != null && noBase('soreness') && sore >= FLOOR_SORENESS) out.push(`soreness ${sore}`)
  const stress = val('stress')
  if (stress != null && noBase('stress') && stress >= FLOOR_STRESS) out.push(`stress ${stress}`)
  const sleep = val('sleepHours')
  const energy = val('energy')
  if (sleep != null && energy != null && (noBase('sleepHours') || noBase('energy')) && sleep < FLOOR_SLEEP_HOURS && energy <= FLOOR_ENERGY) {
    out.push(`slept ${round1(sleep)} h with energy ${energy}`)
  }
  return out
}

function stateOfDay(today: DayRead, yesterday: DayRead): ReadinessState {
  const s = relativeState(today, yesterday)
  // No baseline yet for an item: its plain floor can still make the day AMBER.
  if (STATE_RANK[s] > STATE_RANK.AMBER && floorHits(today).length > 0) return 'AMBER'
  return s
}

function relativeState(today: DayRead, yesterday: DayRead): ReadinessState {
  const twoDays = manyWorse(today) && manyWorse(yesterday)
  if (twoDays) return 'RED'
  const sameItem = today.worse.some(i => yesterday.worse.includes(i))
  if (manyWorse(today) || sameItem) return 'AMBER'
  // FRESH needs the whole picture: a short check-in is never read as "all fine".
  if (today.worse.length === 0 && today.better.length >= 2 && today.confidence === 'full') return 'FRESH'
  return 'GREEN'
}

function whyFor(state: ReadinessState, today: DayRead, yesterday: DayRead): string | null {
  if (state === 'FRESH' || state === 'GREEN' || today.worse.length === 0) return null
  const parts = today.worse.map(i => {
    const r = today.items.find(x => x.item === i)
    if (!r || r.today == null) return WORD[i]
    return i === 'sleepHours' ? `slept ${round1(r.today)} h` : `${WORD[i]} ${r.today}`
  })
  const lead = cap(parts.join(', '))
  if (state === 'RED') return `${lead}, two mornings running.`
  const repeat = today.worse.find(i => yesterday.worse.includes(i))
  if (today.worse.length < 2 && repeat) return `${cap(WORD[repeat])} off two mornings running.`
  if (today.worse.length < WORSE_TRIGGER && today.confidence === 'partial') return `${lead}, on a short check-in.`
  return `${lead}.`
}

export interface NightInputs {
  checkIns: readonly ModelCheckIn[]
  /** The night's own day (days after it are planned GREEN). */
  today: number
  /** Days with a session skipped as sick. */
  sickDays: ReadonlySet<number>
  notesByDay: ReadonlyMap<number, string>
  /** Short states from his notes (tempStates.ts): an active "sick" is RED until it ends. */
  temp?: readonly TempState[]
}

export interface NightRead { state: ReadinessState; why: string | null; confidence: ReadConfidence }

const DAY_WORD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The night's ceiling for `day`: yesterday's state (FRESH may push; AMBER or
 * RED yesterday is AMBER today until the morning says otherwise). Days ahead
 * are GREEN. While a sick state from his notes runs, RED (recover or rest);
 * it ends on its own (tempStates.ts), so it never sticks.
 */
export function nightRead(inp: NightInputs, day: number): NightRead {
  const sick = inp.temp ? activeState(inp.temp, 'sick', day) : null
  if (sick && day >= inp.today) {
    const from = DAY_WORD[((sick.mentions[sick.mentions.length - 1] % 7) + 11) % 7]
    return { state: 'RED', why: `Sick, per your note on ${from}. Recover until it passes.`, confidence: 'partial' }
  }
  if (day > inp.today) return { state: 'GREEN', why: null, confidence: 'none' }
  const opts = (d: number) => ({ sickSkip: inp.sickDays.has(d) || inp.sickDays.has(d - 1), notes: inp.notesByDay.get(d) ?? null })
  const y = readinessState(inp.checkIns, day - 1, opts(day - 1))
  if (!y.checkedIn) return { state: y.state === 'AMBER' ? 'AMBER' : 'GREEN', why: y.why, confidence: 'none' }
  return { state: y.state === 'RED' ? 'AMBER' : y.state, why: y.why, confidence: y.confidence }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

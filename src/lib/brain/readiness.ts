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
// "Worse" is 1 point worse than his mean (sleep: 1 h less). Cannabis and
// alcohol are neutral inputs: they never move the state. One bad night never
// cancels a session; it only caps the dose. This replaces the old 7-day R10
// read, the weekly 15% load flag and the daily rolling-load flag. Pure.

import { CHECKIN_ITEMS, itemBaseline, noteFlags, type CheckInItem } from './athleteModel'
import type { ModelCheckIn } from './types'

export type ReadinessState = 'FRESH' | 'GREEN' | 'AMBER' | 'RED'

export const STATE_RANK: Readonly<Record<ReadinessState, number>> = { RED: 0, AMBER: 1, GREEN: 2, FRESH: 3 }

/** The lower of two states (the morning check-in can only lower the night's ceiling). */
export function lowerState(a: ReadinessState, b: ReadinessState): ReadinessState {
  return STATE_RANK[a] <= STATE_RANK[b] ? a : b
}

export const RED_SLEEP_HOURS = 5
export const RED_ENERGY = 2

export interface ItemRead {
  item: CheckInItem
  today: number | null
  mean: number | null
  worse: boolean
  better: boolean
}

export interface DayRead {
  day: number
  checkedIn: boolean
  items: ItemRead[]
  worse: CheckInItem[]
  better: CheckInItem[]
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
  return { day, checkedIn: c != null, items, worse: items.filter(i => i.worse).map(i => i.item), better: items.filter(i => i.better).map(i => i.item) }
}

export interface ReadinessRead {
  day: number
  state: ReadinessState
  /** Plain words, numbers from the check-in only ("Slept 5 h, energy 2."). */
  why: string | null
  checkedIn: boolean
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
  const base = { day, checkedIn: today.checkedIn, today, yesterday }

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
  return { ...base, state, why: whyFor(state, today, yesterday) }
}

function stateOfDay(today: DayRead, yesterday: DayRead): ReadinessState {
  const twoDays = today.worse.length >= 2 && yesterday.worse.length >= 2
  if (twoDays) return 'RED'
  const sameItem = today.worse.some(i => yesterday.worse.includes(i))
  if (today.worse.length >= 2 || sameItem) return 'AMBER'
  if (today.worse.length === 0 && today.better.length >= 2) return 'FRESH'
  return 'GREEN'
}

function whyFor(state: ReadinessState, today: DayRead, yesterday: DayRead): string | null {
  if (state === 'FRESH' || state === 'GREEN') return null
  const parts = today.worse.map(i => {
    const r = today.items.find(x => x.item === i)
    if (!r || r.today == null) return WORD[i]
    return i === 'sleepHours' ? `slept ${round1(r.today)} h` : `${WORD[i]} ${r.today}`
  })
  const lead = cap(parts.join(', '))
  if (state === 'RED') return `${lead}, two mornings running.`
  const repeat = today.worse.find(i => yesterday.worse.includes(i))
  if (today.worse.length < 2 && repeat) return `${cap(WORD[repeat])} off two mornings running.`
  return `${lead}.`
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

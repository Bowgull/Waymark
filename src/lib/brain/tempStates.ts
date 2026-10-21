// Short-lived states read from his own words (approved 2026-10-21, idea 8):
// sick, away (travel), busy (a deadline, a move). Each one starts on the day
// he mentions it and ENDS ON ITS OWN: on the day he names ("away till Sun",
// "back Monday", "for 3 days"), when he says it's over ("better", "home"),
// or after a fixed time with no new mention. A state never sticks: Google's
// coach kept a stale "sick" for weeks; this can't.
//
//   sick   3 days from the last mention (today + 2), or until "better"
//   away   the day he names, else 7 days; at most 14
//   busy   the day he names, else 5 days
//
// The rules read `sick` (RED: recover or rest only while it lasts); the AI
// gets every state with its end day and is told an ended one is history.
// These never go in the coach's notebook. Pure.

import { noteFlags } from './athleteModel'

export type TempKind = 'sick' | 'away' | 'busy'

export interface TempState {
  kind: TempKind
  fromDay: number
  /** Last day it applies (inclusive). */
  untilDay: number
  /** Days of the mentions behind it. */
  mentions: number[]
  /** Why it stopped: its time ran out, or he said it was over (null while it can still run). */
  endedBy: 'time' | 'note' | null
}

export const TTL_DAYS: Readonly<Record<TempKind, number>> = { sick: 3, away: 7, busy: 5 }
export const MAX_DAYS: Readonly<Record<TempKind, number>> = { sick: 7, away: 14, busy: 10 }

const PATTERN: Readonly<Record<TempKind, RegExp>> = {
  sick: /$^/, // noteFlags('sick') decides
  away: /\b(away|travel(l)?ing|trip|hotel|flight|flying|out of town|on the road|vacation|holiday)\b/i,
  busy: /\b(deadline|crunch|exams?|busy (week|stretch|few days)|moving (house|apartment|out)|slammed at work)\b/i,
}
const OVER: Readonly<Record<TempKind, RegExp>> = {
  sick: /\b(better now|feel(ing)? better|recovered|over it|no longer sick|not sick|healthy again|back to normal)\b/i,
  away: /\b(back home|home now|got back|back from|returned)\b/i,
  busy: /\b(deadline (is )?(done|over|passed)|done with (the )?(deadline|exams?)|calmer now|things calmed)\b/i,
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const NUMBER_WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, couple: 2, few: 3 }
const dowOf = (day: number) => ((day % 7) + 11) % 7

/** The end day a note names ("till Sun", "back Monday", "for 3 days", "this week"), else null. */
export function namedEnd(text: string, day: number): number | null {
  const t = text.toLowerCase()
  const wd = t.match(/\b(?:till|til|until|thru|through|back(?: on)?|returning(?: on)?|home(?: on)?)\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/)
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1])
    let delta = (target - dowOf(day) + 7) % 7
    if (delta === 0) delta = 7
    // "back Monday": away until the day before; "till Sunday": through that day.
    return /back|returning|home/.test(wd[0]) ? day + delta - 1 : day + delta
  }
  if (/\b(back|home) tomorrow\b/.test(t)) return day
  if (/\b(till|until) tomorrow\b/.test(t)) return day + 1
  const n = t.match(/\bfor (?:the next )?(\d+|a|one|two|three|four|five|six|seven|ten|a couple of|a few)\s*(day|night|week)s?\b/)
  if (n) {
    const raw = n[1].replace('a couple of', 'couple').replace('a few', 'few')
    const k = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? 1)
    return day + Math.max(1, n[2] === 'week' ? k * 7 : k) - 1
  }
  // "This week" said on a Sunday means the week ahead.
  if (/\b(this|the) week\b/.test(t)) return day + (dowOf(day) === 0 ? 7 : (7 - dowOf(day)) % 7)
  return null
}

function kindsIn(text: string): TempKind[] {
  const out: TempKind[] = []
  if (noteFlags(text).includes('sick')) out.push('sick')
  if (PATTERN.away.test(text)) out.push('away')
  if (PATTERN.busy.test(text)) out.push('busy')
  return out
}

/**
 * Every short state in the notes up to `today`, oldest first. A new mention
 * while one is running extends it (never past MAX_DAYS from its start); a
 * mention after it ended starts a new one.
 */
export function tempStates(notes: ReadonlyArray<{ day: number; text: string }>, today: number): TempState[] {
  const sorted = notes.filter(n => n.day <= today && n.text?.trim()).sort((a, b) => a.day - b.day)
  const out: TempState[] = []
  const open: Partial<Record<TempKind, TempState>> = {}
  for (const n of sorted) {
    for (const kind of ['sick', 'away', 'busy'] as const) {
      const cur = open[kind]
      // He says it's over: it ends the day before (a morning "feeling better" means today is fine).
      if (cur && OVER[kind].test(n.text) && n.day > cur.fromDay && n.day <= cur.untilDay + 1) {
        cur.untilDay = Math.max(cur.fromDay, n.day - 1)
        cur.endedBy = 'note'
        delete open[kind]
      }
    }
    for (const kind of kindsIn(n.text)) {
      if (OVER[kind].test(n.text)) continue
      const named = namedEnd(n.text, n.day)
      const until = named ?? n.day + TTL_DAYS[kind] - 1
      const cur = open[kind]
      if (cur && n.day <= cur.untilDay + 1) {
        cur.untilDay = Math.min(cur.fromDay + MAX_DAYS[kind] - 1, Math.max(cur.untilDay, until))
        cur.mentions.push(n.day)
      } else {
        const s: TempState = { kind, fromDay: n.day, untilDay: Math.min(n.day + MAX_DAYS[kind] - 1, until), mentions: [n.day], endedBy: null }
        out.push(s)
        open[kind] = s
      }
    }
  }
  for (const s of out) if (s.endedBy == null && s.untilDay < today) s.endedBy = 'time'
  return out
}

export function isActive(s: TempState, day: number): boolean {
  return s.fromDay <= day && day <= s.untilDay
}

/** The state of a kind that applies on `day`, if any. */
export function activeState(states: readonly TempState[], kind: TempKind, day: number): TempState | null {
  return [...states].reverse().find(s => s.kind === kind && isActive(s, day)) ?? null
}

// Today's week strip (page 35 #5, A: the Program day tiles, small, under the
// header) and the day states that pick what Today shows (page 43). Pure.

import { sessionIconFor, type SessionIconKey } from '@/design/sessionIconKeys'

export interface StripSession {
  id: string
  type: string
  status: string
  scheduledDate?: number | null
  timeSlot?: string | null
  notes?: string | null
  label?: string | null
}

export type StripIconState = 'done' | 'todo' | 'skip'

export interface StripDay {
  epochDay: number
  /** YYYY-MM-DD (for /program?day=). */
  iso: string
  /** One letter: M T W T F S S. */
  letter: string
  /** Day of the month. */
  date: number
  isToday: boolean
  /** A prepared week with nothing on this day: REST. */
  rest: boolean
  icons: Array<{ key: SessionIconKey; state: StripIconState; id: string }>
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function epochDayToISO(epochDay: number): string {
  return new Date(epochDay * 86400000).toISOString().slice(0, 10)
}

function iconState(status: string): StripIconState {
  if (status === 'completed') return 'done'
  if (status === 'skipped' || status === 'missed') return 'skip'
  return 'todo'
}

/** Run category for the icon (Zone 2 dial vs the shoe): runs keep it in notes. */
export function runCategoryOf(s: Pick<StripSession, 'type' | 'notes'>): string | null {
  return s.type === 'running' ? (s.notes ?? null) : null
}

/**
 * The seven Monday-Sunday tiles (plans run Monday to Sunday). AM before PM on
 * each tile. `prepared` = the week has a plan with sessions in it, so an empty
 * day is a planned REST, not a day nobody prepared.
 */
export function weekStripDays(sessions: StripSession[], mondayEpoch: number, todayEpoch: number): StripDay[] {
  const prepared = sessions.length > 0
  return Array.from({ length: 7 }, (_, i) => {
    const day = mondayEpoch + i
    const dow = new Date(day * 86400000).getUTCDay()
    const list = sessions
      .filter(s => s.scheduledDate === day)
      .sort((a, b) => (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1))
    return {
      epochDay: day,
      iso: epochDayToISO(day),
      letter: LETTERS[dow],
      date: new Date(day * 86400000).getUTCDate(),
      isToday: day === todayEpoch,
      rest: prepared && list.length === 0,
      icons: list.map(s => ({ key: sessionIconFor(s.type, runCategoryOf(s)), state: iconState(s.status), id: s.id })),
    }
  })
}

export type TodayMode = 'loading' | 'day' | 'rest' | 'unprepared' | 'allDone'

/**
 * What Today shows (page 43): the hobbit home for a planned rest day, for a
 * day not prepared yet (with NOTHING TODAY), and in the evening once every
 * session today is done (ALL DONE); otherwise the day board.
 * `weekSessions` = this week's planned sessions (any day), null when there's no week plan.
 */
/** Every session the day still holds (skipped and missed set aside) is done. */
export function dayAllDone(today: ReadonlyArray<Pick<StripSession, 'status'>>): boolean {
  const live = today.filter(s => s.status !== 'skipped' && s.status !== 'missed')
  return live.length > 0 && live.every(s => s.status === 'completed')
}

/**
 * A Strava confirm (page 40 / 46): LOGGED and the row glow first; when that was the day's last
 * session in the evening, the day fades to ALL DONE (page 43) this long after.
 */
export const ALL_DONE_AFTER_CONFIRM_MS = 2000

export function fadesToAllDone(today: ReadonlyArray<Pick<StripSession, 'status'>>, hour: number): boolean {
  return dayAllDone(today) && hour >= EVENING_HOUR
}

export function todayMode(input: { today: StripSession[]; weekSessions: StripSession[] | null; hour: number; showDayAnyway?: boolean }): TodayMode {
  if (input.today.length === 0) {
    return input.weekSessions && input.weekSessions.length > 0 ? 'rest' : 'unprepared'
  }
  if (dayAllDone(input.today) && input.hour >= EVENING_HOUR && !input.showDayAnyway) return 'allDone'
  return 'day'
}

/** Evening, for ALL DONE (the home at night on page 43). */
export const EVENING_HOUR = 17

/** The world's home stands in for the clearing on these. */
export function showsHome(mode: TodayMode): boolean {
  return mode === 'rest' || mode === 'unprepared' || mode === 'allDone'
}

/** The lantern follows readiness: dimmer on an eased day (page 13: lamp 0.45, fireflies 0.35). */
export function lanternFor(readiness: { ease?: boolean; checkedIn?: boolean } | null): number {
  if (!readiness || !readiness.checkedIn) return 0.85
  return readiness.ease ? 0 : 1
}

/** The tiles for tomorrow on a rest day: icons and one plain line ("Foundation, then Strength A."). */
export function tomorrowLine(sessions: Array<Pick<StripSession, 'type' | 'label' | 'notes' | 'timeSlot'>>, names: (s: Pick<StripSession, 'type' | 'label' | 'notes'>) => string, weekStarts?: number | null): string | null {
  if (sessions.length === 0) return null
  const ordered = sessions.slice().sort((a, b) => (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)).map(names)
  const line = ordered.length === 1 ? `${ordered[0]}.` : `${ordered.slice(0, -1).join(', ')}, then ${ordered[ordered.length - 1]}.`
  // page 43 B: "Foundation, then Strength A. Week 4 starts." when tomorrow opens a new week
  return weekStarts != null ? `${line} Week ${weekStarts} starts.` : line
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** The header's date flap: "SAT 18 OCT". */
export function dateFlap(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** The Coach board's count: "2 changes · 1 question". */
export function coachCount(changes: number, questions: number): string {
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  return [changes > 0 ? p(changes, 'change') : null, questions > 0 ? p(questions, 'question') : null].filter(Boolean).join(' · ')
}

/**
 * A line's bold lead (page 36). 'sentence': the first sentence ("Lighter
 * week.") and the rest after a space. 'colon': the words before a colon
 * ("Strength C eased") and the rest from the colon on. No lead: rest is ''.
 */
export function splitLead(line: string, by: 'sentence' | 'colon'): { lead: string; rest: string } {
  if (by === 'sentence') {
    const cut = line.indexOf('. ')
    return cut > 0 ? { lead: line.slice(0, cut + 1), rest: line.slice(cut + 2) } : { lead: line, rest: '' }
  }
  const cut = line.indexOf(': ')
  return cut > 0 && cut <= 40 ? { lead: line.slice(0, cut), rest: line.slice(cut) } : { lead: line, rest: '' }
}

/**
 * The why line, shorter, for the first line of Today's Coach board (page 36:
 * "Lighter week. Two short nights and a sore Thursday."): the first two
 * sentences, the second cut before its ", so ..." consequence.
 */
export function shortWhy(why: string | null): string | null {
  if (!why) return null
  const sentences = why.split(/(?<=\.)\s+/).filter(Boolean)
  const head = sentences.slice(0, 2)
  if (head.length === 2) {
    const so = head[1].search(/,\s+so\s/i)
    if (so > 0) head[1] = `${head[1].slice(0, so)}.`
  }
  return head.join(' ')
}

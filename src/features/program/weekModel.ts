// The Program week (design-decisions.md "Program · the day board"): the six
// week flap tiles, the road's wayposts, and the seven-day tile strip. Pure;
// relative imports only so the day board tests run it under node.

import type { WeekPost } from '../../world/worldStore'
import { iconFor, rowStatus, type DayBoardSession } from '../dayboard/rowState'
import type { SessionIconKey } from '../../design/sessionIconKeys'

export { cycleWeeks } from '../../lib/programWeeks'

export function weekState(week: number, currentWeek: number): WeekPost['state'] {
  return week < currentWeek ? 'done' : week === currentWeek ? 'now' : 'todo'
}

/** The wayposts: done weeks lit with a notch per session done (cap 10), this week, then dark ones. */
export function worldWeekPosts(weeks: ReadonlyArray<number>, currentWeek: number, completed: ReadonlyMap<number, number>): WeekPost[] {
  return weeks.map(w => {
    const state = weekState(w, currentWeek)
    return { state, notches: state === 'todo' ? 0 : Math.min(10, completed.get(w) ?? 0) }
  })
}

/** Monday to Sunday. */
export function weekDays(monday: number): number[] {
  return Array.from({ length: 7 }, (_, i) => monday + i)
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export interface DayTile {
  epochDay: number
  letter: string
  date: number
  today: boolean
  icons: Array<{ id: string; icon: SessionIconKey; state: 'done' | 'skipped' | 'todo' }>
}

export function dayStrip(days: ReadonlyArray<number>, sessions: ReadonlyArray<DayBoardSession>, todayEpochDay: number): DayTile[] {
  return days.map(d => {
    const date = new Date(d * 86400000)
    const list = sessions
      .filter(s => s.scheduledDate === d)
      .sort((a, b) => (a.timeSlot === 'pm' ? 1 : 0) - (b.timeSlot === 'pm' ? 1 : 0))
    return {
      epochDay: d,
      letter: LETTERS[date.getUTCDay()],
      date: date.getUTCDate(),
      today: d === todayEpochDay,
      icons: list.map(s => {
        const st = rowStatus(s.status)
        return { id: s.id, icon: iconFor(s), state: st === 'done' ? 'done' : st === 'skipped' || st === 'missed' ? 'skipped' : 'todo' }
      }),
    }
  })
}

/** The block week a calendar day falls in (deep links: /program?day=YYYY-MM-DD). */
export function weekForDay(epochDay: number, todayEpochDay: number, currentWeek: number, totalWeeks: number, firstWeek = 1): number {
  const monday = (d: number) => d - ((new Date(d * 86400000).getUTCDay() + 6) % 7)
  const offset = Math.round((monday(epochDay) - monday(todayEpochDay)) / 7)
  return Math.min(Math.max(currentWeek + offset, firstWeek), Math.max(1, totalWeeks))
}

export interface WeekRead {
  /** The "why this week" line. */
  why: string | null
  /** The coach's changes, per session (placement shuffles left out by the row). */
  changes: Array<{ sessionId: string | null; reason: string; was: string | null; now: string | null; source?: string }>
}

/**
 * The week's stored read: the weekly pass writes version 2 (the why line and
 * per-change reasons) and the why_line column; older weeks carry the rules
 * summary or an AI narrative.
 */
export function readWeekAnalysis(analysisJson: string | null | undefined, whyLine?: string | null): WeekRead {
  let parsed: Record<string, unknown> | null = null
  if (analysisJson) {
    try {
      const v = JSON.parse(analysisJson)
      if (v && typeof v === 'object') parsed = v as Record<string, unknown>
    } catch { /* unreadable: no read */ }
  }
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const why = s(whyLine) ?? (parsed ? (parsed.version === 2 ? s(parsed.why) : s(parsed.summary) ?? s(parsed.adjustmentNotes) ?? s(parsed.narrative)) : null)
  const changes = parsed?.version === 2 && Array.isArray(parsed.changes)
    ? (parsed.changes as Array<Record<string, unknown>>)
      .filter(c => typeof c.reason === 'string')
      .map(c => ({ sessionId: s(c.sessionId), reason: String(c.reason), was: s(c.was), now: s(c.now), source: s(c.source) ?? undefined }))
    : []
  return { why, changes }
}

/** The why line with its first sentence in bold ("Lighter this week." then the reason). */
export function splitWhy(why: string): { lead: string; rest: string } {
  const m = why.match(/^(.+?[.!?])(\s+)(.+)$/)
  return m ? { lead: m[1], rest: m[3] } : { lead: '', rest: why }
}

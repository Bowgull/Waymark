// The Program week (design-decisions.md "Program · the day board"): the six
// week flap tiles, the road's wayposts, and the seven-day tile strip. Pure;
// relative imports only so the day board tests run it under node.

import type { WeekPost } from '../../world/worldStore'
import { iconFor, plannedRowMinutes, rowStatus, sessionDisplayName, shortLift, type DayBoardSession } from '../dayboard/rowState'
import { getStrengthTemplate } from '../../lib/strengthTemplates'
import { ROPE_ROUNDS } from '../../lib/plannedLength'
import type { SessionIconKey } from '../../design/sessionIconKeys'
import { fiveKText, hardKindOf } from '../../lib/brain/hardRuns'
import { planFromContext } from '../../lib/coach/bagConditioning'

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

// ─── The planner's day list (page 73, approved 2026-10-22) ───────

/** "Zone 2 Run" → "Zone 2 run", "Run-Walk" → "Run-walk". */
function sentenceCase(s: string): string {
  const t = s.trim()
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

/** The strength day's lifts in a few words: "RDL · row · press". */
function liftsLine(s: Pick<DayBoardSession, 'scheduledDate' | 'blockWeek' | 'blockType' | 'label'>): string {
  if (s.scheduledDate == null) return 'Strength'
  const kind = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
  const main = getStrengthTemplate(new Date(s.scheduledDate * 86400000).getUTCDay(), s.blockWeek ?? 1, kind, s.label ?? null).exercises.filter(e => e.section === 'main')
  if (main.length === 0) return 'Strength'
  return main.slice(0, 3).map((e, i) => (i === 0 ? shortLift(e.label) : (shortLift(e.label).split(' ').pop() ?? '').toLowerCase())).join(' · ')
}

function hardReps(doseJson: string | null | undefined): number | null {
  if (!doseJson) return null
  try { const r = (JSON.parse(doseJson) as { run?: { hard?: { reps?: unknown } } }).run?.hard?.reps; return typeof r === 'number' ? r : null } catch { return null }
}

function bagRounds(doseJson: string | null | undefined): number | null {
  if (!doseJson) return null
  try { const r = (JSON.parse(doseJson) as { bag?: { rounds?: unknown } }).bag?.rounds; return typeof r === 'number' ? r : null } catch { return null }
}

/**
 * A day's one line (page 73): the day's main session in a few words. "RDL ·
 * row · press", "Easy run · 20 min", "Bag · 4 × 3 min", "MT class", "Rest".
 */
export function dayLine(list: ReadonlyArray<DayBoardSession>, weekNumber: number): string {
  const live = list.filter(s => rowStatus(s.status) !== 'skipped')
  if (live.length === 0) return list.length > 0 ? 'Skipped' : 'Rest'
  const main = [...live].reverse().find(s => s.type !== 'mobility') ?? live[0]
  switch (main.type) {
    case 'strength': return liftsLine(main)
    case 'running':
    case 'foundation_run': {
      // Page 76: "Tempo · 30 min", "Intervals 2 min × 6", "5K test", "5K test · 27:48".
      const hard = hardKindOf(main)
      if (hard === 'test') return main.runSession?.fiveKSec ? `5K test · ${fiveKText(main.runSession.fiveKSec)}` : '5K test'
      if (hard === 'intervals') { const reps = hardReps(main.doseJson); if (reps) return `Intervals 2 min × ${reps}` }
      return `${sentenceCase(sessionDisplayName(main))} · ${plannedRowMinutes(main, weekNumber)} min`
    }
    case 'bag_work': { const r = bagRounds(main.doseJson); return r ? `Bag · ${r} × 3 min` : `Bag · ~${plannedRowMinutes(main, weekNumber)} min` }
    case 'mt_class': return 'MT class'
    // page 93: "Bag conditioning · 3 rounds" (its plan once picked), else its minutes
    case 'bag_conditioning': { const p = planFromContext(main.contextJson); return p ? `Bag conditioning · ${p.rounds} round${p.rounds === 1 ? '' : 's'}` : `Bag conditioning · ~${plannedRowMinutes(main, weekNumber)} min` }
    case 'active_recovery': return `${sentenceCase(sessionDisplayName(main))} · ~${plannedRowMinutes(main, weekNumber)} min`
    case 'skip_rope': return `Skip rope · ${ROPE_ROUNDS} × 3 min`
    case 'mobility': return `Foundation · ~${plannedRowMinutes(main, weekNumber)} min`
    default: return sentenceCase(sessionDisplayName(main))
  }
}

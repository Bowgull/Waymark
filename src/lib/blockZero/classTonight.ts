// "+ Class tonight" (page 45, page 13's placement): an MT class lands on
// today, and the day rebalances around it with rebalanceDayForClass (the run
// moves off, strength stays in the morning one set lighter, Foundation stays).
// Pure: which rows to ease, which to bring to the morning, which to move, and
// the one Coach line that says what happened. The server applies the plan
// (src/server/classTonight.ts) and stores the line on the class session.

import type { PlannedSession } from './autoEase'
import { rebalanceDayForClass } from './muayThai'

/** A session already on the day (a row of the sessions table, trimmed). */
export interface DayRow {
  id: string
  type: string
  label: string | null
  timeSlot: string | null
  status: string
}

export interface ClassTonightPlan {
  /** Strength rows that drop a set (an applied coach ease). */
  ease: string[]
  /** Rows that come to the morning so the class has the evening. */
  toAm: string[]
  /** Rows that move to another day (the run: the class is the conditioning). */
  move: string[]
}

const slot = (s: string | null): 'am' | 'pm' => (s === 'pm' ? 'pm' : 'am')

/** What changes on a day when a class lands on it. Only planned rows move or ease; done and skipped rows stay as they are. */
export function planClassTonight(day: readonly DayRow[], mtClass: Pick<DayRow, 'label' | 'timeSlot'>): ClassTonightPlan {
  const open = day.filter(r => r.status === 'planned' && r.type !== 'mt_class')
  const planned: PlannedSession[] = open.map(r => ({ type: r.type, label: r.label ?? r.type, timeSlot: slot(r.timeSlot), estimatedMin: 0 }))
  const out = rebalanceDayForClass(planned, { type: 'mt_class', label: mtClass.label ?? 'MT Class', timeSlot: slot(mtClass.timeSlot), estimatedMin: 60 })
  const plan: ClassTonightPlan = { ease: [], toAm: [], move: [] }
  planned.forEach((p, i) => {
    const row = open[i]
    if (out.moved.includes(p)) { plan.move.push(row.id); return }
    if (p.type === 'strength') {
      plan.ease.push(row.id)
      if (slot(row.timeSlot) !== 'am') plan.toAm.push(row.id)
    }
  })
  return plan
}

/** What the server managed to apply. */
export interface ClassTonightApplied {
  /** Rows that did move (a row with no safe day left this week stays). */
  moved: number
  /** Strength was eased (or already was). */
  eased: boolean
  /** The placement rules' notes from adding the class, if any. */
  placementNotes?: readonly string[]
}

/**
 * The Coach line under the readiness line: "Class tonight." in brass, then
 * how the day rebalanced, in rebalanceDayForClass's own words. Nothing
 * rebalanced: the placement notes, else the app's add line.
 */
export function classTonightLine(a: ClassTonightApplied): { lead: string; rest: string } {
  const parts: string[] = []
  if (a.moved > 0) parts.push('The run moves to another day.')
  if (a.eased) parts.push('Strength stays in the morning, one set lighter.')
  if (parts.length === 0) {
    const notes = (a.placementNotes ?? []).map(n => n.trim()).filter(Boolean)
    parts.push(...(notes.length > 0 ? notes : ['Log the type after class.']))
  }
  return { lead: 'Class tonight.', rest: parts.join(' ') }
}

/** The stored line on the class session's context_json ({ classTonight: { lead, rest } }), or null. */
export function classTonightFrom(contextJson: string | null | undefined): { lead: string; rest: string } | null {
  if (!contextJson) return null
  try {
    const c = (JSON.parse(contextJson) as { classTonight?: { lead?: unknown; rest?: unknown } }).classTonight
    if (!c || typeof c.lead !== 'string' || typeof c.rest !== 'string') return null
    return { lead: c.lead, rest: c.rest }
  } catch {
    return null
  }
}

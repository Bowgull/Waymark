// MT Class tonight (page 56: MT Class is a normal row on the Add Session
// board): an MT class lands on today, and the day rebalances around it with
// rebalanceDayForClass (the run moves off, strength stays in the morning one
// set less, Foundation stays). Pure: which rows to ease, which to bring to the
// morning, which to move. The server applies the plan as change records
// (src/server/classTonight.ts).

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

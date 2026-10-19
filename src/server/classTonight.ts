// MT Class tonight (page 56 items 5 and 15, approved 2026-10-19): MT Class is
// a normal row on the Add Session board. Adding one for tonight rebalances
// the day with rebalanceDayForClass: strength drops a set and comes to the
// morning; the run moves to the first later day this week the placement
// rules allow (none: it stays). Every change is a change record (actor
// 'class_tonight') with its rune and UNDO, in the add's change set.
// Idempotent: a class rebalances its day once (context_json.classTonight).

import { eq } from 'drizzle-orm'
import { sessions } from '../db/schema'
import { planClassTonight } from '../lib/blockZero/classTonight'
import { DAY_NAMES, applyContext, easeFor, mondayOf, sessionName, type CoachChangePlan } from '../lib/coach'
import { blockKind, checkChange, toSessionLike, trainingWeekFor } from './coachData'
import { applyCoachPlans } from './changes'
import { getActiveBlock } from './blockZeroData'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Rebalance the class's day and record what moved. Returns the change ids. */
export async function rebalanceForClassTonight(db: DB, classId: string, setId: string, todayDay: number, nowSec: number): Promise<string[]> {
  const [cls] = await db.select().from(sessions).where(eq(sessions.id, classId))
  if (!cls || cls.type !== 'mt_class' || cls.scheduledDate == null) return []
  let ctx: { classTonight?: unknown } = {}
  try { ctx = JSON.parse(cls.contextJson ?? '{}') as { classTonight?: unknown } } catch { ctx = {} }
  if (ctx.classTonight) return []

  const day = cls.scheduledDate
  const rows = (await db.select().from(sessions).where(eq(sessions.scheduledDate, day))).filter(r => r.id !== cls.id)
  const plan = planClassTonight(rows, cls)
  const block = await getActiveBlock(db)
  const kind = blockKind(block?.blockType)
  const week = block ? (await trainingWeekFor(db, block, day, todayDay)).week : 1
  const plans: CoachChangePlan[] = []

  for (const id of plan.ease) {
    const row = rows.find(r => r.id === id)
    if (!row) continue
    // Strength comes to the morning first (part of the same change on the day's back).
    if (plan.toAm.includes(id) && row.timeSlot !== 'am') {
      await db.update(sessions).set({ timeSlot: 'am' }).where(eq(sessions.id, id))
      row.timeSlot = 'am'
    }
    const words = easeFor({ ...toSessionLike(row), id: row.id }, { blockType: kind, weekNumber: week })
    if (!words) continue
    plans.push({ rule: 'R5', kind: 'ease', sessionId: id, ease: words.ease, show: words.show, why: `Class tonight: ${sessionName(toSessionLike(row))} stays in the morning, one set less.`, detail: words.detail, put: words.put })
  }

  const sunday = mondayOf(day) + 6
  for (const id of plan.move) {
    const row = rows.find(r => r.id === id)
    if (!row) continue
    const slot = row.timeSlot === 'pm' ? 'pm' : 'am'
    for (let d = day + 1; d <= sunday; d++) {
      const check = await checkChange(db, { kind: 'move', type: row.type, label: row.label, notes: row.notes, epochDay: d, timeSlot: slot, sessionId: row.id, fromEpochDay: day }, todayDay)
      if (!check.ok) continue
      const name = sessionName(toSessionLike(row))
      const to = check.change.timeSlot
      plans.push({
        rule: 'R1', kind: 'move', sessionId: id, move: { epochDay: d, timeSlot: to },
        show: { before: `${DAY_NAMES[new Date(day * 86400000).getUTCDay()].toUpperCase()} ${slot.toUpperCase()}`, after: `${DAY_NAMES[new Date(d * 86400000).getUTCDay()].toUpperCase()} ${to.toUpperCase()}` },
        why: `Class tonight, so ${name.toLowerCase()} moves to ${DAY_LONG[new Date(d * 86400000).getUTCDay()]} ${to.toUpperCase()}. Class is enough running for one night.`,
        detail: null,
        put: { line: `${name} is back tonight.`, dim: 'The coach leaves it as you set it this week.' },
      })
      break
    }
  }

  const ids = await applyCoachPlans(db, plans, rows, setId, 'class_tonight', nowSec)
  await db.update(sessions).set({ contextJson: applyContext(cls.contextJson, { classTonight: { at: nowSec, changes: ids.length } }) }).where(eq(sessions.id, cls.id))
  return ids
}

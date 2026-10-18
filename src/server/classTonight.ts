// "+ Class tonight" rebalance (page 45, page 13's placement). After the class
// is added (POST /api/sessions/insert-ad-hoc), POST
// /api/sessions/:id/class-tonight applies rebalanceDayForClass to its day:
// strength drops a set (an applied coach ease, so the prescriptions read it)
// and comes to the morning; the run moves to the first later day this week
// the placement rules allow (none: it stays). The Coach line is stored on the
// class session's context_json ({ classTonight: { lead, rest } }) so Today can
// show it after a reload. Idempotent: a second call returns the stored line.

import { eq } from 'drizzle-orm'
import { sessions } from '../db/schema'
import { classTonightFrom, classTonightLine, planClassTonight } from '../lib/blockZero/classTonight'
import { coachEaseFrom, mergeContext, mondayOf, withCoachEase } from '../lib/coach'
import { checkChange } from './coachData'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

export interface ClassTonightResult {
  line: { lead: string; rest: string }
  moved: Array<{ id: string; epochDay: number; timeSlot: string }>
  eased: string[]
}

export async function rebalanceForClassTonight(db: DB, classId: string, todayDay: number, nowSec: number): Promise<{ status: number; body: ClassTonightResult | { error: string } }> {
  const [cls] = await db.select().from(sessions).where(eq(sessions.id, classId))
  if (!cls) return { status: 404, body: { error: 'session not found' } }
  if (cls.type !== 'mt_class' || cls.scheduledDate == null) return { status: 400, body: { error: 'Only a class rebalances its day.' } }
  const stored = classTonightFrom(cls.contextJson)
  if (stored) return { status: 200, body: { line: stored, moved: [], eased: [] } }

  const day = cls.scheduledDate
  const rows = (await db.select().from(sessions).where(eq(sessions.scheduledDate, day))).filter(r => r.id !== cls.id)
  const plan = planClassTonight(rows, cls)

  const eased: string[] = []
  for (const id of plan.ease) {
    const row = rows.find(r => r.id === id)
    if (!row) continue
    const already = coachEaseFrom(row.contextJson) != null
    await db.update(sessions).set({
      ...(plan.toAm.includes(id) ? { timeSlot: 'am' } : {}),
      ...(already ? {} : { contextJson: withCoachEase(row.contextJson, { kind: 'reduce', reason: 'Class tonight.', source: 'reactive', at: nowSec }) }),
    }).where(eq(sessions.id, id))
    eased.push(id)
  }

  const moved: ClassTonightResult['moved'] = []
  const sunday = mondayOf(day) + 6
  for (const id of plan.move) {
    const row = rows.find(r => r.id === id)
    if (!row) continue
    const slot = row.timeSlot === 'pm' ? 'pm' : 'am'
    for (let d = day + 1; d <= sunday; d++) {
      const check = await checkChange(db, { kind: 'move', type: row.type, label: row.label, notes: row.notes, epochDay: d, timeSlot: slot, sessionId: row.id, fromEpochDay: day }, todayDay)
      if (!check.ok) continue
      await db.update(sessions).set({
        scheduledDate: d,
        timeSlot: check.change.timeSlot,
        contextJson: mergeContext(row.contextJson, { movedFrom: { epochDay: day, timeSlot: row.timeSlot }, movedFor: 'class_tonight' }),
      }).where(eq(sessions.id, id))
      moved.push({ id, epochDay: d, timeSlot: check.change.timeSlot })
      break
    }
  }

  let placementNotes: string[] = []
  try { placementNotes = (JSON.parse(cls.contextJson ?? '{}') as { placement?: { notes?: string[] } }).placement?.notes ?? [] } catch { placementNotes = [] }
  const line = classTonightLine({ moved: moved.length, eased: eased.length > 0, placementNotes })
  await db.update(sessions).set({ contextJson: mergeContext(cls.contextJson, { classTonight: line }) }).where(eq(sessions.id, cls.id))
  return { status: 200, body: { line, moved, eased } }
}

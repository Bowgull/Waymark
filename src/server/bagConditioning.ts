// Bag Conditioning on the server (page 93): what the start routes read from
// the database for lib/coach/bagConditioning and lib/coach/kickBudget. The
// session's plan is rebuilt from its template, step and switches (stored in
// context_json.conditioning), so nothing stored on the phone is trusted.

import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'

import type { createDB } from '../db/client'
import { sessions, trainingBlocks } from '../db/schema'
import { buildPlan, conditioningLevel, parseConditioning, parseConditioningLog, loggedKicks, templateById, type StepEntry } from '../lib/coach/bagConditioning'
import { finisherKicks, parseFinisherLog } from '../lib/coach/bagFinisher'
import { kicksLeft, weekStartDay, type KickCount } from '../lib/coach/kickBudget'
import { programStartDay } from './ledgerData'

type DB = ReturnType<typeof createDB>

/** The session type (separate from Bag Work's bag_work). */
export const BAG_CONDITIONING = 'bag_conditioning'

const parse = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {}
  try { const v = JSON.parse(raw) as unknown; return v && typeof v === 'object' ? v as Record<string, unknown> : {} } catch { return {} }
}

/** Whole weeks since his program started (Block Zero, else the active block). */
export async function weeksBack(db: DB, today: number): Promise<number> {
  const blocks = await db.select().from(trainingBlocks)
  return Math.max(0, Math.floor((today - programStartDay(blocks, today)) / 7))
}

/** His Bag Conditioning level today (1 weeks 1 to 3, 2 weeks 3 to 8, 3 from week 8). */
export async function levelToday(db: DB, today: number): Promise<1 | 2 | 3> {
  return conditioningLevel(await weeksBack(db, today))
}

/** The shin kicks a side his done bag sessions this week spent (finisher sets and Bag Conditioning parts). */
export async function kicksUsedThisWeek(db: DB, day: number, notSessionId: string | null = null): Promise<KickCount[]> {
  const from = weekStartDay(day)
  const rows = await db.select({ id: sessions.id, type: sessions.type, contextJson: sessions.contextJson }).from(sessions)
    .where(and(inArray(sessions.type, ['bag_work', BAG_CONDITIONING]), eq(sessions.status, 'completed'), gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, from + 6)))
  const out: KickCount[] = []
  for (const r of rows) {
    if (r.id === notSessionId) continue
    const ctx = parse(r.contextJson)
    if (r.type === 'bag_work') out.push(finisherKicks(parseFinisherLog(ctx.finisherLog)))
    else {
      const spec = parseConditioning(ctx.conditioning)
      const t = spec && templateById(spec.templateId)
      if (!spec || !t) continue
      const plan = buildPlan(t, { step: spec.step, switches: new Set(spec.switches), lighterWeek: spec.lighterWeek })
      const log = parseConditioningLog(ctx.conditioningLog, plan.parts.length)
      if (log) out.push(loggedKicks(plan, log))
    }
  }
  return out
}

/** What is left of this week's kicks, per side. */
export async function kicksLeftThisWeek(db: DB, day: number, notSessionId: string | null = null): Promise<KickCount> {
  return kicksLeft(await levelToday(db, day), await kicksUsedThisWeek(db, day, notSessionId))
}

const PAIN = /\b(pain|painful|hurts?|hurt|sore|shins?|wrists?|tweak(ed)?)\b/i

/** His last Bag Conditioning sessions, newest first: the template, its step, the planned effort and his. */
export async function conditioningHistory(db: DB, notSessionId: string | null = null): Promise<{ steps: StepEntry[]; lastTemplateId: string | null }> {
  const rows = await db.select({ id: sessions.id, rpe: sessions.rpe, notes: sessions.notes, contextJson: sessions.contextJson }).from(sessions)
    .where(and(eq(sessions.type, BAG_CONDITIONING), eq(sessions.status, 'completed')))
    .orderBy(desc(sessions.completedAt))
    .limit(12)
  const steps: StepEntry[] = []
  for (const r of rows) {
    if (r.id === notSessionId) continue
    const ctx = parse(r.contextJson)
    const spec = parseConditioning(ctx.conditioning)
    const t = spec && templateById(spec.templateId)
    if (!spec || !t) continue
    // a note on the effort card about pain (a wrist, a shin) steps it down
    steps.push({ templateId: spec.templateId, step: spec.step, planned: t.effort, effort: typeof r.rpe === 'number' ? r.rpe : null, pain: PAIN.test(r.notes ?? '') })
  }
  return { steps, lastTemplateId: steps[0]?.templateId ?? null }
}

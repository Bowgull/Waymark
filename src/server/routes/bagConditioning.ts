// Bag Conditioning (page 93, approved 2026-10-25): its own session type,
// bag_conditioning, separate from Bag Work.
//
//   GET  /api/sessions/:id/bag-conditioning        the session and its plan (null before it starts)
//   POST /api/sessions/:id/start-bag-conditioning  picks and keeps the plan, once
//
// The plan: the coach's pick when the week planner placed one
// (context_json.conditioningPick: { templateId }), else lib/coach/
// bagConditioning pickConditioning from his level, today's readiness, his
// Settings switches, his history, a lift that day, and the week's kicks. It is
// kept as { templateId, step, switches, lighterWeek } in context_json
// .conditioning and rebuilt from that every time. The log (each part done or
// skipped) comes with the finish (POST /complete, conditioningLog).

import { Hono } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'

import { createDB } from '../../db/client'
import { sessions, settings } from '../../db/schema'
import { athleteDayFrom, TODAY_HEADER } from '../../lib/dates'
import { mergeContext } from '../../lib/coach/classify'
import { buildPlan, nextStep, parseConditioning, parseConditioningLog, pickConditioning, planFromContext, planMinutes, templateById, type ConditioningPlan, type ConditioningReadiness } from '../../lib/coach/bagConditioning'
import { techniqueGroups } from '../../lib/coach/bagFinisher'
import { BAG_CONDITIONING, conditioningHistory, kicksLeftThisWeek, levelToday } from '../bagConditioning'
import { loadSessionCoachState } from '../coachData'
import { brainCapFrom, lighterOn, loadBrainInputs, nightState } from '../brain'
import { activeState } from '../../lib/brain/tempStates'

type Bindings = { DB: D1Database }
type DB = ReturnType<typeof createDB>

export const bagConditioning = new Hono<{ Bindings: Bindings }>()

const parse = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {}
  try { const v = JSON.parse(raw) as unknown; return v && typeof v === 'object' ? v as Record<string, unknown> : {} } catch { return {} }
}

/** A lower-leg note takes the kicks off; a wrist or hand note the hands (bag-workouts.md: scaling down). */
const LEGS = /\b(shin|ankle|foot|calf|knee|leg|hip)/i
const HANDS = /\b(wrist|hand|knuckle|elbow|thumb|finger)/i

/** The session's plan, rebuilt from what it keeps (null before it starts). */
export function planOf(contextJson: string | null | undefined): ConditioningPlan | null {
  const spec = parseConditioning(parse(contextJson).conditioning)
  return spec ? planFromContext(contextJson) : null
}

/**
 * The coach's plan for this session today, not yet kept: the week planner's pick when it named one
 * (still shaped by today's switches and his step), else pickConditioning from his level, today's
 * readiness (an injury note, an ease, a return ramp, a morning AMBER or RED, back from sick, away
 * or a lighter week: the steady version), his Settings switches
 * (a lower-leg note takes the kicks off, a wrist or hand note the punches), his history, a lift
 * that day and the week's kicks.
 */
async function pickFor(db: DB, session: typeof sessions.$inferSelect, todayHeader: string | undefined): Promise<{ plan: ConditioningPlan; lighterWeek: boolean }> {
  const today = athleteDayFrom({ header: todayHeader, nowMs: Date.now() })
  const day = session.scheduledDate ?? today
  const [userSettings] = await db.select().from(settings).limit(1)
  const switches = techniqueGroups(userSettings?.enabledTechniques)
  const state = await loadSessionCoachState(db, session, day)
  const region = state.injury?.region ?? ''
  if (LEGS.test(region)) { switches.delete('kicks'); switches.delete('knees') }
  if (HANDS.test(region)) { switches.delete('boxing'); switches.delete('elbows') }
  const placed = (parse(session.contextJson).conditioningPick ?? null) as { templateId?: unknown; lighterWeek?: unknown } | null
  const [history, kicksLeft, level, lifts, inp] = await Promise.all([
    conditioningHistory(db, session.id),
    kicksLeftThisWeek(db, day, session.id),
    levelToday(db, day),
    db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.scheduledDate, day), eq(sessions.type, 'strength'), inArray(sessions.status, ['planned', 'in_progress', 'completed']))),
    loadBrainInputs(db, today),
  ])
  // The same reads that ease every other session: a morning AMBER or RED on it, back from
  // being sick, away, or a lighter week in force all take the steady version.
  const cap = brainCapFrom(session.contextJson)?.state
  const night = nightState(inp, day)
  const lighter = lighterOn(inp, day)
  const eased = cap === 'AMBER' || cap === 'RED' || night.returning || activeState(inp.temp, 'away', day) != null || lighter != null
  const readiness: ConditioningReadiness = state.injury || state.coachEase || state.returnCtx?.active || eased ? 'low' : 'ok'
  const lighterWeek = placed?.lighterWeek === true || lighter != null
  const pick = pickConditioning({ level, readiness, switches, lastTemplateId: history.lastTemplateId, history: history.steps, kicksLeft, liftDay: lifts.length > 0, lighterWeek })
  const placedT = typeof placed?.templateId === 'string' && readiness !== 'low' ? templateById(placed.templateId) : null
  if (!placedT) return { plan: pick.plan, lighterWeek }
  const step = nextStep(history.steps, placedT.id)
  return { plan: buildPlan(placedT, { step, switches, lighterWeek }), lighterWeek }
}

/** The session, its plan (kept once started; before, the coach's pick as it would be now), its log and minutes. */
export async function conditioningResponse(db: DB, id: string, todayHeader?: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id))
  if (!session) return { session: null, plan: null, started: false, log: null, plannedMin: null }
  const kept = planOf(session.contextJson)
  const plan = kept ?? (session.status === 'planned' ? (await pickFor(db, session, todayHeader)).plan : null)
  const log = kept ? parseConditioningLog(parse(session.contextJson).conditioningLog, kept.parts.length) : null
  return { session, plan, started: kept != null, log, plannedMin: plan ? planMinutes(plan) : null }
}

bagConditioning.get('/:id/bag-conditioning', async (c) => {
  const out = await conditioningResponse(createDB(c.env), c.req.param('id'), c.req.header(TODAY_HEADER))
  if (!out.session) return c.json({ error: 'session not found' }, 404)
  return c.json(out)
})

/** START: the plan is picked once, then kept (idempotent). Null: no such session; 'type': not one. */
export async function startConditioning(db: DB, id: string, todayHeader?: string, nowSec = Math.floor(Date.now() / 1000)) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id))
  if (!session) return null
  if (session.type !== BAG_CONDITIONING) return 'type' as const
  if (!planOf(session.contextJson)) {
    const { plan, lighterWeek } = await pickFor(db, session, todayHeader)
    const kept = { templateId: plan.templateId, step: plan.step, switches: [...plan.switches], lighterWeek }
    await db.update(sessions).set({
      status: 'in_progress',
      startedAt: session.startedAt ?? nowSec,
      contextJson: mergeContext(session.contextJson, { conditioning: kept }),
    }).where(eq(sessions.id, id))
  }
  return conditioningResponse(db, id, todayHeader)
}

bagConditioning.post('/:id/start-bag-conditioning', async (c) => {
  const out = await startConditioning(createDB(c.env), c.req.param('id'), c.req.header(TODAY_HEADER))
  if (out == null) return c.json({ error: 'session not found' }, 404)
  if (out === 'type') return c.json({ error: 'not a bag conditioning session' }, 400)
  return c.json(out)
})

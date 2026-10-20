// Injury weather and the raven on the server (page 58, approved 2026-10-19).
// The rules are pure in lib/coach/bodyWatch.ts; this file loads the reports,
// keeps body_alerts (0036), runs the morning pass (open, raise, step down,
// the return, the quiet rule), and writes a plan's changes as ordinary coach
// change rows (week_adjustments: Dagaz on the day, UNDO until it starts).
// Days that aren't made yet keep their changes pending until their sessions
// are (applyPendingBodyPlans, next to applyPendingMerges). Nothing blocks.

import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import { bodyAlerts, dailyLogs, sessions, weekAdjustments, weekPlans } from '../db/schema'
import type { createDB } from '../db/client'
import { getRunWalkWeek, runWalkTotalSec } from '../lib/blockZero/running'
import {
  BODY_REGIONS,
  PLACE_NAME,
  askDue,
  askView,
  clearView,
  evaluateWatch,
  groupOf,
  holdChanges,
  isBodyRegion,
  isBodyStage,
  leftOutFor,
  morningReportLine,
  morningsBetter,
  noteView,
  physioView,
  planFor,
  planToast,
  plan2View,
  programLine,
  ratingsFor,
  ravenAlarmLine,
  reportsFor,
  sessionWords,
  shouldClear,
  stepAfter,
  stepLinesFor,
  stepToast,
  stepUp,
  weatherFor,
  type AlertLike,
  type AskView,
  type BodyEvent,
  type BodyRegion,
  type BodyStage,
  type BodyWeather,
  type BoardLine,
  type BoardView,
  type PlanChange,
  type PlanOp,
  type PlanSession,
  type PlanShown,
  type Report,
  type StepUpChange,
  type Trigger,
  type WatchInputs,
} from '../lib/coach/bodyWatch'
import { applyContext, injuryFlag, mondayOf, nameToken, readChangeRow, slotStart, type CoachEase, type SkipSignal } from '../lib/coach'
import { getActiveBlock } from './blockZeroData'
import { blockDayPlan, loadTemplateExtras, mtClassDays, trainingWeekFor, weekStamps } from './coachData'
import { pmStart, recordChanges, snap, type NewChange } from './changes'

type DB = ReturnType<typeof createDB>
type AlertRow = typeof bodyAlerts.$inferSelect
type SessionRow = typeof sessions.$inferSelect

const DAY_SEC = 86400
/** How far back the reports are read (T1's six weeks, plus a run's start). */
const LOOKBACK = 84

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function ctxOf(contextJson: string | null | undefined): Record<string, unknown> {
  return parse<Record<string, unknown>>(contextJson, {})
}

/** The body-plan mark a plan change leaves on a session (context_json.bodyPlan). */
export interface BodyPlanCtx {
  alertId: string
  round: number
  op: PlanOp['kind']
  was: string
  shapeWeek?: number
  label?: string
  which?: 'back' | 'neck'
}

export function bodyPlanOf(contextJson: string | null | undefined): BodyPlanCtx | null {
  const v = ctxOf(contextJson).bodyPlan as BodyPlanCtx | undefined
  return v && typeof v === 'object' && typeof v.op === 'string' ? v : null
}

// ─── Inputs ───────────────────────────────────────────────────

/** Everything the triggers read, for the days up to `today`. */
export async function loadWatchInputs(db: DB, today: number): Promise<WatchInputs> {
  const from = today - LOOKBACK
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, today)))
  const plans = rows.some(r => r.weekPlanId) ? await db.select({ id: weekPlans.id, weekNumber: weekPlans.weekNumber }).from(weekPlans) : []
  const weekOfPlan = new Map(plans.map(p => [p.id, p.weekNumber]))
  const skips: Array<WatchInputs['skips'][number]> = []
  const notes: Array<WatchInputs['notes'][number]> = []
  const runs: Array<WatchInputs['runs'][number]> = []
  for (const r of rows) {
    const day = r.scheduledDate as number
    const name = sessionWords({ type: r.type, label: r.label, notes: r.notes })
    if (r.status === 'skipped') skips.push({ day, reason: r.skipReason, detail: r.skipReasonDetail, notes: null, name })
    const userNotes = ctxOf(r.contextJson).userNotes
    if (typeof userNotes === 'string' && userNotes.trim()) notes.push({ day, text: userNotes, name })
    if (r.status === 'completed' && (r.type === 'foundation_run' || r.type === 'running')) {
      if (r.blockType === 'block_zero' && r.type === 'foundation_run') {
        const plan = bodyPlanOf(r.contextJson)
        const week = plan?.op === 'shape' && plan.shapeWeek ? plan.shapeWeek : weekOfPlan.get(r.weekPlanId ?? '') ?? r.blockWeek ?? 1
        const w = getRunWalkWeek(week)
        runs.push({ day, boutSec: w.runSec, totalSec: r.durationSec ?? runWalkTotalSec(w) })
      } else if (r.durationSec) {
        runs.push({ day, boutSec: r.durationSec, totalSec: r.durationSec })
      }
    }
  }
  const logs = await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, from), lte(dailyLogs.logDate, today)))
  const backMornings = logs.map(l => ({ day: l.logDate, value: l.backToday ?? null }))
  const ratings: Array<WatchInputs['ratings'][number]> = []
  for (const l of logs) {
    for (const [region, value] of Object.entries(parse<Record<string, unknown>>(l.regionRatingsJson, {}))) {
      if (typeof value === 'number') ratings.push({ day: l.logDate, region, value })
    }
  }
  const pickRows = await db.select().from(weekAdjustments).where(and(isNotNull(weekAdjustments.againstFlag), gte(weekAdjustments.createdAt, from * DAY_SEC)))
  const picks: Array<WatchInputs['picks'][number]> = []
  for (const p of pickRows) {
    const c = readChangeRow(p)
    if (!c || c.undoneAt != null || !p.againstFlag) continue
    picks.push({ day: c.after.day, region: p.againstFlag, name: sessionWords({ type: p.sessionType, label: null }) })
  }
  return { skips, notes, backMornings, ratings, picks, runs }
}

// ─── The plan's sessions (made, or the template's for days not made yet) ──

/** The sessions from `from` to `to` as the plans read them. */
export async function loadPlanSessions(db: DB, from: number, to: number, today: number, alertId: string | null): Promise<Array<PlanSession & { row: SessionRow | null }>> {
  const block = await getActiveBlock(db)
  if (!block) return []
  const blockZero = block.blockType === 'block_zero'
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, to)))
  const weeks = new Map<number, number>()
  const weekOf = async (day: number) => {
    const m = mondayOf(day)
    if (!weeks.has(m)) weeks.set(m, weekStamps(block, await trainingWeekFor(db, block, m, today)).weekNumber)
    return weeks.get(m) as number
  }
  const out: Array<PlanSession & { row: SessionRow | null }> = []
  for (const r of rows) {
    const day = r.scheduledDate as number
    const plan = bodyPlanOf(r.contextJson)
    out.push({
      id: r.id, day, type: r.type, label: r.label, notes: r.notes, timeSlot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status,
      week: r.type === 'strength' && r.blockWeek ? r.blockWeek : await weekOf(day), blockZero: r.blockType === 'block_zero',
      plan: plan && (alertId == null || plan.alertId === alertId) ? { op: plan.op, was: plan.was, shapeWeek: plan.shapeWeek } : null,
      row: r,
    })
  }
  // Days not made yet: the template stands in (the week is prepared on Sunday or from Program).
  const mtDays = await mtClassDays(db)
  const extras = await loadTemplateExtras(db, block.id)
  for (let d = Math.max(from, today); d <= to; d++) {
    if (rows.some(r => r.scheduledDate === d && (r.source == null || r.source === 'template'))) continue
    const week = await weekOf(d)
    const plan = blockDayPlan(block, d, week, mtDays, extras)
    for (const e of plan.entries) {
      out.push({ id: null, day: d, type: e.type, label: blockZero || 'extra' in e ? e.label : null, notes: e.runCategory ?? null, timeSlot: e.timeSlot, status: 'planned', week, blockZero, plan: null, row: null })
    }
  }
  return out.sort((a, b) => a.day - b.day || (a.timeSlot === 'am' ? -1 : 1))
}

// ─── Alert rows ───────────────────────────────────────────────

interface Evidence { reports: Report[]; picks: Array<{ day: number; name: string }>; count: number; first: number; latest: number }
interface Answer { on: number; answer: 'better' | 'sore' }
interface PendingItem { day: number; type: string; timeSlot: 'am' | 'pm'; op: PlanOp; before: string; after: string; was: string; round: number; why: string; detail: string | null }

export function alertLike(r: AlertRow): AlertLike & { id: string; seen: boolean } {
  const region = r.region as BodyRegion
  const ev = parse<Evidence>(r.evidenceJson, { reports: [], picks: [], count: 0, first: r.openedAt, latest: r.openedAt })
  return {
    id: r.id,
    region,
    stage: isBodyStage(r.stage) ? r.stage : 'watch',
    level: r.level,
    ackedLevel: r.ackedLevel,
    triggers: parse<Trigger[]>(r.triggersJson, [r.trigger as Trigger]),
    openedAt: r.openedAt,
    clearedAt: r.clearedAt,
    clearReason: r.clearReason,
    evidence: ev,
    contextLine: r.contextLine,
    planRound: r.planRound,
    planStartedAt: r.planStartedAt,
    planEndsAt: r.planEndsAt,
    askOn: r.askOn,
    plan1Start: r.plan1Start,
    answers: parse<Answer[]>(r.answersJson, []),
    appliedOn: r.appliedOn,
    stepLines: parse<BoardLine[] | null>(r.stepJson, null),
    seen: r.seenAt != null,
  }
}

const TRIGGER_RANK: Record<Trigger, number> = { picked_through: 0, not_easing: 1, slow: 2, comes_back: 3 }
const strongest = (t: Trigger[]) => [...t].sort((a, b) => TRIGGER_RANK[a] - TRIGGER_RANK[b])[0] ?? 'comes_back'

async function openAlerts(db: DB): Promise<AlertRow[]> {
  return db.select().from(bodyAlerts).where(isNull(bodyAlerts.clearedAt))
}

async function getAlert(db: DB, id: string): Promise<AlertRow | null> {
  const [row] = await db.select().from(bodyAlerts).where(eq(bodyAlerts.id, id))
  return row ?? null
}

async function saveAlert(db: DB, id: string, patch: Partial<AlertRow>, nowSec: number) {
  await db.update(bodyAlerts).set({ ...patch, updatedAt: nowSec }).where(eq(bodyAlerts.id, id))
}

// ─── Writing a plan's changes ────────────────────────────────

const FIELD_OPS = new Set<PlanOp['kind']>(['bike', 'reset'])

/** One plain line for the day's back (tokens per renderWhy). */
function whyFor(region: BodyRegion, c: Pick<PlanChange, 'op' | 'type' | 'label' | 'notes'>, stepUpWeek?: number | null): { why: string; detail: string | null } {
  const P = PLACE_NAME[region]
  const name = sessionWords({ type: c.type, label: c.label, notes: c.notes })
  if (stepUpWeek != null) {
    const w = getRunWalkWeek(stepUpWeek)
    return { why: `${P} feels better: back up at ${Math.floor(w.runSec / 60)}:${String(w.runSec % 60).padStart(2, '0')} run segments.`, detail: `Walk ${w.walkSec / 60}:00 between, ${w.rounds} rounds. Then the plan.` }
  }
  switch (c.op.kind) {
    case 'bike': return { why: `${P} plan: ${c.op.label.toLowerCase()} instead of ${name}.`, detail: 'Easy, pain-free, 25 min.' }
    case 'reset': return { why: `${P} plan: Reset instead of ${name}.`, detail: 'Easy, 25 min.' }
    case 'shape': return { why: `${P} plan: back at 2:00 run segments.`, detail: 'Walk 1:00 between, 7 rounds.' }
    case 'technique': return { why: `${P} plan: technique only. No hard rounds.`, detail: null }
    case 'one_set': return { why: `${P} plan: one set lighter, RPE 6.`, detail: 'Same weights.' }
    case 'back': return { why: `${P} plan: back-friendly lifts, one set less.`, detail: 'Stop if it hurts.' }
    case 'badday': return { why: `${P} plan: Foundation's ${c.op.which === 'back' ? 'bad-back day' : 'bad-neck version'}.`, detail: null }
  }
}

/** The session's fields and context after a plan op. */
function opEffect(op: PlanOp, ctxMark: BodyPlanCtx, reason: string, nowSec: number): { fields: Partial<SessionRow>; ctx: Record<string, unknown> } {
  const ctx: Record<string, unknown> = { bodyPlan: ctxMark }
  if (op.kind === 'one_set') ctx.coachEase = { kind: 'one_set', reason, source: 'injury', at: nowSec } satisfies CoachEase
  if (op.kind === 'bike') return { fields: { type: 'active_recovery', label: op.label, notes: null }, ctx }
  if (op.kind === 'reset') return { fields: { type: 'active_recovery', label: null, notes: null }, ctx }
  return { fields: {}, ctx }
}

/** Write one plan change on a made session: the session, then its change row. Returns the row id. */
async function writeChange(db: DB, alert: AlertRow, row: SessionRow, c: { op: PlanOp; before: string; after: string; was: string; why: string; detail: string | null; round: number }, setId: string, nowSec: number, pm: string): Promise<string | null> {
  if (row.status !== 'planned' || row.scheduledDate == null) return null
  const mark: BodyPlanCtx = { alertId: alert.id, round: c.round, op: c.op.kind, was: c.was, ...(c.op.kind === 'shape' ? { shapeWeek: c.op.week } : {}), ...(c.op.kind === 'bike' ? { label: c.op.label } : {}), ...(c.op.kind === 'badday' ? { which: c.op.which } : {}) }
  const { fields, ctx } = opEffect(c.op, mark, c.why, nowSec)
  const fieldKeys = FIELD_OPS.has(c.op.kind) ? (['type', 'label', 'notes'] as const) : ([] as const)
  const ctxKeys = Object.keys(ctx)
  const before = snap(row, fieldKeys, ctxKeys)
  const contextJson = applyContext(row.contextJson, ctx)
  const next = { ...row, ...fields, contextJson }
  await db.update(sessions).set({ ...fields, contextJson }).where(eq(sessions.id, row.id))
  const day = row.scheduledDate
  const name = sessionWords({ type: row.type, label: row.label, notes: row.notes })
  const list: NewChange[] = [{
    setId, actor: 'coach', kind: 'ease', targetSessionId: row.id, sessionType: next.type,
    before: { show: c.before, day, sessions: [before] },
    after: { show: c.after, day, sessions: [snap(next, fieldKeys, ctxKeys)], put: { line: `${nameToken(name.replace(/^the /, '').replace(/^./, x => x.toUpperCase()), day)} is back as planned.`, dim: 'The coach leaves it as you set it this week.' } },
    why: c.why, detail: c.detail, undoUntil: slotStart(day, row.timeSlot, pm),
    adjustmentType: 'body_plan', extraSource: { rule: 'body_plan', alertId: alert.id, round: c.round },
  }]
  const [id] = await recordChanges(db, list, nowSec)
  return id ?? null
}

/** Put a plan change back (a later plan or the step back up replaces it). Not a hold: the coach did it. */
async function revertChange(db: DB, changeId: string, nowSec: number): Promise<boolean> {
  const [r] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, changeId))
  const c = r ? readChangeRow(r) : null
  if (!r || !c || c.undoneAt != null) return false
  for (const a of c.after.sessions) {
    const b = c.before.sessions.find(s => s.id === a.id)
    if (!b) continue
    const [s] = await db.select().from(sessions).where(eq(sessions.id, a.id))
    if (!s || s.status !== 'planned') return false
    const fields: Record<string, unknown> = {}
    for (const k of Object.keys(a.f)) fields[k] = (b.f as Record<string, unknown>)[k] ?? null
    const ctx: Record<string, unknown> = {}
    for (const k of Object.keys(a.ctx ?? {})) ctx[k] = b.ctx?.[k] ?? null
    await db.update(sessions).set({ ...fields, contextJson: applyContext(s.contextJson, ctx) }).where(eq(sessions.id, a.id))
  }
  await db.update(weekAdjustments).set({ undoneAt: nowSec, seenAt: nowSec }).where(eq(weekAdjustments.id, changeId))
  return true
}

/** The live (not undone) plan change rows of an alert on a session. */
async function liveChangesOn(db: DB, alertId: string, sessionIds: string[]): Promise<Array<{ id: string; sessionId: string; createdAt: number }>> {
  if (sessionIds.length === 0) return []
  const rows = await db.select().from(weekAdjustments).where(and(eq(weekAdjustments.adjustmentType, 'body_plan'), inArray(weekAdjustments.targetSessionId, sessionIds), isNull(weekAdjustments.undoneAt)))
  return rows
    .filter(r => parse<{ alertId?: string }>(r.sourceData, {}).alertId === alertId)
    .map(r => ({ id: r.id, sessionId: r.targetSessionId as string, createdAt: r.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

async function revertAllOn(db: DB, alertId: string, sessionId: string, nowSec: number) {
  for (const c of await liveChangesOn(db, alertId, [sessionId])) await revertChange(db, c.id, nowSec)
}

// ─── The pass ─────────────────────────────────────────────────

/**
 * The morning pass (runs on every read of the watch, and after a skip, a
 * session's notes or a check-in): open a place that fires, raise or ease the
 * weather, open the raven's return on its morning, keep the physio stage's
 * bikes, and clear what has gone quiet.
 */
export async function bodyPass(db: DB, today: number, nowSec: number): Promise<void> {
  const inputs = await loadWatchInputs(db, today)
  const open = await openAlerts(db)
  for (const row of open) {
    const region = row.region as BodyRegion
    if (!isBodyRegion(region)) continue
    let stage: BodyStage = isBodyStage(row.stage) ? row.stage : 'watch'
    // Page 57's quiet rule: no report for 14 days and good mornings. It clears, and the runs step back up.
    if (shouldClear(region, inputs, today, row.openedAt)) {
      await clearAlert(db, row, today, nowSec, 'quiet')
      continue
    }
    const patch: Partial<AlertRow> = {}
    const ev = evaluateWatch(region, inputs, today)
    if (ev) {
      patch.evidenceJson = JSON.stringify({ reports: ev.reports, picks: ev.picks, count: ev.count, first: ev.first, latest: ev.latest } satisfies Evidence)
      patch.contextLine = ev.contextLine
      patch.triggersJson = JSON.stringify([...new Set([...parse<Trigger[]>(row.triggersJson, []), ...ev.triggers])])
      patch.trigger = strongest(ev.triggers)
      // It steps up at once when a pattern fires; the raven brings a new note.
      if (ev.level > row.level) { patch.level = ev.level; patch.levelAt = today; patch.seenAt = null }
    }
    // One level down for each week whose mornings beat the week before, with no new report.
    const level = patch.level ?? row.level
    const lastReport = reportsFor(region, inputs).filter(r => r.day <= today).at(-1)?.day ?? -Infinity
    const since = row.levelAt ?? row.openedAt
    if (level > 1 && today - since >= 7 && lastReport < since && morningsBetter(ratingsFor(region, inputs), today)) {
      patch.level = level - 1
      patch.levelAt = today
    }
    // The return: the morning after the plan ends.
    if ((stage === 'plan1' || stage === 'plan2') && row.askOn != null && today >= row.askOn) {
      stage = stepAfter(stage, 'ask_due') ?? stage
      patch.stage = stage
    }
    if (Object.keys(patch).length > 0) await saveAlert(db, row.id, patch, nowSec)
    // The physio stage holds plan 2's bikes: runs made since become bikes too.
    if (stage === 'physio') await holdBikes(db, { ...row, ...patch }, today, nowSec)
  }

  // New places. After a clearing, a new report brings the old dates back in (T1 still counts them).
  const recent = await db.select().from(bodyAlerts).where(gte(bodyAlerts.openedAt, today - 120))
  for (const region of BODY_REGIONS) {
    if (open.some(r => r.region === region)) continue
    const ev = evaluateWatch(region, inputs, today)
    if (!ev || ev.level < 1) continue
    const lastClear = recent.filter(r => r.region === region && r.clearedAt != null).reduce((m, r) => Math.max(m, r.clearedAt as number), -Infinity)
    if (ev.latest <= lastClear) continue
    await db.insert(bodyAlerts).values({
      id: crypto.randomUUID(), region, trigger: strongest(ev.triggers), triggersJson: JSON.stringify(ev.triggers), openedAt: today,
      evidenceJson: JSON.stringify({ reports: ev.reports, picks: ev.picks, count: ev.count, first: ev.first, latest: ev.latest } satisfies Evidence),
      contextLine: ev.contextLine, level: ev.level, ackedLevel: 0, levelAt: today, stage: 'watch', planRound: 0, createdAt: nowSec, updatedAt: nowSec,
    })
  }
}

/** The physio stage keeps the easy bikes in place of runs until it feels better (approved). */
async function holdBikes(db: DB, row: AlertRow, today: number, nowSec: number) {
  const region = row.region as BodyRegion
  const list = await loadPlanSessions(db, today + 1, today + 13, today, row.id)
  const made = list.filter(s => s.id != null)
  const holds = holdChanges(region, today + 1, made)
  if (holds.length === 0) return
  const pm = await pmStart(db)
  const setId = crypto.randomUUID()
  const ids: string[] = []
  for (const h of holds) {
    const s = made.find(x => x.id === h.sessionId)
    if (!s?.row) continue
    const w = { why: `${PLACE_NAME[region]}: the ${h.after === 'EASY WALK' ? 'easy walks' : 'easy bikes'} stay until it feels better.`, detail: 'Easy, pain-free, 25 min. UNDO puts it back.' }
    const id = await writeChange(db, row, s.row, { op: h.op, before: h.before, after: h.after, was: h.was, round: 2, ...w }, setId, nowSec, pm)
    if (id) ids.push(id)
  }
  if (ids.length) await saveAlert(db, row.id, { planChangeIds: JSON.stringify([...parse<string[]>(row.planChangeIds, []), ...ids]) }, nowSec)
}

// ─── His answers ──────────────────────────────────────────────

export type BodyResult = { ok: true; toast: { title: string; text: string } | null } | { ok: false; status: 404 | 409; error: string }

/** DO IT: the plan goes on the week as coach changes, each with UNDO. */
export async function applyBodyPlan(db: DB, id: string, today: number, nowSec: number): Promise<BodyResult> {
  const row = await getAlert(db, id)
  if (!row) return { ok: false, status: 404, error: 'not found' }
  const stage = isBodyStage(row.stage) ? row.stage : 'watch'
  const next = stepAfter(stage, 'doit')
  if (!next || (next !== 'plan1' && next !== 'plan2')) return { ok: false, status: 409, error: 'No plan to apply now.' }
  const round = next === 'plan1' ? 1 : 2
  const region = row.region as BodyRegion
  // Plan 2 starts on the return morning he said still sore; plan 1 tomorrow.
  const offered = round === 2 ? (parse<Answer[]>(row.answersJson, []).filter(a => a.answer === 'sore').at(-1)?.on ?? today) : today
  const list = await loadPlanSessions(db, Math.min(offered, today), today + 21, today, row.id)
  const plan = planFor(region, round, offered, list)
  const pm = await pmStart(db)
  const setId = crypto.randomUUID()
  const ids: string[] = []
  const pending: PendingItem[] = parse<PendingItem[]>(row.pendingJson, []).filter(p => p.day > today && p.round !== 1)
  for (const c of plan.changes) {
    if (c.day <= today) continue
    const w = whyFor(region, c)
    if (c.sessionId == null) {
      pending.push({ day: c.day, type: c.type, timeSlot: c.timeSlot, op: c.op, before: c.before, after: c.after, was: c.was, round, why: w.why, detail: w.detail })
      continue
    }
    const s = list.find(x => x.id === c.sessionId)
    if (!s?.row) continue
    // Plan 2 replaces plan 1's 2:00 runs: those go back first.
    if (round === 2 && s.plan) await revertAllOn(db, row.id, s.row.id, nowSec)
    const [fresh] = await db.select().from(sessions).where(eq(sessions.id, s.row.id))
    const cid = fresh ? await writeChange(db, row, fresh, { op: c.op, before: c.before, after: c.after, was: c.was, round, ...w }, setId, nowSec, pm) : null
    if (cid) ids.push(cid)
  }
  const shown: PlanShown = { round: plan.round, start: plan.start, end: plan.end, askOn: plan.askOn, lines: plan.lines, preview: plan.preview }
  await saveAlert(db, id, {
    stage: next, planRound: round, planStartedAt: plan.start, planEndsAt: plan.end, askOn: plan.askOn, appliedOn: today,
    ...(round === 1 ? { plan1Start: plan.start } : {}),
    ackedLevel: row.level, seenAt: row.seenAt ?? nowSec,
    planChangeIds: JSON.stringify([...parse<string[]>(row.planChangeIds, []), ...ids]),
    pendingJson: JSON.stringify(pending), planJson: JSON.stringify(shown),
  }, nowSec)
  return { ok: true, toast: planToast(region, plan, today) }
}

/** GOT IT: read; nothing on the week changes. The rain settles to its quieter fall. */
export async function gotBodyNote(db: DB, id: string, nowSec: number): Promise<BodyResult> {
  const row = await getAlert(db, id)
  if (!row) return { ok: false, status: 404, error: 'not found' }
  const stage = isBodyStage(row.stage) ? row.stage : 'watch'
  const next = stage === 'cleared' ? 'cleared' : stepAfter(stage, 'got') ?? stage
  await saveAlert(db, id, { stage: next, ackedLevel: Math.max(row.ackedLevel, row.level), seenAt: row.seenAt ?? nowSec }, nowSec)
  return { ok: true, toast: null }
}

/** The note was opened: the raven stops looking round. */
export async function seenBodyNote(db: DB, id: string, nowSec: number): Promise<BodyResult> {
  const row = await getAlert(db, id)
  if (!row) return { ok: false, status: 404, error: 'not found' }
  if (row.seenAt == null) await saveAlert(db, id, { seenAt: nowSec }, nowSec)
  return { ok: true, toast: null }
}

/** FEELS BETTER / STILL SORE / Not now on the raven's question (and FEELS BETTER at the physio stage). */
export async function answerBody(db: DB, id: string, answer: 'better' | 'sore' | 'not_now', today: number, nowSec: number): Promise<BodyResult> {
  const row = await getAlert(db, id)
  if (!row) return { ok: false, status: 404, error: 'not found' }
  const stage = isBodyStage(row.stage) ? row.stage : 'watch'
  const event: BodyEvent = answer
  const next = stepAfter(stage, event)
  if (!next) return { ok: false, status: 409, error: 'Nothing to answer now.' }
  if (answer === 'not_now') {
    // It waits a day: the raven stays perched and the plan carries on as written.
    await saveAlert(db, id, { askOn: today + 1, seenAt: row.seenAt ?? nowSec }, nowSec)
    return { ok: true, toast: null }
  }
  const answers = [...parse<Answer[]>(row.answersJson, []), { on: today, answer }]
  if (answer === 'better') {
    await saveAlert(db, id, { answersJson: JSON.stringify(answers) }, nowSec)
    const toast = await clearAlert(db, { ...row, answersJson: JSON.stringify(answers) }, today, nowSec, 'better')
    return { ok: true, toast }
  }
  if (next === 'offer2') {
    // One more plan: its note lands, the rain loud again until he answers it.
    await saveAlert(db, id, { stage: next, answersJson: JSON.stringify(answers), seenAt: null, ackedLevel: 0 }, nowSec)
    return { ok: true, toast: null }
  }
  // Still sore the second time: see a physio. No third plan; the bikes stay; the rain stays.
  const updated = { ...row, stage: next, answersJson: JSON.stringify(answers), seenAt: null, ackedLevel: row.level }
  await saveAlert(db, id, { stage: next, answersJson: updated.answersJson, seenAt: null, ackedLevel: row.level }, nowSec)
  await holdBikes(db, updated, today, nowSec)
  return { ok: true, toast: null }
}

/** The clearing: the plan steps back up (2:00, then 3:30, then the plan); the raven leaves tomorrow. */
async function clearAlert(db: DB, row: AlertRow, today: number, nowSec: number, reason: 'better' | 'quiet'): Promise<{ title: string; text: string }> {
  const region = row.region as BodyRegion
  const list = await loadPlanSessions(db, today + 1, today + 21, today, row.id)
  const steps: StepUpChange[] = stepUp(region, today + 1, list)
  const pm = await pmStart(db)
  const setId = crypto.randomUUID()
  const pending: PendingItem[] = []
  for (const st of steps) {
    if (st.same) continue
    if (st.sessionId == null) {
      if (st.shapeWeek != null) {
        const s = list.find(x => x.id == null && x.day === st.day && x.type === 'foundation_run')
        if (s) pending.push({ day: st.day, type: s.type, timeSlot: s.timeSlot, op: { kind: 'shape', week: st.shapeWeek }, before: st.before, after: st.after, was: '', round: 3, ...whyFor(region, { op: { kind: 'shape', week: st.shapeWeek }, type: s.type, label: s.label, notes: s.notes }, st.shapeWeek) })
      }
      continue
    }
    if (st.revert) await revertAllOn(db, row.id, st.sessionId, nowSec)
    if (st.shapeWeek != null) {
      const [fresh] = await db.select().from(sessions).where(eq(sessions.id, st.sessionId))
      if (fresh) await writeChange(db, row, fresh, { op: { kind: 'shape', week: st.shapeWeek }, before: st.before, after: st.after, was: '', round: 3, ...whyFor(region, { op: { kind: 'shape', week: st.shapeWeek }, type: fresh.type, label: fresh.label, notes: fresh.notes }, st.shapeWeek) }, setId, nowSec, pm)
    }
  }
  const lines = stepLinesFor(steps, list, today + 1)
  await saveAlert(db, row.id, {
    stage: 'cleared', clearedAt: today, clearReason: reason, seenAt: null,
    pendingJson: JSON.stringify(pending), stepJson: JSON.stringify(lines),
  }, nowSec)
  return stepToast(steps)
}

// ─── Days made later ──────────────────────────────────────────

/**
 * Sessions just made (generate-today, the weekly pass, Prepare week): a
 * plan's change that waited for its day lands now, as a coach change with
 * UNDO; at the physio stage, a new run becomes an easy bike.
 */
export async function applyPendingBodyPlans(db: DB, createdIds: string[]): Promise<void> {
  if (createdIds.length === 0) return
  try {
    const alerts = await db.select().from(bodyAlerts).where(isNotNull(bodyAlerts.pendingJson))
    const physio = (await openAlerts(db)).filter(a => a.stage === 'physio')
    if (alerts.length === 0 && physio.length === 0) return
    const created = await db.select().from(sessions).where(inArray(sessions.id, createdIds))
    const pm = await pmStart(db)
    const nowSec = Math.floor(Date.now() / 1000)
    for (const a of alerts) {
      const items = parse<PendingItem[]>(a.pendingJson, [])
      if (items.length === 0) continue
      const left: PendingItem[] = []
      const ids: string[] = []
      const setId = crypto.randomUUID()
      for (const it of items) {
        const s = created.find(r => r.scheduledDate === it.day && r.type === it.type && (r.timeSlot ?? 'am') === it.timeSlot && !bodyPlanOf(r.contextJson))
        if (!s) { left.push(it); continue }
        const id = await writeChange(db, a, s, it, setId, nowSec, pm)
        if (id) ids.push(id)
      }
      if (ids.length || left.length !== items.length) {
        await saveAlert(db, a.id, { pendingJson: JSON.stringify(left), planChangeIds: JSON.stringify([...parse<string[]>(a.planChangeIds, []), ...ids]) }, nowSec)
      }
    }
    for (const a of physio) {
      const region = a.region as BodyRegion
      if (!isBodyRegion(region)) continue
      const from = parse<Answer[]>(a.answersJson, []).at(-1)?.on ?? 0
      const setId = crypto.randomUUID()
      for (const s of created) {
        if (s.scheduledDate == null || s.scheduledDate <= from || bodyPlanOf(s.contextJson)) continue
        const ps: PlanSession = { id: s.id, day: s.scheduledDate, type: s.type, label: s.label, notes: s.notes, timeSlot: s.timeSlot === 'pm' ? 'pm' : 'am', status: s.status, week: s.blockWeek ?? 1, blockZero: s.blockType === 'block_zero', plan: null }
        for (const h of holdChanges(region, from + 1, [ps])) {
          await writeChange(db, a, s, { op: h.op, before: h.before, after: h.after, was: h.was, round: 2, why: `${PLACE_NAME[region]}: the easy bikes stay until it feels better.`, detail: 'Easy, pain-free, 25 min. UNDO puts it back.' }, setId, nowSec, pm)
        }
      }
    }
  } catch (err) {
    console.warn('[body] pending plans failed', err)
  }
}

// ─── His picks against a place on watch (T4) ─────────────────

/** Mark his own add / swap row when it picks what the coach leaves out for a place on watch. Quiet: never refused. */
export async function markAgainstFlag(db: DB, changeIds: string[], type: string, notes: string | null, day: number): Promise<void> {
  if (changeIds.length === 0) return
  try {
    const regions = new Set<string>((await openAlerts(db)).map(a => a.region))
    // The 10-day flag from an injury skip counts as on watch too (page 57).
    const flag = await injuryFlagFor(db, day)
    if (flag) regions.add(flag)
    const hit = [...regions].find(r => isBodyRegion(r) && leftOutFor(r, type, notes))
    if (!hit) return
    await db.update(weekAdjustments).set({ againstFlag: hit }).where(and(inArray(weekAdjustments.id, changeIds), eq(weekAdjustments.actor, 'you')))
  } catch (err) {
    console.warn('[body] against-flag mark failed', err)
  }
}

async function injuryFlagFor(db: DB, day: number): Promise<string | null> {
  const rows = await db.select({ epochDay: sessions.scheduledDate, skipReason: sessions.skipReason, detail: sessions.skipReasonDetail, notes: sessions.notes })
    .from(sessions).where(and(eq(sessions.status, 'skipped'), gte(sessions.scheduledDate, day - 10), lte(sessions.scheduledDate, day)))
  const signals: SkipSignal[] = rows.filter(r => r.epochDay != null).map(r => ({ epochDay: r.epochDay as number, skipReason: r.skipReason, detail: r.detail, notes: r.notes }))
  return injuryFlag(signals, day)?.region ?? null
}

/** A lower-leg place on watch (knee, ankle, shin): REPLACE on a run offers the knee-safe pick, not rope. */
export async function lowerLegOnWatch(db: DB): Promise<boolean> {
  return (await openAlerts(db)).some(a => isBodyRegion(a.region) && groupOf(a.region) === 'lower')
}

// ─── What the screens read ───────────────────────────────────

export type RavenPose = 'watch' | 'held' | 'settled' | 'leave'

export interface BodyWatchView {
  id: string
  region: BodyRegion
  place: string
  stage: BodyStage
  seen: boolean
  weather: BodyWeather
  /** The raven's pose; null when it has gone. */
  raven: RavenPose | null
  /** The day it landed (or returned): the screens fly it in once per day. */
  arrivedOn: number
  line: { text: string; settled: boolean } | null
  /** The return's question opens on top today. */
  askDue: boolean
  ask: AskView | null
  /** What a tap on the raven opens (the ask stages open the question instead). */
  board: BoardView | null
  programLine: string | null
  /** The plan's days (DO IT's day to the return): Program shows its line on those weeks. */
  planDays: [number, number] | null
}

export interface BodyWatchPayload {
  alert: BodyWatchView | null
  /** The weather over the whole world (the strongest open place). */
  weather: BodyWeather
  /** "<Place> today" cards for the morning check-in (the back has its own). */
  checkIn: Array<{ region: BodyRegion; label: string }>
}

const STAGE_RANK: Record<BodyStage, number> = { ask1: 0, ask2: 0, offer2: 1, watch: 2, physio: 3, noted2: 4, plan2: 5, noted: 6, plan1: 7, cleared: 8 }

/** The episode's plan as its note shows it: the one applied, else as it would go on today. */
async function shownPlan(db: DB, row: AlertRow, a: AlertLike, today: number, round: 1 | 2): Promise<PlanShown> {
  const kept = parse<PlanShown | null>(row.planJson, null)
  if (kept && kept.round === round && (a.stage === 'plan1' || a.stage === 'plan2')) return kept
  const offered = round === 2 ? (a.answers.filter(x => x.answer === 'sore').at(-1)?.on ?? today) : today
  const list = await loadPlanSessions(db, Math.min(offered, today), today + 21, today, row.id)
  const p = planFor(a.region, round, offered, list)
  return { round: p.round, start: p.start, end: p.end, askOn: p.askOn, lines: p.lines, preview: p.preview.filter(x => x.days.length > 0) }
}

async function viewOf(db: DB, row: AlertRow, today: number): Promise<BodyWatchView> {
  const a = alertLike(row)
  const due = askDue(a.stage, a.askOn, today)
  let board: BoardView | null = null
  let ask: AskView | null = null
  switch (a.stage) {
    case 'watch': case 'noted': case 'plan1': board = noteView(a, await shownPlan(db, row, a, today, 1), today); break
    case 'offer2': case 'noted2': case 'plan2': board = plan2View(a, await shownPlan(db, row, a, today, 2), today); break
    case 'physio': board = physioView(a, today); break
    case 'cleared': board = clearView(a, today); break
    case 'ask1': case 'ask2': {
      const next = (await loadPlanSessions(db, today + 1, today + 7, today, row.id)).find(s => s.type === 'foundation_run' || s.plan?.op === 'shape')
      ask = askView(a, today, next?.day ?? null)
      break
    }
  }
  const raven: RavenPose | null = a.stage === 'cleared'
    ? (a.clearedAt === today ? 'settled' : a.clearedAt === today - 1 ? 'leave' : null)
    : due ? 'watch' : a.seen ? 'held' : 'watch'
  return {
    id: row.id, region: a.region, place: PLACE_NAME[a.region], stage: a.stage, seen: a.seen,
    weather: weatherFor(a, today), raven,
    arrivedOn: due ? (a.askOn as number) : a.openedAt,
    line: morningReportLine(a, today), askDue: due, ask, board, programLine: programLine(a, today),
    planDays: a.appliedOn != null && a.askOn != null && (a.stage === 'plan1' || a.stage === 'plan2') ? [a.appliedOn, a.askOn] : null,
  }
}

/** GET /api/body/watch: the pass, then what Today, Program, the Ledger and the Library read. */
export async function bodyWatchPayload(db: DB, today: number, nowSec: number): Promise<BodyWatchPayload> {
  await bodyPass(db, today, nowSec)
  const rows = await db.select().from(bodyAlerts).where(gte(bodyAlerts.updatedAt, 0))
  const shown = rows.filter(r => r.clearedAt == null || r.clearedAt >= today - 1)
  shown.sort((x, y) => {
    const sx = isBodyStage(x.stage) ? STAGE_RANK[x.stage] : 9
    const sy = isBodyStage(y.stage) ? STAGE_RANK[y.stage] : 9
    return sx - sy || y.level - x.level || y.updatedAt - x.updatedAt
  })
  const top = shown[0] ?? null
  const alert = top ? await viewOf(db, top, today) : null
  // The world's weather: the strongest open place; the clearing the day one clears and none is left open.
  const openOnes = shown.filter(r => r.clearedAt == null).map(r => weatherFor(alertLike(r), today))
  const weather: BodyWeather = openOnes.length
    ? openOnes.reduce((w, x) => (x.level > w.level || (x.level === w.level && !x.quiet && w.quiet) ? x : w))
    : { level: 0, quiet: false, clearing: shown.some(r => r.clearedAt === today) }
  const checkIn = rows
    .filter(r => r.clearedAt == null && isBodyRegion(r.region) && r.region !== 'back')
    .map(r => ({ region: r.region as BodyRegion, label: `${PLACE_NAME[r.region as BodyRegion].toUpperCase()} TODAY` }))
  const flag = await injuryFlagFor(db, today)
  if (flag && isBodyRegion(flag) && flag !== 'back' && !checkIn.some(c => c.region === flag)) checkIn.push({ region: flag, label: `${PLACE_NAME[flag].toUpperCase()} TODAY` })
  return { alert, weather, checkIn }
}

/** The raven's line for the morning alarm on `alarmDay` (page 58 item 14), or null. */
export async function ravenLineFor(db: DB, alarmDay: number, today: number, nowSec: number): Promise<string | null> {
  await bodyPass(db, today, nowSec)
  for (const row of await openAlerts(db)) {
    const line = ravenAlarmLine(alertLike(row), alarmDay)
    if (line) return line
  }
  return null
}

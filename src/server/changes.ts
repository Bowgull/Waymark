// Coach changes on the server (page 56, approved 2026-10-19). Every session
// change is one week_adjustments row (0033): his own (replace, skip, add,
// pull forward) and the coach's (the rebalance after any of his, a missed
// session's fix, check-in and weekly eases). Rules stay pure in lib/coach
// (changes.ts, rebalance.ts, undo.ts, missed.ts); this file loads rows,
// records changes, applies the rebalance and an undo, and builds the views
// the day's back, the week log, the runes and the one quiet line read.

import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { sessions, settings, trainingMaxes, weekAdjustments } from '../db/schema'
import type { createDB } from '../db/client'
import {
  KEY_TYPES,
  RESTORABLE_FIELDS,
  applyContext,
  changeLock,
  coachEaseFrom,
  dayRune,
  heldSessionIds,
  isCoachActor,
  mergedLiftsFrom,
  missedFix,
  mondayOf,
  optionalDay,
  pickContext,
  planUndo,
  readChangeRow,
  rebalance,
  renderWhy,
  runeFor,
  sessionName,
  slotStart,
  whoWord,
  type ChangeActor,
  type ChangeEffect,
  type ChangeLock,
  type ChangeRecordKind,
  type ChangeRowLike,
  type ChangeState,
  type CoachChangePlan,
  type CoachEase,
  type LineChange,
  type RebalanceAction,
  type RebalanceSession,
  type RuneState,
  type SessionFields,
  type SessionNow,
  type SessionSnap,
} from '../lib/coach'
import { rolloverStaleSessionIds } from '../lib/sessionRollover'
import { getActiveBlock } from './blockZeroData'
import { addTemplateExtra, blockKind, blockDayPlan, blockStartDay, loadPlacementContext, loadTemplateExtras, mtClassDays, resolveWeekPlan, toSessionLike, trainingWeekFor, weekStamps } from './coachData'

type DB = ReturnType<typeof createDB>
type SessionRow = typeof sessions.$inferSelect
type AdjRow = typeof weekAdjustments.$inferSelect

const DAY_SEC = 86400

/** Context keys a change may write, and an undo puts back. */
export const CHANGE_CTX_KEYS = ['coachEase', 'coachPush', 'mergedLifts', 'movedFrom', 'movedFor', 'pulledForward', 'classTonight', 'bodyPlan'] as const

// ─── Snapshots ────────────────────────────────────────────────

/** A session's listed fields and context keys, as a change record stores them. */
export function snap(row: Pick<SessionRow, 'id' | 'contextJson'> & SessionFields, fields: ReadonlyArray<keyof SessionFields>, ctxKeys: readonly string[] = []): SessionSnap {
  const f: SessionFields = {}
  for (const k of fields) (f as Record<string, unknown>)[k] = (row as unknown as Record<string, unknown>)[k] ?? null
  return ctxKeys.length > 0 ? { id: row.id, f, ctx: pickContext(row.contextJson, ctxKeys) } : { id: row.id, f }
}

/** A day's state with no sessions (an add's before, a let-go's after). */
export function emptyState(day: number, show = ''): ChangeState {
  return { show, day, sessions: [] }
}

// ─── Recording ────────────────────────────────────────────────

export interface NewChange {
  setId: string
  actor: ChangeActor
  kind: ChangeRecordKind
  /** The session it is about: the rune's row and, for a missed record, the missed session. */
  targetSessionId: string | null
  sessionType: string
  before: ChangeState
  after: ChangeState
  /** One plain line, tokens per renderWhy. */
  why: string
  detail?: string | null
  /** When UNDO stops (local wall-clock seconds); null: when the session starts. */
  undoUntil?: number | null
  /** Legacy columns some readers still key on (felt_hard idempotency). */
  adjustmentType?: string
  extraSource?: Record<string, unknown>
  /** A week plan to file it under; else the plan of its day's week. */
  weekPlanId?: string | null
}

/** The PM session start from settings ("18:00"), for undo_until. */
export async function pmStart(db: DB): Promise<string> {
  const [row] = await db.select({ pm: settings.pmSessionTime }).from(settings)
  return row?.pm && /^\d{1,2}:\d{2}$/.test(row.pm) ? row.pm : '18:00'
}

/** The week plan a day's changes are filed under (week_plan_id is required). */
async function planForDay(db: DB, day: number, nowSec: number): Promise<string | null> {
  const block = await getActiveBlock(db)
  if (!block) return null
  const tw = await trainingWeekFor(db, block, day, Math.min(day, Math.floor(nowSec / DAY_SEC)))
  return resolveWeekPlan(db, block.id, weekStamps(block, tw).weekNumber, mondayOf(day), nowSec)
}

/** Store change records (one row each). Returns their ids; a record with no week plan is skipped. */
export async function recordChanges(db: DB, list: NewChange[], nowSec: number): Promise<string[]> {
  const ids: string[] = []
  for (const c of list) {
    const weekPlanId = c.weekPlanId ?? await planForDay(db, c.after.day, nowSec)
    if (!weekPlanId) continue
    const id = crypto.randomUUID()
    const plain = renderWhy(c.why, c.after.day)
    await db.insert(weekAdjustments).values({
      id,
      weekPlanId,
      adjustmentType: c.adjustmentType ?? (isCoachActor(c.actor) ? 'coach_change' : 'athlete_change'),
      sessionType: c.sessionType,
      action: c.kind,
      reason: plain,
      targetDay: new Date(c.after.day * DAY_SEC * 1000).getUTCDay(),
      targetTimeSlot: null,
      sourceData: JSON.stringify({ note: plain, targetEpochDay: c.after.day, ...(c.extraSource ?? {}) }),
      status: 'accepted',
      auto: isCoachActor(c.actor) ? 1 : 0,
      targetSessionId: c.targetSessionId,
      changeSetId: c.setId,
      actor: c.actor,
      kind: c.kind,
      beforeJson: JSON.stringify(c.before),
      afterJson: JSON.stringify(c.after),
      why: c.why,
      detail: c.detail ?? null,
      undoUntil: c.undoUntil ?? null,
      // His own changes need no telling: they are seen as he makes them.
      seenAt: isCoachActor(c.actor) ? null : nowSec,
      createdAt: nowSec,
    })
    ids.push(id)
  }
  return ids
}

// ─── Reading the week ────────────────────────────────────────

/** Every change record whose day falls in the week starting `monday`. */
export async function loadWeekChanges(db: DB, monday: number): Promise<Array<{ row: AdjRow; change: ChangeRowLike }>> {
  // Changes for a week are written from the Sunday before it (the weekly pass) to after it (a missed session).
  const rows = await db.select().from(weekAdjustments)
    .where(and(isNotNull(weekAdjustments.kind), gte(weekAdjustments.createdAt, (monday - 14) * DAY_SEC)))
  const out: Array<{ row: AdjRow; change: ChangeRowLike }> = []
  for (const r of rows) {
    const change = readChangeRow(r)
    if (change && change.after.day >= monday && change.after.day <= monday + 6) out.push({ row: r, change })
  }
  return out.sort((a, b) => a.change.createdAt - b.change.createdAt)
}

/** Sessions the coach leaves alone in the week of `day`. */
export async function loadHeld(db: DB, day: number): Promise<Set<string>> {
  return heldSessionIds((await loadWeekChanges(db, mondayOf(day))).map(c => c.change))
}

async function sessionsNow(db: DB, ids: string[]): Promise<Map<string, SessionNow & { row: SessionRow }>> {
  const unique = [...new Set(ids)]
  const rows = unique.length > 0 ? await db.select().from(sessions).where(inArray(sessions.id, unique)) : []
  return new Map(rows.map(r => [r.id, { id: r.id, status: r.status, scheduledDate: r.scheduledDate, timeSlot: r.timeSlot, contextJson: r.contextJson, row: r }]))
}

function touched(c: ChangeRowLike): string[] {
  return [...c.before.sessions.map(s => s.id), ...c.after.sessions.map(s => s.id), ...(c.after.created ?? []), ...(c.after.watch ?? []), ...(c.targetSessionId ? [c.targetSessionId] : [])]
}

/** What the screens read for one change. */
export interface ChangeView {
  id: string
  setId: string | null
  actor: ChangeActor
  kind: ChangeRecordKind
  who: 'YOU' | 'COACH' | 'MISSED'
  /** The day it belongs to (rune and log heading). */
  day: number
  /** The session the row and the icon are about. */
  session: { id: string | null; type: string; label: string | null; notes: string | null }
  before: string
  after: string
  logBefore: string | null
  /** Tokens per renderWhy (the screens render it against their own day). */
  why: string
  detail: string | null
  createdAt: number
  undoUntil: number | null
  lock: ChangeLock
  rune: RuneState | null
  put: { line: string; dim: string } | null
  /** A missed session's fix: the session that took its lifts (the "until" line). */
  fix: { day: number; name: string } | null
}

/** A missed session's fix still waiting for its week: its day and session name. */
function pendingFix(c: ChangeRowLike, row: AdjRow): { day: number; name: string } | null {
  if (c.kind !== 'missed' || c.undoUntil == null) return null
  const p = pendingMerge(row.sourceData)
  return p ? { day: p.epochDay, name: p.label } : null
}

/** The week's changes as views, and the rune per day. */
export async function weekChangeViews(db: DB, monday: number, todayDay: number): Promise<{ changes: ChangeView[]; runes: Record<number, RuneState | null> }> {
  const list = await loadWeekChanges(db, monday)
  const now = await sessionsNow(db, list.flatMap(c => touched(c.change)))
  const changes = list.map(({ row, change: c }) => {
    const lock = changeLock(c, now, todayDay)
    // The icon and name: what he swapped in or added, else the session it targets.
    const createdId = c.after.created?.[0]
    const subject = (c.kind === 'swap' || c.kind === 'add') && createdId ? now.get(createdId)?.row : now.get(c.targetSessionId ?? '')?.row
    const fixSession = c.kind === 'missed' ? now.get(c.after.sessions[0]?.id ?? c.after.watch?.[0] ?? '')?.row : null
    return {
      id: c.id,
      setId: c.changeSetId,
      actor: c.actor,
      kind: c.kind,
      who: whoWord(c),
      day: c.after.day,
      session: subject
        ? { id: subject.id, type: subject.type, label: subject.label, notes: subject.notes }
        : { id: c.targetSessionId, type: c.sessionType, label: null, notes: null },
      before: c.before.show,
      after: c.after.show,
      logBefore: c.before.logShow ?? null,
      why: c.why,
      detail: c.detail,
      createdAt: c.createdAt,
      undoUntil: c.undoUntil,
      lock,
      rune: runeFor(c),
      put: c.after.put ?? null,
      fix: fixSession && fixSession.scheduledDate != null
        ? { day: fixSession.scheduledDate, name: fixSession.label ?? sessionName(toSessionLike(fixSession)) }
        : pendingFix(c, row),
    } satisfies ChangeView
  })
  const runes: Record<number, RuneState | null> = {}
  for (let d = monday; d <= monday + 6; d++) runes[d] = dayRune(list.map(l => l.change), d)
  return { changes, runes }
}

/** The changes the one quiet line reads (alarm, finish card), for the week of `day`. */
export async function lineChanges(db: DB, day: number, todayDay: number): Promise<LineChange[]> {
  // Last week's missed sessions too: their fix can land this week (m18: Friday's C into Monday's A).
  const thisWeek = await loadWeekChanges(db, mondayOf(day))
  const lastWeek = (await loadWeekChanges(db, mondayOf(day) - 7)).filter(c => c.change.kind === 'missed')
  const list = [...thisWeek, ...lastWeek.filter(l => !thisWeek.some(t => t.change.id === l.change.id))]
  const now = await sessionsNow(db, list.flatMap(c => touched(c.change)))
  return list.map(({ row, change: c }) => {
    const target = now.get(c.targetSessionId ?? '')?.row
    let into: { day: number; name: string } | null = null
    if (c.kind === 'missed') {
      const fixRow = now.get(c.after.sessions[0]?.id ?? '')?.row
      let pending: { epochDay?: unknown; label?: unknown } | undefined
      try { pending = (JSON.parse(row.sourceData ?? '{}') as { pending?: { epochDay?: unknown; label?: unknown } }).pending } catch { pending = undefined }
      if (fixRow?.scheduledDate != null) into = { day: fixRow.scheduledDate, name: fixRow.label ?? sessionName(toSessionLike(fixRow)) }
      else if (pending && typeof pending.epochDay === 'number' && typeof pending.label === 'string') into = { day: pending.epochDay, name: pending.label }
    }
    return {
      ...c,
      name: target ? (target.label ?? sessionName(toSessionLike(target))) : c.sessionType,
      day: c.after.day,
      open: changeLock(c, now, todayDay) === 'open',
      into,
    }
  })
}

/** Mark changes seen (the day's back opened). */
export async function markSeen(db: DB, ids: string[], nowSec: number): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await db.select({ id: weekAdjustments.id, seenAt: weekAdjustments.seenAt }).from(weekAdjustments).where(inArray(weekAdjustments.id, ids))
  const fresh = rows.filter(r => r.seenAt == null).map(r => r.id)
  if (fresh.length > 0) await db.update(weekAdjustments).set({ seenAt: nowSec }).where(inArray(weekAdjustments.id, fresh))
  return fresh.length
}

// ─── Undo ────────────────────────────────────────────────────

async function applyEffect(db: DB, e: ChangeEffect, nowSec: number): Promise<void> {
  if (e.kind === 'tm') {
    for (const l of e.lifts) await db.update(trainingMaxes).set({ weightKg: l.kg, updatedAt: nowSec }).where(eq(trainingMaxes.exerciseId, l.exerciseId))
    return
  }
  const [row] = await db.select({ id: settings.id, extras: settings.templateExtras }).from(settings)
  if (e.present) {
    await addTemplateExtra(db, { ...e.extra, label: null, notes: null, addedAt: nowSec }, nowSec)
    return
  }
  if (!row?.extras) return
  try {
    const list = JSON.parse(row.extras) as Array<{ blockId: string; type: string; dayOfWeek: number; timeSlot: string }>
    const keep = list.filter(x => !(x.blockId === e.extra.blockId && x.type === e.extra.type && x.dayOfWeek === e.extra.dayOfWeek && x.timeSlot === e.extra.timeSlot))
    await db.update(settings).set({ templateExtras: JSON.stringify(keep), updatedAt: nowSec }).where(eq(settings.id, row.id))
  } catch { /* unreadable extras: leave them */ }
}

export type UndoResult =
  | { ok: true; undone: string[] }
  | { ok: false; status: 404 | 409; error: string; lock?: ChangeLock }

/** Undo one change (and what must come back with it). */
export async function undoChange(db: DB, id: string, todayDay: number, nowSec: number): Promise<UndoResult> {
  const [row] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, id))
  const target = row ? readChangeRow(row) : null
  if (!row || !target) return { ok: false, status: 404, error: 'change not found' }
  const all = (await loadWeekChanges(db, mondayOf(target.after.day))).map(c => c.change)
  if (!all.some(c => c.id === target.id)) all.push(target)
  const now = await sessionsNow(db, all.flatMap(touched))
  const plan = planUndo(target, all, now, todayDay)
  if (!plan.ok) {
    const words: Record<string, string> = { started: 'It has started. It stays.', done: 'Done is done. It stays.', missed: 'Missed. It stays.', passed: 'Its day has passed. It stays.', undone: 'Already put back.' }
    return { ok: false, status: 409, error: words[plan.lock] ?? 'It stays.', lock: plan.lock }
  }
  for (const step of plan.steps) {
    for (const r of step.restore) {
      const s = now.get(r.id)?.row
      if (!s) continue
      const fields: Record<string, unknown> = {}
      for (const k of RESTORABLE_FIELDS) if (k in r.f) fields[k] = (r.f as Record<string, unknown>)[k] ?? null
      if (fields.status == null && 'status' in r.f) delete fields.status
      const ctxJson = Object.keys(r.ctx).length > 0 ? applyContext(s.contextJson, r.ctx) : s.contextJson
      await db.update(sessions).set({ ...fields, contextJson: ctxJson }).where(eq(sessions.id, r.id))
      const fresh = now.get(r.id)
      if (fresh) { fresh.row = { ...fresh.row, ...fields, contextJson: ctxJson } as SessionRow; fresh.contextJson = ctxJson }
    }
    for (const sid of step.remove) {
      const s = now.get(sid)?.row
      // Only a session that never started goes; anything else stays as it is.
      if (s && s.status === 'planned') await db.delete(sessions).where(eq(sessions.id, sid))
    }
    for (const e of step.effects) await applyEffect(db, e, nowSec)
    await db.update(weekAdjustments).set({ undoneAt: nowSec, seenAt: nowSec, ...(step.hold ? { held: 1 } : {}) }).where(eq(weekAdjustments.id, step.changeId))
  }
  return { ok: true, undone: plan.steps.map(s => s.changeId) }
}

/**
 * REDO (page 73): a coach change he undid comes back as the coach made it,
 * while its session is still planned and its day has not passed. Only a
 * change that wrote fields on existing sessions can come back (an added
 * session was deleted by the UNDO). The hold the UNDO set goes with it.
 */
export async function redoChange(db: DB, id: string, todayDay: number, nowSec: number): Promise<UndoResult> {
  const [row] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, id))
  const target = row ? readChangeRow(row) : null
  if (!row || !target) return { ok: false, status: 404, error: 'change not found' }
  if (target.undoneAt == null) return { ok: false, status: 409, error: 'It is still in place.' }
  if ((target.after.created ?? []).length > 0 || (target.before.effects ?? []).length > 0) return { ok: false, status: 409, error: "It can't come back." }
  if (target.after.day < todayDay) return { ok: false, status: 409, error: 'Its day has passed. It stays.', lock: 'passed' }
  const now = await sessionsNow(db, target.after.sessions.map(s => s.id))
  for (const a of target.after.sessions) {
    const s = now.get(a.id)?.row
    if (!s || s.status === 'in_progress' || s.status === 'completed') return { ok: false, status: 409, error: 'It has started. It stays.', lock: 'started' }
  }
  for (const a of target.after.sessions) {
    const s = now.get(a.id)?.row
    if (!s) continue
    const fields: Record<string, unknown> = {}
    for (const k of RESTORABLE_FIELDS) if (k in a.f) fields[k] = (a.f as Record<string, unknown>)[k] ?? null
    const b = target.before.sessions.find(x => x.id === a.id)
    const ctx: Record<string, unknown> = {}
    for (const k of Object.keys(b?.ctx ?? {})) ctx[k] = null
    Object.assign(ctx, a.ctx ?? {})
    const ctxJson = Object.keys(ctx).length > 0 ? applyContext(s.contextJson, ctx) : s.contextJson
    await db.update(sessions).set({ ...fields, contextJson: ctxJson }).where(eq(sessions.id, a.id))
  }
  await db.update(weekAdjustments).set({ undoneAt: null, held: 0, seenAt: nowSec }).where(eq(weekAdjustments.id, target.id))
  return { ok: true, undone: [] }
}

// ─── The rebalance after his change ──────────────────────────

/** The week around `day` as the rebalance reads it (eased flags, run-walk rounds). */
async function rebalanceWeek(db: DB, day: number, todayDay: number) {
  const ctx = await loadPlacementContext(db, day, todayDay)
  const monday = mondayOf(day)
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, monday - 1), isNotNull(sessions.scheduledDate)))
  const inRange = rows.filter(r => (r.scheduledDate as number) <= monday + 7)
  const week: RebalanceSession[] = inRange.map(r => {
    const ease = coachEaseFrom(r.contextJson)
    return { ...toSessionLike(r), id: r.id, eased: ease != null }
  })
  return { ctx: { ...ctx, sessions: week }, week, rows: inRange }
}

function easeOf(plan: CoachChangePlan, reason: string, nowSec: number): CoachEase {
  const e = plan.ease
  if (e?.kind === 'one_set') return { kind: 'one_set', reason, source: 'rebalance', at: nowSec }
  if (e?.kind === 'rounds') return { kind: 'rounds', rounds: e.rounds, reason, source: 'rebalance', at: nowSec }
  if (e?.kind === 'reduce' && e.minutes != null) return { kind: 'reduce', capMin: e.minutes, reason, source: 'rebalance', at: nowSec }
  return { kind: 'reduce', reason, source: 'rebalance', at: nowSec }
}

/**
 * Apply coach change plans (the rebalance's or class tonight's) and record
 * them in the set. Eases write context_json.coachEase; a run kept by R1 is a
 * copy on the new day; any other move moves the session.
 */
export async function applyCoachPlans(db: DB, plans: CoachChangePlan[], rows: SessionRow[], setId: string, actor: ChangeActor, nowSec: number): Promise<string[]> {
  const pm = await pmStart(db)
  const records: NewChange[] = []
  for (const p of plans) {
    const s = rows.find(r => r.id === p.sessionId)
    if (!s || s.scheduledDate == null) continue
    const plain = renderWhy(p.why, s.scheduledDate)
    if (p.kind === 'ease') {
      const before = snap(s, [], ['coachEase'])
      const ctxJson = applyContext(s.contextJson, { coachEase: easeOf(p, plain, nowSec) })
      await db.update(sessions).set({ contextJson: ctxJson }).where(eq(sessions.id, s.id))
      records.push({
        setId, actor, kind: 'ease', targetSessionId: s.id, sessionType: s.type,
        before: { show: p.show.before, ...(p.show.logBefore ? { logShow: p.show.logBefore } : {}), day: s.scheduledDate, sessions: [before] },
        after: { show: p.show.after, day: s.scheduledDate, sessions: [snap({ ...s, contextJson: ctxJson }, [], ['coachEase'])], put: p.put },
        why: p.why, detail: p.detail, undoUntil: slotStart(s.scheduledDate, s.timeSlot, pm),
        extraSource: { rule: p.rule },
      })
    } else if (p.kind === 'move' && p.move) {
      const to = p.move
      if (s.status !== 'planned') {
        // R1: the run he let go stays as he left it; the coach puts a copy on the next day.
        const id = crypto.randomUUID()
        const contextJson = JSON.stringify({ movedFrom: { epochDay: s.scheduledDate, timeSlot: s.timeSlot, sessionId: s.id } })
        await db.insert(sessions).values({ id, type: s.type, label: s.label, weekPlanId: s.weekPlanId, scheduledDate: to.epochDay, timeSlot: to.timeSlot, blockWeek: s.blockWeek, blockType: s.blockType, status: 'planned', notes: s.notes, source: 'coach', contextJson, createdAt: nowSec })
        records.push({
          setId, actor, kind: 'move', targetSessionId: id, sessionType: s.type,
          before: { show: p.show.before, day: to.epochDay, sessions: [] },
          after: { show: p.show.after, day: to.epochDay, sessions: [], created: [id], put: p.put },
          why: p.why, detail: p.detail, undoUntil: slotStart(to.epochDay, to.timeSlot, pm), extraSource: { rule: p.rule, fromSessionId: s.id },
        })
      } else {
        const before = snap(s, ['scheduledDate', 'timeSlot'], ['movedFrom'])
        const contextJson = applyContext(s.contextJson, { movedFrom: { epochDay: s.scheduledDate, timeSlot: s.timeSlot } })
        await db.update(sessions).set({ scheduledDate: to.epochDay, timeSlot: to.timeSlot, contextJson }).where(eq(sessions.id, s.id))
        records.push({
          setId, actor, kind: 'move', targetSessionId: s.id, sessionType: s.type,
          before: { show: p.show.before, day: s.scheduledDate, sessions: [before] },
          after: { show: p.show.after, day: to.epochDay, sessions: [snap({ ...s, scheduledDate: to.epochDay, timeSlot: to.timeSlot, contextJson }, ['scheduledDate', 'timeSlot'], ['movedFrom'])], put: p.put },
          why: p.why, detail: p.detail, undoUntil: slotStart(to.epochDay, to.timeSlot, pm), extraSource: { rule: p.rule },
        })
      }
    }
  }
  return recordChanges(db, records, nowSec)
}

/** Run the rebalance after his change and record what the coach did, in his change's set. */
export async function rebalanceAfter(db: DB, action: { kind: RebalanceAction['kind']; sessionId: string; replacedId?: string | null; reason: string | null }, setId: string, todayDay: number, nowSec: number): Promise<string[]> {
  try {
    const [mine] = await db.select().from(sessions).where(eq(sessions.id, action.sessionId))
    if (!mine || mine.scheduledDate == null) return []
    const { ctx, week, rows } = await rebalanceWeek(db, mine.scheduledDate, todayDay)
    const session = week.find(s => s.id === mine.id)
    if (!session) return []
    const replaced = action.replacedId ? week.find(s => s.id === action.replacedId) ?? null : null
    const held = await loadHeld(db, mine.scheduledDate)
    const plans = rebalance({ action: { kind: action.kind, session, replaced, reason: action.reason }, week, ctx, held })
    return applyCoachPlans(db, plans, rows, setId, 'coach', nowSec)
  } catch (err) {
    console.warn('[coach] rebalance failed', err)
    return []
  }
}

// ─── Missed sessions: the coach applies its fix ──────────────

function isLeadInRow(s: Pick<SessionRow, 'contextJson'>): boolean {
  if (!s.contextJson) return false
  try { return (JSON.parse(s.contextJson) as { leadIn?: unknown }).leadIn === true } catch { return false }
}

/**
 * One missed record per missed key session (idempotent by session): a
 * strength session's main lifts go into the next strength day in reach; the
 * rest goes. Never asks (page 56 §5).
 */
export async function applyMissedFixes(db: DB, missedIds: string[], todayDay: number, nowSec: number, isOptional: (day: number) => boolean): Promise<number> {
  if (missedIds.length === 0) return 0
  const missed = await db.select().from(sessions).where(inArray(sessions.id, missedIds))
  const done = await db.select({ target: weekAdjustments.targetSessionId }).from(weekAdjustments)
    .where(and(eq(weekAdjustments.kind, 'missed'), inArray(weekAdjustments.targetSessionId, missedIds)))
  const handled = new Set(done.map(d => d.target))
  const block = await getActiveBlock(db)
  if (!block) return 0
  const kind = blockKind(block.blockType)
  const mtDays = await mtClassDays(db)
  const extras = await loadTemplateExtras(db, block.id)
  const pm = await pmStart(db)
  let n = 0
  for (const m of missed) {
    if (handled.has(m.id) || m.scheduledDate == null || m.status !== 'missed' || isLeadInRow(m) || isOptional(m.scheduledDate)) continue
    const day = m.scheduledDate
    const upcomingRows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, day + 1), eq(sessions.status, 'planned')))
    const upcoming = upcomingRows.filter(r => (r.scheduledDate as number) <= day + 4).map(r => ({ ...toSessionLike(r), id: r.id }))
    const tw = await trainingWeekFor(db, block, day, todayDay)
    const nextTw = await trainingWeekFor(db, block, mondayOf(day) + 7, todayDay)
    // The next week may not be prepared yet: its template's strength days stand in.
    let nextStrength: { epochDay: number; label: string } | null = null
    for (let d = day + 1; d <= day + 4 && !nextStrength; d++) {
      if (upcomingRows.some(r => r.scheduledDate === d)) continue
      const plan = blockDayPlan(block, d, mondayOf(d) === mondayOf(day) ? tw.week : nextTw.week, mtDays, extras)
      const str = plan.entries.find(e => e.type === 'strength')
      if (str) nextStrength = { epochDay: d, label: str.label }
    }
    const held = await loadHeld(db, day)
    const fix = missedFix({ ...toSessionLike(m), id: m.id }, upcoming, { blockType: kind, weekNumber: tw.week, nextWeekNumber: nextTw.week, nextStrength, held })
    const setId = crypto.randomUUID()
    if (fix.kind === 'merge' && fix.targetSessionId) {
      const target = upcomingRows.find(r => r.id === fix.targetSessionId)
      if (!target) continue
      const ctxJson = applyContext(target.contextJson, { mergedLifts: fix.merged })
      await db.update(sessions).set({ contextJson: ctxJson }).where(eq(sessions.id, target.id))
      await recordChanges(db, [{
        setId, actor: 'coach', kind: 'missed', targetSessionId: m.id, sessionType: m.type,
        before: { show: fix.show.before, day, sessions: [snap(target, [], ['mergedLifts'])] },
        after: { show: fix.show.after, day, sessions: [snap({ ...target, contextJson: ctxJson }, [], ['mergedLifts'])], put: fix.put },
        why: fix.why, detail: fix.detail, undoUntil: slotStart(fix.targetDay, target.timeSlot, pm), weekPlanId: m.weekPlanId,
      }], nowSec)
    } else if (fix.kind === 'merge') {
      // Waits for its week: applied when that day's sessions are made (applyPendingMerges).
      await recordChanges(db, [{
        setId, actor: 'coach', kind: 'missed', targetSessionId: m.id, sessionType: m.type,
        before: { show: fix.show.before, day, sessions: [] },
        after: { show: fix.show.after, day, sessions: [], put: fix.put },
        why: fix.why, detail: fix.detail, undoUntil: slotStart(fix.targetDay, 'am', pm), weekPlanId: m.weekPlanId,
        extraSource: { pending: { epochDay: fix.targetDay, label: fix.targetLabel, merged: fix.merged } },
      }], nowSec)
    } else {
      await recordChanges(db, [{
        setId, actor: 'coach', kind: 'missed', targetSessionId: m.id, sessionType: m.type,
        before: { show: fix.show.before, day, sessions: [] },
        after: { show: fix.show.after, day, sessions: [], put: null },
        why: fix.why, detail: fix.detail, weekPlanId: m.weekPlanId,
      }], nowSec)
    }
    n++
  }
  return n
}

/** Missed key sessions from last Monday on that have no missed record yet get their fix. */
export async function fixMissed(db: DB, todayDay: number, nowSec: number): Promise<number> {
  const block = await getActiveBlock(db)
  if (!block) return 0
  const rows = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.status, 'missed'), inArray(sessions.type, [...KEY_TYPES]), gte(sessions.scheduledDate, mondayOf(todayDay) - 7), lt(sessions.scheduledDate, todayDay)))
  // Lead-in and pre-start sessions are optional: a miss there changes nothing (Part B).
  return applyMissedFixes(db, rows.map(r => r.id), todayDay, nowSec, day => optionalDay(blockKind(block.blockType), blockStartDay(block), day))
}

/** Rollover with the athlete's local today, then the coach's fix for anything that just became missed. */
export async function rolloverAndFix(db: DB, todayDay: number): Promise<number> {
  const flipped = await rolloverStaleSessionIds(db, todayDay)
  if (flipped.length > 0) {
    try {
      await fixMissed(db, todayDay, Math.floor(Date.now() / 1000))
    } catch (err) {
      console.warn('[coach] missed fixes failed', err)
    }
  }
  return flipped.length
}

function pendingMerge(sourceData: string | null): { epochDay: number; label: string; merged: unknown } | null {
  try {
    const p = (JSON.parse(sourceData ?? '{}') as { pending?: { epochDay?: unknown; label?: unknown; merged?: unknown } }).pending
    return p && typeof p.epochDay === 'number' && typeof p.label === 'string' ? { epochDay: p.epochDay, label: p.label, merged: p.merged } : null
  } catch {
    return null
  }
}

/**
 * A missed session's fix that waited for its week: once that day's sessions
 * exist, the lifts go onto its strength session and the record points at it.
 */
export async function applyPendingMerges(db: DB, createdIds: string[]): Promise<void> {
  if (createdIds.length === 0) return
  const created = await db.select().from(sessions).where(inArray(sessions.id, createdIds))
  const strength = created.filter(s => s.type === 'strength' && s.scheduledDate != null)
  if (strength.length === 0) return
  const rows = await db.select().from(weekAdjustments).where(and(eq(weekAdjustments.kind, 'missed'), gte(weekAdjustments.createdAt, ((strength[0].scheduledDate as number) - 10) * DAY_SEC)))
  for (const r of rows) {
    if (r.undoneAt != null) continue
    const pending = pendingMerge(r.sourceData)
    const change = readChangeRow(r)
    if (!pending || !change || change.after.sessions.length > 0) continue
    const target = strength.find(s => s.scheduledDate === pending.epochDay)
    if (!target || mergedLiftsFrom(target.contextJson)) continue
    const ctxJson = applyContext(target.contextJson, { mergedLifts: pending.merged })
    await db.update(sessions).set({ contextJson: ctxJson }).where(eq(sessions.id, target.id))
    const before = { ...change.before, sessions: [snap(target, [], ['mergedLifts'])] }
    const after = { ...change.after, sessions: [snap({ ...target, contextJson: ctxJson }, [], ['mergedLifts'])] }
    await db.update(weekAdjustments).set({ beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after) }).where(eq(weekAdjustments.id, r.id))
  }
}

// ─── His own change, recorded ────────────────────────────────

const REASON_WORDS: Record<string, string> = {
  rough_day: 'Rough day',
  too_sore: 'Too sore',
  low_sleep: 'Low on sleep',
  schedule: 'Short on time',
  low_drive: 'Not feeling it',
  illness: 'Body signal',
  variety: 'Changing it up',
  tired: 'Tired',
  injury: 'Injury or pain',
  sick: 'Sick',
  other: 'Other',
  class_time: "Class time doesn't fit",
  no_time: 'No time',
  coach_rest: 'Rest day',
}

/** A reason code as the log writes it ("Rough day."). */
export function reasonWords(code: string | null | undefined): string | null {
  if (!code) return null
  return REASON_WORDS[code] ?? code.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

/** The add line: "Added, tonight." */
export function addedWhy(day: number, slot: string | null | undefined, todayDay: number): string {
  if (day === todayDay) return slot === 'pm' ? 'Added, tonight.' : 'Added, this morning.'
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return `Added, ${names[new Date(day * DAY_SEC * 1000).getUTCDay()]} ${slot === 'pm' ? 'evening' : 'morning'}.`
}

/** The undo_until for a session: its planned start. */
export async function undoUntilFor(db: DB, s: Pick<SessionRow, 'scheduledDate' | 'timeSlot'>): Promise<number | null> {
  return s.scheduledDate == null ? null : slotStart(s.scheduledDate, s.timeSlot, await pmStart(db))
}

/** The rows of a set (for his reason tile, which re-reads the week). */
export async function setRows(db: DB, setId: string): Promise<AdjRow[]> {
  return db.select().from(weekAdjustments).where(eq(weekAdjustments.changeSetId, setId))
}

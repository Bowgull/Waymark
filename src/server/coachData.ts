// Coach data access (Phase E1): the DB reads and writes the coach rules need.
// Rules stay pure in lib/coach; this file loads rows and applies the results:
// the pausable training week, the return ramp, week plans per calendar week,
// template sessions for a day, placement context, missed-session asks,
// injury flags and the per-session coach state prescriptions read.

import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { dailyLogs, sessions, settings, trainingBlocks, userProfile, weekAdjustments, weekPlans } from '../db/schema'
import { getBlockZeroTemplate, getDayTemplate, strengthBlockWeek, WEEKLY_TEMPLATE } from '../lib/weeklyTemplate'
import { rolloverStaleSessionIds } from '../lib/sessionRollover'
import {
  KEY_TYPES,
  checkSessionChange,
  coachEaseFrom,
  injuryActionFor,
  injuryFlag,
  missedSessionOptions,
  mondayOf,
  plannedLoad,
  returnContext,
  trainingWeek,
  weeksSinceRampStart,
  type BlockKind,
  type CoachEase,
  type InjuryFlag,
  type PlacementContext,
  type PlacementResult,
  type ReturnContext,
  type SessionChange,
  type SessionLike,
  type TrainingWeek,
} from '../lib/coach'
import { getActiveBlock, loadRunHistory, readinessFor } from './blockZeroData'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>
type Block = typeof trainingBlocks.$inferSelect
type SessionRow = typeof sessions.$inferSelect

const DAY_SEC = 86400
const KEY_LIST = [...KEY_TYPES]
const HISTORY_DAYS = 180

export function blockStartDay(block: { startedAt: number | null; createdAt: number }): number {
  return Math.floor((block.startedAt ?? block.createdAt) / DAY_SEC)
}

export function blockKind(blockType: string | null | undefined): BlockKind {
  return blockType === 'block_zero' ? 'block_zero' : 'fighter'
}

// ─── Exposure history ─────────────────────────────────────────

/**
 * Epoch days of completed key sessions up to `toDay`, one entry per session.
 * The last one before the window is kept so a long gap still reads as a gap.
 */
export async function loadCompletedKeyDays(db: DB, toDay: number): Promise<number[]> {
  const from = toDay - HISTORY_DAYS
  const rows = await db.select({ day: sessions.scheduledDate }).from(sessions)
    .where(and(eq(sessions.status, 'completed'), inArray(sessions.type, KEY_LIST), gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, toDay)))
  const days = rows.map(r => r.day).filter((d): d is number => d != null)
  const [older] = await db.select({ day: sessions.scheduledDate }).from(sessions)
    .where(and(eq(sessions.status, 'completed'), inArray(sessions.type, KEY_LIST), lt(sessions.scheduledDate, from)))
    .orderBy(desc(sessions.scheduledDate)).limit(1)
  if (older?.day != null) days.push(older.day)
  return days
}

async function mtClassDays(db: DB): Promise<Set<number>> {
  const [row] = await db.select({ mt: settings.mtClassDays }).from(settings)
  return new Set((row?.mt ?? '1,3,5').split(',').filter(Boolean).map(Number))
}

/** Key sessions in a normal week of the block's template (for the half-done rule). */
function plannedKeyPerWeek(blockType: BlockKind, mtDays: Set<number>): number {
  const week = blockType === 'block_zero' ? getBlockZeroTemplate(2) : WEEKLY_TEMPLATE
  let n = 0
  for (let dow = 0; dow <= 6; dow++) {
    const day = blockType === 'block_zero' ? week[dow] ?? [] : getDayTemplate('fighter', 1, dow, mtDays)
    n += day.filter(s => KEY_TYPES.has(s.type)).length
  }
  return n
}

/** Training week of `day` for a block: paused through gaps (lib/coach/weekCounter). */
export async function trainingWeekFor(db: DB, block: Block, day: number, todayDay: number = day): Promise<TrainingWeek> {
  const kind = blockKind(block.blockType)
  return trainingWeek({
    blockType: kind,
    startDay: blockStartDay(block),
    totalWeeks: block.totalWeeks,
    completedKeyDays: await loadCompletedKeyDays(db, todayDay),
    day,
    todayDay,
    plannedKeyPerWeek: plannedKeyPerWeek(kind, await mtClassDays(db)),
  })
}

/** Week numbers stamped on sessions: plan week, and the strength wave week. */
export function weekStamps(block: Block, tw: TrainingWeek): { weekNumber: number; strengthWeek: number } {
  const kind = blockKind(block.blockType)
  return {
    weekNumber: tw.week,
    // Fighter keeps its 6-week wave off the uncapped count; Block Zero never wraps.
    strengthWeek: kind === 'block_zero' ? strengthBlockWeek('block_zero', tw.week) : strengthBlockWeek('fighter', tw.rawWeek),
  }
}

export async function returnContextFor(db: DB, day: number): Promise<ReturnContext> {
  return returnContext(await loadCompletedKeyDays(db, day), day)
}

// ─── Week plans per calendar week ─────────────────────────────

/**
 * The week plan for a training week in the calendar week starting `monday`.
 * A paused block can repeat a week number, so a plan whose sessions all sit in
 * another calendar week is not reused: a new plan row is made.
 */
export async function resolveWeekPlan(db: DB, blockId: string, weekNumber: number, monday: number, nowSec: number, opts: { create?: boolean; autoGenerated?: boolean } = {}): Promise<string | null> {
  const plans = await db.select().from(weekPlans)
    .where(and(eq(weekPlans.blockId, blockId), eq(weekPlans.weekNumber, weekNumber)))
    .orderBy(desc(weekPlans.createdAt))
  let empty: string | null = null
  for (const p of plans) {
    const rows = await db.select({ day: sessions.scheduledDate }).from(sessions).where(eq(sessions.weekPlanId, p.id))
    if (rows.length === 0) { empty = empty ?? p.id; continue }
    if (rows.some(r => r.day != null && r.day >= monday && r.day <= monday + 6)) return p.id
  }
  if (empty) return empty
  if (opts.create === false) return null
  const id = crypto.randomUUID()
  await db.insert(weekPlans).values({ id, blockId, weekNumber, status: 'draft', autoGenerated: opts.autoGenerated ? 1 : 0, createdAt: nowSec })
  return id
}

/** Latest plan row for a week number (a paused block can have more than one). */
export async function latestWeekPlan(db: DB, blockId: string, weekNumber: number) {
  const [row] = await db.select().from(weekPlans)
    .where(and(eq(weekPlans.blockId, blockId), eq(weekPlans.weekNumber, weekNumber)))
    .orderBy(desc(weekPlans.createdAt)).limit(1)
  return row ?? null
}

// ─── Template sessions for a day ──────────────────────────────

/**
 * Insert one day's template sessions for the active block (source 'template').
 * `todayDay` is the athlete's today (week counter pauses only past weeks).
 */
export async function generateDaySessions(db: DB, epochDay: number, todayDay: number, nowSec: number): Promise<SessionRow[]> {
  const block = await getActiveBlock(db)
  const mtDays = await mtClassDays(db)
  const dow = new Date(epochDay * DAY_SEC * 1000).getUTCDay()
  let blockType = 'fighter'
  let weekNumber = 1
  let strengthWeek = 1
  let weekPlanId: string | null = null
  if (block) {
    blockType = block.blockType
    const tw = await trainingWeekFor(db, block, epochDay, todayDay)
    ;({ weekNumber, strengthWeek } = weekStamps(block, tw))
    weekPlanId = await resolveWeekPlan(db, block.id, weekNumber, mondayOf(epochDay), nowSec, { autoGenerated: true })
  }
  const isBlockZero = blockType === 'block_zero'
  const ids: string[] = []
  for (const entry of getDayTemplate(blockType, weekNumber, dow, mtDays)) {
    const id = crypto.randomUUID()
    ids.push(id)
    await db.insert(sessions).values({
      id,
      type: entry.type,
      // Block Zero labels carry the strength day (A/B/C) so a moved session keeps its content
      label: isBlockZero ? entry.label : null,
      weekPlanId,
      scheduledDate: epochDay,
      timeSlot: entry.timeSlot,
      blockWeek: entry.type === 'strength' ? strengthWeek : null,
      blockType,
      status: 'planned',
      // Tag running sessions with their category so start-run can determine prescription
      notes: entry.type === 'running' ? (entry.runCategory ?? null) : null,
      source: 'template',
      createdAt: nowSec,
    })
  }
  return ids.length > 0 ? db.select().from(sessions).where(inArray(sessions.id, ids)) : []
}

/**
 * Days of the current week that were never opened get their template
 * sessions, so the rollover sees them as missed (map #4). From the block
 * start or this Monday, through yesterday.
 */
export async function backfillCurrentWeek(db: DB, todayDay: number, nowSec: number): Promise<number> {
  const block = await getActiveBlock(db)
  if (!block) return 0
  const from = Math.max(mondayOf(todayDay), blockStartDay(block))
  let created = 0
  for (let d = from; d < todayDay; d++) {
    const existing = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.scheduledDate, d)).limit(1)
    if (existing.length > 0) continue
    created += (await generateDaySessions(db, d, todayDay, nowSec)).length
  }
  return created
}

// ─── Injury flag (F16, F17) ───────────────────────────────────

export async function loadInjuryFlag(db: DB, day: number): Promise<InjuryFlag | null> {
  const from = day - 10
  const skips = await db.select({ epochDay: sessions.scheduledDate, skipReason: sessions.skipReason, detail: sessions.skipReasonDetail, notes: sessions.notes })
    .from(sessions)
    .where(and(eq(sessions.status, 'skipped'), gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, day)))
  const backNotes = await db.select({ epochDay: dailyLogs.logDate, text: dailyLogs.backNotes }).from(dailyLogs)
    .where(and(gte(dailyLogs.logDate, from), lte(dailyLogs.logDate, day)))
  return injuryFlag(
    skips.filter(s => s.epochDay != null).map(s => ({ epochDay: s.epochDay as number, skipReason: s.skipReason, detail: s.detail, notes: s.notes })),
    backNotes,
    day,
  )
}

// ─── Placement context ────────────────────────────────────────

function toSessionLike(r: Pick<SessionRow, 'id' | 'type' | 'label' | 'notes' | 'scheduledDate' | 'timeSlot' | 'status'>): SessionLike {
  return { id: r.id, type: r.type, label: r.label, notes: r.notes, epochDay: r.scheduledDate as number, timeSlot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status }
}

async function planWeekLoad(blockType: BlockKind, weekNumber: number, mtDays: Set<number>): Promise<number> {
  let total = 0
  for (let dow = 0; dow <= 6; dow++) {
    for (const s of getDayTemplate(blockType, weekNumber, dow, mtDays)) {
      if (!KEY_TYPES.has(s.type)) continue
      total += plannedLoad({ type: s.type, label: s.label, notes: s.runCategory ?? null, estimatedMin: null }, blockType, weekNumber)
    }
  }
  return total
}

/** Everything checkSessionChange needs for a change landing in `targetDay`'s week. */
export async function loadPlacementContext(db: DB, targetDay: number, todayDay: number): Promise<PlacementContext> {
  const block = await getActiveBlock(db)
  const kind = blockKind(block?.blockType)
  const tw = block ? await trainingWeekFor(db, block, Math.max(targetDay, todayDay), todayDay) : null
  const weekNumber = tw?.week ?? 1
  const monday = mondayOf(targetDay)
  const rows = await db.select().from(sessions)
    .where(and(gte(sessions.scheduledDate, monday - 1), lte(sessions.scheduledDate, monday + 7)))
  const report = await readinessFor(db, todayDay)
  const run = await loadRunHistory(db, todayDay)
  const classes = await db.select({ day: sessions.scheduledDate }).from(sessions)
    .where(and(eq(sessions.type, 'mt_class'), inArray(sessions.status, ['completed', 'in_progress']), gte(sessions.scheduledDate, todayDay - HISTORY_DAYS), lt(sessions.scheduledDate, todayDay)))
  const [profile] = await db.select({ cap: userProfile.mtCapPerWeek }).from(userProfile).where(eq(userProfile.id, 'default'))
  const mtDays = await mtClassDays(db)
  const easeDays = rows
    .filter(r => r.scheduledDate != null && r.status === 'planned' && coachEaseFrom(r.contextJson) != null)
    .map(r => r.scheduledDate as number)
  return {
    blockType: kind,
    weekNumber,
    todayEpochDay: todayDay,
    sessions: rows.filter(r => r.scheduledDate != null).map(toSessionLike),
    readinessEase: report.readinessEase,
    loadFlag: report.load?.flagged ?? false,
    easeReason: report.reason ?? null,
    easeDays,
    run: { longestLast30Sec: run.longestLast30Sec, lastWeekRunSec: run.lastWeekRunSec, thisWeekRunSec: run.thisWeekRunSec },
    mt: {
      weeksSinceRampStart: weeksSinceRampStart(classes.map(c => c.day).filter((d): d is number => d != null), targetDay),
      profileCap: profile?.cap ?? null,
    },
    planWeekLoad: block ? await planWeekLoad(kind, weekNumber, mtDays) : null,
    injury: await loadInjuryFlag(db, todayDay),
  }
}

export async function checkChange(db: DB, change: SessionChange, todayDay: number): Promise<PlacementResult> {
  return checkSessionChange(change, await loadPlacementContext(db, change.epochDay, todayDay))
}

/** The 409 body for a refused change. */
export function refusalBody(r: Extract<PlacementResult, { ok: false }>) {
  return { error: r.reason, code: r.code, reason: r.reason, safeAlternatives: r.safeAlternatives }
}

// ─── Missed sessions -> asks ──────────────────────────────────

/** Noon UTC the Monday after the week: Sunday is over everywhere in the Americas. */
function expirySec(expiresOnDay: number): number {
  return expiresOnDay * DAY_SEC + 12 * 3600
}

/** Lapse pending asks whose week is over. */
export async function expireAsks(db: DB, nowSec: number): Promise<number> {
  const due = await db.select({ id: weekAdjustments.id }).from(weekAdjustments)
    .where(and(eq(weekAdjustments.status, 'proposed'), lte(weekAdjustments.expiresAt, nowSec)))
  for (const r of due) {
    await db.update(weekAdjustments).set({ status: 'expired', resolvedAt: nowSec }).where(eq(weekAdjustments.id, r.id))
  }
  return due.length
}

/**
 * One pending ask per missed key session from last Monday on (never back
 * care). Idempotent by session id. Options come from the placement rules;
 * nothing is rescheduled until the athlete answers.
 */
export async function createMissedAsks(db: DB, todayDay: number, nowSec: number): Promise<number> {
  const missed = await db.select().from(sessions)
    .where(and(eq(sessions.status, 'missed'), inArray(sessions.type, KEY_LIST), gte(sessions.scheduledDate, mondayOf(todayDay) - 7), lt(sessions.scheduledDate, todayDay)))
  if (missed.length === 0) return 0
  const asked = await db.select({ target: weekAdjustments.targetSessionId }).from(weekAdjustments)
    .where(and(eq(weekAdjustments.adjustmentType, 'missed_session'), inArray(weekAdjustments.targetSessionId, missed.map(m => m.id))))
  const done = new Set(asked.map(a => a.target))
  const block = await getActiveBlock(db)
  let created = 0
  for (const m of missed) {
    if (done.has(m.id) || m.scheduledDate == null) continue
    const weekPlanId = m.weekPlanId ?? (block ? await resolveWeekPlan(db, block.id, (await trainingWeekFor(db, block, m.scheduledDate, todayDay)).week, mondayOf(m.scheduledDate), nowSec) : null)
    if (!weekPlanId) continue
    const ctx = await loadPlacementContext(db, m.scheduledDate, todayDay)
    const ask = missedSessionOptions(toSessionLike(m), ctx)
    const lapsed = ask.expiresOnDay <= todayDay
    const def = ask.defaultOption
    await db.insert(weekAdjustments).values({
      id: crypto.randomUUID(),
      weekPlanId,
      adjustmentType: 'missed_session',
      sessionType: m.type,
      action: def.kind === 'drop' ? 'remove' : 'add',
      reason: ask.reason,
      targetDay: def.kind === 'drop' ? null : new Date(def.epochDay * DAY_SEC * 1000).getUTCDay(),
      targetTimeSlot: def.kind === 'drop' ? null : def.timeSlot,
      sourceData: JSON.stringify({ missedSessionId: m.id, missedDay: m.scheduledDate, label: m.label, defaultOption: def }),
      status: lapsed ? 'expired' : 'proposed',
      targetSessionId: m.id,
      optionsJson: JSON.stringify(ask.options),
      expiresAt: expirySec(ask.expiresOnDay),
      resolvedAt: lapsed ? nowSec : null,
      createdAt: nowSec,
    })
    created++
  }
  return created
}

/**
 * Rollover with the athlete's local today, then an ask for anything that just
 * became missed. Returns the number of sessions rolled over.
 */
export async function rolloverAndAsk(db: DB, todayDay: number): Promise<number> {
  const flipped = await rolloverStaleSessionIds(db, todayDay)
  if (flipped.length > 0) {
    try {
      await createMissedAsks(db, todayDay, Math.floor(Date.now() / 1000))
    } catch (err) {
      console.warn('[coach] missed asks failed', err)
    }
  }
  return flipped.length
}

// ─── Per-session coach state (prescriptions read this) ────────

export interface SessionCoachState {
  returnCtx: ReturnContext
  coachEase: CoachEase | null
  injury: InjuryFlag | null
  injuryAction: ReturnType<typeof injuryActionFor>
}

export async function loadSessionCoachState(db: DB, session: Pick<SessionRow, 'type' | 'scheduledDate' | 'contextJson'>, fallbackDay: number): Promise<SessionCoachState> {
  const day = session.scheduledDate ?? fallbackDay
  const injury = await loadInjuryFlag(db, day)
  return {
    returnCtx: await returnContextFor(db, day),
    coachEase: coachEaseFrom(session.contextJson),
    injury,
    injuryAction: injuryActionFor(session.type, injury),
  }
}

/** Active block plus its training week today, for routes that report it. */
export async function currentBlockWeek(db: DB, todayDay: number) {
  const block = await getActiveBlock(db)
  if (!block) return null
  const tw = await trainingWeekFor(db, block, todayDay, todayDay)
  return { block, tw }
}

export async function findWeekAdjustment(db: DB, id: string) {
  const [adj] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, id))
  return adj ?? null
}


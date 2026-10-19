// Coach data access (Phase E1): the DB reads and writes the coach rules need.
// Rules stay pure in lib/coach; this file loads rows and applies the results:
// the pausable training week, the return ramp, week plans per calendar week,
// template sessions for a day, placement context, injury flags and the
// per-session coach state prescriptions read. Missed sessions: server/changes.ts.

import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { sessions, settings, trainingBlocks, userProfile, weekPlans } from '../db/schema'
import { getBlockZeroTemplate, getDayTemplate, strengthBlockWeek, WEEKLY_TEMPLATE, type TemplateSession } from '../lib/weeklyTemplate'
import {
  KEY_TYPES,
  LEAD_IN_CONTEXT,
  checkSessionChange,
  coachEaseFrom,
  countsFromDay,
  inLeadIn,
  pickWeekPlan,
  planDayTemplate,
  startedAtForLocalDay,
  injuryActionFor,
  injuryFlag,
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

export { startedAtForLocalDay }

/** First day that counts for completion, the gate and missed asks (week 1's Monday in Block Zero). */
export function blockCountsFrom(block: Block): number {
  return countsFromDay(blockKind(block.blockType), blockStartDay(block))
}

/** Is a day in the active Block Zero lead-in? */
export function isBlockLeadInDay(block: Block | null | undefined, day: number): boolean {
  return block != null && inLeadIn(blockKind(block.blockType), blockStartDay(block), day)
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

export async function mtClassDays(db: DB): Promise<Set<number>> {
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
  // No approval step: a plan is active from the start ('draft' rows from before read the same).
  await db.insert(weekPlans).values({ id, blockId, weekNumber, status: 'active', autoGenerated: opts.autoGenerated ? 1 : 0, createdAt: nowSec })
  return id
}

/**
 * Latest plan row for a week number (a paused block can have more than one).
 * A mid-week Block Zero start has a lead-in plan and a real week 1, both
 * numbered 1: `leadIn` picks which (default: the real week).
 */
export async function latestWeekPlan(db: DB, blockId: string, weekNumber: number, opts: { leadIn?: boolean } = {}) {
  const plans = await db.select().from(weekPlans)
    .where(and(eq(weekPlans.blockId, blockId), eq(weekPlans.weekNumber, weekNumber)))
    .orderBy(desc(weekPlans.createdAt))
  if (plans.length === 0) return null
  const withRows = []
  for (const plan of plans) {
    const rows = await db.select({ ctx: sessions.contextJson }).from(sessions).where(eq(sessions.weekPlanId, plan.id))
    withRows.push({ plan, contexts: rows.map(r => r.ctx) })
  }
  return pickWeekPlan(withRows, opts.leadIn === true)
}

// ─── Sessions made regular (plan §4) ──────────────────────────

export interface TemplateExtra {
  blockId: string
  type: string
  label: string | null
  notes: string | null
  dayOfWeek: number
  timeSlot: 'am' | 'pm'
  addedAt: number
}

/** Sessions the athlete made part of the plan, for one block (settings.template_extras). */
export async function loadTemplateExtras(db: DB, blockId: string | null | undefined): Promise<TemplateExtra[]> {
  if (!blockId) return []
  const [row] = await db.select({ extras: settings.templateExtras }).from(settings)
  if (!row?.extras) return []
  try {
    const list = JSON.parse(row.extras) as TemplateExtra[]
    return Array.isArray(list) ? list.filter(e => e && e.blockId === blockId && typeof e.type === 'string') : []
  } catch {
    return []
  }
}

export async function addTemplateExtra(db: DB, extra: TemplateExtra, nowSec: number): Promise<void> {
  const [row] = await db.select({ id: settings.id, extras: settings.templateExtras }).from(settings)
  let list: TemplateExtra[] = []
  try { list = row?.extras ? (JSON.parse(row.extras) as TemplateExtra[]) : [] } catch { list = [] }
  if (!Array.isArray(list)) list = []
  const same = (e: TemplateExtra) => e.blockId === extra.blockId && e.type === extra.type && e.dayOfWeek === extra.dayOfWeek && e.timeSlot === extra.timeSlot
  if (!list.some(same)) list.push(extra)
  if (row) await db.update(settings).set({ templateExtras: JSON.stringify(list), updatedAt: nowSec }).where(eq(settings.id, row.id))
  else await db.insert(settings).values({ id: 'default', templateExtras: JSON.stringify(list), createdAt: nowSec, updatedAt: nowSec })
}

/** A day's template plus the sessions made regular on that weekday. */
export function dayTemplateWithExtras(blockType: string, weekNumber: number, dow: number, mtDays: Set<number>, extras: TemplateExtra[], base: TemplateSession[] = getDayTemplate(blockType, weekNumber, dow, mtDays)) {
  const add = extras.filter(e => e.dayOfWeek === dow).map(e => ({
    timeSlot: e.timeSlot,
    type: e.type,
    label: e.label ?? e.type,
    estimatedMin: 0,
    ...(e.type === 'running' && (e.notes === 'zone2' || e.notes === 'progression') ? { runCategory: e.notes as 'zone2' | 'progression' } : {}),
    extra: true as const,
  }))
  return [...base, ...add]
}

export interface BlockDayPlan {
  entries: ReturnType<typeof dayTemplateWithExtras>
  leadIn: boolean
}

/**
 * What a block's day holds from the template: nothing before the start, the
 * lead-in day in a Block Zero lead-in (no extras), else the week's template
 * with the sessions made regular. Shared by generate-today, the back-fill,
 * the week preparation and BEGIN (D1).
 */
export function blockDayPlan(block: Block, epochDay: number, weekNumber: number, mtDays: Set<number>, extras: TemplateExtra[]): BlockDayPlan {
  const day = planDayTemplate({ blockType: blockKind(block.blockType), startDay: blockStartDay(block), epochDay, weekNumber, mtDays })
  if (day.beforeStart) return { entries: [], leadIn: false }
  if (day.leadIn) return { entries: day.sessions.map(s => ({ ...s })), leadIn: true }
  const dow = new Date(epochDay * DAY_SEC * 1000).getUTCDay()
  return { entries: dayTemplateWithExtras(block.blockType, weekNumber, dow, mtDays, extras, day.sessions), leadIn: false }
}

// ─── Template sessions for a day ──────────────────────────────

/**
 * Insert one day's template sessions for the active block (source 'template').
 * `todayDay` is the athlete's today (week counter pauses only past weeks).
 */
export async function generateDaySessions(db: DB, epochDay: number, todayDay: number, nowSec: number): Promise<SessionRow[]> {
  const block = await getActiveBlock(db)
  // No active block: nothing to plan. Training starts when the athlete starts a
  // block (Block Zero on Program); Today shows that board instead.
  if (!block) return []
  // Days before the start get no sessions, ever (D1).
  if (epochDay < blockStartDay(block)) return []
  const mtDays = await mtClassDays(db)
  const blockType = block.blockType
  const tw = await trainingWeekFor(db, block, epochDay, todayDay)
  const { weekNumber, strengthWeek } = weekStamps(block, tw)
  const plan = blockDayPlan(block, epochDay, weekNumber, mtDays, await loadTemplateExtras(db, block.id))
  if (plan.entries.length === 0) return []
  const weekPlanId = await resolveWeekPlan(db, block.id, weekNumber, mondayOf(epochDay), nowSec, { autoGenerated: true })
  const isBlockZero = blockType === 'block_zero'
  const ids: string[] = []
  for (const entry of plan.entries) {
    const id = crypto.randomUUID()
    ids.push(id)
    await db.insert(sessions).values({
      id,
      type: entry.type,
      // Block Zero labels carry the strength day (A/B/C) so a moved session keeps its content
      label: isBlockZero || 'extra' in entry ? entry.label : null,
      weekPlanId,
      scheduledDate: epochDay,
      timeSlot: entry.timeSlot,
      blockWeek: entry.type === 'strength' ? strengthWeek : null,
      blockType,
      status: 'planned',
      // Tag running sessions with their category so start-run can determine prescription
      notes: entry.type === 'running' ? (entry.runCategory ?? null) : null,
      source: 'template',
      // Lead-in sessions are optional (Part B): no asks, no completion count.
      ...(plan.leadIn ? { contextJson: JSON.stringify(LEAD_IN_CONTEXT) } : {}),
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
  // Lead-in days are optional: never back-filled, so they never turn missed (Part B).
  const from = Math.max(mondayOf(todayDay), blockCountsFrom(block))
  let created = 0
  for (let d = from; d < todayDay; d++) {
    const existing = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.scheduledDate, d)).limit(1)
    if (existing.length > 0) continue
    created += (await generateDaySessions(db, d, todayDay, nowSec)).length
  }
  return created
}

// ─── Injury flag (F16) ────────────────────────────────────────

export async function loadInjuryFlag(db: DB, day: number): Promise<InjuryFlag | null> {
  const from = day - 10
  const skips = await db.select({ epochDay: sessions.scheduledDate, skipReason: sessions.skipReason, detail: sessions.skipReasonDetail, notes: sessions.notes })
    .from(sessions)
    .where(and(eq(sessions.status, 'skipped'), gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, day)))
  const signals = skips.filter(s => s.epochDay != null)
    .map(s => ({ epochDay: s.epochDay as number, skipReason: s.skipReason, detail: s.detail, notes: s.notes }))
  return injuryFlag(signals, day)
}

// ─── Placement context ────────────────────────────────────────

export function toSessionLike(r: Pick<SessionRow, 'id' | 'type' | 'label' | 'notes' | 'scheduledDate' | 'timeSlot' | 'status'>): SessionLike {
  return { id: r.id, type: r.type, label: r.label, notes: r.notes, epochDay: r.scheduledDate as number, timeSlot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status }
}

export async function planWeekLoad(blockType: BlockKind, weekNumber: number, mtDays: Set<number>, extras: TemplateExtra[] = []): Promise<number> {
  let total = 0
  for (let dow = 0; dow <= 6; dow++) {
    for (const s of dayTemplateWithExtras(blockType, weekNumber, dow, mtDays, extras)) {
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
  // Part B: the lead-in has its own limits and no planned load to cram past.
  const leadIn = isBlockLeadInDay(block, targetDay)
  return {
    leadIn,
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
    planWeekLoad: block && !leadIn ? await planWeekLoad(kind, weekNumber, mtDays, await loadTemplateExtras(db, block.id)) : null,
    injury: await loadInjuryFlag(db, todayDay),
  }
}

export async function checkChange(db: DB, change: SessionChange, todayDay: number): Promise<PlacementResult> {
  return checkSessionChange(change, await loadPlacementContext(db, change.epochDay, todayDay))
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

// Coach data access (Phase E1): the DB reads and writes the coach rules need.
// Rules stay pure in lib/coach; this file loads rows and applies the results:
// the pausable training week, the return ramp, week plans per calendar week,
// template sessions for a day, placement context, injury flags and the
// per-session coach state prescriptions read. Missed sessions: server/changes.ts.

import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { sessions, settings, trainingBlocks, userProfile, weekPlans } from '../db/schema'
import { strengthBlockWeek, type TemplateSession } from '../lib/weeklyTemplate'
import { MIN_STEP, STEP_SHAPE, dayEntries, type PlanEntry } from '../lib/brain/weekBuilder'
import { parseShape, weekShapeFor, type StoredWeek } from './onePlan'
import {
  KEY_TYPES,
  checkSessionChange,
  coachEaseFrom,
  countsFromDay,
  inLeadIn,
  pickWeekPlan,
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
import { classDaySlots, parseClassDays, type ClassDaySlot } from '../lib/classSlots'

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

/** His slot per lit class day (page 70): saved, else PM on weekdays and ANY on the weekend. */
export async function mtClassSlots(db: DB): Promise<Record<number, ClassDaySlot>> {
  const [row] = await db.select({ mt: settings.mtClassDays, slots: settings.mtClassSlots }).from(settings)
  return classDaySlots(parseClassDays(row?.mt), row?.slots)
}

export async function mtClassDays(db: DB): Promise<Set<number>> {
  const [row] = await db.select({ mt: settings.mtClassDays }).from(settings)
  // None picked (null or ''): no classes, as brain.ts's week reads it.
  return new Set(parseClassDays(row?.mt))
}

/**
 * Key sessions in a normal week (for the half-done rule): the one plan's
 * first step (4 training days; rebuild Phase 2, page 93). The week builder
 * ramps from there, so a week left with fewer than 2 done reads as half done.
 */
function plannedKeyPerWeek(): number {
  return STEP_SHAPE[MIN_STEP].days
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
    plannedKeyPerWeek: plannedKeyPerWeek(),
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

/**
 * The return ramp after a gap (F12/F13) on `day`. Never inside Block Zero:
 * Block Zero week 1 is the comeback (Josh, 2026-10-20; coach-brain lead-in
 * item 6), so its sessions get no ramp on top of an already easy week.
 */
export async function returnContextFor(db: DB, day: number): Promise<ReturnContext> {
  const block = await getActiveBlock(db)
  if (block?.blockType === 'block_zero') return returnContext([], day)
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

/**
 * Sessions made regular on a weekday, as template entries. Classes never:
 * class days come only from Settings (review R3), so an old "made regular"
 * class on an unpicked day is left out.
 */
export function extrasForDay(dow: number, extras: TemplateExtra[]): Array<TemplateSession & { extra: true }> {
  return extras.filter(e => e.dayOfWeek === dow && e.type !== 'mt_class').map(e => ({
    timeSlot: e.timeSlot,
    type: e.type,
    label: e.label ?? e.type,
    estimatedMin: 0,
    ...(e.type === 'running' && (e.notes === 'zone2' || e.notes === 'progression') ? { runCategory: e.notes as 'zone2' | 'progression' } : {}),
    extra: true as const,
  }))
}

export interface BlockDayPlan {
  entries: Array<(PlanEntry | (TemplateSession & { extra: true })) & { plan?: PlanEntry['plan'] }>
  leadIn: boolean
  weekPlanId: string | null
  shape: StoredWeek | null
}

/**
 * What a block's day holds (rebuild Phase 2: the one plan's week for every
 * block, never the old Fighter week): nothing before the start, else the
 * week's stored build (made now when the week has none) and the sessions made
 * regular on that weekday. Shared by generate-today, the back-fill, the week
 * preparation, BEGIN and the previews of days not made yet. A preview passes
 * `store: false`: it never keeps a week's shape (only making the days does).
 */
export async function blockDayPlan(db: DB, block: Block, epochDay: number, weekNumber: number, nowSec: number, o: { store?: boolean } = {}): Promise<BlockDayPlan> {
  const start = blockStartDay(block)
  if (epochDay < start) return { entries: [], leadIn: false, weekPlanId: null, shape: null }
  const monday = mondayOf(epochDay)
  const weekPlanId = await resolveWeekPlan(db, block.id, weekNumber, monday, nowSec, { autoGenerated: true })
  if (!weekPlanId) return { entries: [], leadIn: false, weekPlanId: null, shape: null }
  const extras = await loadTemplateExtras(db, block.id)
  const shape = await weekShapeFor(db, {
    blockId: block.id, blockStart: start, monday, week: weekNumber, planId: weekPlanId, nowSec, blockType: block.blockType,
    extras: extras.map(e => ({ dayOfWeek: e.dayOfWeek, timeSlot: e.timeSlot, type: e.type, label: e.label, notes: e.notes })),
  }, o)
  const dow = new Date(epochDay * DAY_SEC * 1000).getUTCDay()
  return { entries: [...dayEntries(shape, dow), ...extrasForDay(dow, extras)], leadIn: false, weekPlanId, shape }
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
  const tw = await trainingWeekFor(db, block, epochDay, todayDay)
  const { weekNumber, strengthWeek } = weekStamps(block, tw)
  const plan = await blockDayPlan(db, block, epochDay, weekNumber, nowSec)
  if (plan.entries.length === 0) return []
  return insertDayEntries(db, block, epochDay, plan.entries, { weekPlanId: plan.weekPlanId, strengthWeek, nowSec })
}

/** Insert a day's planned entries as template sessions (the one creation path, and a re-shape's new days). */
export async function insertDayEntries(db: DB, block: Block, epochDay: number, entries: BlockDayPlan['entries'], o: { weekPlanId: string | null; strengthWeek: number; nowSec: number }): Promise<SessionRow[]> {
  // A class sits in his chosen slot for that day (page 70); ANY keeps the plan's.
  const daySlot = (await mtClassSlots(db))[new Date(epochDay * 86400000).getUTCDay()]
  const ids: string[] = []
  for (const entry of entries) {
    const id = crypto.randomUUID()
    ids.push(id)
    const plan = 'plan' in entry && entry.plan ? entry.plan : null
    await db.insert(sessions).values({
      id,
      type: entry.type,
      // Labels carry the strength day (A/B) so a moved session keeps its content
      label: entry.label,
      weekPlanId: o.weekPlanId,
      scheduledDate: epochDay,
      timeSlot: entry.type === 'mt_class' && (daySlot === 'am' || daySlot === 'pm') ? daySlot : entry.timeSlot,
      blockWeek: entry.type === 'strength' ? o.strengthWeek : null,
      blockType: block.blockType,
      status: 'planned',
      // Tag running sessions with their category so start-run can determine prescription
      notes: entry.type === 'running' ? (entry.runCategory ?? null) : null,
      source: 'template',
      // Bag Work technique or not, Bag Conditioning's planned minutes and effort (the week builder's plan mark).
      // Bag Conditioning: the workout the coach picked (the Muay Thai track's start route reads conditioningPick).
      ...(plan ? { contextJson: JSON.stringify({ plan, ...(entry.type === 'bag_conditioning' && plan.workoutId ? { conditioningPick: { templateId: plan.workoutId } } : {}) }) } : {}),
      createdAt: o.nowSec,
    })
  }
  return dedupeDay(db, epochDay, ids)
}

/**
 * Two screens asking at once can make a day's plan twice (review T8). After
 * inserting, every racer picks the same keeper for each session it made (the
 * first made, then the smallest id) and takes every other copy off, its own
 * or the other racer's, so the day ends with one set whichever finishes last.
 */
async function dedupeDay(db: DB, epochDay: number, mine: string[]): Promise<SessionRow[]> {
  const rows = await db.select().from(sessions).where(and(eq(sessions.scheduledDate, epochDay), eq(sessions.source, 'template'), eq(sessions.status, 'planned')))
  const keyOf = (r: SessionRow) => `${r.type}|${r.label ?? ''}|${r.timeSlot ?? ''}|${r.notes ?? ''}`
  const first = (a: SessionRow, b: SessionRow) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)
  const keep = new Map<string, string>()
  for (const r of [...rows].sort(first)) { const k = keyOf(r); if (!keep.has(k)) keep.set(k, r.id) }
  // Only the sessions this insert made a copy of: older rows of other kinds are left alone.
  const touched = new Set(rows.filter(r => mine.includes(r.id)).map(keyOf))
  const spare = rows.filter(r => touched.has(keyOf(r)) && keep.get(keyOf(r)) !== r.id).map(r => r.id)
  if (spare.length) await db.delete(sessions).where(inArray(sessions.id, spare))
  const left = mine.filter(id => !spare.includes(id))
  return left.length > 0 ? db.select().from(sessions).where(inArray(sessions.id, left)) : []
}

/**
 * The day already holds the active block's own template sessions (the one
 * creation path's idempotency check). An ended block's leftovers and his own
 * adds don't count.
 */
export async function dayHasPlan(db: DB, blockId: string, day: number): Promise<boolean> {
  const rows = await db.select({ source: sessions.source, blockId: weekPlans.blockId }).from(sessions)
    .leftJoin(weekPlans, eq(weekPlans.id, sessions.weekPlanId))
    .where(eq(sessions.scheduledDate, day))
  return rows.some(r => (r.source == null || r.source === 'template') && (r.blockId == null || r.blockId === blockId))
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

/**
 * The stored build of a calendar week, without making one: the block's week
 * plan whose stored week is that Monday's (a week made early can carry another
 * week number, so the Monday decides).
 */
export async function storedWeekPlan(db: DB, blockId: string, monday: number): Promise<{ id: string; shape: StoredWeek } | null> {
  const plans = await db.select({ id: weekPlans.id, shape: weekPlans.shapeJson }).from(weekPlans).where(eq(weekPlans.blockId, blockId)).orderBy(desc(weekPlans.createdAt))
  for (const p of plans) {
    const s = parseShape(p.shape)
    if (s && s.monday === monday) return { id: p.id, shape: s }
  }
  return null
}

export async function storedShape(db: DB, blockId: string, _weekNumber: number, monday: number): Promise<StoredWeek | null> {
  void _weekNumber
  return (await storedWeekPlan(db, blockId, monday))?.shape ?? null
}

export function toSessionLike(r: Pick<SessionRow, 'id' | 'type' | 'label' | 'notes' | 'scheduledDate' | 'timeSlot' | 'status'>): SessionLike {
  return { id: r.id, type: r.type, label: r.label, notes: r.notes, epochDay: r.scheduledDate as number, timeSlot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status }
}

/** The planned load of a week from its stored build (null: the week has none yet). */
export function planWeekLoad(blockType: BlockKind, weekNumber: number, shape: StoredWeek | null): number | null {
  if (!shape) return null
  let total = 0
  for (const s of shape.entries) {
    if (!KEY_TYPES.has(s.type)) continue
    total += s.plan?.minutes != null && s.plan.effort != null ? s.plan.minutes * s.plan.effort : plannedLoad({ type: s.type, label: s.label, notes: s.runCategory ?? null, estimatedMin: null }, blockType, weekNumber)
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
    planWeekLoad: block && !leadIn ? planWeekLoad(kind, weekNumber, await storedShape(db, block.id, weekNumber, monday)) : null,
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
  const state: SessionCoachState = {
    returnCtx: await returnContextFor(db, day),
    coachEase: coachEaseFrom(session.contextJson),
    injury,
    injuryAction: injuryActionFor(session.type, injury),
  }
  // A raven's plan on this session (page 58, server/bodyWatch.ts): bag work technique only (a class comes off instead),
  // back-friendly lifts, or the bad-neck Foundation, through the same eases an injury flag uses.
  const plan = bodyPlanMark(session.contextJson)
  if (plan && state.injuryAction.action === 'none') {
    const region = plan.op === 'back' ? 'back' : plan.op === 'badday' && plan.which === 'neck' ? 'neck' : (injury?.region ?? 'knee')
    const flag: InjuryFlag = { region, since: day, reason: `${region.charAt(0).toUpperCase()}${region.slice(1)} plan.` }
    if (plan.op === 'technique' || plan.op === 'back' || (plan.op === 'badday' && plan.which === 'neck')) {
      return { ...state, injury: flag, injuryAction: injuryActionFor(session.type, flag) }
    }
  }
  return state
}

/** The raven's plan mark on a session (context_json.bodyPlan), read without the body-watch module. */
export function bodyPlanMark(contextJson: string | null | undefined): { op: string; which?: string; shapeWeek?: number } | null {
  if (!contextJson) return null
  try {
    const v = (JSON.parse(contextJson) as { bodyPlan?: { op?: unknown; which?: unknown; shapeWeek?: unknown } }).bodyPlan
    if (!v || typeof v.op !== 'string') return null
    return { op: v.op, ...(typeof v.which === 'string' ? { which: v.which } : {}), ...(typeof v.shapeWeek === 'number' ? { shapeWeek: v.shapeWeek } : {}) }
  } catch {
    return null
  }
}

/** Active block plus its training week today, for routes that report it. */
export async function currentBlockWeek(db: DB, todayDay: number) {
  const block = await getActiveBlock(db)
  if (!block) return null
  const tw = await trainingWeekFor(db, block, todayDay, todayDay)
  return { block, tw }
}

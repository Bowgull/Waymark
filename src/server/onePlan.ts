// The one plan's week on the server (rebuild Phase 2; page 93 approved
// 2026-10-25): the week the coach built for a calendar week is stored on its
// week plan (week_plans.shape_json, 0053) and every day's sessions are made
// from it (coachData.generateDaySessions). The step comes from the weeks
// before it (lib/brain/dayRamp.ts), the shape from lib/brain/weekBuilder.ts.
//
// Class days changed in Settings: the night re-shapes the rest of this week
// and next quietly (no screen, no rune: he made the change). Sessions he did,
// started, added or moved himself, and earlier days stay as they are.

import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { athleteEstimates, dailyLogs, sessions, settings, userProfile, weekPlans } from '../db/schema'
import type { createDB } from '../db/client'
import { getBlockZeroWeekTemplate } from '../lib/blockZero/weekPlan'
import { planDayTemplate, startWeekDay } from '../lib/coach/leadIn'
import { BAG_CONDITIONING_TYPE, buildWeek, roleOf, type DayStep, type KeptSession, type PlanEntry } from '../lib/brain/weekBuilder'
import { nextStep, type RampWeek, type StepPick } from '../lib/brain/dayRamp'
import { classDaySlots, parseClassDays } from '../lib/classSlots'
import { KEY_TYPES } from '../lib/keyTypes'
import { CONTINUOUS_FROM_SEC } from '../lib/brain/history'
import { conditioningHistory } from './bagConditioning'

type DB = ReturnType<typeof createDB>
type SessionRow = typeof sessions.$inferSelect

/** What a week plan stores (week_plans.shape_json). */
export interface StoredWeek {
  v: 1
  monday: number
  /** The plan week it was built for (hard runs from week 4). */
  week: number
  step: DayStep
  change: StepPick['change']
  stepWhy: string
  /** Settings' class days and slots and the profile cap it was built from. */
  classKey: string
  entries: PlanEntry[]
  why: string
  eased: string[]
  broken: string[]
  hardDays: number
  cap: number
  at: number
  /** He ran 10 minutes straight when it was built (hard runs need it; rebuild Phase 3). Missing: older weeks. */
  runsReady?: boolean
}

const WEEK_TYPES = new Set([...KEY_TYPES, BAG_CONDITIONING_TYPE])
const HARD_NOTES = new Set(['tempo', 'intervals', '5k_test'])
const dowOf = (day: number) => new Date(day * 86400000).getUTCDay()

export function parseShape(json: string | null | undefined): StoredWeek | null {
  if (!json) return null
  try {
    const v = JSON.parse(json) as StoredWeek
    return v && v.v === 1 && typeof v.monday === 'number' && Array.isArray(v.entries) && typeof v.step === 'number' ? v : null
  } catch {
    return null
  }
}

/** Settings' class days as the builder reads them, and the key a stored week remembers. */
export async function classSetting(db: DB): Promise<{ days: Array<{ dow: number; slot: 'am' | 'pm' | 'any' }>; cap: number | null; key: string }> {
  const [st] = await db.select({ mt: settings.mtClassDays, slots: settings.mtClassSlots }).from(settings).limit(1)
  const [profile] = await db.select({ cap: userProfile.mtCapPerWeek }).from(userProfile).where(eq(userProfile.id, 'default'))
  const picked = parseClassDays(st?.mt)
  const slots = classDaySlots(picked, st?.slots)
  const days = picked.map(dow => ({ dow, slot: slots[dow] ?? 'any' }))
  const cap = profile?.cap ?? null
  return { days, cap, key: `${days.map(d => `${d.dow}:${d.slot}`).join(',')}|${cap ?? ''}` }
}

/** He runs 10 minutes straight (the athlete model's rung, as last stored). */
export async function runsReady(db: DB): Promise<boolean> {
  const rows = await db.select({ value: athleteEstimates.valueJson }).from(athleteEstimates).where(eq(athleteEstimates.kind, 'run'))
  for (const r of rows) {
    try { if (((JSON.parse(r.value) as { rungSec?: number }).rungSec ?? 0) >= CONTINUOUS_FROM_SEC) return true } catch { /* not a run row */ }
  }
  return false
}

/** A rough morning (the day ramp's "mornings sinking"): low energy or very sore. */
const rough = (l: { energy: number | null; soreness: number | null }) => (l.energy != null && l.energy <= 2) || (l.soreness != null && l.soreness >= 4)

/** The weeks before `monday` in this plan (up to 3), as the day ramp reads them. */
export async function rampWeeks(db: DB, blockId: string, blockStart: number, monday: number): Promise<RampWeek[]> {
  const plans = await db.select({ shape: weekPlans.shapeJson }).from(weekPlans).where(eq(weekPlans.blockId, blockId))
  const stepOf = new Map<number, DayStep>()
  for (const p of plans) { const s = parseShape(p.shape); if (s) stepOf.set(s.monday, s.step) }
  const from = Math.max(monday - 21, blockStart - 6)
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, monday - 1)))
  const logs = await db.select({ day: dailyLogs.logDate, energy: dailyLogs.energy, soreness: dailyLogs.soreness }).from(dailyLogs)
    .where(and(gte(dailyLogs.logDate, from), lte(dailyLogs.logDate, monday - 1)))
  const out: RampWeek[] = []
  for (let m = monday - 21; m < monday; m += 7) {
    if (m + 6 < blockStart) continue
    const week = rows.filter(r => r.scheduledDate != null && r.scheduledDate >= m && r.scheduledDate <= m + 6 && WEEK_TYPES.has(r.type))
    const mine = (r: SessionRow) => r.source === 'ad_hoc' || r.source === 'replace'
    const planned = week.filter(r => !mine(r) && !(r.status === 'skipped' && r.skipReason === 'coach_rest')).length
    const done = week.filter(r => r.status === 'completed').length
    const missed = week.filter(r => !mine(r) && (r.status === 'missed' || (r.status === 'skipped' && r.skipReason !== 'coach_rest'))).length
    const ls = logs.filter(l => l.day >= m && l.day <= m + 6)
    out.push({
      monday: m, step: stepOf.get(m) ?? null, planned, done,
      // His own extra sessions count as showing up: each one covers a miss.
      missed: Math.max(0, missed - week.filter(r => mine(r) && r.status === 'completed').length),
      roughShare: ls.length ? ls.filter(rough).length / ls.length : null,
      hardRunDone: week.some(r => r.type === 'running' && HARD_NOTES.has(r.notes ?? '') && r.status === 'completed'),
    })
  }
  return out
}

/** A session that stays put in a week the coach (re)builds. */
function keptOf(r: SessionRow): KeptSession | null {
  if (r.scheduledDate == null || !WEEK_TYPES.has(r.type) || r.status === 'skipped' && r.skipReason === 'coach_rest') return null
  if (!roleOf({ type: r.type, notes: r.notes, label: r.label })) return null
  const plan = planOf(r.contextJson)
  return { dow: dowOf(r.scheduledDate), slot: r.timeSlot === 'pm' ? 'pm' : 'am', type: r.type, label: r.label, notes: r.notes, ...(plan?.hard != null ? { hard: plan.hard } : {}) }
}

/** The plan mark on a session (context_json.plan): Bag Work technique, Bag Conditioning's minutes and effort. */
export function planOf(contextJson: string | null | undefined): PlanEntry['plan'] | null {
  if (!contextJson) return null
  try {
    const p = (JSON.parse(contextJson) as { plan?: PlanEntry['plan'] }).plan
    return p && typeof p === 'object' && typeof p.hard === 'boolean' ? p : null
  } catch {
    return null
  }
}

export interface ShapeArgs {
  blockId: string
  blockStart: number
  monday: number
  /** The plan week (trainingWeekFor's week). */
  week: number
  planId: string
  /** Sessions made regular, by weekday (they stay in the week and count). */
  extras?: ReadonlyArray<{ dayOfWeek: number; timeSlot: 'am' | 'pm'; type: string; label: string | null; notes: string | null }>
  nowSec: number
  /** The block's type (a week made before the one plan rebuilds from its own template). */
  blockType?: string | null
}

/** Last week's Saturday and Sunday: hard days (never 3 in a row across the weekend), and their lifts (the 48 h rule). */
async function lastWeekend(db: DB, monday: number): Promise<{ hard: [boolean, boolean]; lifts: Array<{ daysBefore: 1 | 2; slot: 'am' | 'pm'; label: string | null }> }> {
  const rows = (await db.select().from(sessions).where(and(gte(sessions.scheduledDate, monday - 2), lte(sessions.scheduledDate, monday - 1))))
    .filter(r => r.status !== 'skipped' && r.status !== 'missed')
  const hard = (d: number) => rows.some(r => r.scheduledDate === d && isHardRow(r))
  const lifts = rows.filter(r => r.type === 'strength').map(r => ({ daysBefore: (monday - (r.scheduledDate as number)) as 1 | 2, slot: r.timeSlot === 'pm' ? 'pm' as const : 'am' as const, label: r.label }))
  return { hard: [hard(monday - 2), hard(monday - 1)], lifts }
}

/** A session row as the week builder counts hard days. */
export function isHardRow(r: Pick<SessionRow, 'type' | 'notes' | 'contextJson'>): boolean {
  if (r.type === 'strength' || r.type === 'mt_class') return true
  if (r.type === 'running') return HARD_NOTES.has(r.notes ?? '')
  if (r.type === 'bag_work') return planOf(r.contextJson)?.hard !== false
  if (r.type === BAG_CONDITIONING_TYPE) return planOf(r.contextJson)?.hard === true
  return false
}

/**
 * The stored week for a calendar week, built now when it has none (or one
 * stored for another calendar week: a paused block repeats a week number).
 *
 * A week whose sessions were made before the one plan (template rows, no
 * stored week) keeps the old template (legacyWeek): building it now would
 * judge a half-made week and take its classes and hard runs. `store: false`
 * (previews, a missed session's fix) builds without keeping it: only making
 * the week's days (generate, the night's run from Saturday) stores its shape.
 */
export async function weekShapeFor(db: DB, a: ShapeArgs, o: { store?: boolean } = {}): Promise<StoredWeek> {
  const store = o.store !== false
  const [plan] = await db.select({ shape: weekPlans.shapeJson }).from(weekPlans).where(eq(weekPlans.id, a.planId))
  const stored = parseShape(plan?.shape)
  if (stored && stored.monday === a.monday) return stored
  if (fixedWeekForTests) return fixedWeek(a)
  const made = await db.select({ id: sessions.id }).from(sessions)
    .where(and(gte(sessions.scheduledDate, a.monday), lte(sessions.scheduledDate, a.monday + 6), eq(sessions.source, 'template'))).limit(1)
  if (made.length > 0) {
    const legacy = await legacyWeek(db, a)
    if (store) await db.update(weekPlans).set({ shapeJson: JSON.stringify(legacy) }).where(eq(weekPlans.id, a.planId))
    return legacy
  }
  const pick = nextStep(await rampWeeks(db, a.blockId, a.blockStart, a.monday))
  return storeBuild(db, a, pick, { open: openDays(a.monday, a.blockStart, a.monday), kept: await keptInWeek(db, a, () => true) }, store)
}

/**
 * A week made before the one plan: its old template, day by day, with the
 * fixed class key so the old rules (class ladder, hard runs) stay in charge
 * of it and its classes and hard runs are kept.
 */
async function legacyWeek(db: DB, a: ShapeArgs): Promise<StoredWeek> {
  const cls = await classSetting(db)
  const mtDays = new Set(cls.days.map(d => d.dow))
  const blockType = a.blockType === 'block_zero' ? 'block_zero' as const : 'fighter' as const
  const entries: PlanEntry[] = []
  for (const dow of openDays(a.monday, a.blockStart, a.monday)) {
    const day = planDayTemplate({ blockType, startDay: a.blockStart, epochDay: a.monday + ((dow + 6) % 7), weekNumber: a.week, mtDays })
    for (const t of day.sessions) {
      const role = roleOf({ type: t.type, notes: t.runCategory ?? null, label: t.label }) ?? 'run'
      entries.push({ ...t, dow, role, hard: role === 'lift' || role === 'hard_run' || role === 'class' })
    }
  }
  return { v: 1, monday: a.monday, week: a.week, step: 6, change: 'hold', stepWhy: '', classKey: FIXED_KEY, entries, why: '', eased: [], broken: [], hardDays: 0, cap: 7, at: a.nowSec }
}

// ─── A fixed week for older story tests ──────────────────────

let fixedWeekForTests = false
/** The class key a fixed test week carries: the old rules (class ladder, heavy weeks) stay in charge of it. */
export const FIXED_KEY = 'fixed'

/**
 * Tests only: weeks come from the old fixed Block Zero week (Strength A/B/C,
 * three runs, hard runs from week 4) instead of the builder, so the stories
 * written on that week (the raven, the night's decision, the replay smoke)
 * keep testing what they test. The one plan's week has its own tests
 * (lib/brain/weekBuilder.test.ts, server/onePlan.test.ts).
 */
export function setFixedWeekForTests(on: boolean): void {
  fixedWeekForTests = on
}

function fixedWeek(a: ShapeArgs): StoredWeek {
  const tpl = getBlockZeroWeekTemplate(a.week)
  const entries: PlanEntry[] = []
  for (const dow of openDays(a.monday, a.blockStart, a.monday)) {
    for (const t of startWeekDay(a.blockStart, a.monday + ((dow + 6) % 7), a.week) ?? tpl[dow] ?? []) {
      const role = roleOf({ type: t.type, notes: t.runCategory ?? null, label: t.label }) ?? 'run'
      entries.push({ ...t, dow, role, hard: role === 'lift' || role === 'hard_run' })
    }
  }
  return { v: 1, monday: a.monday, week: a.week, step: 6, change: 'hold', stepWhy: '', classKey: FIXED_KEY, entries, why: '', eased: [], broken: [], hardDays: 0, cap: 7, at: a.nowSec }
}

/** The weekdays from `from` (the block start, a re-shape's first day) to Sunday. */
function openDays(monday: number, blockStart: number, from: number): number[] {
  const out: number[] = []
  for (let d = Math.max(monday, blockStart, from); d <= monday + 6; d++) out.push(dowOf(d))
  return out
}

/** Sessions of the week that stay (filter picks which), plus the extras made regular on open days. */
async function keptInWeek(db: DB, a: Pick<ShapeArgs, 'monday' | 'extras'>, stays: (r: SessionRow) => boolean): Promise<KeptSession[]> {
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, a.monday), lte(sessions.scheduledDate, a.monday + 6)))
  const kept = rows.filter(stays).map(keptOf).filter((k): k is KeptSession => k != null)
  for (const e of a.extras ?? []) {
    if (e.type === 'mt_class') continue
    // A made-regular session already made for the day is in the rows.
    if (rows.some(r => r.scheduledDate != null && dowOf(r.scheduledDate) === e.dayOfWeek && r.type === e.type && r.timeSlot === e.timeSlot && stays(r))) continue
    kept.push({ dow: e.dayOfWeek, slot: e.timeSlot, type: e.type, label: e.label, notes: e.notes })
  }
  return kept
}

async function storeBuild(db: DB, a: ShapeArgs, pick: { step: DayStep; change: StepPick['change']; why: string }, where: { open: number[]; kept: KeptSession[]; keepEntries?: PlanEntry[] }, store = true): Promise<StoredWeek> {
  const cls = await classSetting(db)
  const weekend = await lastWeekend(db, a.monday)
  const [st] = await db.select({ techniques: settings.enabledTechniques }).from(settings).limit(1)
  const hist = await conditioningHistory(db)
  const ready = await runsReady(db)
  const build = buildWeek({
    week: a.week, step: pick.step, classDays: cls.days, classCap: cls.cap, open: where.open, kept: where.kept,
    prevHard: weekend.hard, prevLifts: weekend.lifts, runsReady: ready,
    conditioning: { switches: (st?.techniques ?? 'boxing,kicks,defensive').split(','), lastTemplateId: hist.lastTemplateId, history: hist.steps },
  })
  const shape: StoredWeek = {
    v: 1, monday: a.monday, week: a.week, step: pick.step, change: pick.change, stepWhy: pick.why, classKey: cls.key,
    entries: [...(where.keepEntries ?? []), ...build.entries], why: build.why, eased: build.eased, broken: build.broken,
    hardDays: build.hardDays, cap: build.cap, at: a.nowSec, runsReady: ready,
  }
  if (store) await db.update(weekPlans).set({ shapeJson: JSON.stringify(shape) }).where(eq(weekPlans.id, a.planId))
  return shape
}

/** The week's line under THIS WEEK (page 93): the step's why, then the week's. */
export function shapeLine(s: Pick<StoredWeek, 'stepWhy' | 'why' | 'change'>): string {
  return s.change === 'hold' || s.change === 'start' ? s.why : `${s.stepWhy} ${s.why}`
}

/** A session the coach already changed (merged lifts, a morning cap, an ease): it stays where it is. */
function coachMarked(contextJson: string | null): boolean {
  if (!contextJson) return false
  try {
    const c = JSON.parse(contextJson) as Record<string, unknown>
    return c.mergedLifts != null || c.brainCap != null || c.coachEase != null
  } catch { return false }
}

/**
 * Re-shape the rest of a week (class days changed): sessions the coach planned
 * on the days from `fromDay` come off (never one he did, started, added or
 * moved, one an UNDO holds, or one the coach changed: merged lifts, a cap,
 * an ease) and the builder places the rest around what stays. A planned class
 * on a day no longer picked always comes off, held or not. Quiet: no
 * change rows. Returns the removed session ids and the new shape; the caller
 * makes the new sessions for days already made.
 */
export async function reshapeWeek(db: DB, a: ShapeArgs, fromDay: number, holds: ReadonlySet<string>): Promise<{ removed: string[]; shape: StoredWeek }> {
  const [plan] = await db.select({ shape: weekPlans.shapeJson }).from(weekPlans).where(eq(weekPlans.id, a.planId))
  const before = parseShape(plan?.shape)
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, a.monday), lte(sessions.scheduledDate, a.monday + 6)))
  const movable = (r: SessionRow) => r.scheduledDate != null && r.scheduledDate >= fromDay && r.status === 'planned' && r.source === 'template' && !holds.has(r.id) && WEEK_TYPES.has(r.type) && !coachMarked(r.contextJson)
  // Classes land only on Settings class days: a planned class on a day no longer picked goes,
  // whatever holds it (a change row, a coach mark, his own add). Done and started ones stay.
  const picked = new Set((await classSetting(db)).days.map(d => d.dow))
  const offDay = (r: SessionRow) => r.type === 'mt_class' && r.scheduledDate != null && r.scheduledDate >= fromDay && r.status === 'planned' && !picked.has(dowOf(r.scheduledDate))
  const removed = rows.filter(r => movable(r) || offDay(r)).map(r => r.id)
  const pick = before && before.monday === a.monday ? { step: before.step, change: before.change, why: before.stepWhy } : nextStep(await rampWeeks(db, a.blockId, a.blockStart, a.monday))
  const open = openDays(a.monday, a.blockStart, fromDay)
  const kept = await keptInWeek(db, a, r => !removed.includes(r.id))
  // Days before the re-shape keep the entries they were made from (Foundation too).
  const keepEntries = (before?.entries ?? []).filter(e => !open.includes(e.dow))
  if (removed.length) await db.delete(sessions).where(inArray(sessions.id, removed))
  return { removed, shape: await storeBuild(db, a, pick, { open, kept, keepEntries }) }
}

// The weekly pass (adaptive coach, plan §1). The nightly job runs it when the
// athlete's local day is Sunday (Monday catches up a missed run), once per
// block and calendar week. It prepares next week from what happened:
// completion, the sRPE load trend, the readiness trend, logged effort (RPE,
// RIR), added sessions, retests, the gap rules and the block/wave week.
//
// One path for the cron and the app: prepareWeek() is what POST
// /api/weeks/auto-generate calls too.
//   1. The planner: the AI week planner (guarded: Block Zero guardrails;
//      Fighter sessions placement-checked by E1, refused ones dropped with a
//      reason), else the template (rules only, offline or no key).
//   2. The rules: at most two small eases with a reason each (coach/weeklyPass).
//      Nothing is added, moved or made up.
//   3. The week stores its one line in plain words (what's new, what's
//      next; week_plans.why_line, analysis_json v2) and each ease as a change
//      record with its rune and UNDO (server/changes.ts).
// No approval step: a prepared week is just shown.
// Then the pass: the athlete model (Sonnet, guarded, 10-day expiry), the
// new training maxes at a wave end and sessions added 2+ weeks joining the
// plan, each applied with its rune and UNDO (the coach never asks).

import { and, eq, gte, lte } from 'drizzle-orm'
import { blockTests, coachingOutputs, dailyLogs, sessions, trainingBlocks, weekPlans } from '../db/schema'
import type { createDB } from '../db/client'
import {
  KEY_TYPES,
  sessionName,
  claimDecision,
  isoOf,
  summarizeEffort,
  weeklyPassKey,
  weeklyPassTarget,
  whyThisWeek,
  stillStarting,
  isLeadInContext,
  hasCoachEase,
  type WeekChange,
  type WeekIntelligence,
  type WeekSignals,
  type EstimateLike,
} from '../lib/coach'
import { checkInFromDailyLog, evaluateReadiness, weeklyLoadFlag } from '../lib/blockZero'
import { strengthBlockWeek } from '../lib/weeklyTemplate'
import { analyzeWeek, previousAnalysisFrom } from '../lib/weekAnalysis'
import { loadLatestAthleteState } from '../lib/athleteState/store'
import { getActiveBlock, loadSessionLoadEntries } from './blockZeroData'
import {
  blockKind,
  dayHasPlan,
  generateDaySessions,
  resolveWeekPlan,
  returnContextFor,
  trainingWeekFor,
  weekStamps,
} from './coachData'
import { applyTmUpdate, loadEffortReads, maybeMakeRegular } from './coachAsks'
import { applyPendingMerges } from './changes'
import { applyPendingBodyPlans } from './bodyWatch'

type DB = ReturnType<typeof createDB>
type Block = typeof trainingBlocks.$inferSelect
type SessionRow = typeof sessions.$inferSelect
type WeekPlanRow = typeof weekPlans.$inferSelect

const DAY_SEC = 86400

function sortSessions<T extends { scheduledDate: number | null; timeSlot: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0) || (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1))
}

/** A stored week plan with the old 'draft' status read as active (no approval step). */
export function weekForClient(w: WeekPlanRow): WeekPlanRow {
  return w.status === 'draft' || w.status === 'approved' ? { ...w, status: 'active' } : w
}

// ─── What happened ─────────────────────────────────────────────

function parseStored(raw: string | null): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** analysis_json of the plan the previous week's sessions belong to. */
async function latestPlanAnalysis(db: DB, prevWeek: SessionRow[]): Promise<string | null> {
  const id = prevWeek.find(s => s.weekPlanId)?.weekPlanId
  if (!id) return null
  const [row] = await db.select({ a: weekPlans.analysisJson }).from(weekPlans).where(eq(weekPlans.id, id))
  return row?.a ?? null
}

/** Signals for preparing the week starting `monday`, read as of `todayDay`. */
export async function loadWeekSignals(db: DB, block: Block, monday: number, todayDay: number): Promise<{ signals: WeekSignals; analysis: ReturnType<typeof analyzeWeek> }> {
  const kind = blockKind(block.blockType)
  const prevStart = monday - 7
  const prevEnd = Math.min(monday - 1, todayDay)
  const tw = await trainingWeekFor(db, block, monday, todayDay)
  const lastTw = await trainingWeekFor(db, block, monday - 1, todayDay)

  const prev = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, prevStart), lte(sessions.scheduledDate, monday - 1)))
  const key = prev.filter(s => KEY_TYPES.has(s.type))
  const plannedKey = key.filter(s => s.source !== 'ad_hoc')
  const counted = plannedKey.filter(s => s.status === 'completed' || s.status === 'missed' || s.status === 'skipped')
  const completed = plannedKey.filter(s => s.status === 'completed').length
  const added = key.filter(s => s.source === 'ad_hoc' && s.status === 'completed').length

  const end = prevEnd
  const entries = await loadSessionLoadEntries(db, end - 13, end)
  let last7 = 0
  let prev7 = 0
  for (const e of entries) {
    const load = e.rpe != null && e.minutes != null ? e.rpe * e.minutes : 0
    if (e.epochDay > end - 7) last7 += load
    else prev7 += load
  }
  const flag = weeklyLoadFlag(prev7, last7)

  const logs = await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, prevStart - 10), lte(dailyLogs.logDate, monday - 1)))
  const days = evaluateReadiness(logs.map(checkInFromDailyLog)).filter(d => d.epochDay >= prevStart && d.epochDay <= monday - 1)
  const weekLogs = logs.filter(l => l.logDate >= prevStart && l.logDate <= monday - 1)
  const avg = (vals: Array<number | null>) => {
    const v = vals.filter((x): x is number => x != null)
    return v.length > 0 ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null
  }

  const effort = summarizeEffort(await loadEffortReads(db, prevStart, monday - 1))
  const ret = await returnContextFor(db, Math.max(todayDay, monday))
  const tests = await db.select({ id: blockTests.id }).from(blockTests)
    .where(and(eq(blockTests.blockId, block.id), gte(blockTests.recordedAt, prevStart * DAY_SEC), lte(blockTests.recordedAt, monday * DAY_SEC)))
  const state = await loadLatestAthleteState(db)
  const waveEnd = kind === 'fighter' && (strengthBlockWeek('fighter', lastTw.rawWeek) === 6 || lastTw.week >= block.totalWeeks)

  const analysis = analyzeWeek(
    prev.map(s => ({ type: s.type, status: s.status, scheduledDate: s.scheduledDate ?? 0, timeSlot: s.timeSlot ?? 'am', rpe: s.rpe, difficulty: s.difficulty, notes: s.type === 'running' ? s.notes : null })),
    weekLogs.map(l => ({ logDate: l.logDate, sleepHours: l.sleepHours, soreness: l.soreness, herbScale: l.herbScale, alcoholScale: l.alcoholScale })),
    logs.filter(l => l.logDate >= prevStart - 7 && l.logDate < prevStart).map(l => ({ logDate: l.logDate, sleepHours: l.sleepHours, soreness: l.soreness, herbScale: l.herbScale, alcoholScale: l.alcoholScale })),
    // The week before's stored read, whatever shape it has (no crash on an old AI plan).
    previousAnalysisFrom(parseStored(await latestPlanAnalysis(db, prev))),
  )

  const signals: WeekSignals = {
    weekNumber: tw.week,
    totalWeeks: block.totalWeeks,
    blockType: kind,
    lastWeek: {
      planned: counted.length,
      completed,
      missed: plannedKey.filter(s => s.status === 'missed').length,
      skipped: plannedKey.filter(s => s.status === 'skipped').length,
      added,
    },
    completionRate: counted.length > 0 ? Math.round((completed / counted.length) * 100) / 100 : null,
    load: { last7, prev7, changePct: flag.change != null ? Math.round(flag.change * 100) : null, flagged: flag.flagged && prev7 > 0 },
    readiness: {
      days: days.length,
      flaggedDays: days.filter(d => d.flagged).length,
      easeDays: days.filter(d => d.ease).length,
      freshDays: days.filter(d => d.fresh).length,
      oversleepFatigueDays: days.filter(d => d.oversleep === 'fatigue').length,
    },
    effort,
    avgSoreness: avg(weekLogs.map(l => l.soreness)),
    avgSleep: avg(weekLogs.map(l => l.sleepHours)),
    returnRamp: { active: ret.active, gapDays: ret.plan.gapDays, reason: ret.reason },
    retestLastWeek: tests.length > 0,
    waveEnd,
    athleteShape: state?.weekShape ?? null,
  }
  return { signals, analysis }
}

/** The rules' read as a prompt block for the planner. */
export function serializeWeekSignals(s: WeekSignals): string {
  const lines = ['# What happened last week (rules read)']
  lines.push(`Key sessions: ${s.lastWeek.completed} of ${s.lastWeek.planned} done, ${s.lastWeek.missed} missed, ${s.lastWeek.skipped} skipped, ${s.lastWeek.added} added.`)
  lines.push(`Session load (RPE x min): ${s.load.last7} vs ${s.load.prev7} the week before${s.load.changePct != null ? ` (${s.load.changePct > 0 ? '+' : ''}${s.load.changePct}%)` : ''}${s.load.flagged ? ', over the guide' : ''}.`)
  lines.push(`Check-ins: ${s.readiness.days} days, ${s.readiness.flaggedDays} off trend, ${s.readiness.freshDays} above trend, ${s.readiness.oversleepFatigueDays} long sleeps with low energy or high soreness.`)
  lines.push(`Effort vs target: ${s.effort.easier} easier, ${s.effort.onTarget} on target, ${s.effort.harder} harder, ${s.effort.wayHarder} way harder${s.effort.avgRpe != null ? `, avg RPE ${s.effort.avgRpe}` : ''}.`)
  if (s.avgSoreness != null || s.avgSleep != null) lines.push(`Averages: soreness ${s.avgSoreness ?? 'n/a'}/5, sleep ${s.avgSleep ?? 'n/a'} h.`)
  if (s.returnRamp.active) lines.push(`Return ramp active (${s.returnRamp.gapDays} days off): the app lowers loads and volume. Plan inside it.`)
  if (s.retestLastWeek) lines.push('A retest was logged last week.')
  if (s.waveEnd) lines.push('The strength wave just ended. New training maxes are proposed separately.')
  if (s.athleteShape) lines.push(`Athlete model read: ${s.athleteShape}.`)
  lines.push(`Block week ${s.weekNumber} of ${s.totalWeeks}.`)
  return lines.join('\n')
}

// ─── Prepare one week ──────────────────────────────────────────

interface Planned {
  type: string
  label: string | null
  notes: string | null
  epochDay: number
  timeSlot: 'am' | 'pm'
  estimatedMin: number | null
  /** One-line reason from the planner when it differs from the template. */
  why: string | null
  extra?: boolean
  /** Block Zero lead-in day: optional session (Part B). */
  leadIn?: boolean
}

export interface PrepareWeekOptions {
  blockId: string
  monday: number
  todayDay: number
  nowSec: number
  /** Use the AI planner (falls back to the template when offline). */
  useAi: boolean
}

export interface PrepareWeekResult {
  week: WeekPlanRow
  sessions: SessionRow[]
  prepared: boolean
  source: 'ai' | 'rules' | 'existing'
  analysis: WeekIntelligence | null
}

export async function prepareWeek(db: DB, _apiKey: string, opts: PrepareWeekOptions): Promise<PrepareWeekResult | null> {
  const [block] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, opts.blockId))
  if (!block) return null
  const { monday, todayDay, nowSec } = opts
  const kind = blockKind(block.blockType)
  const isBlockZero = kind === 'block_zero'
  const tw = await trainingWeekFor(db, block, monday, todayDay)
  const stamps = weekStamps(block, tw)
  const weekId = (await resolveWeekPlan(db, block.id, stamps.weekNumber, monday, nowSec, { autoGenerated: true })) as string
  const existing = await db.select().from(sessions).where(eq(sessions.weekPlanId, weekId))
  const [weekRow] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  if (existing.length > 0) {
    return { week: weekForClient(weekRow), sessions: sortSessions(existing), prepared: false, source: 'existing', analysis: null }
  }

  const { signals, analysis } = await loadWeekSignals(db, block, monday, todayDay)
  // One creation path (coach brain P2): each day from the block's template, as generate-today does.
  // No planner and no rule eases: the nightly brain doses each session and shapes the week.
  void opts.useAi
  const source: 'ai' | 'rules' = 'rules'
  const ids: string[] = []
  for (let d = monday; d <= monday + 6; d++) {
    if (await dayHasPlan(db, block.id, d)) continue
    ids.push(...(await generateDaySessions(db, d, todayDay, nowSec)).map(r => r.id))
  }
  const changes: WeekChange[] = []
  const dropped: WeekIntelligence['dropped'] = []
  const narrative: string | null = null
  const adjustmentNotes: string | null = null
  const eases: Array<{ cause: NonNullable<WeekChange['cause']>; index: number }> = []
  const planned: Planned[] = []
  void kind
  void isBlockZero

  // A missed session's lifts waiting for this week land on its strength day.
  await applyPendingMerges(db, ids)
  // A raven's plan that waited for this week lands on its days (page 58).
  await applyPendingBodyPlans(db, ids)

  // The week line is the rules' own, in plain words (page 56 item 16); the planner's narrative is stored only.
  const rulesWhy = whyThisWeek(signals, eases.map(e => ({ cause: e.cause, epochDay: planned[e.index].epochDay, name: sessionName(planned[e.index]), type: planned[e.index].type })))
  const why = rulesWhy
  const state = await loadLatestAthleteState(db)
  const intelligence: WeekIntelligence = {
    version: 2,
    source,
    why,
    changes,
    dropped,
    signals,
    athleteVerdict: state?.verdict ?? null,
    reasoning: { narrative, adjustmentNotes, rulesWhy },
    deficits: analysis.deficits,
    consistentSkips: analysis.consistentSkips,
    addedTypes: analysis.addedTypes,
    volumeByType: analysis.volumeByType,
    wellness: analysis.wellness,
    summary: why,
  }
  await db.update(weekPlans).set({ analysisJson: JSON.stringify(intelligence), whyLine: why, preparedAt: nowSec, status: 'active' }).where(eq(weekPlans.id, weekId))
  const [week] = await db.select().from(weekPlans).where(eq(weekPlans.id, weekId))
  const rows = ids.length > 0 ? await db.select().from(sessions).where(eq(sessions.weekPlanId, weekId)) : []
  console.log(`[weeklyPass] week ${stamps.weekNumber} (${isoOf(monday)}) prepared: source=${source} sessions=${rows.length} eases=${eases.length} dropped=${dropped.length}`)
  return { week: weekForClient(week), sessions: sortSessions(rows), prepared: true, source, analysis: intelligence }
}

// ─── The nightly weekly pass ───────────────────────────────────

export interface WeeklyPassResult {
  ran: boolean
  key: string | null
  monday: number | null
  prepared?: boolean
  source?: string
  applied?: string[]
  athleteVerdict?: string | null
  reason?: string
}

/** Claim the pass for a key. False when another run did it or holds a fresh claim. */
async function claimPass(db: DB, key: string, nowSec: number): Promise<boolean> {
  const [row] = await db.select().from(coachingOutputs).where(and(eq(coachingOutputs.kind, 'weekly_pass'), eq(coachingOutputs.inputHash, key)))
  const status = row ? (() => { try { return (JSON.parse(row.outputJson) as { status?: string }).status ?? null } catch { return null } })() : null
  const decision = claimDecision(row ? { status, createdAt: row.createdAt } : null, nowSec)
  if (decision === 'skip') return false
  if (decision === 'takeover' && row) {
    await db.update(coachingOutputs).set({ createdAt: nowSec, outputJson: JSON.stringify({ status: 'running' }) }).where(eq(coachingOutputs.id, row.id))
    return true
  }
  try {
    await db.insert(coachingOutputs).values({ id: crypto.randomUUID(), kind: 'weekly_pass', model: 'rules', scopeWeekPlanId: null, scopeSessionId: null, inputHash: key, outputJson: JSON.stringify({ status: 'running' }), tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, createdAt: nowSec })
    return true
  } catch {
    // The unique index (0031): another run claimed it first.
    return false
  }
}

/**
 * Run the weekly pass for `todayDay` (the athlete's local day). Sunday
 * prepares next week; Monday prepares this week if Sunday's run never
 * happened. Idempotent per block and calendar week.
 */
export async function runWeeklyPass(db: DB, apiKey: string, todayDay: number, nowSec: number, opts: { monday?: number } = {}): Promise<WeeklyPassResult> {
  const monday = opts.monday ?? weeklyPassTarget(todayDay)
  if (monday == null) return { ran: false, key: null, monday: null, reason: 'not a pass day' }
  const block = await getActiveBlock(db)
  if (!block) return { ran: false, key: null, monday, reason: 'no active block' }
  const key = weeklyPassKey(block.id, monday)
  if (!(await claimPass(db, key, nowSec))) return { ran: false, key, monday, reason: 'already done' }

  const applied: string[] = []
  const errors: string[] = []
  const athleteVerdict: string | null = null
  let prepared: PrepareWeekResult | null = null
  try {
    prepared = await prepareWeek(db, apiKey, { blockId: block.id, monday, todayDay, nowSec, useAi: false })
  } catch (err) {
    errors.push('prepare')
    console.warn('[weeklyPass] prepare failed', err)
  }

  try {
    const signals = prepared?.analysis?.signals
    if (block.blockType === 'fighter' && signals?.waveEnd) {
      const tm = await applyTmUpdate(db, block, todayDay, nowSec)
      if (tm.changeId && !tm.idempotent) applied.push(tm.changeId)
    }
  } catch (err) {
    errors.push('tm')
    console.warn('[weeklyPass] TM update failed', err)
  }
  try {
    // Only when preparing next week: the slot it offers is next week's.
    if (monday > todayDay) {
      const id = await maybeMakeRegular(db, block, monday, todayDay, nowSec)
      if (id) applied.push(id)
    }
  } catch (err) {
    errors.push('make_regular')
    console.warn('[weeklyPass] make-regular failed', err)
  }

  const out = { status: errors.includes('prepare') ? 'failed' : 'done', monday, date: isoOf(monday), weekPlanId: prepared?.week.id ?? null, prepared: prepared?.prepared ?? false, source: prepared?.source ?? null, why: prepared?.week.whyLine ?? null, applied, athleteVerdict, errors }
  await db.update(coachingOutputs).set({ outputJson: JSON.stringify(out), scopeWeekPlanId: prepared?.week.id ?? null })
    .where(and(eq(coachingOutputs.kind, 'weekly_pass'), eq(coachingOutputs.inputHash, key)))
  console.log(`[weeklyPass] ${key} done: prepared=${out.prepared} source=${out.source} applied=${applied.length} errors=${errors.join(',') || 'none'}`)
  return { ran: true, key, monday, prepared: out.prepared, source: out.source ?? undefined, applied, athleteVerdict }
}

/**
 * The week line Program shows (page 56 item 16), always in the rules' plain
 * words: from the week's stored read when it has one, else from the block
 * and week alone. Weeks prepared before 0033 carry older wording in why_line;
 * this reads them the new way.
 */
export function weekLineFor(week: Pick<WeekPlanRow, 'weekNumber' | 'analysisJson'>, block: Pick<Block, 'blockType' | 'totalWeeks'>, rows: ReadonlyArray<Pick<SessionRow, 'id' | 'label' | 'contextJson'>> = [], estimates: ReadonlyArray<EstimateLike> | null = null): string {
  const stored = parseStored(week.analysisJson) as Partial<WeekIntelligence> | null
  const kind = blockKind(block.blockType)
  const signals: WeekSignals = stored?.version === 2 && stored.signals
    ? { ...stored.signals, weekNumber: week.weekNumber, blockType: kind, totalWeeks: block.totalWeeks }
    : {
      weekNumber: week.weekNumber, totalWeeks: block.totalWeeks, blockType: kind,
      lastWeek: { planned: 0, completed: 0, missed: 0, skipped: 0, added: 0 }, completionRate: null,
      load: { last7: 0, prev7: 0, changePct: null, flagged: false },
      readiness: { days: 0, flaggedDays: 0, easeDays: 0, freshDays: 0, oversleepFatigueDays: 0 },
      effort: summarizeEffort([]), avgSoreness: null, avgSleep: null,
      returnRamp: { active: false, gapDays: 0, reason: null }, retestLastWeek: false, waveEnd: false, athleteShape: null,
    }
  const eases = (stored?.version === 2 ? stored.changes ?? [] : [])
    // An ease he undid (the session no longer carries it) is not in the line.
    .filter(c => c.source === 'rules' && c.cause != null && (rows.length === 0 || hasCoachEase(rows.find(r => r.id === c.sessionId)?.contextJson)))
    .map(c => ({ cause: c.cause as NonNullable<WeekChange['cause']>, epochDay: c.epochDay, name: rows.find(r => r.id === c.sessionId)?.label ?? (c.type === 'strength' ? 'Strength' : c.type), type: c.type }))
  const leadIn = rows.length > 0 && rows.some(r => isLeadInContext(r.contextJson))
  // The coach's stored estimates: still finding his starting weights and run (audit 2026-10-23 #18).
  const starting = estimates != null && stillStarting(estimates)
  return whyThisWeek(signals, eases, { leadIn, starting })
}

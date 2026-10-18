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
//   3. The week stores one "why this week" line and per-change reasons
//      (week_plans.why_line, analysis_json v2, week_adjustments auto rows).
// No approval step: a prepared week is just shown.
// Then the pass: the athlete model (Sonnet, guarded, 10-day expiry), the
// training max proposal at a wave end, and an ask for sessions added 2+ weeks.

import { and, eq, gte, lte } from 'drizzle-orm'
import { blockTests, coachingOutputs, dailyLogs, sessions, settings, trainingBlocks, weekPlans } from '../db/schema'
import type { createDB } from '../db/client'
import {
  KEY_TYPES,
  claimDecision,
  houseLine,
  isoOf,
  summarizeEffort,
  weekRuleEases,
  weeklyPassKey,
  weeklyPassTarget,
  whyThisWeek,
  withCoachEase,
  mergeContext,
  placePlannedWeek,
  type PlacementContext,
  type WeekChange,
  type WeekIntelligence,
  type WeekSignals,
} from '../lib/coach'
import { checkInFromDailyLog, evaluateReadiness, weeklyLoadFlag } from '../lib/blockZero'
import { strengthBlockWeek } from '../lib/weeklyTemplate'
import { analyzeWeek, previousAnalysisFrom } from '../lib/weekAnalysis'
import { generateWeekPlan } from '../lib/weeklyPlanAI'
import { runAthleteState } from '../lib/athleteState/runAthleteState'
import { loadLatestAthleteState } from '../lib/athleteState/store'
import { getActiveBlock, loadRunHistory, loadSessionLoadEntries, readinessFor } from './blockZeroData'
import {
  blockKind,
  dayTemplateWithExtras,
  loadInjuryFlag,
  loadPlacementContext,
  loadTemplateExtras,
  mtClassDays,
  resolveWeekPlan,
  returnContextFor,
  trainingWeekFor,
  weekStamps,
} from './coachData'
import { loadEffortReads, maybeMakeRegularAsk, proposeTmUpdate, recordAutoChange } from './coachAsks'

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
    weekLogs.map(l => ({ logDate: l.logDate, sleepHours: l.sleepHours, soreness: l.soreness, weedGrams: l.weedGrams, alcoholScale: l.alcoholScale })),
    logs.filter(l => l.logDate >= prevStart - 7 && l.logDate < prevStart).map(l => ({ logDate: l.logDate, sleepHours: l.sleepHours, soreness: l.soreness, weedGrams: l.weedGrams, alcoholScale: l.alcoholScale })),
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

export async function prepareWeek(db: DB, apiKey: string, opts: PrepareWeekOptions): Promise<PrepareWeekResult | null> {
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

  const mtDays = await mtClassDays(db)
  const extras = await loadTemplateExtras(db, block.id)
  const { signals, analysis } = await loadWeekSignals(db, block, monday, todayDay)
  const template: Planned[] = []
  for (let d = monday; d <= monday + 6; d++) {
    for (const t of dayTemplateWithExtras(block.blockType, stamps.weekNumber, new Date(d * DAY_SEC * 1000).getUTCDay(), mtDays, extras)) {
      template.push({ type: t.type, label: isBlockZero || 'extra' in t ? t.label : null, notes: t.runCategory ?? null, epochDay: d, timeSlot: t.timeSlot, estimatedMin: null, why: null, extra: 'extra' in t })
    }
  }

  // 1. The planner.
  let source: 'ai' | 'rules' = 'rules'
  let planned: Planned[] = template
  const dropped: WeekIntelligence['dropped'] = []
  let narrative: string | null = null
  let adjustmentNotes: string | null = null
  const aiPlan = opts.useAi
    ? await generateWeekPlan(db, apiKey, {
      blockId: block.id, weekId, weekNumber: stamps.weekNumber, blockWeek: stamps.strengthWeek, isBlockZero,
      mtClassDays: mtDays, prevWeekStart: monday - 7, prevWeekEnd: monday - 1, coachContext: serializeWeekSignals(signals),
    }).catch(err => { console.warn('[weeklyPass] planner failed', err); return null })
    : null
  if (aiPlan && Array.isArray(aiPlan.days)) {
    source = 'ai'
    narrative = aiPlan.narrative ?? null
    adjustmentNotes = aiPlan.adjustmentNotes ?? null
    const fromAi: Planned[] = []
    for (const day of aiPlan.days) {
      if (!Number.isInteger(day?.dayOfWeek)) continue
      const epochDay = monday + ((day.dayOfWeek + 6) % 7)
      for (const e of Array.isArray(day.sessions) ? day.sessions : []) {
        // Block Zero never schedules classes; Fighter only on class days.
        if (e.type === 'mt_class' && (isBlockZero || !mtDays.has(day.dayOfWeek))) continue
        fromAi.push({ type: e.type, label: isBlockZero ? e.label : null, notes: e.runCategory ?? null, epochDay, timeSlot: e.timeSlot === 'pm' ? 'pm' : 'am', estimatedMin: e.estimatedMin ?? null, why: e.notes ? houseLine(e.notes, 140) : null })
      }
    }
    // Sessions made regular stay in the plan unless the planner kept them already.
    for (const x of template.filter(t => t.extra)) {
      if (!fromAi.some(p => p.epochDay === x.epochDay && p.type === x.type)) fromAi.push(x)
    }
    planned = fromAi
  }

  // Fighter: E1 placement for everything that differs from the template (the
  // AI's added or moved sessions, sessions made regular). The template's own
  // sessions are the rules' week and stay.
  if (!isBlockZero && (source === 'ai' || planned.some(p => p.extra))) {
    const base = await loadPlacementContext(db, monday, todayDay)
    const ctx: PlacementContext = { ...base, todayEpochDay: Math.min(todayDay, monday), readinessEase: false, easeDays: [], run: await loadRunHistory(db, monday) }
    const placed = placePlannedWeek(planned, template.filter(t => !t.extra), ctx, Math.max(todayDay, monday))
    planned = placed.accepted
    for (const d of placed.dropped) dropped.push({ type: d.entry.type, epochDay: d.entry.epochDay, reason: d.reason })
  }

  // 2. The rules: small eases with a reason.
  const eases = weekRuleEases(signals, planned.map(p => ({ type: p.type, label: p.label, notes: p.notes, epochDay: p.epochDay, timeSlot: p.timeSlot, estimatedMin: p.estimatedMin })))
  const easeBy = new Map(eases.map(e => [e.index, e]))

  // 3. Insert, with reasons.
  const ids: string[] = []
  const changes: WeekChange[] = []
  for (let i = 0; i < planned.length; i++) {
    const p = planned[i]
    const id = crypto.randomUUID()
    ids.push(id)
    const ease = easeBy.get(i)
    let ctxJson: string | null = null
    if (p.why || p.extra) ctxJson = mergeContext(null, { coachNote: { reason: p.why ?? 'Part of the plan since you made it regular.', source: p.extra ? 'make_regular' : 'planner', at: nowSec } })
    if (ease) ctxJson = withCoachEase(ctxJson, { kind: ease.kind, reason: ease.reason, source: 'reactive', at: nowSec })
    await db.insert(sessions).values({
      id,
      type: p.type,
      label: p.label,
      weekPlanId: weekId,
      scheduledDate: p.epochDay,
      timeSlot: p.timeSlot,
      blockWeek: p.type === 'strength' ? stamps.strengthWeek : null,
      blockType: block.blockType,
      status: 'planned',
      notes: p.notes,
      source: 'template',
      contextJson: ctxJson,
      createdAt: nowSec,
    })
    if (ease) {
      await recordAutoChange(db, { weekPlanId: weekId, adjustmentType: 'weekly_ease', sessionType: p.type, action: 'ease', reason: ease.reason, targetSessionId: id, targetEpochDay: p.epochDay, timeSlot: p.timeSlot, was: ease.was, now: ease.now, detail: { cause: ease.cause }, nowSec })
      changes.push({ sessionId: id, epochDay: p.epochDay, type: p.type, reason: ease.reason, was: ease.was, now: ease.now, source: 'rules' })
    } else if (p.why) {
      changes.push({ sessionId: id, epochDay: p.epochDay, type: p.type, reason: p.why, was: null, now: null, source: 'ai' })
    }
  }
  for (const d of dropped) changes.push({ sessionId: null, epochDay: d.epochDay, type: d.type, reason: `Dropped ${isoOf(d.epochDay)}: ${d.reason}`, was: null, now: null, source: 'placement' })

  const rulesWhy = whyThisWeek(signals, eases)
  const aiWhy = adjustmentNotes || narrative
  const why = source === 'ai' && aiWhy ? houseLine(aiWhy) : rulesWhy
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
  asks?: string[]
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

  const asks: string[] = []
  const errors: string[] = []
  // The athlete model first, so its read shapes the week (within the rules).
  let athleteVerdict: string | null = null
  try {
    const ret = await returnContextFor(db, todayDay)
    const injury = await loadInjuryFlag(db, todayDay)
    const report = await readinessFor(db, todayDay)
    const r = await runAthleteState(db, apiKey, 'weekly_pass', todayDay, { noPush: ret.active || ret.noPush || injury != null, easeActive: report.ease })
    athleteVerdict = r?.state.verdict ?? null
  } catch (err) {
    errors.push('athlete_state')
    console.warn('[weeklyPass] athlete state failed', err)
  }

  let prepared: PrepareWeekResult | null = null
  try {
    prepared = await prepareWeek(db, apiKey, { blockId: block.id, monday, todayDay, nowSec, useAi: true })
  } catch (err) {
    errors.push('prepare')
    console.warn('[weeklyPass] prepare failed', err)
  }

  try {
    const signals = prepared?.analysis?.signals
    if (block.blockType === 'fighter' && signals?.waveEnd) {
      const tm = await proposeTmUpdate(db, block, todayDay, nowSec)
      if (tm.adjustmentId && !tm.idempotent) asks.push(tm.adjustmentId)
    }
  } catch (err) {
    errors.push('tm')
    console.warn('[weeklyPass] TM proposal failed', err)
  }
  try {
    // Only when preparing next week: the slot it offers is next week's.
    if (monday > todayDay) {
      const id = await maybeMakeRegularAsk(db, block, monday, todayDay, nowSec)
      if (id) asks.push(id)
    }
  } catch (err) {
    errors.push('make_regular')
    console.warn('[weeklyPass] make-regular ask failed', err)
  }

  const out = { status: errors.includes('prepare') ? 'failed' : 'done', monday, date: isoOf(monday), weekPlanId: prepared?.week.id ?? null, prepared: prepared?.prepared ?? false, source: prepared?.source ?? null, why: prepared?.week.whyLine ?? null, asks, athleteVerdict, errors }
  await db.update(coachingOutputs).set({ outputJson: JSON.stringify(out), scopeWeekPlanId: prepared?.week.id ?? null })
    .where(and(eq(coachingOutputs.kind, 'weekly_pass'), eq(coachingOutputs.inputHash, key)))
  console.log(`[weeklyPass] ${key} done: prepared=${out.prepared} source=${out.source} asks=${asks.length} errors=${errors.join(',') || 'none'}`)
  return { ran: true, key, monday, prepared: out.prepared, source: out.source ?? undefined, asks, athleteVerdict }
}

/** Last time the athlete opened the app (settings.coach_seen_at). */
export async function coachSeenAt(db: DB): Promise<number | null> {
  const [row] = await db.select({ seen: settings.coachSeenAt }).from(settings)
  return row?.seen ?? null
}

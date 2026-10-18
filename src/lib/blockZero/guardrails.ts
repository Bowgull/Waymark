// Block Zero guardrails. Every AI output that touches Block Zero training goes
// through here before it is stored or applied. The rules module sets the
// limits; the AI only chooses inside them. Violations are clamped or dropped,
// never answered by adding training the rules didn't plan.
//
// Each clamp carries a machine code + detail (logs, stored JSON) and a one-line
// human reason in the house voice: short sentences, no exclamation marks, no
// em dashes. Pure: callers pass context in and log/store the clamps.

import type {
  PlannedSession as AiPlannedSession,
  ReactiveReplanOutput,
  ReplaceSuggestion,
  ReplaceSuggestionsOutput,
  SessionType,
  WeekPlanOutput,
} from '../prompts/tools'
import { easeSession } from './autoEase'
import { evaluateClassRequest, normaliseClassType, type MtClassType } from './muayThai'
import { RESTART_WEEKLY_SEC, WEEKLY_RUN_CAP_RATIO, getRunWalkWeek, runWalkTotalSec, singleRunCap } from './running'
import type { NextLoad, WorkingLoad } from './strength'
import { getBlockZeroWeekTemplate, type BlockZeroTemplateSession } from './weekPlan'
import { BLOCK_ZERO_BASE_WEEKS, blockZeroPhase } from './weeks'
import { FOUNDATION_LABEL } from '../foundation'
import { lbText } from '../units'

export const GUARDRAIL_TAG = '[bz-guardrail]'

export type ClampCode =
  | 'mt_class_dropped'
  | 'mt_class_type'
  | 'mt_class_cap'
  | 'off_template'
  | 'rest_day'
  | 'strength_day'
  | 'strength_label'
  | 'strength_same_day'
  | 'strength_back_to_back'
  | 'strength_order'
  | 'test_week'
  | 'back_care'
  | 'duration'
  | 'run_type'
  | 'run_same_day'
  | 'run_single_cap'
  | 'run_weekly_cap'
  | 'ease_day'
  | 'load_flag'
  | 'bad_day'
  | 'load_cap'
  | 'calibration_cap'
  | 'calibration_untested'
  | 'mt_cap'
  | 'suggestion_fallback'
  | 'voice'

export interface Clamp {
  code: ClampCode
  /** Machine detail: where and what, e.g. "dow=2 type=mt_class". */
  detail: string
  /** One line, house voice. */
  reason: string
}

export interface Guarded<T> {
  output: T
  clamps: Clamp[]
}

/** console.warn every clamp under one stable tag, so they can be grepped. */
export function logClamps(source: string, clamps: Clamp[]): void {
  for (const c of clamps) console.warn(`${GUARDRAIL_TAG} ${source} ${c.code} ${c.detail}`)
}

/** What gets stored next to the output in coaching_outputs. */
export function clampsForStorage(clamps: Clamp[]): { applied: boolean; clamps: Clamp[] } {
  return { applied: clamps.length > 0, clamps }
}

// ─── House voice ──────────────────────────────────────────────

/** No em/en dashes, no exclamation marks. Cheap insurance on AI text. */
export function houseVoice(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ', ').replace(/!+/g, '.').replace(/\.{2,}/g, '.').replace(/\s{2,}/g, ' ').trim()
}

function voiced(s: string | undefined, field: string, clamps: Clamp[]): string | undefined {
  if (s == null) return s
  const clean = houseVoice(s)
  if (clean !== s.trim()) clamps.push({ code: 'voice', detail: field, reason: 'Text cleaned to the house voice.' })
  return clean
}

// ─── Shared limits ────────────────────────────────────────────

export const HARD_TYPES: ReadonlySet<string> = new Set(['strength', 'foundation_run', 'running', 'skip_rope', 'bag_work', 'mt_class'])
const RUN_TYPES: ReadonlySet<string> = new Set(['foundation_run', 'running'])

/** Sane minutes per session type. Runs are also bounded by the plan and the caps. */
export const DURATION_BOUNDS: Readonly<Record<string, [number, number]>> = {
  strength: [20, 90],
  foundation_run: [5, 45],
  running: [5, 45],
  skip_rope: [5, 30],
  bag_work: [10, 45],
  mt_class: [30, 90],
  mobility: [5, 30],
  active_recovery: [10, 45],
}

function clampMin(type: string, min: number, upper?: number): number {
  const [lo, hi] = DURATION_BOUNDS[type] ?? [5, 90]
  const top = Math.max(lo, Math.min(hi, upper ?? hi))
  const n = Number.isFinite(min) ? Math.round(min) : lo
  return Math.min(top, Math.max(lo, n))
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Sunday in the Block Zero template: Foundation only. */
export function isBlockZeroRestDay(weekNumber: number, dow: number): boolean {
  const day = getBlockZeroWeekTemplate(weekNumber)[dow] ?? []
  return day.every(s => s.type === 'mobility')
}

function isTestWeekNumber(weekNumber: number): boolean {
  const phase = blockZeroPhase(weekNumber)
  return phase === 'test' || (phase === 'consolidate' && weekNumber === BLOCK_ZERO_BASE_WEEKS)
}

// ─── Week planner (WeekPlanOutput) ────────────────────────────

export interface RunHistory {
  /** Longest completed run in the last 30 days, seconds. Null or 0 = none. */
  longestLast30Sec: number | null
  /** Completed run time last Monday-Sunday week, seconds. */
  lastWeekRunSec: number
  /** Completed run time this week so far, seconds. */
  thisWeekRunSec?: number
}

export interface WeekPlanGuardInput {
  /** Block week (extension weeks 7-8 included). */
  weekNumber: number
  run?: RunHistory | null
}

function toAiSession(t: BlockZeroTemplateSession): AiPlannedSession {
  return { type: t.type as SessionType, timeSlot: t.timeSlot, label: t.label, estimatedMin: t.estimatedMin }
}

const STRENGTH_FIRST: Record<string, number> = { mobility: 0, strength: 1 }

/**
 * Clamp a Block Zero week plan to the rules' week: no classes, Strength A/B/C
 * on Mon/Wed/Fri with their labels, run-walk on Tue/Thu/Sat (rope allowed where
 * the template allows it), Foundation daily, Sunday rest, minutes inside the
 * plan and the run caps. The AI may drop or soften a session; it may not add
 * one or move one to another day. Test weeks keep every test session.
 */
export function guardWeekPlan(plan: WeekPlanOutput, input: WeekPlanGuardInput): Guarded<WeekPlanOutput> {
  const clamps: Clamp[] = []
  const template = getBlockZeroWeekTemplate(input.weekNumber)
  const testWeek = isTestWeekNumber(input.weekNumber)

  const byDow = new Map<number, AiPlannedSession[]>()
  for (const day of Array.isArray(plan.days) ? plan.days : []) {
    const dow = day?.dayOfWeek
    const list = Array.isArray(day?.sessions) ? day.sessions : []
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      if (list.length > 0) clamps.push({ code: 'bad_day', detail: `dow=${String(dow)}`, reason: 'A day outside the week was dropped.' })
      continue
    }
    byDow.set(dow, [...(byDow.get(dow) ?? []), ...list])
  }

  const days: WeekPlanOutput['days'] = []
  for (let dow = 0; dow <= 6; dow++) {
    const slots = (template[dow] ?? []).map(t => ({ t, used: false }))
    const kept: AiPlannedSession[] = []
    for (const raw of byDow.get(dow) ?? []) {
      if (!raw || typeof raw.type !== 'string') continue
      let s: AiPlannedSession = { ...raw }
      if (s.type === 'mt_class') {
        clamps.push({ code: 'mt_class_dropped', detail: `dow=${dow} label=${s.label ?? ''}`, reason: 'No muay thai in the plan. Classes are yours to add.' })
        continue
      }
      if (s.type === 'running' && slots.some(x => !x.used && RUN_TYPES.has(x.t.type))) {
        clamps.push({ code: 'run_type', detail: `dow=${dow}`, reason: 'Runs in Block Zero are run-walks.' })
        s = { ...s, type: 'foundation_run', label: 'Run-Walk' }
        delete s.runCategory
      }
      const exact = slots.find(x => !x.used && (x.t.type === s.type || x.t.alternativeType === s.type))
      if (exact) {
        exact.used = true
        const t = exact.t
        if (t.type === 'strength' && s.label !== t.label) {
          clamps.push({ code: 'strength_label', detail: `dow=${dow} label=${s.label ?? ''} -> ${t.label}`, reason: `${DOW[dow]} is ${t.label}. The label stays.` })
          s.label = t.label
        }
        const upper = RUN_TYPES.has(s.type)
          ? t.estimatedMin
          : s.type === 'strength' ? t.estimatedMin + 15 : undefined
        const min = clampMin(s.type, s.estimatedMin, upper)
        if (min !== s.estimatedMin) {
          clamps.push({ code: 'duration', detail: `dow=${dow} type=${s.type} min=${s.estimatedMin} -> ${min}`, reason: `${DOW[dow]} ${s.label} set to ${min} min, inside the plan.` })
          s.estimatedMin = min
        }
        kept.push(s)
        continue
      }
      const softer = (s.type === 'mobility' || s.type === 'active_recovery') && !isBlockZeroRestDay(input.weekNumber, dow)
        ? slots.find(x => !x.used && HARD_TYPES.has(x.t.type))
        : undefined
      if (softer && !(testWeek && softer.t.type === 'strength')) {
        softer.used = true
        const min = clampMin(s.type, s.estimatedMin)
        kept.push({ ...s, estimatedMin: min })
        continue
      }
      if (isBlockZeroRestDay(input.weekNumber, dow)) {
        clamps.push({ code: 'rest_day', detail: `dow=${dow} type=${s.type}`, reason: 'Sunday is the rest day. Foundation only.' })
      } else if (s.type === 'strength') {
        clamps.push({ code: 'strength_day', detail: `dow=${dow}`, reason: 'Strength stays on Mon, Wed and Fri. Never two days in a row.' })
      } else {
        clamps.push({ code: 'off_template', detail: `dow=${dow} type=${s.type}`, reason: `${DOW[dow]} has no slot for ${s.label || s.type}. Nothing added past the plan.` })
      }
    }

    // Foundation is the daily habit; test weeks keep every test session.
    for (const x of slots) {
      if (x.used) continue
      if (x.t.type === 'mobility') {
        kept.unshift(toAiSession(x.t))
        clamps.push({ code: 'back_care', detail: `dow=${dow}`, reason: 'Foundation stays every day.' })
      } else if (testWeek) {
        kept.push(toAiSession(x.t))
        clamps.push({ code: 'test_week', detail: `dow=${dow} type=${x.t.type}`, reason: 'Test week. Every test session stays in.' })
      }
    }

    // R15: strength before anything else on a shared day.
    const strength = kept.find(s => s.type === 'strength')
    if (strength) {
      const before = kept.map(s => s.type).join(',')
      kept.sort((a, b) => (STRENGTH_FIRST[a.type] ?? 2) - (STRENGTH_FIRST[b.type] ?? 2))
      const others = kept.filter(s => s !== strength && HARD_TYPES.has(s.type))
      if (strength.timeSlot === 'pm' && others.some(s => s.timeSlot === 'am')) {
        strength.timeSlot = 'am'
        for (const o of others) o.timeSlot = 'pm'
        clamps.push({ code: 'strength_order', detail: `dow=${dow}`, reason: 'Strength comes first on a shared day.' })
      } else if (before !== kept.map(s => s.type).join(',') && others.length > 0) {
        clamps.push({ code: 'strength_order', detail: `dow=${dow}`, reason: 'Strength comes first on a shared day.' })
      }
    }

    days.push({ dayOfWeek: dow, sessions: kept.map(s => (s.notes != null ? { ...s, notes: voiced(s.notes, `notes dow=${dow}`, clamps) } : s)) })
  }

  // R7 / R8 on the plan's runs, in day order (Mon first).
  if (input.run) {
    const order = [1, 2, 3, 4, 5, 6, 0]
    const runs = order.flatMap(d => (days.find(x => x.dayOfWeek === d)?.sessions ?? []).filter(s => RUN_TYPES.has(s.type)).map(s => ({ d, s })))
    const allowance = input.run.lastWeekRunSec > 0 ? Math.floor(input.run.lastWeekRunSec * WEEKLY_RUN_CAP_RATIO) : RESTART_WEEKLY_SEC
    let budget = Math.max(0, allowance - (input.run.thisWeekRunSec ?? 0))
    runs.forEach(({ d, s }, i) => {
      const single = Math.floor(singleRunCap(s.estimatedMin * 60, input.run?.longestLast30Sec ?? null).capSec / 60)
      const perSession = Math.floor(budget / Math.max(1, runs.length - i) / 60)
      const capMin = Math.max(DURATION_BOUNDS[s.type][0], Math.min(single, perSession))
      if (s.estimatedMin > capMin) {
        const weekly = perSession < single
        clamps.push({
          code: weekly ? 'run_weekly_cap' : 'run_single_cap',
          detail: `dow=${d} min=${s.estimatedMin} -> ${capMin}`,
          reason: weekly ? 'Run time this week stays within 30% of last week.' : 'Capped at 110% of your longest run in 30 days.',
        })
        s.estimatedMin = capMin
      }
      budget = Math.max(0, budget - s.estimatedMin * 60)
    })
  }

  if (plan.mtSessionsThisWeek !== 0) {
    clamps.push({ code: 'mt_class_dropped', detail: `mtSessionsThisWeek=${String(plan.mtSessionsThisWeek)}`, reason: 'No muay thai in the plan. Classes are yours to add.' })
  }

  const output: WeekPlanOutput = {
    ...plan,
    narrative: voiced(plan.narrative ?? '', 'narrative', clamps) ?? '',
    days,
    mtSessionsThisWeek: 0,
  }
  if (plan.adjustmentNotes != null) output.adjustmentNotes = voiced(plan.adjustmentNotes, 'adjustmentNotes', clamps)
  return { output, clamps }
}

// ─── Mid-week placements (reactive replan, replace suggestions) ──

export interface GuardSession {
  id?: string
  type: string
  epochDay: number
  timeSlot: 'am' | 'pm'
  status: string
  label?: string | null
}

export interface BlockZeroGuardContext {
  /** Block week today falls in (7-8 = extension). */
  weekNumber: number
  todayEpochDay: number
  /** Sessions around today (at least the day before this week to the day after). */
  sessions: GuardSession[]
  /** Readiness ease today (R10). */
  readinessEase: boolean
  /** Weekly sRPE load flag (R5). */
  loadFlag: boolean
  /** One-line reason from the readiness / load read. */
  easeReason: string | null
  run: RunHistory
  mt: { weeksSinceFirstClass: number | null; classesThisWeek: number; profileCap: number | null }
}

const LIVE = new Set(['planned', 'in_progress', 'completed'])

export function dowOf(epochDay: number): number {
  return new Date(epochDay * 86400000).getUTCDay()
}

function mondayOf(epochDay: number): number {
  return epochDay - ((dowOf(epochDay) + 6) % 7)
}

/** Class type a free-text label implies. Unknown reads as a general class. */
export function classTypeFromLabel(label: string | null | undefined): MtClassType {
  const words = (label ?? '').toLowerCase()
  if (/spar/.test(words)) return 'sparring'
  if (/clinch/.test(words)) return 'clinch'
  if (/pad|bag/.test(words)) return 'padwork'
  if (/techni|drill|fundament/.test(words)) return 'technical'
  return normaliseClassType(words) ?? 'general'
}

const CLASS_LABEL: Record<MtClassType, string> = {
  technical: 'MT Technique',
  padwork: 'MT Pads',
  clinch: 'MT Clinch (light)',
  general: 'MT Class',
  sparring: 'MT Sparring',
}

export interface Placement {
  type: string
  label: string
  epochDay: number
  timeSlot: 'am' | 'pm'
  estimatedMin?: number
  /** The session this one replaces or moves away from. */
  removedSessionId?: string | null
  /** True when this puts new load into the week (swap, add); false for a move. */
  adds: boolean
}

export type PlacementResult =
  | { ok: true; placement: Placement; clamps: Clamp[] }
  | { ok: false; clamp: Clamp; clamps: Clamp[] }

function weekRunSec(weekNumber: number): number {
  return runWalkTotalSec(getRunWalkWeek(weekNumber))
}

/**
 * Check one session placed on a day against the rules. Returns the placement
 * (possibly clamped: class type, time slot, minutes) or a refusal.
 */
export function checkPlacement(p: Placement, ctx: BlockZeroGuardContext): PlacementResult {
  const clamps: Clamp[] = []
  const dow = dowOf(p.epochDay)
  const where = `day=${DOW[dow]} type=${p.type}`
  const refuse = (code: ClampCode, reason: string, extra = ''): PlacementResult => ({ ok: false, clamp: { code, detail: `${where}${extra}`, reason }, clamps })
  let next: Placement = { ...p }

  if (p.epochDay < ctx.todayEpochDay) return refuse('bad_day', 'That day has passed. Nothing changes.')

  const around = ctx.sessions.filter(s => s.id == null || s.id !== p.removedSessionId).filter(s => LIVE.has(s.status))
  const sameDay = around.filter(s => s.epochDay === p.epochDay)
  const hard = HARD_TYPES.has(p.type)

  if (hard && isBlockZeroRestDay(ctx.weekNumber, dow)) return refuse('rest_day', 'Sunday is the rest day. Foundation only.')

  // Overreach: the rules' auto-ease wins over any added hard work.
  const easeToday = ctx.readinessEase && p.epochDay === ctx.todayEpochDay
  if (hard && (easeToday || ctx.loadFlag)) {
    const code: ClampCode = easeToday ? 'ease_day' : 'load_flag'
    const eased = easeSession(
      { type: p.type, label: p.label, timeSlot: p.timeSlot, estimatedMin: p.estimatedMin ?? 30 },
      { readinessEase: easeToday, readinessReason: easeToday ? ctx.easeReason : null, loadFlag: ctx.loadFlag, loadReason: ctx.loadFlag ? ctx.easeReason : null },
    )
    if (eased.eased && !HARD_TYPES.has(eased.session.type)) {
      clamps.push({ code, detail: `${where} -> ${eased.session.type}`, reason: eased.reason ?? 'Easy day. The run becomes a walk or bike.' })
      next = { ...next, type: eased.session.type, label: eased.session.label, estimatedMin: p.estimatedMin != null ? clampMin(eased.session.type, eased.session.estimatedMin) : undefined }
      return { ok: true, placement: next, clamps }
    }
    return refuse(code, easeToday ? 'Check-ins say ease today. No hard sessions added.' : 'Load is past the guide this week. No hard sessions added.')
  }

  if (p.type === 'mt_class') {
    const wanted = classTypeFromLabel(p.label)
    const decision = evaluateClassRequest({
      classType: wanted,
      weeksSinceFirstClass: ctx.mt.weeksSinceFirstClass,
      classesThisWeek: p.adds ? ctx.mt.classesThisWeek : Math.max(0, ctx.mt.classesThisWeek - 1),
      profileCap: ctx.mt.profileCap,
    })
    if (!decision.allowed && decision.suggestedType) {
      const label = CLASS_LABEL[decision.suggestedType]
      clamps.push({ code: 'mt_class_type', detail: `${where} class=${wanted} -> ${decision.suggestedType}`, reason: decision.reason })
      next = { ...next, label }
    } else if (!decision.allowed) {
      return refuse('mt_class_cap', decision.reason)
    }
    if (sameDay.some(s => s.type === 'strength') && next.timeSlot !== 'pm') {
      clamps.push({ code: 'strength_order', detail: `${where} slot=${next.timeSlot} -> pm`, reason: 'Strength comes first. The class goes in the evening.' })
      next = { ...next, timeSlot: 'pm' }
    }
  }

  if (p.type === 'strength') {
    if (sameDay.some(s => s.type === 'strength')) return refuse('strength_same_day', 'One strength session a day.')
    if (around.some(s => s.type === 'strength' && Math.abs(s.epochDay - p.epochDay) === 1)) {
      return refuse('strength_back_to_back', 'No strength days back to back. Legs and back need the day between.')
    }
    const runs = sameDay.filter(s => RUN_TYPES.has(s.type) || s.type === 'mt_class')
    if (runs.some(s => s.status === 'completed' || s.timeSlot === 'am')) {
      return refuse('strength_order', 'Strength comes before running on a shared day.')
    }
    if (runs.length > 0 && next.timeSlot !== 'am') {
      clamps.push({ code: 'strength_order', detail: `${where} slot=pm -> am`, reason: 'Strength comes first on a shared day.' })
      next = { ...next, timeSlot: 'am' }
    }
  }

  if (RUN_TYPES.has(p.type)) {
    if (p.type === 'running') {
      clamps.push({ code: 'run_type', detail: where, reason: 'Runs in Block Zero are run-walks.' })
      next = { ...next, type: 'foundation_run', label: 'Run-Walk' }
    }
    if (sameDay.some(s => RUN_TYPES.has(s.type))) return refuse('run_same_day', 'One run a day.')
    const strength = sameDay.find(s => s.type === 'strength' && s.status !== 'completed')
    if (strength) {
      if (strength.timeSlot === 'pm') return refuse('strength_order', 'Strength comes before running on a shared day.')
      if (next.timeSlot !== 'pm') {
        clamps.push({ code: 'strength_order', detail: `${where} slot=am -> pm`, reason: 'Strength comes first. The run goes after.' })
        next = { ...next, timeSlot: 'pm' }
      }
    }

    // R7: single-run cap.
    const plannedSec = next.estimatedMin != null ? next.estimatedMin * 60 : weekRunSec(ctx.weekNumber)
    const single = singleRunCap(plannedSec, ctx.run.longestLast30Sec)
    let capSec = single.capSec
    let capCode: ClampCode = 'run_single_cap'
    let capReason = single.reason ?? 'Capped at 110% of your longest run in 30 days.'

    // R8: weekly cap, only when the change adds a run to the week.
    if (p.adds) {
      const monday = mondayOf(ctx.todayEpochDay)
      const allowance = ctx.run.lastWeekRunSec > 0 ? Math.floor(ctx.run.lastWeekRunSec * WEEKLY_RUN_CAP_RATIO) : RESTART_WEEKLY_SEC
      const stillPlanned = around.filter(s => RUN_TYPES.has(s.type) && s.status !== 'completed' && s.epochDay >= ctx.todayEpochDay && s.epochDay <= monday + 6).length
      const room = allowance - (ctx.run.thisWeekRunSec ?? 0) - stillPlanned * weekRunSec(ctx.weekNumber)
      if (room < capSec) {
        capSec = Math.max(0, room)
        capCode = 'run_weekly_cap'
        capReason = ctx.run.lastWeekRunSec > 0 ? 'Run time this week stays within 30% of last week.' : 'No running last week. This week stays at week-1 volume.'
      }
    }

    if (plannedSec > capSec) {
      const capMin = Math.floor(capSec / 60)
      // A suggestion with minutes can shrink; a run with no room, or a replan
      // that can't carry minutes, is refused.
      if (next.estimatedMin == null || capMin < DURATION_BOUNDS.foundation_run[0] * 2) return refuse(capCode, capReason, ` sec=${plannedSec} cap=${capSec}`)
      clamps.push({ code: capCode, detail: `${where} min=${next.estimatedMin} -> ${capMin}`, reason: capReason })
      next = { ...next, estimatedMin: capMin }
    }
  }

  if (next.estimatedMin != null) {
    const min = clampMin(next.type, next.estimatedMin)
    if (min !== next.estimatedMin) {
      clamps.push({ code: 'duration', detail: `${where} min=${next.estimatedMin} -> ${min}`, reason: `${next.label} set to ${min} min.` })
      next = { ...next, estimatedMin: min }
    }
  }
  return { ok: true, placement: next, clamps }
}

// ─── Reactive replan (ReactiveReplanOutput) ───────────────────

/** A 0=Sun..6=Sat day as an epoch day from today through this Sunday (plans run Monday-Sunday). Null when outside. */
function dayInPlanWeek(todayEpochDay: number, dow: number): number | null {
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null
  const day = todayEpochDay + ((dow - dowOf(todayEpochDay) + 7) % 7)
  return day <= mondayOf(todayEpochDay) + 6 ? day : null
}

function findOriginal(output: ReactiveReplanOutput, ctx: BlockZeroGuardContext): GuardSession | null {
  if (output.originalSessionId) {
    const byId = ctx.sessions.find(s => s.id === output.originalSessionId)
    if (byId) return byId
  }
  if (output.shiftAction !== 'move' && output.shiftAction !== 'swap') return null
  return ctx.sessions
    .filter(s => s.status === 'planned' && s.epochDay >= ctx.todayEpochDay && (output.shiftAction === 'swap' || s.type === output.targetSessionType))
    .sort((a, b) => a.epochDay - b.epochDay)[0] ?? null
}

/**
 * The rules' answer when a replan is refused. Overreach prefers the rules'
 * auto-ease on the next hard session; otherwise the week holds.
 */
function safeReplan(output: ReactiveReplanOutput, ctx: BlockZeroGuardContext, clamp: Clamp): ReactiveReplanOutput {
  if (ctx.readinessEase || ctx.loadFlag) {
    const target = ctx.sessions
      .filter(s => s.status === 'planned' && HARD_TYPES.has(s.type) && s.epochDay >= ctx.todayEpochDay)
      .sort((a, b) => a.epochDay - b.epochDay || (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1))[0]
    if (target) {
      const eased = easeSession(
        { type: target.type, label: target.label ?? target.type, timeSlot: target.timeSlot, estimatedMin: 45 },
        { readinessEase: ctx.readinessEase, readinessReason: ctx.easeReason, loadFlag: ctx.loadFlag, loadReason: ctx.easeReason },
      )
      const reason = eased.reason ?? clamp.reason
      return {
        note: reason,
        shiftAction: 'reduce_intensity',
        shiftReason: reason,
        targetSessionType: target.type as SessionType,
        targetLabel: target.label ?? output.targetLabel,
        targetDay: dowOf(target.epochDay),
        targetTimeSlot: target.timeSlot,
        ...(target.id ? { originalSessionId: target.id } : {}),
      }
    }
  }
  const original = findOriginal(output, ctx)
  return {
    note: clamp.reason,
    shiftAction: 'hold',
    shiftReason: clamp.reason,
    targetSessionType: (original?.type ?? (output.targetSessionType === 'mt_class' ? 'mobility' : output.targetSessionType)) as SessionType,
    targetLabel: original?.label ?? (output.targetSessionType === 'mt_class' ? FOUNDATION_LABEL : output.targetLabel),
    targetDay: Number.isInteger(output.targetDay) && dayInPlanWeek(ctx.todayEpochDay, output.targetDay) != null ? output.targetDay : dowOf(ctx.todayEpochDay),
    targetTimeSlot: output.targetTimeSlot === 'pm' ? 'pm' : 'am',
    ...(original?.id ? { originalSessionId: original.id } : {}),
  }
}

/**
 * Guard one reactive replan. hold passes; reduce_intensity passes (a class
 * target keeps to the ramp's class types); swap / move / add_recovery place a
 * session and go through checkPlacement. A refusal becomes the rules' safe
 * answer with the refusal's reason as the one-line why.
 */
export function guardReactiveReplan(output: ReactiveReplanOutput, ctx: BlockZeroGuardContext): Guarded<ReactiveReplanOutput> {
  const clamps: Clamp[] = []
  const out: ReactiveReplanOutput = {
    ...output,
    note: voiced(output.note ?? '', 'note', clamps) ?? '',
    shiftReason: voiced(output.shiftReason ?? '', 'shiftReason', clamps) ?? '',
  }
  const action = out.shiftAction

  if (action === 'hold') return { output: out, clamps }

  if (action === 'reduce_intensity') {
    if (out.targetSessionType === 'mt_class') {
      const wanted = classTypeFromLabel(out.targetLabel)
      const decision = evaluateClassRequest({ classType: wanted, weeksSinceFirstClass: ctx.mt.weeksSinceFirstClass, classesThisWeek: 0, profileCap: null })
      if (!decision.allowed && decision.suggestedType) {
        clamps.push({ code: 'mt_class_type', detail: `class=${wanted} -> ${decision.suggestedType}`, reason: decision.reason })
        out.targetLabel = CLASS_LABEL[decision.suggestedType]
      }
    }
    return { output: out, clamps }
  }

  const todayDow = dowOf(ctx.todayEpochDay)
  const targetEpochDay = dayInPlanWeek(ctx.todayEpochDay, out.targetDay)
  if (targetEpochDay == null) {
    const clamp: Clamp = { code: 'bad_day', detail: `targetDay=${String(out.targetDay)} today=${todayDow}`, reason: 'That day is outside this week. Nothing changes.' }
    clamps.push(clamp)
    return { output: safeReplan(out, ctx, clamp), clamps }
  }

  const original = action === 'add_recovery' ? null : findOriginal(out, ctx)
  const type = action === 'move' && original ? original.type : out.targetSessionType
  const result = checkPlacement({
    type,
    label: out.targetLabel,
    epochDay: targetEpochDay,
    timeSlot: out.targetTimeSlot === 'pm' ? 'pm' : 'am',
    removedSessionId: original?.id ?? null,
    adds: action !== 'move',
  }, ctx)
  clamps.push(...result.clamps)

  if (!result.ok) {
    clamps.push(result.clamp)
    return { output: safeReplan(out, ctx, result.clamp), clamps }
  }

  const p = result.placement
  const changed = p.type !== type || p.label !== out.targetLabel || p.timeSlot !== out.targetTimeSlot
  const final: ReactiveReplanOutput = {
    ...out,
    targetSessionType: p.type as SessionType,
    targetLabel: p.label,
    targetTimeSlot: p.timeSlot,
    ...(original?.id && !out.originalSessionId ? { originalSessionId: original.id } : {}),
  }
  // A clamp that changed what happens also changes the why.
  if (changed && result.clamps.length > 0) {
    const why = result.clamps[result.clamps.length - 1].reason
    final.shiftReason = why
    if (HARD_TYPES.has(type) && !HARD_TYPES.has(p.type)) final.shiftAction = 'swap'
  }
  return { output: final, clamps }
}

// ─── Replace suggestions (ReplaceSuggestionsOutput) ───────────

export interface ReplacedSession {
  id: string
  type: string
  epochDay: number
  timeSlot: 'am' | 'pm'
}

/** Rules-made safe options when nothing the AI offered fits. */
export function safeReplaceOptions(replaced: Pick<ReplacedSession, 'type'>): ReplaceSuggestion[] {
  const foundation: ReplaceSuggestion = { type: 'mobility', label: FOUNDATION_LABEL, timeSlot: 'am', estimatedMin: 12 }
  const walk: ReplaceSuggestion = { type: 'active_recovery', label: 'Easy Walk', timeSlot: 'am', estimatedMin: 20 }
  return replaced.type === 'mobility' ? [walk] : [foundation, walk]
}

/**
 * Filter replace suggestions to the ones the rules allow today, clamping
 * minutes, class types and time slots on the way. Fewer than one left: the
 * rules' safe options, with the refusal of the AI's top pick as the line.
 */
export function guardReplaceSuggestions(
  output: ReplaceSuggestionsOutput,
  replaced: ReplacedSession,
  ctx: BlockZeroGuardContext,
): Guarded<ReplaceSuggestionsOutput> {
  const clamps: Clamp[] = []
  const coachLine = voiced(output.coachLine ?? '', 'coachLine', clamps) ?? ''
  const kept: ReplaceSuggestion[] = []
  let topRefusal: Clamp | null = null
  let topChanged = false
  const list = Array.isArray(output.suggestions) ? output.suggestions : []

  list.forEach((s, i) => {
    if (!s || typeof s.type !== 'string') return
    const result = checkPlacement({
      type: s.type,
      label: s.label ?? s.type,
      epochDay: Math.max(replaced.epochDay, ctx.todayEpochDay),
      timeSlot: s.timeSlot === 'pm' ? 'pm' : 'am',
      estimatedMin: Number.isFinite(s.estimatedMin) ? s.estimatedMin : (DURATION_BOUNDS[s.type]?.[0] ?? 10),
      removedSessionId: replaced.id,
      adds: true,
    }, ctx)
    clamps.push(...result.clamps)
    if (!result.ok) {
      clamps.push({ ...result.clamp, detail: `#${i + 1} ${result.clamp.detail}` })
      if (i === 0) topRefusal = result.clamp
      return
    }
    const p = result.placement
    if (i === 0 && result.clamps.length > 0) topChanged = true
    const next: ReplaceSuggestion = { type: p.type as SessionType, label: p.label, timeSlot: p.timeSlot, estimatedMin: p.estimatedMin ?? s.estimatedMin }
    if (!kept.some(k => k.type === next.type && k.label === next.label)) kept.push(next)
  })

  if (kept.length === 0) {
    const reason = (topRefusal as Clamp | null)?.reason ?? 'Nothing offered fits the rules today.'
    const fallback = safeReplaceOptions(replaced)
    clamps.push({ code: 'suggestion_fallback', detail: `replaced=${replaced.type} options=${fallback.map(f => f.type).join(',')}`, reason: `${reason} Foundation or an easy walk instead.` })
    return { output: { coachLine: `${reason} Foundation or an easy walk instead.`, suggestions: fallback }, clamps }
  }

  const first = topRefusal as Clamp | null
  const line = first ? first.reason : topChanged ? clamps.filter(c => c.code !== 'voice')[0]?.reason ?? coachLine : coachLine
  return { output: { coachLine: line, suggestions: kept.slice(0, 3) }, clamps }
}

// ─── Loads (assessment, transition, any proposed weight) ──────

export interface LoadProposal {
  exerciseId: string
  weightKg: number
}

/** Cap one proposed weight at the rules' number. */
export function capLoad(proposedKg: number, limitKg: number, detail: string, reason: string): { weightKg: number; clamp: Clamp | null } {
  if (!(proposedKg > limitKg)) return { weightKg: proposedKg, clamp: null }
  return { weightKg: limitKg, clamp: { code: 'load_cap', detail: `${detail} kg=${proposedKg} -> ${limitKg}`, reason } }
}

/**
 * Proposed working loads against the rules' next load per lift (nextLoad /
 * blockZeroWorkingLoad). Above it: capped. A lift with no rules number keeps
 * nothing: the rules' TM x % fallback applies instead.
 */
export function guardLoadProposals(proposals: LoadProposal[], limits: Map<string, NextLoad | WorkingLoad>): Guarded<LoadProposal[]> {
  const clamps: Clamp[] = []
  const out: LoadProposal[] = []
  for (const p of proposals) {
    const limit = limits.get(p.exerciseId)
    if (!limit) {
      clamps.push({ code: 'load_cap', detail: `${p.exerciseId} no_rules_load`, reason: 'No logged effort for that lift yet. The rules set the load.' })
      continue
    }
    const capped = capLoad(p.weightKg, limit.weightKg, p.exerciseId, `Load capped at ${lbText(limit.weightKg)}. ${limit.reason}`)
    if (capped.clamp) clamps.push(capped.clamp)
    out.push({ exerciseId: p.exerciseId, weightKg: capped.weightKg })
  }
  return { output: out, clamps }
}

export interface CalibrationStartLike {
  exerciseName: string
  startingWeightKg: number
  rationale?: string
}

/**
 * Assessment calibrationStarts against week-1 test ceilings (TM = 90% of the
 * week-1 e1RM). `resolve` maps a name to an exercise id. Lifts without a
 * test are reported as untested and left out of `writes`, so an assessment
 * before the week-1 tests writes no maxes at all (map #8).
 */
export function guardCalibrationStarts<T extends CalibrationStartLike>(
  starts: T[],
  resolve: (name: string) => string | null,
  ceilings: Map<string, number>,
): Guarded<T[]> & { writes: Array<{ exerciseId: string; weightKg: number }> } {
  const clamps: Clamp[] = []
  const out: T[] = []
  const writes: Array<{ exerciseId: string; weightKg: number }> = []
  const seen = new Set<string>()
  for (const s of Array.isArray(starts) ? starts : []) {
    if (!s || !(s.startingWeightKg > 0)) continue
    const id = resolve(s.exerciseName)
    const ceiling = id ? ceilings.get(id) : undefined
    let next = s
    if (ceiling != null) {
      const capped = capLoad(s.startingWeightKg, ceiling, id as string, `${s.exerciseName} capped at ${lbText(ceiling)}. That is 90% of the week-1 estimate.`)
      if (capped.clamp) {
        clamps.push({ ...capped.clamp, code: 'calibration_cap' })
        next = { ...s, startingWeightKg: capped.weightKg }
      }
    }
    out.push(next.rationale != null ? { ...next, rationale: houseVoice(next.rationale) } : next)
    if (!id || seen.has(id)) continue
    // Map #8: an untested lift's max is never written, before or after week 1.
    if (ceiling == null) {
      clamps.push({ code: 'calibration_untested', detail: id, reason: `${s.exerciseName} has no test yet. Its max waits for one.` })
      continue
    }
    seen.add(id)
    writes.push({ exerciseId: id, weightKg: next.startingWeightKg })
  }
  return { output: out, clamps, writes }
}

/** The assessment's MT cap stays inside the ramp: 0-3 classes a week. */
export function guardMtCap(cap: number): { value: number | null; clamp: Clamp | null } {
  if (!Number.isFinite(cap)) return { value: null, clamp: { code: 'mt_cap', detail: `cap=${String(cap)}`, reason: 'No usable class cap. The ramp cap applies.' } }
  const value = Math.max(0, Math.min(3, Math.round(cap)))
  if (value === cap) return { value, clamp: null }
  return { value, clamp: { code: 'mt_cap', detail: `cap=${cap} -> ${value}`, reason: `Class cap set to ${value} a week. The ramp allows 3 at most in Block Zero.` } }
}

export interface CalibrationWriteLike {
  exerciseId: string
  weightKg: number
  source: 'ai' | 'retest'
}

/**
 * Transition calibration: AI targets may not exceed the retest e1RM rule
 * (90% of e1RM, 85% on adjust) for any lift with retest data.
 */
export function guardCalibrationWrites<T extends CalibrationWriteLike>(
  writes: T[],
  retestE1rms: Map<string, number>,
  decision: string,
  retestCeiling: (e1rmKg: number, decision: string) => number,
): Guarded<T[]> {
  const clamps: Clamp[] = []
  const out = writes.map(w => {
    const e1rm = retestE1rms.get(w.exerciseId)
    if (w.source !== 'ai' || e1rm == null) return w
    const ceiling = retestCeiling(e1rm, decision)
    const pct = decision === 'adjust' ? 85 : 90
    const capped = capLoad(w.weightKg, ceiling, w.exerciseId, `Training max capped at ${lbText(ceiling)}, ${pct}% of the retest.`)
    if (!capped.clamp) return w
    clamps.push({ ...capped.clamp, code: 'calibration_cap' })
    return { ...w, weightKg: capped.weightKg }
  })
  return { output: out, clamps }
}

// ─── Smart Session Suggestions ──────────────────────────────────
// Pure function that computes session recommendations based on
// wellness metrics, skip patterns, training block position,
// and volume deficits from training targets.

import { TRAINING_TARGETS, type SessionTarget } from './trainingTargets'
import type { PickAction } from './coach/pickDay'

export interface WellnessSnapshot {
  sleepHours: number | null
  soreness: number | null   // 1-5 (1=Fresh, 5=Cooked)
  herbScale: number | null  // 0-9 (0 none, 9 most)
  alcoholScale: number | null // 0-10
}

/** Herb at or above this (0-9 scale) is a substance load day. */
export const HIGH_HERB_SCALE = 6

export interface RecentWellness {
  avgSleep: number | null
  avgSoreness: number | null
}

export interface WeekSession {
  type: string
  status: string       // planned | in_progress | completed | skipped
  scheduledDate: number // epochDay
  timeSlot: string
  notes?: string | null
}

export interface SuggestionInput {
  todayWellness: WellnessSnapshot | null
  recentWellness: RecentWellness | null
  weekSessions: WeekSession[]
  blockWeek: number | null
  blockType?: string | null
  targetDate: number           // epochDay for the date we're suggesting sessions for
  existingSessionsOnDate: { type: string; timeSlot: string }[]
}

export interface SessionSuggestion {
  type: string
  label: string
  timeSlot: 'am' | 'pm'
  flexibleTimeSlot: boolean
  runCategory?: string
  reason: string | null
  priority: 'suggested' | 'caution' | 'neutral'
  /**
   * What picking the row does (page 56: it always adds): a plain add, or the
   * week's next strength pulled to this day. Absent on the Replace board and
   * when no block is active.
   */
  action?: PickAction
}

export interface SuggestionsResponse {
  suggestions: SessionSuggestion[]
  wellness: {
    avgSleep: number | null
    avgSoreness: number | null
    todaySoreness: number | null
    todaySleep: number | null
  }
  flags: string[]
  deficits: { type: string; label: string; completed: number; target: number }[]
}

function optionsForTargets(targets: SessionTarget[]): Omit<SessionSuggestion, 'reason' | 'priority'>[] {
  return targets
  // MT Class is a row like any session (page 56 item 15).
  .map(t => ({
    type: t.type,
    label: t.label,
    timeSlot: t.defaultTimeSlot,
    flexibleTimeSlot: t.flexibleTimeSlot,
    runCategory: t.runCategory,
  }))
}

const RECOVERY_TYPES = new Set(['active_recovery', 'mobility', 'foundation_run'])
const INTENSE_TYPES = new Set(['bag_work', 'skip_rope'])

export function computeSuggestions(input: SuggestionInput): SuggestionsResponse {
  const { todayWellness, recentWellness, weekSessions, existingSessionsOnDate } = input
  const targets = TRAINING_TARGETS
  const allOptions = optionsForTargets(targets)

  const flags: string[] = []
  const overrides = new Map<string, { priority: SessionSuggestion['priority']; reason: string }>()

  const todaySoreness = todayWellness?.soreness ?? null
  const todaySleep = todayWellness?.sleepHours ?? null
  const avgSoreness = recentWellness?.avgSoreness ?? null
  const avgSleep = recentWellness?.avgSleep ?? null

  // ─── Volume deficit tracking ───────────────────────────────
  const deficits: SuggestionsResponse['deficits'] = []
  for (const target of targets) {
    if (target.weeklyTarget === 0) continue
    const key = target.runCategory ? `${target.type}:${target.runCategory}` : target.type
    const completed = weekSessions.filter(s => {
      const sKey = s.type === 'running' ? `${s.type}:${s.notes ?? ''}` : s.type
      return sKey === key && s.status === 'completed'
    }).length

    if (completed < target.weeklyTarget) {
      deficits.push({ type: key, label: target.label, completed, target: target.weeklyTarget })
    }
    // Skipped sessions are not flagged and never boosted: missed work is not
    // made up (F14, system rules). The coach handles each missed session.
  }

  // ─── Rule 1: High soreness ─────────────────────────────────
  const sorenessHigh = (todaySoreness !== null && todaySoreness >= 4) ||
    (avgSoreness !== null && avgSoreness >= 3.5)

  if (sorenessHigh) {
    flags.push('Soreness is high')

    for (const opt of allOptions) {
      const key = optKey(opt)
      if (RECOVERY_TYPES.has(opt.type)) {
        overrides.set(key, { priority: 'suggested', reason: 'Recovery. Soreness is elevated' })
      } else if (INTENSE_TYPES.has(opt.type) && !overrides.has(key)) {
        overrides.set(key, { priority: 'caution', reason: 'High intensity while sore' })
      }
    }
  }

  // ─── Rule 2: Low sleep ─────────────────────────────────────
  const sleepLow = (todaySleep !== null && todaySleep < 6) ||
    (avgSleep !== null && avgSleep < 6)

  if (sleepLow) {
    flags.push('Sleep is low')

    for (const opt of allOptions) {
      const key = optKey(opt)
      if (RECOVERY_TYPES.has(opt.type) && !overrides.has(key)) {
        overrides.set(key, { priority: 'suggested', reason: 'Light session. Sleep deficit' })
      } else if (INTENSE_TYPES.has(opt.type) && !overrides.has(key)) {
        overrides.set(key, { priority: 'caution', reason: 'Intensity while under-slept' })
      }
    }
  }

  // ─── Rule 3: High substance ────────────────────────────────
  const highAlcohol = todayWellness?.alcoholScale !== null && (todayWellness?.alcoholScale ?? 0) >= 5
  // Herb on the 0-9 scale: 6+ is the top third (the old card's 2 g of 3+ g).
  const highHerb = todayWellness?.herbScale != null && todayWellness.herbScale >= HIGH_HERB_SCALE

  if (highAlcohol || highHerb) {
    const parts: string[] = []
    if (highAlcohol) parts.push(`alcohol ${todayWellness!.alcoholScale}/10`)
    if (highHerb) parts.push(`herb ${todayWellness!.herbScale}/9`)
    flags.push(`Substance load (${parts.join(', ')})`)

    for (const opt of allOptions) {
      const key = optKey(opt)
      if (!overrides.has(key)) {
        if (RECOVERY_TYPES.has(opt.type)) {
          overrides.set(key, { priority: 'suggested', reason: 'Keep it light today' })
        } else if (INTENSE_TYPES.has(opt.type)) {
          overrides.set(key, { priority: 'caution', reason: 'High intensity after substance load' })
        }
      }
    }
  }

  // ─── Rule 4: Good recovery ─────────────────────────────────
  const recoveryGood = !sorenessHigh && !sleepLow && !highAlcohol && !highHerb &&
    todaySoreness !== null && todaySoreness <= 2 &&
    todaySleep !== null && todaySleep >= 7

  if (recoveryGood) {
    flags.push('Good recovery. Full send')
    for (const opt of allOptions) {
      const key = optKey(opt)
      if (!overrides.has(key)) {
        overrides.set(key, { priority: 'suggested', reason: null! })
      }
    }
  }

  // ─── Build final suggestions ───────────────────────────────
  const existingTypes = new Set(existingSessionsOnDate.map(s => s.type))

  const suggestions: SessionSuggestion[] = allOptions
    .filter(opt => {
      if (opt.type === 'running') return true
      return !existingTypes.has(opt.type)
    })
    .map(opt => {
      const key = optKey(opt)
      const override = overrides.get(key)
      return {
        ...opt,
        reason: override?.reason ?? null,
        priority: override?.priority ?? 'neutral' as const,
      }
    })

  // Sort: suggested first, then neutral, then caution
  const priorityOrder = { suggested: 0, neutral: 1, caution: 2 }
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return {
    suggestions,
    wellness: { avgSleep, avgSoreness, todaySoreness, todaySleep },
    flags,
    deficits,
  }
}

function optKey(opt: { type: string; runCategory?: string }): string {
  return opt.runCategory ? `${opt.type}:${opt.runCategory}` : opt.type
}

// ─── The Add / Replace board (page 56 items 1, 4; approved 2026-10-19) ───

/**
 * Base order of the board's "Everything else". Kinds already on that day
 * (any status; runs count as one kind) go last, in the same order, so what
 * he hasn't done today comes first (page 56 1B and 4A).
 */
export const BOARD_ORDER: ReadonlyArray<string> = ['skip_rope', 'bag_work', 'mt_class', 'strength', 'foundation_run', 'running', 'mobility', 'active_recovery']

const RUN_KINDS = new Set(['foundation_run', 'running'])
const kindOf = (type: string) => (RUN_KINDS.has(type) ? 'run' : type)

export interface BoardInput {
  mode: 'add' | 'replace'
  /** The session REPLACE swaps out (its type), when replacing. */
  replacing?: string | null
  /** Types of the sessions already on that day, the replaced one included. */
  dayTypes: ReadonlyArray<string>
  /** A knee, ankle or shin injury flag is up (Josh, 2026-10-19): no rope on REPLACE of a run. */
  kneeSafe?: boolean
}

/**
 * The coach picks and the order of the rest. REPLACE: the session's own swap
 * (rope for a run-walk or a run; with a knee, ankle or shin flag the
 * knee-safe Reset or bike instead) and an easy Reset. + Add: an easy Reset,
 * and Foundation (a second round when it is already on the day). Nothing is
 * refused, cautioned or greyed out; rows carry no other line.
 */
export function boardSuggestions(rows: ReadonlyArray<SessionSuggestion>, input: BoardInput): SessionSuggestion[] {
  const isRun = input.replacing != null && RUN_KINDS.has(input.replacing)
  const runWord = input.replacing === 'foundation_run' ? 'run-walk' : 'run'
  const picks: Array<[string, string]> = input.mode === 'replace'
    ? isRun && input.kneeSafe
      ? [['active_recovery', 'Knee-safe. Easy, 20 min']]
      : [...(isRun ? [['skip_rope', `The ${runWord}'s own swap`] as [string, string]] : []), ['active_recovery', 'Easy, 20 min']]
    : [['active_recovery', 'Easy, 20 min'], ['mobility', input.dayTypes.includes('mobility') ? 'A second round, 12 min' : '12 min']]
  const pickReason = new Map(picks)
  const on = new Set(input.dayTypes.map(kindOf))
  const base = (t: string) => { const i = BOARD_ORDER.indexOf(t); return i < 0 ? BOARD_ORDER.length : i }
  const rank = (s: SessionSuggestion) => {
    const pick = picks.findIndex(([t]) => t === s.type && !s.runCategory)
    if (pick >= 0) return pick
    return 100 + (on.has(kindOf(s.type)) ? 50 : 0) + base(s.type)
  }
  return rows
    .map(s => {
      const reason = !s.runCategory ? pickReason.get(s.type) : undefined
      return reason ? { ...s, priority: 'suggested' as const, reason } : { ...s, priority: 'neutral' as const, reason: null }
    })
    .sort((a, b) => rank(a) - rank(b))
}

/** Every session on the board, plain, before the coach's picks and order. */
export function allBoardRows(): SessionSuggestion[] {
  return optionsForTargets(TRAINING_TARGETS).map(o => ({ ...o, reason: null, priority: 'neutral' as const }))
}

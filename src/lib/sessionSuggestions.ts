// ─── Smart Session Suggestions ──────────────────────────────────
// Pure function that computes session recommendations based on
// wellness metrics, skip patterns, training block position,
// and volume deficits from training targets.

import { TRAINING_TARGETS, type SessionTarget } from './trainingTargets'

export interface WellnessSnapshot {
  sleepHours: number | null
  soreness: number | null   // 1-5 (1=Fresh, 5=Cooked)
  weedGrams: number | null
  alcoholScale: number | null // 0-10
}

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

const ROAD_BOOTCAMP_TARGETS: SessionTarget[] = [
  {
    type: 'strength',
    label: 'Strength',
    weeklyTarget: 2,
    priority: 'high',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.8,
  },
  {
    type: 'foundation_run',
    label: 'Easy Run',
    weeklyTarget: 2,
    priority: 'high',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.6,
  },
  {
    type: 'running',
    label: 'Quality Run',
    weeklyTarget: 1,
    priority: 'high',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.6,
    runCategory: 'progression',
  },
  {
    type: 'skip_rope',
    label: 'Rope Primer',
    weeklyTarget: 2,
    priority: 'medium',
    flexibleTimeSlot: true,
    defaultTimeSlot: 'pm',
    carryForwardWeight: 0.2,
  },
  {
    type: 'mobility',
    label: 'Mobility',
    weeklyTarget: 7,
    priority: 'low',
    flexibleTimeSlot: false,
    defaultTimeSlot: 'am',
    carryForwardWeight: 0.1,
  },
]

function targetsForBlock(blockType?: string | null): SessionTarget[] {
  return blockType === 'road_bootcamp' ? ROAD_BOOTCAMP_TARGETS : TRAINING_TARGETS
}

function optionsForTargets(targets: SessionTarget[]): Omit<SessionSuggestion, 'reason' | 'priority'>[] {
  return targets
  .filter(t => t.type !== 'mt_class') // MT class not available for ad-hoc
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
  const targets = targetsForBlock(input.blockType)
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
    const skipped = weekSessions.filter(s => {
      const sKey = s.type === 'running' ? `${s.type}:${s.notes ?? ''}` : s.type
      return sKey === key && s.status === 'skipped'
    }).length

    if (completed < target.weeklyTarget) {
      deficits.push({ type: key, label: target.label, completed, target: target.weeklyTarget })
    }

    // Flag skipped high/medium priority sessions
    if (skipped > 0 && target.priority !== 'low') {
      const msg = skipped >= 2
        ? `Missed ${skipped} ${target.label} sessions this week`
        : `Missed 1 ${target.label} session this week`
      flags.push(msg)

      // Boost this type in suggestions if behind target
      if (completed < target.weeklyTarget) {
        const optKey = target.runCategory ? `${target.type}:${target.runCategory}` : target.type
        overrides.set(optKey, {
          priority: 'suggested',
          reason: `Behind target (${completed}/${target.weeklyTarget}). Make up ${target.label}`,
        })
      }
    }
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
  const highHerb = todayWellness?.weedGrams !== null && (todayWellness?.weedGrams ?? 0) >= 2

  if (highAlcohol || highHerb) {
    const parts: string[] = []
    if (highAlcohol) parts.push(`alcohol ${todayWellness!.alcoholScale}/10`)
    if (highHerb) parts.push(`herb ${todayWellness!.weedGrams}g`)
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

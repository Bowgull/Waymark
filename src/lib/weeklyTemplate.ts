import { blockZeroTrainingWeek } from './blockZero/weeks'
import { getBlockZeroWeekTemplate } from './blockZero/weekPlan'
import { FOUNDATION_LABEL } from './foundation'

export interface TemplateSession {
  timeSlot: 'am' | 'pm'
  type: string
  label: string
  estimatedMin: number
  runCategory?: 'zone2' | 'progression'
}

const DAILY_FOUNDATION: TemplateSession = {
  timeSlot: 'am',
  type: 'mobility',
  label: FOUNDATION_LABEL,
  estimatedMin: 12,
}

/**
 * Weekly training template. Keys are JS day-of-week (0=Sun, 1=Mon, ..., 6=Sat).
 *
 * Foundation runs every AM (the daily back-and-neck session, ~12 min, level 3
 * in the Fighter phase; lib/foundation). Then on top of that:
 * - M/W/F AM: Zone 2 (5-move pre-run stretch + easy Zone 2 run)
 * - T/Th AM: Strength (Foundation runs first)
 * - Sat AM: Bag Work + progression run
 * - PM evenings: MT Class (M/W/F), Reset (Th/Sat)
 * - Sun: Foundation only, otherwise rest
 */
export const WEEKLY_TEMPLATE: Record<number, TemplateSession[]> = {
  0: [ // Sunday
    DAILY_FOUNDATION,
  ],
  1: [ // Monday
    DAILY_FOUNDATION,
    { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  2: [ // Tuesday
    DAILY_FOUNDATION,
    { timeSlot: 'am', type: 'strength', label: 'Strength: Push', estimatedMin: 75 },
  ],
  3: [ // Wednesday
    DAILY_FOUNDATION,
    { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  4: [ // Thursday
    DAILY_FOUNDATION,
    { timeSlot: 'am', type: 'strength', label: 'Strength: Pull', estimatedMin: 75 },
    { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 20 },
  ],
  5: [ // Friday
    DAILY_FOUNDATION,
    { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  6: [ // Saturday
    DAILY_FOUNDATION,
    { timeSlot: 'am', type: 'bag_work', label: 'Bag Work', estimatedMin: 30 },
    { timeSlot: 'am', type: 'running', label: 'Progression Run', estimatedMin: 30, runCategory: 'progression' },
    { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 30 },
  ],
}

// ─── Block Zero template ───────────────────────────────────────

/**
 * Weekly template for a Block Zero week. The shape lives in the rules module
 * (src/lib/blockZero/weekPlan.ts): 3 strength days, 3 run-walks, daily back
 * care, no MT classes. Weeks past 6 are extensions and repeat week 5.
 */
export function getBlockZeroTemplate(blockZeroWeek: number): Record<number, TemplateSession[]> {
  return getBlockZeroWeekTemplate(blockZeroWeek)
}

/**
 * The strength block week stamped on sessions. Fighter waves cycle every 6
 * weeks. Block Zero never wraps: extension weeks hold week-5 levels.
 */
export function strengthBlockWeek(blockType: string, weekNumber: number): number {
  if (blockType === 'block_zero') return blockZeroTrainingWeek(weekNumber)
  return ((weekNumber - 1) % 6) + 1
}

/**
 * One day's sessions for a block. Block Zero uses its week template and never
 * schedules MT; Fighter uses the weekly template with MT only on class days.
 * Shared by generate-today and the auto-generate fallback.
 */
export function getDayTemplate(blockType: string, weekNumber: number, dayOfWeek: number, mtClassDays: Set<number>): TemplateSession[] {
  if (blockType === 'block_zero') return getBlockZeroTemplate(weekNumber)[dayOfWeek] ?? []
  const base = WEEKLY_TEMPLATE[dayOfWeek] ?? []
  return base.filter(entry => entry.type !== 'mt_class' || mtClassDays.has(dayOfWeek))
}

/** Get the human-readable label for a session type, optionally using day of week for disambiguation. */
export function getSessionLabel(type: string, dayOfWeek?: number): string {
  if (dayOfWeek !== undefined) {
    const dayTemplate = WEEKLY_TEMPLATE[dayOfWeek] ?? []
    for (const s of dayTemplate) {
      if (s.type === type) return s.label
    }
  }
  for (const day of Object.values(WEEKLY_TEMPLATE)) {
    for (const s of day) {
      if (s.type === type) return s.label
    }
  }
  return type.replace(/_/g, ' ')
}

/** Get estimated minutes for a session type, optionally using day context. */
export function getEstimatedMin(type: string, dayOfWeek?: number): number {
  if (dayOfWeek !== undefined) {
    const dayTemplate = WEEKLY_TEMPLATE[dayOfWeek] ?? []
    for (const s of dayTemplate) {
      if (s.type === type) return s.estimatedMin
    }
  }
  for (const day of Object.values(WEEKLY_TEMPLATE)) {
    for (const s of day) {
      if (s.type === type) return s.estimatedMin
    }
  }
  return 30
}

/** Color accent class for left border by session type. */
export function getTypeAccentColor(type: string): string {
  switch (type) {
    case 'foundation_run': return 'border-l-[#4ACAAA]'
    case 'mobility': return 'border-l-[#E8C860]'
    case 'strength': return 'border-l-[#C8A030]'
    case 'mt_class': return 'border-l-[#C45A3C]'
    case 'bag_work': return 'border-l-[#C45A3C]'
    case 'running': return 'border-l-[#1E8A68]'
    case 'skip_rope': return 'border-l-[#1E8A68]'
    case 'active_recovery': return 'border-l-muted-foreground'
    default: return 'border-l-muted-foreground'
  }
}

const VOLUME_TYPE_LABELS: Record<string, string> = {
  strength: 'Strength',
  foundation_run: 'Zone 2',
  mobility: FOUNDATION_LABEL,
  mt_class: 'MT Class',
  bag_work: 'Bag Work',
  running: 'Run',
  skip_rope: 'Skip Rope',
  active_recovery: 'Reset',
}

const RUN_CATEGORY_LABELS: Record<string, string> = {
  zone2: 'Zone 2 Run',
  progression: 'Progression Run',
}

/**
 * Human label for a week-volume key ("strength", "running:progression").
 * Week Intelligence chips used to print the raw type code.
 */
export function volumeKeyLabel(key: string): string {
  const [type, category] = key.split(':')
  if (category) {
    const known = RUN_CATEGORY_LABELS[category]
    if (known) return known
    const base = VOLUME_TYPE_LABELS[type] ?? getSessionLabel(type)
    return `${base} (${category.replace(/_/g, ' ')})`
  }
  return VOLUME_TYPE_LABELS[type] ?? getSessionLabel(type)
}

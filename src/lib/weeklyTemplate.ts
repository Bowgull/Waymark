export interface TemplateSession {
  timeSlot: 'am' | 'pm'
  type: string
  label: string
  estimatedMin: number
  runCategory?: 'zone2' | 'progression'
}

const DAILY_MOBILITY: TemplateSession = {
  timeSlot: 'am',
  type: 'mobility',
  label: 'Mobility',
  estimatedMin: 10,
}

/**
 * Weekly training template. Keys are JS day-of-week (0=Sun, 1=Mon, ..., 6=Sat).
 *
 * Daily AM Mobility runs every day (7 exercises, ~8-10 min). This is the
 * micro-dose that actually remodels posture. Then on top of that:
 * - M/W/F AM: Zone 2 (5-move pre-run stretch + easy Zone 2 run)
 * - T/Th AM: Strength (Mobility runs first, acts as pre-lift activation)
 * - Sat AM: Bag Work + progression run
 * - PM evenings: MT Class (M/W/F), Reset (Th/Sat)
 * - Sun: Mobility only, otherwise rest
 */
export const WEEKLY_TEMPLATE: Record<number, TemplateSession[]> = {
  0: [ // Sunday
    DAILY_MOBILITY,
  ],
  1: [ // Monday
    DAILY_MOBILITY,
    { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  2: [ // Tuesday
    DAILY_MOBILITY,
    { timeSlot: 'am', type: 'strength', label: 'Strength: Push', estimatedMin: 75 },
  ],
  3: [ // Wednesday
    DAILY_MOBILITY,
    { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  4: [ // Thursday
    DAILY_MOBILITY,
    { timeSlot: 'am', type: 'strength', label: 'Strength: Pull', estimatedMin: 75 },
    { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 20 },
  ],
  5: [ // Friday
    DAILY_MOBILITY,
    { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  6: [ // Saturday
    DAILY_MOBILITY,
    { timeSlot: 'am', type: 'bag_work', label: 'Bag Work', estimatedMin: 30 },
    { timeSlot: 'am', type: 'running', label: 'Progression Run', estimatedMin: 30, runCategory: 'progression' },
    { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 30 },
  ],
}

// ─── Block Zero template ───────────────────────────────────────

/**
 * Returns the weekly template for a given Block Zero week (1-6).
 *
 * Daily Mobility runs every day in every phase. Mobility is the foundational
 * habit Block Zero is designed to build.
 *
 * Phase 1 (weeks 1-2): No MT class. Foundation + Strength + Bag Work only.
 *   Connective tissue adaptation before adding class volume.
 * Phase 2 (weeks 3-4): MT class returns (Mon/Wed/Fri PM). Easy run added Saturday.
 * Phase 3 (weeks 5-6): Full template.
 */
export function getBlockZeroTemplate(blockZeroWeek: number): Record<number, TemplateSession[]> {
  if (blockZeroWeek <= 2) {
    return {
      0: [DAILY_MOBILITY],
      1: [DAILY_MOBILITY, { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 }],
      2: [DAILY_MOBILITY, { timeSlot: 'am', type: 'strength', label: 'Strength: Push', estimatedMin: 60 }],
      3: [DAILY_MOBILITY, { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 }],
      4: [DAILY_MOBILITY, { timeSlot: 'am', type: 'strength', label: 'Strength: Pull', estimatedMin: 60 }],
      5: [DAILY_MOBILITY, { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 }],
      6: [
        DAILY_MOBILITY,
        { timeSlot: 'am', type: 'bag_work', label: 'Bag Work', estimatedMin: 25 },
        { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 30 },
      ],
    }
  }

  if (blockZeroWeek <= 4) {
    return {
      0: [DAILY_MOBILITY],
      1: [
        DAILY_MOBILITY,
        { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
        { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
      ],
      2: [DAILY_MOBILITY, { timeSlot: 'am', type: 'strength', label: 'Strength: Push', estimatedMin: 65 }],
      3: [
        DAILY_MOBILITY,
        { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
        { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
      ],
      4: [DAILY_MOBILITY, { timeSlot: 'am', type: 'strength', label: 'Strength: Pull', estimatedMin: 65 }],
      5: [
        DAILY_MOBILITY,
        { timeSlot: 'am', type: 'foundation_run', label: 'Zone 2', estimatedMin: 35 },
        { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
      ],
      6: [
        DAILY_MOBILITY,
        { timeSlot: 'am', type: 'bag_work', label: 'Bag Work', estimatedMin: 30 },
        { timeSlot: 'am', type: 'running', label: 'Easy Run', estimatedMin: 20, runCategory: 'zone2' },
        { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 30 },
      ],
    }
  }

  // Weeks 5-6: full Fighter template
  return WEEKLY_TEMPLATE
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

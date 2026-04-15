export interface TemplateSession {
  timeSlot: 'am' | 'pm'
  type: string
  label: string
  estimatedMin: number
  runCategory?: 'zone2' | 'progression'
}

/**
 * Weekly training template. Keys are JS day-of-week (0=Sun, 1=Mon, ..., 6=Sat).
 *
 * Schedule:
 * - Foundation Run M/W/F AM (Zone 2 run + posture corrective, combined)
 * - Strength is early AM (4 AM gym, Tue/Thu)
 * - MT classes are PM (evening after work, M/W/F, controlled by settings.mtClassDays)
 * - Bag work + progression run Saturday AM
 * - Sunday is full rest
 */
export const WEEKLY_TEMPLATE: Record<number, TemplateSession[]> = {
  0: [], // Sunday, full rest
  1: [ // Monday
    { timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  2: [ // Tuesday
    { timeSlot: 'am', type: 'strength', label: 'Strength: Push', estimatedMin: 75 },
  ],
  3: [ // Wednesday
    { timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  4: [ // Thursday
    { timeSlot: 'am', type: 'strength', label: 'Strength: Pull', estimatedMin: 75 },
    { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 20 },
  ],
  5: [ // Friday
    { timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
  ],
  6: [ // Saturday
    { timeSlot: 'am', type: 'bag_work', label: 'Bag Work', estimatedMin: 30 },
    { timeSlot: 'am', type: 'running', label: 'Progression Run', estimatedMin: 30, runCategory: 'progression' },
    { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 30 },
  ],
}

// ─── Block Zero template ───────────────────────────────────────

/**
 * Returns the weekly template for a given Block Zero week (1-6).
 *
 * Phase 1 (weeks 1-2): No MT class. Foundation + Strength + Bag Work only.
 *   Connective tissue adaptation before adding class volume.
 * Phase 2 (weeks 3-4): MT class returns (Mon/Wed/Fri PM). Easy run added Saturday.
 * Phase 3 (weeks 5-6): Full template — same as Fighter block.
 */
export function getBlockZeroTemplate(blockZeroWeek: number): Record<number, TemplateSession[]> {
  if (blockZeroWeek <= 2) {
    return {
      0: [],
      1: [{ timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 }],
      2: [{ timeSlot: 'am', type: 'strength', label: 'Strength: Push', estimatedMin: 60 }],
      3: [{ timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 }],
      4: [{ timeSlot: 'am', type: 'strength', label: 'Strength: Pull', estimatedMin: 60 }],
      5: [{ timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 }],
      6: [
        { timeSlot: 'am', type: 'bag_work', label: 'Bag Work', estimatedMin: 25 },
        { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 30 },
      ],
    }
  }

  if (blockZeroWeek <= 4) {
    return {
      0: [],
      1: [
        { timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 },
        { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
      ],
      2: [{ timeSlot: 'am', type: 'strength', label: 'Strength: Push', estimatedMin: 65 }],
      3: [
        { timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 },
        { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
      ],
      4: [{ timeSlot: 'am', type: 'strength', label: 'Strength: Pull', estimatedMin: 65 }],
      5: [
        { timeSlot: 'am', type: 'foundation_run', label: 'Foundation Run', estimatedMin: 45 },
        { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 100 },
      ],
      6: [
        { timeSlot: 'am', type: 'bag_work', label: 'Bag Work', estimatedMin: 30 },
        { timeSlot: 'am', type: 'running', label: 'Easy Run', estimatedMin: 20, runCategory: 'zone2' },
        { timeSlot: 'pm', type: 'active_recovery', label: 'Reset', estimatedMin: 30 },
      ],
    }
  }

  // Weeks 5-6: full Fighter template — ready to transition
  return WEEKLY_TEMPLATE
}

/** Get the human-readable label for a session type, optionally using day of week for disambiguation. */
export function getSessionLabel(type: string, dayOfWeek?: number): string {
  // If we have the day, use exact template match
  if (dayOfWeek !== undefined) {
    const dayTemplate = WEEKLY_TEMPLATE[dayOfWeek] ?? []
    for (const s of dayTemplate) {
      if (s.type === type) return s.label
    }
  }
  // Fallback: first match across all days
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
    case 'posture_corrective': return 'border-l-[#E8C860]'
    case 'strength': return 'border-l-[#C8A030]'
    case 'mt_class': return 'border-l-[#C45A3C]'
    case 'bag_work': return 'border-l-[#C45A3C]'
    case 'running': return 'border-l-[#1E8A68]'
    case 'skip_rope': return 'border-l-[#1E8A68]'
    case 'active_recovery': return 'border-l-muted-foreground'
    default: return 'border-l-muted-foreground'
  }
}

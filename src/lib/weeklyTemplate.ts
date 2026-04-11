export interface TemplateSession {
  timeSlot: 'am' | 'pm'
  type: string
  label: string
  estimatedMin: number
}

/**
 * Weekly training template. Keys are JS day-of-week (0=Sun, 1=Mon, ..., 6=Sat).
 */
export const WEEKLY_TEMPLATE: Record<number, TemplateSession[]> = {
  0: [ // Sunday
    { timeSlot: 'am', type: 'posture_corrective', label: 'Posture Correctives', estimatedMin: 15 },
    { timeSlot: 'pm', type: 'active_recovery', label: 'Active Recovery', estimatedMin: 30 },
  ],
  1: [ // Monday
    { timeSlot: 'am', type: 'posture_corrective', label: 'Posture Correctives', estimatedMin: 15 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 90 },
  ],
  2: [ // Tuesday
    { timeSlot: 'am', type: 'posture_corrective', label: 'Posture Correctives', estimatedMin: 15 },
    { timeSlot: 'pm', type: 'strength', label: 'Strength A + Core', estimatedMin: 50 },
  ],
  3: [ // Wednesday
    { timeSlot: 'am', type: 'posture_corrective', label: 'Posture Correctives', estimatedMin: 15 },
    { timeSlot: 'pm', type: 'running', label: 'Run', estimatedMin: 35 },
  ],
  4: [ // Thursday
    { timeSlot: 'am', type: 'posture_corrective', label: 'Posture Correctives', estimatedMin: 15 },
    { timeSlot: 'pm', type: 'mt_class', label: 'MT Class', estimatedMin: 90 },
  ],
  5: [ // Friday
    { timeSlot: 'am', type: 'posture_corrective', label: 'Posture Correctives', estimatedMin: 15 },
    { timeSlot: 'pm', type: 'bag_work', label: 'Solo Bag Work', estimatedMin: 45 },
  ],
  6: [ // Saturday
    { timeSlot: 'am', type: 'posture_corrective', label: 'Posture Correctives', estimatedMin: 15 },
    { timeSlot: 'pm', type: 'running', label: 'Run + Skip Rope', estimatedMin: 50 },
  ],
}

/** Get the human-readable label for a session type. */
export function getSessionLabel(type: string): string {
  for (const day of Object.values(WEEKLY_TEMPLATE)) {
    for (const s of day) {
      if (s.type === type) return s.label
    }
  }
  return type.replace(/_/g, ' ')
}

/** Get estimated minutes for a session type. */
export function getEstimatedMin(type: string): number {
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
    case 'posture_corrective': return 'border-l-[#E8C860]'
    case 'strength': return 'border-l-[#C8A030]'
    case 'mt_class': return 'border-l-[#C45A3C]'
    case 'bag_work': return 'border-l-[#C45A3C]'
    case 'running': return 'border-l-[#1E8A68]'
    case 'skip_rope': return 'border-l-[#1E8A68]'
    case 'active_recovery': return 'border-l-zinc-600'
    default: return 'border-l-zinc-600'
  }
}

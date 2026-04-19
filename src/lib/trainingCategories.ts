// Maps session types into ring categories for the Ledger dashboard.
// Used by CompletionRings and the category-completion API endpoint.

import mobilityIcon from '@/assets/brand/Mobility.png'
import strengthIcon from '@/assets/brand/Strength.png'
import wellnessIcon from '@/assets/brand/Wellness.png'

export interface TrainingCategory {
  label: string
  types: readonly string[]
  color: string
  icon: string
}

export type CategoryKey = 'strength' | 'conditioning' | 'recovery'

export const TRAINING_CATEGORIES: Record<CategoryKey, TrainingCategory> = {
  strength: {
    label: 'Strength',
    types: ['strength'],
    color: '#E8C860', // gold
    icon: strengthIcon,
  },
  conditioning: {
    label: 'Conditioning',
    types: ['foundation_run', 'running', 'mt_class', 'bag_work', 'skip_rope'],
    color: '#3BB5CC', // cyan-blue
    icon: mobilityIcon,
  },
  recovery: {
    label: 'Recovery',
    types: ['active_recovery', 'mobility'],
    color: '#4ABA8A', // forest-light
    icon: wellnessIcon,
  },
}

export function categorizeSession(type: string): CategoryKey | null {
  for (const [key, cat] of Object.entries(TRAINING_CATEGORIES)) {
    if ((cat.types as readonly string[]).includes(type)) return key as CategoryKey
  }
  return null
}

export function getCategoryTarget(key: CategoryKey): number {
  // Weekly targets by category (derived from TRAINING_TARGETS)
  const targets: Record<CategoryKey, number> = {
    strength: 2,
    conditioning: 8, // 3 foundation + 3 MT + 1 progression + 1 bag
    recovery: 9, // 7 daily mobility + 2 active recovery
  }
  return targets[key]
}

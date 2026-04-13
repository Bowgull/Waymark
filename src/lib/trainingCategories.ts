// Maps session types into ring categories for the Ledger dashboard.
// Used by CompletionRings and the category-completion API endpoint.

export const TRAINING_CATEGORIES = {
  strength: {
    label: 'Strength',
    types: ['strength'],
    color: '#E8C860', // gold
  },
  conditioning: {
    label: 'Conditioning',
    types: ['foundation_run', 'running', 'mt_class', 'bag_work', 'skip_rope'],
    color: '#4ACAAA', // teal
  },
  recovery: {
    label: 'Recovery',
    types: ['active_recovery', 'posture_corrective'],
    color: '#4ABA8A', // forest-light
  },
} as const

export type CategoryKey = keyof typeof TRAINING_CATEGORIES

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
    recovery: 2,
  }
  return targets[key]
}

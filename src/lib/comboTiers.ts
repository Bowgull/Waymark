/**
 * The coach's tier unlocks (FUNDAMENTALS → WEAPONS → FLOW → DECEPTION →
 * MASTERY). Every combo opens with its tier, knees and elbows too (0052): a
 * knee or elbow combo also waits on its Settings switch, so it is only part of
 * his bag, and of the "N mastered" count, when that switch is on.
 */

export const TIER_ORDER = ['foundation', 'weapons', 'flow', 'deception', 'mastery'] as const

/** The groups on by default (Settings' technique switches: knees and elbows off). */
export const DEFAULT_TECHNIQUES = 'boxing,kicks,defensive'

type TierCombo = { tier: string; unlocked: number; techniques?: string | null; source?: string | null }

/** A library combo the coach opened (his own and class combos don't move his level). */
const coachOpened = (c: TierCombo) => c.unlocked === 1 && !c.source

/** Every group the combo uses is switched on (no groups: always). */
export function switchedOn(c: { techniques?: string | null }, enabled: ReadonlySet<string>): boolean {
  const groups = (c.techniques ?? '').split(',').filter(Boolean)
  return groups.every(g => enabled.has(g))
}

/** The tier he is on: the highest where the coach opened a combo (foundation when none). */
export function currentComboTier(combos: ReadonlyArray<TierCombo>): string {
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    if (combos.some(c => c.tier === TIER_ORDER[i] && coachOpened(c))) return TIER_ORDER[i]
  }
  return TIER_ORDER[0]
}

/**
 * The next tier's combos the coach can offer, once 60% of the current tier is
 * mastered (score 9+). Only combos he can train count toward the 60% (a knee
 * combo with KNEES off can't be rated); the offer is the whole next tier, so
 * its knee and elbow combos open with it and wait on their switch.
 */
export function unlockOffer<C extends TierCombo & { masteryScore: number }>(combos: ReadonlyArray<C>, enabled: ReadonlySet<string> = new Set(DEFAULT_TECHNIQUES.split(','))): { tier: string; next: string | null; mastered: number; of: number; offer: C[] } {
  const tier = currentComboTier(combos)
  const mine = combos.filter(c => c.tier === tier && coachOpened(c) && switchedOn(c, enabled))
  const mastered = mine.filter(c => c.masteryScore >= 9).length
  const i = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number])
  const next = TIER_ORDER[i + 1] ?? null
  const ready = mine.length > 0 && mastered / mine.length >= 0.6
  const offer = ready && next ? combos.filter(c => c.tier === next && c.unlocked === 0) : []
  return { tier, next, mastered, of: mine.length, offer }
}

/**
 * The coach's tier unlocks (FUNDAMENTALS → WEAPONS → FLOW → DECEPTION →
 * MASTERY). Knee and elbow combos are open from the start and wait behind
 * their Settings switch instead, so they never say which tier he is on: an
 * open elbow combo in Mastery must not make him a Mastery fighter.
 */

export const TIER_ORDER = ['foundation', 'weapons', 'flow', 'deception', 'mastery'] as const

type TierCombo = { tier: string; unlocked: number; techniques?: string | null }

/** A knee or elbow combo: opened by its Settings switch, not by the coach. */
export function openedBySwitch(c: { techniques?: string | null }): boolean {
  return /\b(knees|elbows)\b/.test(c.techniques ?? '')
}

/** The tier he is on: the highest with a combo the coach unlocked (foundation when none). */
export function currentComboTier(combos: ReadonlyArray<TierCombo>): string {
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    if (combos.some(c => c.tier === TIER_ORDER[i] && c.unlocked === 1 && !openedBySwitch(c))) return TIER_ORDER[i]
  }
  return TIER_ORDER[0]
}

/** The next tier's combos the coach can offer, once 60% of the current tier is mastered (score 9+). */
export function unlockOffer<C extends TierCombo & { masteryScore: number }>(combos: ReadonlyArray<C>): { tier: string; next: string | null; mastered: number; of: number; offer: C[] } {
  const tier = currentComboTier(combos)
  const mine = combos.filter(c => c.tier === tier && c.unlocked === 1 && !openedBySwitch(c))
  const mastered = mine.filter(c => c.masteryScore >= 9).length
  const i = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number])
  const next = TIER_ORDER[i + 1] ?? null
  const ready = mine.length > 0 && mastered / mine.length >= 0.6
  const offer = ready && next ? combos.filter(c => c.tier === next && c.unlocked === 0 && !openedBySwitch(c)) : []
  return { tier, next, mastered, of: mine.length, offer }
}

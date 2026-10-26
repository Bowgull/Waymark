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

/** The unlock card offers this many at a time (page 93: 3 or 4; fewer when fewer are left). */
export const OFFER_SIZE = 4

type OfferCombo = TierCombo & { masteryScore: number; id?: string; text?: string }

const strikesOf = (c: OfferCombo) => (c.text ?? '').split(/\s*(?:→|->|›|>|,)\s*/).filter(Boolean)
/** A combo with a kick or a teep in it (the legs come first on the card). */
const usesLegs = (c: OfferCombo) => strikesOf(c).some(s => /\b(kick|roundhouse|teep)\b/i.test(s))

/**
 * What the coach offers after a bag session, once 60% of what he opened in the
 * current tier is mastered (score 9+): the next 3 or 4 locked combos he can
 * train (page 93), the rest of his tier first, then the next tier; kicks and
 * teeps first, then the shortest. Only combos his Settings switches allow count
 * toward the 60% or are offered: a knee combo waits, locked, until KNEES is on,
 * then comes in its own tier's turn. Each one he keeps is NEW for two weeks
 * (combos.unlocked_at).
 */
export function unlockOffer<C extends OfferCombo>(combos: ReadonlyArray<C>, enabled: ReadonlySet<string> = new Set(DEFAULT_TECHNIQUES.split(','))): { tier: string; next: string | null; mastered: number; of: number; offer: C[] } {
  const tier = currentComboTier(combos)
  const mine = combos.filter(c => c.tier === tier && coachOpened(c) && switchedOn(c, enabled))
  const mastered = mine.filter(c => c.masteryScore >= 9).length
  const i = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number])
  const next = TIER_ORDER[i + 1] ?? null
  const ready = mine.length > 0 && mastered / mine.length >= 0.6
  const rank = (t: string) => { const k = TIER_ORDER.indexOf(t as typeof TIER_ORDER[number]); return k < 0 ? TIER_ORDER.length : k }
  const reach = next ? rank(next) : i
  const offer = ready
    ? combos
      .filter(c => c.unlocked === 0 && !c.source && switchedOn(c, enabled) && rank(c.tier) <= reach)
      .sort((a, b) => rank(a.tier) - rank(b.tier) || Number(usesLegs(b)) - Number(usesLegs(a)) || strikesOf(a).length - strikesOf(b).length || String(a.id ?? '').localeCompare(String(b.id ?? '')))
      .slice(0, OFFER_SIZE)
    : []
  return { tier, next, mastered, of: mine.length, offer }
}

/** The unlock card's line: more of his tier, or the next one opening. */
export function offerMessage(o: { tier: string; mastered: number; of: number; offer: ReadonlyArray<{ tier: string }> }): string {
  const offerTier = o.offer[0]?.tier ?? o.tier
  const ask = offerTier === o.tier ? `Ready for ${o.offer.length} more?` : `Ready to unlock ${offerTier}?`
  return `You've mastered ${o.mastered}/${o.of} ${o.tier} combos. ${ask}`
}

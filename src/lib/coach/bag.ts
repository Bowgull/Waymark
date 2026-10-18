// Bag work governance (map #9). Power and conditioning finishers are the first
// thing to drop after a 7+ day gap and the last to return; technique holds
// (system rules; F12, F13). On an ease day the session is also shorter.
// Pure: the AI prescription and the offline fallback both pass through here.

import type { BlockKind } from './sessions'

export type BagRoundType = 'warmup' | 'technical_flow' | 'drill_isolation' | 'combo_practice' | 'power' | 'conditioning'

export interface BagGovernanceInput {
  blockType: BlockKind
  weekNumber: number
  /** Readiness / load / coach ease today. */
  eased: boolean
  easeReason: string | null
  /** Return ramp after a gap. */
  returnActive: boolean
  gapDays: number
  returnReason: string | null
  /** Injury flag on an upper-body region, or any red flag. */
  injuryReason?: string | null
}

export interface BagRules {
  noFinishers: boolean
  maxRounds: number
  reason: string | null
  /** Lines for the AI prompt. */
  promptLines: string[]
}

const FINISHERS: ReadonlySet<string> = new Set(['power', 'conditioning'])

export function bagRules(g: BagGovernanceInput): BagRules {
  const earlyBlockZero = g.blockType === 'block_zero' && g.weekNumber <= 2
  const noFinishers = g.eased || g.returnActive || earlyBlockZero || !!g.injuryReason
  const maxRounds = g.eased || g.injuryReason ? 4 : g.returnActive ? 5 : 6
  const reason = g.injuryReason
    ?? (g.eased ? g.easeReason ?? 'Easy day.' : null)
    ?? (g.returnActive ? g.returnReason : null)
    ?? (earlyBlockZero ? 'Early Block Zero. Technique only.' : null)
  const promptLines: string[] = []
  if (noFinishers) promptLines.push(`- No power or conditioning rounds today. Finish on technical_flow or combo_practice. Why: ${reason ?? 'technique day'}`)
  promptLines.push(`- At most ${maxRounds} rounds today.`)
  if (g.returnActive) promptLines.push(`- Coming back after ${g.gapDays} days off. Technique volume holds, intensity stays down.`)
  if (g.blockType === 'block_zero') promptLines.push(`- Block Zero week ${g.weekNumber}. Technique and pads level work, never hard rounds.`)
  return { noFinishers, maxRounds, reason, promptLines }
}

/**
 * Apply the rules to prescribed rounds: finishers become technical flow,
 * the count is trimmed (warm-up kept), rounds renumbered.
 */
export function governBagRounds<T extends { roundNumber: number; roundType: string; rationale?: string }>(rounds: T[], rules: BagRules): T[] {
  let out = rounds.map(r => {
    if (!rules.noFinishers || !FINISHERS.has(r.roundType)) return r
    return { ...r, roundType: 'technical_flow', ...(r.rationale !== undefined ? { rationale: `Finisher out. ${rules.reason ?? 'Technique today.'}` } : {}) }
  })
  if (out.length > rules.maxRounds) {
    const warm = out.filter(r => r.roundType === 'warmup').slice(0, 1)
    const rest = out.filter(r => r !== warm[0])
    out = [...warm, ...rest.slice(0, rules.maxRounds - warm.length)]
  }
  return out.map((r, i) => ({ ...r, roundNumber: i + 1 }))
}

/** Offline round types, after the rules. */
export function fallbackRoundTypes(rules: BagRules): BagRoundType[] {
  const full: BagRoundType[] = ['warmup', 'technical_flow', 'combo_practice', 'combo_practice', 'power', 'conditioning']
  const governed = governBagRounds(full.map((t, i) => ({ roundNumber: i + 1, roundType: t })), rules)
  return governed.map(r => r.roundType as BagRoundType)
}

/**
 * Muay Thai class log microcopy — Flavor C (dry, observational dark humor).
 *
 * Canon: no em dashes, no exclamation marks, period-terminated fragments.
 */

export type MtClassPhase = 'logging' | 'saving' | 'complete'

export type MtClassType =
  | 'technical'
  | 'sparring'
  | 'padwork'
  | 'clinch'
  | 'general'

interface MtClassMicroCopy {
  logging: string
  saving: string
  complete: string
}

export const MT_CLASS_GENERIC: MtClassMicroCopy = {
  logging: 'Write it while it is still warm.',
  saving: 'Saving.',
  complete: 'Logged. Close the book.',
}

/** Per-class-type ready line, shown while logging. */
export const MT_CLASS_BY_TYPE: Record<MtClassType, string> = {
  technical: 'Technique is the inventory. Count what you touched.',
  sparring: 'The bruises already know. Put them on the page.',
  padwork: 'What did the pads teach. Be specific.',
  clinch: 'Hips, hands, head. Where did you lose position.',
  general: 'Write it while it is still warm.',
}

export interface MtClassMomentCtx {
  phase: MtClassPhase
  classType?: MtClassType
}

export function resolveMtClassMoment(ctx: MtClassMomentCtx): string | null {
  const { phase, classType } = ctx

  if (phase === 'complete') return MT_CLASS_GENERIC.complete
  if (phase === 'saving') return MT_CLASS_GENERIC.saving

  // logging
  if (classType && MT_CLASS_BY_TYPE[classType]) {
    return MT_CLASS_BY_TYPE[classType]
  }
  return MT_CLASS_GENERIC.logging
}

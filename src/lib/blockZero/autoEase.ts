// Auto-ease (plan: no fixed deload; ease when check-ins or load say run down).
// Triggers: the readiness flag (R10) and/or the soft weekly load flag (R5).
// The eased session gets fewer sets, a lower RPE ceiling, or the run becomes an
// easy walk or bike. One line says why, in the house voice: short sentences,
// no exclamation marks, no em dashes.

export interface PlannedSession {
  type: string
  label: string
  timeSlot: 'am' | 'pm'
  estimatedMin: number
  /** Strength only: hard sets per main lift. */
  sets?: number
  /** Strength only: target RPE band. */
  rpe?: [number, number]
  /** MT class only. */
  classType?: string
}

export interface EaseTriggers {
  readinessEase?: boolean
  /** From latestReadiness().reason. */
  readinessReason?: string | null
  loadFlag?: boolean
  /** From weeklyLoadFlag().reason. */
  loadReason?: string | null
}

export interface EasedSession {
  session: PlannedSession
  eased: boolean
  reason: string | null
}

export const EASED_RPE_CEILING = 6
const RUN_TYPES = new Set(['foundation_run', 'running'])

function cause(t: EaseTriggers): string {
  if (t.readinessEase && t.readinessReason) return t.readinessReason
  if (t.readinessEase) return 'Your check-ins are off trend for 2 days.'
  if (t.loadReason) return t.loadReason
  return 'Load jumped past the guide.'
}

/** Pure: turn a planned session into its eased version, or return it untouched. */
export function easeSession(planned: PlannedSession, triggers: EaseTriggers): EasedSession {
  if (!triggers.readinessEase && !triggers.loadFlag) return { session: planned, eased: false, reason: null }
  const why = cause(triggers)

  if (planned.type === 'strength') {
    const sets = Math.max(1, (planned.sets ?? 2) - 1)
    const hi = Math.min(planned.rpe?.[1] ?? EASED_RPE_CEILING, EASED_RPE_CEILING)
    const lo = Math.min(planned.rpe?.[0] ?? hi - 1, hi)
    return {
      session: { ...planned, sets, rpe: [lo, hi], estimatedMin: Math.round(planned.estimatedMin * 0.75) },
      eased: true,
      reason: `${why} ${sets === 1 ? 'One set' : `${sets} sets`} per lift today, RPE ${hi} cap.`,
    }
  }

  if (RUN_TYPES.has(planned.type)) {
    return {
      session: { ...planned, type: 'active_recovery', label: 'Easy Walk or Bike', estimatedMin: Math.min(planned.estimatedMin, 30) },
      eased: true,
      reason: `${why} The run becomes an easy walk or bike.`,
    }
  }

  if (planned.type === 'skip_rope' || planned.type === 'bag_work') {
    return {
      session: { ...planned, estimatedMin: Math.round(planned.estimatedMin * 0.6) },
      eased: true,
      reason: `${why} Shorter and easier today.`,
    }
  }

  if (planned.type === 'mt_class') {
    return {
      session: { ...planned, classType: 'technical' },
      eased: true,
      reason: `${why} Technique only tonight. Sit out the hard rounds.`,
    }
  }

  // Mobility, back care and recovery stay as planned. They help.
  return { session: planned, eased: false, reason: null }
}

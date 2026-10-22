// The minutes a session's brain dose comes to (page 73: a row's "~Nmin" is
// the coach's own dose, the one its lines and the coach picks' preview show).
// Pure; shared by the server's coach picks and the rows on Program and Today.

import { plannedStrengthMinutes } from '../plannedLength'
import { getStrengthTemplate } from '../strengthTemplates'
import { templateFromDose, type BagDose, type RunDose, type StrengthDose } from './doses'

export interface DoseLike {
  run?: Pick<RunDose, 'totalSec'> | null
  bag?: Pick<BagDose, 'rounds'> | null
  strength?: StrengthDose | null
}

/** A bag round and the rest after it, minutes (3 min rounds, 1 min rest). */
export const BAG_ROUND_MIN = 4

/**
 * The dose's minutes: a run's whole length, a bag's rounds with their rests,
 * a strength day's sets (the template as the dose shapes it). Null when the
 * dose says nothing about the session's length.
 */
export function doseMinutes(s: { scheduledDate?: number | null; blockWeek?: number | null; label?: string | null; blockType?: string | null }, dose: DoseLike | null | undefined): number | null {
  if (!dose) return null
  if (dose.run) return Math.round(dose.run.totalSec / 60)
  if (dose.bag) return dose.bag.rounds * BAG_ROUND_MIN
  if (dose.strength && s.scheduledDate != null) {
    const kind = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
    const t = templateFromDose(getStrengthTemplate(new Date(s.scheduledDate * 86400000).getUTCDay(), s.blockWeek ?? 1, kind, s.label ?? null), dose.strength)
    return plannedStrengthMinutes(t.exercises.flatMap(e => e.sets.map(st => ({ isWarmup: st.isWarmup, restSec: st.restSec }))))
  }
  return null
}

/** The same, from a session row's dose_json. */
export function doseJsonMinutes(s: { scheduledDate?: number | null; blockWeek?: number | null; label?: string | null; blockType?: string | null; doseJson?: string | null }): number | null {
  if (!s.doseJson) return null
  try {
    const d = JSON.parse(s.doseJson) as DoseLike | null
    return d && typeof d === 'object' ? doseMinutes(s, d) : null
  } catch {
    return null
  }
}

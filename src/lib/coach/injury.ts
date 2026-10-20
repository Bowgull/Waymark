// Injury skips become rules (F16), not AI opinions.
// - A skip with reason "injury" flags its region for 10 days: the next
//   sessions touching it are eased or swapped (back: the back-friendly lifts;
//   other regions: a conservative ease). A neck flag also turns the daily
//   Foundation session into its bad-neck version (lib/foundation).
// Pure. Not medical advice.

import { DAY_NAMES, RUN_TYPES, dowOf } from './sessions'

export const INJURY_WINDOW_DAYS = 10

/** Region from the skip sheet's body part or free text. */
export function normaliseRegion(text: string | null | undefined): string | null {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return null
  if (/back|spine|lumbar|disc|sciatic/.test(t)) return 'back'
  if (/knee/.test(t)) return 'knee'
  if (/hip|groin/.test(t)) return 'hip'
  if (/ankle|achilles|foot|heel/.test(t)) return 'ankle'
  if (/shin|calf/.test(t)) return 'shin'
  if (/shoulder/.test(t)) return 'shoulder'
  if (/neck/.test(t)) return 'neck'
  if (/elbow/.test(t)) return 'elbow'
  if (/wrist|hand|finger|knuckle/.test(t)) return 'wrist'
  if (/rib|chest/.test(t)) return 'rib'
  if (/hamstring|quad|thigh|leg/.test(t)) return 'leg'
  return t.trim().slice(0, 30)
}

export interface SkipSignal {
  epochDay: number
  skipReason: string | null
  detail: string | null
  notes: string | null
}

export interface InjuryFlag {
  region: string
  since: number
  /** One line, house voice. */
  reason: string
}

const REGION_NAME: Record<string, string> = { back: 'Back', knee: 'Knee', hip: 'Hip', ankle: 'Ankle', shin: 'Shin', shoulder: 'Shoulder', neck: 'Neck', elbow: 'Elbow', wrist: 'Wrist', rib: 'Ribs', leg: 'Leg' }

/** The active flag on `day`, from injury skips in the last 10 days. */
export function injuryFlag(skips: SkipSignal[], day: number): InjuryFlag | null {
  const inWindow = <T extends { epochDay: number }>(r: T) => r.epochDay <= day && r.epochDay > day - INJURY_WINDOW_DAYS
  const recentSkips = skips.filter(inWindow).sort((a, b) => b.epochDay - a.epochDay)
  const injury = recentSkips.find(s => s.skipReason === 'injury')
  if (!injury) return null
  const region = normaliseRegion(injury.detail) ?? normaliseRegion(injury.notes) ?? 'unspecified'
  const label = REGION_NAME[region] ?? 'An injury'
  return { region, since: injury.epochDay, reason: `${label} flagged on ${DAY_NAMES[dowOf(injury.epochDay)]}.` }
}

export type InjuryAction = 'none' | 'back_swap' | 'ease' | 'walk_or_bike' | 'technical' | 'skip_or_move'

const LOWER = new Set(['back', 'knee', 'hip', 'ankle', 'shin', 'leg'])

/** What a flag does to one session type. */
export function injuryActionFor(type: string, flag: InjuryFlag | null): { action: InjuryAction; note: string | null } {
  if (!flag) return { action: 'none', note: null }
  if (type === 'mobility' || type === 'active_recovery') return { action: 'none', note: null }
  if (type === 'strength') {
    return flag.region === 'back'
      ? { action: 'back_swap', note: `${flag.reason} Back-friendly lifts and one set less today. Stop if it hurts.` }
      : { action: 'ease', note: `${flag.reason} One set less and RPE 6 today. Stop if it hurts.` }
  }
  if (RUN_TYPES.has(type) || type === 'skip_rope') {
    if (flag.region === 'back') return { action: 'walk_or_bike', note: `${flag.reason} Easy walk instead of the run. Walking helps a sore back.` }
    if (LOWER.has(flag.region)) return { action: 'walk_or_bike', note: `${flag.reason} Easy bike instead of the run.` }
    return { action: 'none', note: null }
  }
  // His own bag work can go technique-only. A class can't: what is taught is the
  // gym's call, so the only ease is his call to skip it or move it.
  if (type === 'bag_work') {
    return { action: 'technical', note: `${flag.reason} Technique only. No hard rounds.` }
  }
  if (type === 'mt_class') {
    return { action: 'skip_or_move', note: `${flag.reason} Your call tonight: skip the class or move it.` }
  }
  return { action: 'none', note: null }
}

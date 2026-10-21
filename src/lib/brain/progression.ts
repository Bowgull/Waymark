// Coach brain P2 (coach-brain.md §6.2): which exercise fills each Block Zero
// main slot. He trains at a full commercial gym (barbells, racks with pins, a
// trap bar, dumbbells, cables, machines, heavy bags): no kit list, no setting.
// Progression is earned, not tied to a week:
//   squat  goblet squat  → front squat
//   hinge  DB RDL        → block pull (blocks or the rack's pins), or the
//                          trap bar when his back says so (back-friendly)
//   row    DB row        → bent-over row
// The harder version comes once the easier one is KNOWN, a 3 × 8 has been
// done at 2+ reps left with every rep in, and his back averages 3 or better.
// Once he has done the harder version it stays (unless a back day or the
// raven's plan swaps it for the day). Pure.

import { BACK_FRIENDLY_THRESHOLD, BACK_FRIENDLY_SWAPS } from '../blockZero/strength'
import type { AthleteModel, LiftEstimate } from './types'

export type MainSlot = 'squat' | 'hinge' | 'row'

export interface SlotLadder {
  easy: { exerciseId: string; label: string }
  hard: { exerciseId: string; label: string; note?: string }
  /** The back-friendly harder version (hinge: the trap bar). */
  backFriendly?: { exerciseId: string; label: string; note?: string }
}

export const PIN_PULL_NOTE = "From blocks or the rack's pins, just below the knee."

export const LADDERS: Readonly<Record<MainSlot, SlotLadder>> = {
  squat: { easy: { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat' }, hard: { exerciseId: 'ex-front-squat', label: 'Front Squat' } },
  hinge: {
    easy: { exerciseId: 'ex-db-rdl', label: 'DB Romanian Deadlift' },
    hard: { exerciseId: 'ex-block-pull', label: 'Block Pull', note: PIN_PULL_NOTE },
    backFriendly: { exerciseId: 'ex-trap-bar-deadlift', label: 'Trap-Bar Deadlift', note: 'The trap bar keeps the load in line with you.' },
  },
  row: { easy: { exerciseId: 'ex-db-row', label: 'Dumbbell Row' }, hard: { exerciseId: 'ex-bent-over-row', label: 'Bent Over Row' } },
}

/** The slot a template's main lift fills, by exercise id (null: a fixed lift like the bench). */
export function slotOf(exerciseId: string): MainSlot | null {
  for (const [slot, l] of Object.entries(LADDERS) as Array<[MainSlot, SlotLadder]>) {
    if ([l.easy.exerciseId, l.hard.exerciseId, l.backFriendly?.exerciseId].includes(exerciseId)) return slot
  }
  return null
}

export const EARN_SETS = 3
export const EARN_REPS = 8
export const EARN_RIR = 2
export const EARN_BACK = 3

/** The easier version has earned the step: KNOWN, a full 3 × 8 at 2+ left, no rep missed. */
export function earned(easy: LiftEstimate | undefined): boolean {
  if (!easy || easy.evidence !== 'KNOWN' || !easy.last) return false
  const l = easy.last
  return (l.workSets ?? 0) >= EARN_SETS && l.allReps === true && !l.lowered && (l.minRir ?? -1) >= EARN_RIR
}

/** His back allows a harder spinal load: averaging 3+ (or no back scores yet), no open back plan. */
export function backAllows(model: AthleteModel): boolean {
  const b = model.back
  if (b.openPlans > 0) return false
  const avg = b.last21Mean ?? b.level
  return avg == null || avg >= EARN_BACK
}

/** The back says the trap bar, not the straight bar: the hinge leaves him sorer next morning, or he flagged it as sensitive and his back runs under 3.5. */
export function preferTrapBar(model: AthleteModel): boolean {
  const s = model.back.sensitivity.hinge
  if (s && s.exposures >= 3 && s.delta <= -0.5) return true
  const avg = model.back.last21Mean ?? model.back.level
  return model.back.profileSensitive && avg != null && avg < 3.5
}

export interface SlotChoice {
  exerciseId: string
  label: string
  note: string | null
  /** Why it changed from the template's pick, in plain words (null: as planned). */
  why: string | null
  /** The step to the harder version happened today (its first exposure). */
  stepped: boolean
}

/** The exercise for a main slot today, before any back-day or raven swap. */
export function chooseSlot(slot: MainSlot, model: AthleteModel): SlotChoice {
  const l = LADDERS[slot]
  const done = (id: string | undefined) => id != null && (model.lifts[id]?.exposures ?? 0) > 0
  const trap = slot === 'hinge' && l.backFriendly != null && preferTrapBar(model)
  const harder = trap && l.backFriendly ? l.backFriendly : l.hard
  // Already doing a harder version: it stays.
  if (done(harder.exerciseId)) return { exerciseId: harder.exerciseId, label: harder.label, note: harder.note ?? null, why: null, stepped: false }
  if (slot === 'hinge' && l.backFriendly && done(l.hard.exerciseId) && !trap) return { exerciseId: l.hard.exerciseId, label: l.hard.label, note: l.hard.note ?? null, why: null, stepped: false }
  if (slot === 'hinge' && l.backFriendly && done(l.backFriendly.exerciseId)) return { exerciseId: l.backFriendly.exerciseId, label: l.backFriendly.label, note: l.backFriendly.note ?? null, why: null, stepped: false }
  const easy = model.lifts[l.easy.exerciseId]
  if (earned(easy) && backAllows(model)) {
    return { exerciseId: harder.exerciseId, label: harder.label, note: harder.note ?? null, why: `${l.easy.label} is set: 3 × 8 with 2+ left. ${harder.label} from today.`, stepped: true }
  }
  return { exerciseId: l.easy.exerciseId, label: l.easy.label, note: null, why: null, stepped: false }
}

/** Back today at 2 or less: the back-friendly version for the day (blockZero/strength's swaps). */
export function backDaySwap(exerciseId: string, backToday: number | null): { exerciseId: string; label: string; why: string } | null {
  if (backToday == null || backToday > BACK_FRIENDLY_THRESHOLD) return null
  const swap = BACK_FRIENDLY_SWAPS[exerciseId]
  return swap ? { exerciseId: swap.exerciseId, label: swap.label, why: `Back is at ${backToday} today. ${swap.label} keeps load off the spine.` } : null
}

/** Squat-pattern lifts load the knee: the raven's knee, ankle or shin plan swaps them for glute bridges. */
const KNEE_LOADED = /squat|lunge|step-up|leg-press/
const LOWER_LEG = new Set(['knee', 'ankle', 'shin', 'calf', 'foot', 'achilles'])

export function ravenSwap(exerciseId: string, openPlans: ReadonlyArray<{ region: string }>): { exerciseId: string; label: string; why: string } | null {
  const plan = openPlans.find(p => LOWER_LEG.has(p.region.toLowerCase()))
  if (!plan || !KNEE_LOADED.test(exerciseId)) return null
  const place = plan.region.charAt(0).toUpperCase() + plan.region.slice(1).toLowerCase()
  return { exerciseId: 'ex-glute-bridges', label: 'Glute Bridges', why: `${place} plan: Glute Bridges keep load off the ${plan.region.toLowerCase()}.` }
}

// The move to the next block (coach-brain.md §8, approved 2026-10-20). Pure.
//
// When all four parts are in (at least 4 weeks in), the coach sets the move:
// - the next 5-7 days are lighter: volume down 30-50%, intensity held (R16):
//   the same weights and run pieces, fewer sets and rounds, no new steps;
// - that week's normal sets give the new e1RMs, and the starting weights are
//   training maxes at no more than 90% of e1RM (the existing guard);
// - the following Monday becomes Fighter Block 1: a Dagaz rune on that Monday
//   with UNDO ("stay in Block Zero") until it starts. The TM writes are a
//   change row with UNDO too.
// From a Monday, Tuesday or Wednesday the lighter days start at once and the
// Monday after is 5-7 days away; from Thursday on, the lighter week is the
// next calendar week.

import { e1rmFromRir, epley } from '../blockZero/e1rm'
import { isFighterMainLift } from '../blockZero/lifts'
import { minLevel, type BagDose, type RunDose, type StrengthDose } from './doses'
import { runWalkTotalSec } from '../blockZero/running'

export const LIGHTER_VOLUME = 0.6
export const TM_FROM_E1RM = 0.9
/** After an UNDO ("stay in Block Zero"), the coach looks again a week later. */
export const MOVE_AGAIN_AFTER_DAYS = 7

const dowOf = (day: number) => ((day % 7) + 11) % 7

/** The lighter days and the Monday the next block starts, for a move set on `today`. */
export function moveDates(today: number): { lighterFrom: number; monday: number } {
  const toMonday = ((8 - dowOf(today)) % 7) || 7
  if (toMonday >= 5) return { lighterFrom: today, monday: today + toMonday }
  const monday = today + toMonday + 7
  return { lighterFrom: monday - 7, monday }
}

export function inLighter(day: number, move: { lighterFrom: number; monday: number } | null | undefined): boolean {
  return move != null && day >= move.lighterFrom && day < move.monday
}

export const LIGHTER_WHY = 'Lighter week before Fighter Block 1: same weights, fewer sets.'
const LIGHTER_RUN_WHY = 'Lighter week before Fighter Block 1: same run pieces, fewer rounds.'
const LIGHTER_BAG_WHY = 'Lighter week before Fighter Block 1: fewer rounds.'

/** Strength: each lift's sets × 0.6 (at least 2, a work-up keeps its sets), weights held, no new steps. */
export function lighterStrength(d: StrengthDose): StrengthDose {
  const lifts = d.lifts.map(l => {
    if (l.workUp) return { ...l, level: minLevel(l.level, 'HOLD') }
    const sets = Math.max(2, Math.round(l.sets * LIGHTER_VOLUME))
    const held = l.change === 'increase' && l.fromKg != null ? { weightKg: l.fromKg, change: 'hold' as const } : {}
    return { ...l, sets: Math.min(l.sets, sets), ...held, level: minLevel(l.level, 'HOLD') }
  })
  return { ...d, lifts, sets: lifts.reduce((n, l) => n + l.sets, 0), level: minLevel(d.level, 'HOLD'), why: [LIGHTER_WHY, ...d.why.filter(w => w !== LIGHTER_WHY)] }
}

/** Run: the same run pieces, rounds × 0.6 (at least 2). */
export function lighterRun(d: RunDose): RunDose {
  if (d.walkOnly) return d
  if (d.rounds <= 1) {
    const sec = Math.max(60, Math.round((d.runSec * LIGHTER_VOLUME) / 30) * 30)
    return { ...d, runSec: sec, totalSec: sec, runTotalSec: sec, level: minLevel(d.level, 'HOLD'), why: [LIGHTER_RUN_WHY, ...d.why] }
  }
  const rounds = Math.max(2, Math.min(d.rounds, Math.round(d.rounds * LIGHTER_VOLUME)))
  const totalSec = runWalkTotalSec({ runSec: d.runSec, walkSec: d.walkSec, rounds, warmupSec: d.warmupSec })
  return { ...d, rounds, totalSec, runTotalSec: d.runSec * rounds, level: minLevel(d.level, 'HOLD'), why: [LIGHTER_RUN_WHY, ...d.why] }
}

/** Bag: rounds × 0.6 (at least 2), no finishers. */
export function lighterBag(d: BagDose): BagDose {
  return { ...d, rounds: Math.max(2, Math.min(d.rounds, Math.round(d.rounds * LIGHTER_VOLUME))), finishers: false, level: minLevel(d.level, 'HOLD'), why: [LIGHTER_BAG_WHY, ...d.why] }
}

export interface MoveSet { exerciseId: string; weightKg: number | null; reps: number; rir: number | null }

/** Best e1RM per lift from the lighter week's logged sets (1-10 reps; reps + reps left when logged, else Epley). */
export function e1rmsFromSets(sets: readonly MoveSet[]): Map<string, number> {
  const best = new Map<string, number>()
  for (const s of sets) {
    if (s.weightKg == null || !(s.weightKg > 0) || s.reps < 1) continue
    const e = (s.rir != null ? e1rmFromRir(s.weightKg, s.reps, s.rir) : null) ?? epley(s.weightKg, s.reps)
    if (e != null && e > (best.get(s.exerciseId) ?? 0)) best.set(s.exerciseId, e)
  }
  return best
}

/**
 * Starting training maxes for Fighter Block 1: 90% of each Fighter main lift's
 * e1RM (the lighter week's sets first, else the athlete model's), to the half
 * kg, never above that guard. Lifts with no e1RM keep the max they have.
 */
export function startingMaxes(fromSets: ReadonlyMap<string, number>, fromModel: ReadonlyMap<string, number>): Array<{ exerciseId: string; kg: number; e1rmKg: number }> {
  const out: Array<{ exerciseId: string; kg: number; e1rmKg: number }> = []
  const ids = new Set([...fromSets.keys(), ...fromModel.keys()])
  for (const id of ids) {
    if (!isFighterMainLift(id)) continue
    const e = fromSets.get(id) ?? fromModel.get(id)
    if (e == null || !(e > 0)) continue
    const kg = Math.floor(e * TM_FROM_E1RM * 2) / 2
    out.push({ exerciseId: id, kg, e1rmKg: Math.round(e * 100) / 100 })
  }
  return out.sort((a, b) => a.exerciseId.localeCompare(b.exerciseId))
}

// Tactical Barbell Fighter in Block Zero (page 99, approved 2026-11-11).
//
// Two strength days, A and B. Each day's first two sessions are the lead-in:
// every big lift works up to one solid set of 5, and those sets give it its
// max (training max, TM: 90% of the best estimated 1RM). From the third
// session the day runs the TB wave on that max: 3x5 at 75%, 3x5 at 80%, 3x3 at
// 90%, twice. The wave goes by the sessions he does, not the calendar, so a
// missed week never skips a step. After each 6 sessions, a lift whose 90% sets
// were all clean goes up 5 lb (upper) or 10 lb (lower); missed reps hold it.
//
// A lift that joins later (the overhead press, the block pull) finds its
// weight the first time, and that session sets its own max. Each press keeps
// its own max, so picking landmine or overhead on the day never breaks the wave.
//
// Pure: everything comes from his logged sets, so nothing is stored.

import type { ModelSet } from './types'
import { liftRegion } from '../blockZero/strength'

export type TbDay = 'A' | 'B'

/** Sessions of a day that find the weights before its wave starts. */
export const TB_LEAD_IN = 2

/** The lift that counts a day's sessions: the squat on A, the hinge on B. */
export const TB_ANCHOR: Readonly<Record<TbDay, readonly string[]>> = {
  A: ['ex-front-squat'],
  B: ['ex-rdl', 'ex-block-pull', 'ex-deadlift'],
}

/** The lifts on the wave (the landmine punch and the chin-ups aren't). */
export const TB_WAVE_LIFTS: ReadonlySet<string> = new Set([
  'ex-front-squat', 'ex-bench-press', 'ex-bent-over-row',
  'ex-rdl', 'ex-block-pull', 'ex-deadlift', 'ex-landmine-press', 'ex-ohp',
])

export type TbPress = 'landmine' | 'overhead'
export const TB_PRESS_ID: Readonly<Record<TbPress, string>> = { landmine: 'ex-landmine-press', overhead: 'ex-ohp' }

/** The TM's share of the estimated 1RM (Tactical Barbell). */
export const TM_OF_E1RM = 0.9
/** What a clean wave adds: 5 lb upper, 10 lb lower. */
export const TM_STEP_KG: Readonly<Record<'upper' | 'lower', number>> = { upper: 2.27, lower: 4.54 }

export interface TbPlan {
  day: TbDay
  leadIn: boolean
  /** 1-6 on the wave; null in the lead-in. */
  waveWeek: number | null
  pct: number | null
  sets: number
  reps: number
  /** B's hinge: RDL for the lead-in and the first 2 wave sessions, the block pull for the next 2, then the deadlift. */
  hinge: { exerciseId: string; label: string }
}

interface Exposure { sessionId: string; day: number; sets: ModelSet[] }

/** Completed sessions before `before` with his logged working sets of any of `ids`, oldest first. */
export function exposures(sets: readonly ModelSet[], done: ReadonlySet<string>, ids: readonly string[], before: number): Exposure[] {
  const by = new Map<string, Exposure>()
  for (const x of sets) {
    if (x.isWarmup || !x.logged || x.day >= before || !done.has(x.sessionId) || !ids.includes(x.exerciseId)) continue
    const e = by.get(x.sessionId) ?? { sessionId: x.sessionId, day: x.day, sets: [] }
    e.sets.push(x)
    by.set(x.sessionId, e)
  }
  return [...by.values()].sort((a, b) => a.day - b.day)
}

/** Week 1-6 of the wave: 75 / 80 / 90 / 75 / 80 / 90. */
export function tbPct(waveWeek: number): number {
  const w = ((waveWeek - 1) % 6) + 1
  return w === 1 || w === 4 ? 0.75 : w === 2 || w === 5 ? 0.8 : 0.9
}

export function tbSetsReps(waveWeek: number): { sets: number; reps: number } {
  return tbPct(waveWeek) === 0.9 ? { sets: 3, reps: 3 } : { sets: 3, reps: 5 }
}

/** Where a day stands on `before`: the lead-in, or its wave week. */
export function tbPlanFor(day: TbDay, sets: readonly ModelSet[], done: ReadonlySet<string>, before: number): TbPlan {
  const n = exposures(sets, done, TB_ANCHOR[day], before).length
  const leadIn = n < TB_LEAD_IN
  const waveIndex = leadIn ? 0 : n - TB_LEAD_IN + 1
  const waveWeek = leadIn ? null : ((waveIndex - 1) % 6) + 1
  const sr = waveWeek == null ? { sets: 3, reps: 5 } : tbSetsReps(waveWeek)
  const hinge = waveIndex <= 2 ? { exerciseId: 'ex-rdl', label: 'Romanian Deadlift' }
    : waveIndex <= 4 ? { exerciseId: 'ex-block-pull', label: 'Block Pull' }
      : { exerciseId: 'ex-deadlift', label: 'Deadlift' }
  return { day, leadIn, waveWeek, pct: waveWeek == null ? null : tbPct(waveWeek), sets: sr.sets, reps: sr.reps, hinge }
}

/** Epley with the reps he had left: the weight times (1 + (reps + left) / 30). No RIR logged reads as 1 left. */
export function e1rmKg(weightKg: number, reps: number, rir: number | null): number {
  return weightKg * (1 + (reps + Math.min(rir ?? 1, 3)) / 30)
}

/**
 * A lift's max on `before`, or null (it finds its weight today). The base is
 * 90% of the best e1RM from its finding sessions: those in its day's lead-in,
 * else its first session. Each finished wave of its day then adds a step if
 * every one of the lift's 90% sets that wave got all its reps.
 */
export function tbMaxKg(day: TbDay, exerciseId: string, sets: readonly ModelSet[], done: ReadonlySet<string>, before: number): number | null {
  const own = exposures(sets, done, [exerciseId], before)
  if (own.length === 0) return null
  const anchor = exposures(sets, done, TB_ANCHOR[day], before)
  const leadInEnd = anchor.length >= TB_LEAD_IN ? anchor[TB_LEAD_IN - 1].day : Infinity
  const inLeadIn = own.filter(e => e.day <= leadInEnd)
  const finding = inLeadIn.length > 0 ? inLeadIn : own.slice(0, 1)
  const best = Math.max(0, ...finding.flatMap(e => e.sets.filter(x => (x.weightKg ?? 0) > 0 && x.reps > 0).map(x => e1rmKg(x.weightKg as number, x.reps, x.rir))))
  if (!(best > 0)) return null
  let tm = best * TM_OF_E1RM
  const fixedDay = finding[finding.length - 1].day
  const wave = anchor.slice(TB_LEAD_IN)
  const step = TM_STEP_KG[liftRegion(exerciseId)]
  for (let k = 0; k + 5 < wave.length; k += 6) {
    if (wave[k].day <= fixedDay) continue
    const heavy = new Set([wave[k + 2].sessionId, wave[k + 5].sessionId])
    const heavySets = own.filter(e => heavy.has(e.sessionId)).flatMap(e => e.sets)
    if (heavySets.length > 0 && heavySets.every(x => x.reps >= (x.plannedReps ?? 3))) tm += step
  }
  return Math.round(tm * 100) / 100
}

/** The press picked on a session (context_json.press); the landmine until he picks. */
export function pressPickFrom(contextJson: string | null | undefined): TbPress {
  if (!contextJson) return 'landmine'
  try {
    return (JSON.parse(contextJson) as { press?: unknown }).press === 'overhead' ? 'overhead' : 'landmine'
  } catch {
    return 'landmine'
  }
}

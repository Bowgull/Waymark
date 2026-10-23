// Starting point from his history (Josh, 2026-10-21: "start me at my real
// level"). The live model is built from the active block's own events; before
// he has logged a lift or a run in the block, those areas start from what he
// did before it, with a time-off discount, instead of from nothing.
//
// - Lifts: the weight of his last exposure of each lift (main or accessory
//   sets with a weight, from a finished session), less a discount for the
//   time off: none up to 2 weeks, then 5% plus 2.5% a month, at most 20%.
//   Snapped to what can be loaded, and always at least one step under the old
//   weight once there is a discount. That weight is only the TOP (Josh,
//   2026-10-23: months off, much weaker than his logs): every lift still
//   starts light and works up ("find your weight"), never above it.
// - Run: his typical continuous run (the median of runs of 8 min to 2 h),
//   rounded to 5 min and never over his longest less the same discount. Ten
//   minutes or more means easy continuous runs; less, a run-walk piece.
// - Uncertainty starts moderate (SEED_U, a little careful the first week),
//   not at GUESS, and his own sessions take over from the first one.
//
// Nothing here is a setting or a question. History older than SEED_MAX_DAYS
// before the block is too old to start from. Pure.

import { snapLoadKg, type LoadEquipment } from '../strengthLoads'
import { getStrengthTemplate } from '../strengthTemplates'
import { chooseSlot, slotOf } from './progression'
import type { AthleteModel, ModelEvents, ModelSet } from './types'
import { clamp, round } from './uncertainty'

/** The starting uncertainty of a seeded area: between KNOWN (0.15) and LEARNING (0.5). */
export const SEED_U = 0.4
/** History this many days before the block start or older seeds nothing. */
export const SEED_MAX_DAYS = 270
/** How far back the history is read. */
export const SEED_LOOKBACK_DAYS = 365
export const DISCOUNT_FREE_DAYS = 14
export const DISCOUNT_BASE = 0.05
export const DISCOUNT_PER_MONTH = 0.025
export const DISCOUNT_MAX = 0.2
/** A run shorter than this (a stub) or longer than this (a typo) is not a continuous run. */
export const SEED_RUN_MIN_SEC = 8 * 60
export const SEED_RUN_MAX_SEC = 2 * 3600
/** From this long a run is a continuous run, not a run-walk piece. */
export const CONTINUOUS_FROM_SEC = 600

export interface SeededLift {
  exerciseId: string
  equipment: ModelSet['equipment']
  /** The heaviest weight of his last exposure (kg). */
  lastKg: number
  lastReps: number
  lastDay: number
  /** Exposures with a weight in the history. */
  exposures: number
  /** The most a first session works up to: the old weight less the time-off discount, snapped (kg). Never the start. */
  capKg: number
}

export interface SeededRun {
  /** The continuous run (or run-walk piece) to start from, sec. */
  rungSec: number
  medianSec: number
  longestSec: number
  runs: number
  /** Average HR over the runs that had one. */
  avgHr: number | null
  lastDay: number
}

export interface HistorySeed {
  /** The day the seed applies from (the block start). */
  fromDay: number
  /** His last logged day in the history. */
  lastDay: number
  daysOff: number
  /** Strength (and run length) discount for the time off, 0-0.2. */
  discount: number
  u: number
  lifts: Record<string, SeededLift>
  run: SeededRun | null
}

/** The discount for `daysOff` days without training: none to 2 weeks, then 5% + 2.5% a month, at most 20%. */
export function timeOffDiscount(daysOff: number): number {
  if (daysOff <= DISCOUNT_FREE_DAYS) return 0
  return round(clamp(DISCOUNT_BASE + DISCOUNT_PER_MONTH * ((daysOff - DISCOUNT_FREE_DAYS) / 30), 0, DISCOUNT_MAX), 3)
}

/** The top for a first session back: the old weight less the discount, snapped, at least one step under it once discounted. */
export function discountedKg(lastKg: number, discount: number, equipment: LoadEquipment): number {
  if (discount <= 0 || equipment === 'none') return round(snapLoadKg(lastKg, equipment, { direction: 'nearest' }), 2)
  const snapped = snapLoadKg(lastKg * (1 - discount), equipment, { direction: 'nearest' })
  const old = snapLoadKg(lastKg, equipment, { direction: 'nearest' })
  if (snapped < old - 0.01) return round(snapped, 2)
  const down = snapLoadKg(old * 0.99, equipment, { direction: 'down' })
  return round(down < old - 0.01 ? down : snapped, 2)
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The run-walk pieces a short seed falls back to (sec), shortest first. */
const RUN_WALK_PIECES = [60, 90, 120, 210, 240]

/**
 * The seed from events logged before `fromDay` (the block start). Null when
 * there is nothing to start from, or it is older than SEED_MAX_DAYS.
 */
export function seedFromHistory(prior: ModelEvents, fromDay: number): HistorySeed | null {
  const done = new Set(prior.sessions.filter(s => s.status === 'completed' && s.day < fromDay).map(s => s.id))
  const notDone = new Set(prior.sessions.filter(s => s.status === 'missed' || s.status === 'skipped').map(s => s.id))
  // A set counts when he logged it, or its session was finished with a weight on it (older app versions
  // left completed_at empty). Nothing from a missed or skipped session.
  const sets = prior.sets.filter(s => s.day < fromDay && !s.isWarmup && (s.section === 'main' || s.section === 'accessory')
    && s.weightKg != null && s.weightKg > 0 && s.reps > 0 && !notDone.has(s.sessionId) && (s.logged || done.has(s.sessionId)))
  const runs = prior.runs.filter(r => r.day < fromDay && done.has(r.sessionId) && r.durationSec != null
    && r.durationSec >= SEED_RUN_MIN_SEC && r.durationSec <= SEED_RUN_MAX_SEC && (r.pieceSec == null || r.pieceSec >= CONTINUOUS_FROM_SEC))
  const days = [...sets.map(s => s.day), ...runs.map(r => r.day)]
  if (days.length === 0) return null
  const lastDay = Math.max(...days)
  const daysOff = fromDay - lastDay
  if (daysOff > SEED_MAX_DAYS) return null
  const discount = timeOffDiscount(daysOff)

  const lifts: Record<string, SeededLift> = {}
  const byLift = new Map<string, ModelSet[]>()
  for (const s of sets) byLift.set(s.exerciseId, [...(byLift.get(s.exerciseId) ?? []), s])
  for (const [id, xs] of byLift) {
    const lastSessionDay = Math.max(...xs.map(s => s.day))
    const last = xs.filter(s => s.day === lastSessionDay)
    const top = last.reduce((m, s) => ((s.weightKg as number) > (m.weightKg as number) ? s : m), last[0])
    const equipment = top.equipment
    if (equipment === 'none') continue
    lifts[id] = {
      exerciseId: id, equipment, lastKg: round(top.weightKg as number, 2), lastReps: top.reps, lastDay: lastSessionDay,
      exposures: new Set(xs.map(s => s.sessionId)).size,
      capKg: discountedKg(top.weightKg as number, discount, equipment),
    }
  }

  let run: SeededRun | null = null
  if (runs.length > 0) {
    const secs = runs.map(r => r.durationSec as number)
    const med = median(secs)
    const longest = Math.max(...secs)
    const cap = longest * (1 - discount)
    let rung = Math.min(Math.round(med / 300) * 300, Math.floor(cap / 60) * 60)
    if (rung < CONTINUOUS_FROM_SEC) rung = [...RUN_WALK_PIECES].reverse().find(p => p <= Math.min(med, cap)) ?? RUN_WALK_PIECES[0]
    const hrs = runs.map(r => r.avgHr).filter((h): h is number => h != null && h > 0)
    run = {
      rungSec: rung, medianSec: Math.round(med), longestSec: longest, runs: runs.length,
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      lastDay: Math.max(...runs.map(r => r.day)),
    }
  }
  if (Object.keys(lifts).length === 0 && !run) return null
  return { fromDay, lastDay, daysOff, discount, u: SEED_U, lifts, run }
}

/** A seeded area's uncertainty on `today`: SEED_U, rising 0.1 a week from the block start with nothing new. */
export function seededU(seed: Pick<HistorySeed, 'fromDay' | 'u'>, today: number): number {
  return round(clamp(seed.u + Math.floor(Math.max(0, today - seed.fromDay) / 7) * 0.1, 0, 1))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The month of a local epoch day, in words ("June"). */
export function monthOf(day: number): string {
  return MONTHS[new Date(day * 86400000).getUTCMonth()]
}

/** "4 months" / "3 weeks" / "10 days" for a gap. */
export function gapWords(days: number): string {
  if (days >= 60) return `${Math.round(days / 30)} months`
  if (days >= 14) return `${Math.round(days / 7)} weeks`
  return `${days} days`
}

// ─── The week's first strength session ───────────────────────

export const BLOCK_ZERO_DAYS = ['A', 'B', 'C'] as const

/**
 * Which Block Zero strength day goes in first when a week has none: the one
 * whose main lifts the model already has weights for (from the block or his
 * history), then the one he has done most, then A, B, C order. The why is
 * plain and quotes only the time off it computed.
 */
export function firstStrengthPick(model: AthleteModel, blockWeek: number): { label: string; why: string } {
  let best: { label: string; known: number; exposures: number } | null = null
  for (const d of BLOCK_ZERO_DAYS) {
    const label = `Strength ${d}`
    const main = getStrengthTemplate(1, blockWeek, 'block_zero', label).exercises.filter(e => e.section === 'main')
    let known = 0
    let exposures = 0
    for (const e of main) {
      const slot = slotOf(e.exerciseId)
      const id = slot ? chooseSlot(slot, model).exerciseId : e.exerciseId
      const l = model.lifts[id]
      if ((l?.workingKg != null && l.workingSource !== 'training_max') || l?.seed != null) known++
      exposures += (l?.exposures ?? 0) + (l?.seed ? 1 : 0)
    }
    if (!best || known > best.known || (known === best.known && exposures > best.exposures)) best = { label, known, exposures }
  }
  const seeded = Object.values(model.lifts).find(l => l.workingSource === 'history' && l.seed)
  const why = seeded?.seed && seeded.seed.discount > 0
    ? `strength starts this week, not next Monday. Every lift starts light after ${gapWords(seeded.seed.daysOff)} off; your last sessions are only the top.`
    : 'strength starts this week, not next Monday.'
  return { label: (best as { label: string }).label, why }
}

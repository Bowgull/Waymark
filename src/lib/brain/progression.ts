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

/**
 * Rebuild Phase 4: the harder version's first ladder starts from the easier
 * one's estimate, not the empty bar. Rough carry-overs at sets of 8 (one
 * dumbbell held to two hands on a bar): front squat about 1.5x the goblet
 * dumbbell, a block pull 2.2x and the trap bar 2.4x one RDL dumbbell, a
 * bent-over row 1.5x the one-arm row. The ladder starts at 70% of it and
 * climbs, so a rough guess costs a set, not a week.
 */
export const EASIER_CARRY: Readonly<Record<string, { from: string; x: number }>> = {
  'ex-front-squat': { from: 'ex-goblet-squat', x: 1.5 },
  'ex-block-pull': { from: 'ex-db-rdl', x: 2.2 },
  'ex-trap-bar-deadlift': { from: 'ex-db-rdl', x: 2.4 },
  'ex-bent-over-row': { from: 'ex-db-row', x: 1.5 },
}

/** The harder version's working weight (kg, 8 reps at about 2 left) from the easier one's e1RM; null when there is none. */
export function startFromEasier(slot: MainSlot, exerciseId: string, model: AthleteModel): number | null {
  const carry = EASIER_CARRY[exerciseId]
  if (!carry || LADDERS[slot].easy.exerciseId !== carry.from) return null
  const easy = model.lifts[carry.from]
  if (!easy?.e1rmKg) return null
  return (easy.e1rmKg / (1 + (8 + 2) / 30)) * carry.x
}

/** Back today at 2 or less: the back-friendly version for the day (blockZero/strength's swaps). */
export function backDaySwap(exerciseId: string, backToday: number | null): { exerciseId: string; label: string; why: string } | null {
  if (backToday == null || backToday > BACK_FRIENDLY_THRESHOLD) return null
  const swap = BACK_FRIENDLY_SWAPS[exerciseId]
  return swap ? { exerciseId: swap.exerciseId, label: swap.label, why: `Back is at ${backToday} today. ${swap.label} keeps load off the spine.` } : null
}

// Away (rebuild Phase 8, audit #12): no gym, so each main lift has a
// bodyweight or band version a hotel room allows. The arm block and core stay
// (dumbbells, if the hotel has them, or he skips them).
const AWAY: Readonly<Record<string, { exerciseId: string; label: string }>> = (() => {
  const squat = { exerciseId: 'ex-tempo-squat', label: 'Tempo Squat' }
  const hinge = { exerciseId: 'ex-single-leg-rdl', label: 'Single-Leg RDL' }
  const row = { exerciseId: 'ex-band-row', label: 'Band Row' }
  const push = { exerciseId: 'ex-push-up', label: 'Push-Up' }
  const press = { exerciseId: 'ex-pike-push-up', label: 'Pike Push-Up' }
  const lunge = { exerciseId: 'ex-reverse-lunge', label: 'Reverse Lunge' }
  const by: Array<[string[], { exerciseId: string; label: string }]> = [
    [['ex-goblet-squat', 'ex-front-squat', 'ex-lm-squat'], squat],
    [['ex-db-rdl', 'ex-block-pull', 'ex-trap-bar-deadlift', 'ex-rdl', 'ex-deadlift', 'ex-lm-rdl', 'ex-lm-sl-rdl'], hinge],
    [['ex-db-row', 'ex-bent-over-row', 'ex-lm-meadows-row'], row],
    [['ex-bench-press', 'ex-db-bench-press', 'ex-incline-db-press'], push],
    [['ex-landmine-press', 'ex-lm-press-standing', 'ex-ohp', 'ex-db-ohp', 'ex-lm-punch', 'ex-lm-push-press', 'ex-lm-rotational-press'], press],
    [['ex-lm-reverse-lunge', 'ex-lm-lateral-lunge', 'ex-bulgarian-split-squat'], lunge],
  ]
  return Object.fromEntries(by.flatMap(([ids, to]) => ids.map(id => [id, to])))
})()

/** Away from home (a note says so): the main lift's bodyweight or band version, or null. */
export function awaySwap(exerciseId: string, away: boolean | undefined): { exerciseId: string; label: string; why: string } | null {
  if (!away) return null
  const to = AWAY[exerciseId]
  return to ? { ...to, why: `Away, per your note: ${to.label} in place of the gym lift.` } : null
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

// ─── The press pick (rebuild Phase 5, page 93) ───────────────
//
// The coach picks the press: the landmine press while his shoulders and back
// rebuild (half-kneeling first, standing once the landmine is a habit), the
// overhead press once they're solid (the standing landmine press done clean
// twice, his back allows it, no open shoulder or back plan), and from then
// on the coach swaps the two: the landmine press on a rough morning or a
// sore-back day (lighter), and every other week for variety; the overhead
// press otherwise (heavier). One plain line says why, behind a tap.

export const PRESS_REBUILD_WHY = "Landmine press while your shoulders and back rebuild. Overhead press comes in once they're solid, then the coach swaps the two for heavy, light and variety days."
export const PRESS_HEAVY_WHY = 'Overhead press today: your shoulders and back are solid. The coach swaps it with the landmine press for heavy, light and variety days.'
export const PRESS_LIGHT_WHY = 'Landmine press today: a lighter press for a rough morning or a sore back.'
export const PRESS_VARIETY_WHY = 'Landmine press this week for variety. The overhead press comes back next week.'

export interface PressPick { exerciseId: string; label: string; explain: string; solid: boolean }

/** Shoulders and back solid enough for the overhead press. */
export function pressSolid(ctx: { model: AthleteModel; openPlans: ReadonlyArray<{ region: string }> }, landmineLast: Readonly<Record<string, ReadonlyArray<{ allReps: boolean; lastRir: number | null }>>>): boolean {
  const standing = landmineLast['ex-lm-press-standing'] ?? []
  // Two standing presses in a row with every rep in and nothing at the limit (a set step-up can end at 1 left).
  const clean = standing.length >= 2 && standing.slice(0, 2).every(e => e.allReps && e.lastRir != null && e.lastRir >= 1)
  const plans = ctx.openPlans.some(p => /shoulder|back|neck/i.test(p.region))
  return clean && !plans && backAllows(ctx.model)
}

export function choosePress(ctx: { day: number; state: string; backToday: number | null; model: AthleteModel; openPlans: ReadonlyArray<{ region: string }> }, landmineLast: Readonly<Record<string, ReadonlyArray<{ allReps: boolean; lastRir: number | null }>>>, stage: number): PressPick {
  const half = landmineLast['ex-landmine-press'] ?? []
  // Standing once the landmine is past its first stage and the half-kneeling press went clean.
  const standing = (landmineLast['ex-lm-press-standing'] ?? []).length > 0 || (stage >= 2 && half.length > 0 && half[0].allReps && half[0].lastRir != null && half[0].lastRir >= 2)
  const lm = standing ? { exerciseId: 'ex-lm-press-standing', label: 'Standing Landmine Press' } : { exerciseId: 'ex-landmine-press', label: 'Landmine Press' }
  if (!pressSolid(ctx, landmineLast)) return { ...lm, explain: PRESS_REBUILD_WHY, solid: false }
  if (ctx.state === 'AMBER' || ctx.state === 'RED' || (ctx.backToday != null && ctx.backToday <= BACK_FRIENDLY_THRESHOLD)) return { ...lm, explain: PRESS_LIGHT_WHY, solid: true }
  // Every other week the landmine press, for variety (weeks counted from Monday).
  if (Math.floor((ctx.day + 3) / 7) % 2 === 1) return { ...lm, explain: PRESS_VARIETY_WHY, solid: true }
  return { exerciseId: 'ex-ohp', label: 'Overhead Press', explain: PRESS_HEAVY_WHY, solid: true }
}

// ─── The arm block's reps (rebuild Phase 4) ──────────────────

/** A reps-only move's last session: the reps of each working set, and the plan. */
export interface RepsLast { exerciseId: string; day: number; reps: number[]; plannedReps: number }

/**
 * Chin-ups on the built ladder, reps only, never added weight: slow lowering
 * 3 → 5, then full chin-ups 3 → 8. No band, ever (Josh, 2026-10-29). Every
 * set at its reps adds one; the top of a rung moves to the next. A missed set holds.
 */
export const CHIN_LADDER = [
  { exerciseId: 'ex-chin-up-negative', label: 'Chin-Up (Slow Lowering)', from: 3, to: 5 },
  { exerciseId: 'ex-chin-up', label: 'Chin-Up', from: 3, to: 8 },
] as const

export function chinUpDose(repsLast: Readonly<Record<string, RepsLast>>, hold: boolean): { exerciseId: string; label: string; reps: number; change: 'start' | 'increase' | 'hold' } {
  const done = CHIN_LADDER.map((r, i) => ({ r, i, last: repsLast[r.exerciseId] })).filter(x => x.last).sort((a, b) => b.last!.day - a.last!.day)[0]
  if (!done) return { exerciseId: CHIN_LADDER[0].exerciseId, label: CHIN_LADDER[0].label, reps: CHIN_LADDER[0].from, change: 'start' }
  const { r, i, last } = done
  const at = last!.plannedReps
  const clean = last!.reps.length > 0 && last!.reps.every(x => x >= at)
  if (!clean || hold) return { exerciseId: r.exerciseId, label: r.label, reps: at, change: 'hold' }
  if (at >= r.to && i < CHIN_LADDER.length - 1) { const n = CHIN_LADDER[i + 1]; return { exerciseId: n.exerciseId, label: n.label, reps: n.from, change: 'increase' } }
  return { exerciseId: r.exerciseId, label: r.label, reps: Math.min(r.to, at + 1), change: at >= r.to ? 'hold' : 'increase' }
}

/** The other reps-only moves: every set at its reps adds a step, up to a top (Copenhagen and the shins in seconds or reps). */
export const REPS_STEPS: Readonly<Record<string, { to: number; step: number }>> = {
  'ex-nordic-curl': { to: 8, step: 1 },
  'ex-copenhagen-plank': { to: 40, step: 5 },
  'ex-tibialis-raise': { to: 25, step: 2 },
  'ex-dips': { to: 12, step: 1 },
}

export function repsDose(exerciseId: string, planned: number, last: RepsLast | null, hold: boolean): { reps: number; change: 'start' | 'increase' | 'hold' } | null {
  const r = REPS_STEPS[exerciseId]
  if (!r) return null
  if (!last) return { reps: planned, change: 'start' }
  const clean = last.reps.length > 0 && last.reps.every(x => x >= last.plannedReps)
  if (!clean || hold || last.plannedReps >= r.to) return { reps: last.plannedReps, change: 'hold' }
  return { reps: Math.min(r.to, last.plannedReps + r.step), change: 'increase' }
}

/** The reps-only moves' last sessions (before `before`, completed sessions), from the model's events. */
export function repsLastFrom(sets: ReadonlyArray<{ exerciseId: string; sessionId: string; day: number; reps: number; plannedReps: number | null; isWarmup: boolean; logged: boolean }>, doneSessionIds: ReadonlySet<string>, before: number): Record<string, RepsLast> {
  const ids = new Set<string>([...CHIN_LADDER.map(r => r.exerciseId), ...Object.keys(REPS_STEPS)])
  const out: Record<string, RepsLast> = {}
  const rows = sets.filter(s => ids.has(s.exerciseId) && !s.isWarmup && s.logged && s.day < before && doneSessionIds.has(s.sessionId))
  for (const s of rows) {
    const cur = out[s.exerciseId]
    if (cur && cur.day > s.day) continue
    if (!cur || cur.day < s.day) out[s.exerciseId] = { exerciseId: s.exerciseId, day: s.day, reps: [], plannedReps: s.plannedReps ?? s.reps }
    out[s.exerciseId].reps.push(s.reps)
  }
  return out
}

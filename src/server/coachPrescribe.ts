// Apply the coach state (return ramp, an applied coach ease, an injury flag)
// to Fighter strength templates and run prescriptions. Block Zero strength
// goes through planBlockZeroStrength with the same inputs. Pure apart from
// the types; app.ts loads the state with loadSessionCoachState.

import { backFriendlyVariation, singleRunCap } from '../lib/blockZero'
import { scaleSets } from '../lib/coach'
import type { StrengthTemplate, TemplateSet } from '../lib/strengthTemplates'
import type { SessionCoachState } from './coachData'

/** Load cut for a reduced or injury-eased Fighter strength day. */
export const EASED_LOAD_FACTOR = 0.9
/** Run time on a small coach ease. */
export const EASED_RUN_FACTOR = 0.8

export interface FighterStrengthAdjust {
  template: StrengthTemplate
  /** Multiplier on TM x wave after the trend factor. */
  loadMultiplier: number
  /** Trend / AthleteState factors may not go above 1. */
  noPush: boolean
  notes: string[]
}

export function adjustFighterStrength(template: StrengthTemplate, state: SessionCoachState): FighterStrengthAdjust {
  const notes: string[] = []
  let loadMultiplier = 1
  let dropSets = 0
  let noPush = false
  const ramp = state.returnCtx.active ? state.returnCtx : null
  if (ramp) {
    loadMultiplier *= ramp.loadFactor
    noPush = true
    if (ramp.reason) notes.push(ramp.reason)
  }
  const injury = state.injuryAction.action
  if (injury === 'ease' || injury === 'back_swap') {
    dropSets = 1
    loadMultiplier *= EASED_LOAD_FACTOR
    noPush = true
    if (state.injuryAction.note) notes.push(state.injuryAction.note)
  } else if (state.coachEase?.kind === 'reduce') {
    dropSets = 1
    loadMultiplier *= EASED_LOAD_FACTOR
    noPush = true
    notes.push(`${state.coachEase.reason} One set less, load down 10%.`)
  }
  if (notes.length === 0) return { template, loadMultiplier, noPush, notes }

  const note = notes.join(' ')
  const exercises = template.exercises.map(tex => {
    if (tex.section !== 'main') return tex
    let next = tex
    if (injury === 'back_swap') {
      const pick = backFriendlyVariation(tex.exerciseId, 1)
      if (pick.swapped) next = { ...next, exerciseId: pick.exerciseId, label: pick.label ?? next.label }
    }
    const warm = next.sets.filter((s: TemplateSet) => s.isWarmup)
    const working = next.sets.filter((s: TemplateSet) => !s.isWarmup)
    const keep = Math.max(1, (ramp ? scaleSets(working.length, ramp.volumeFactor) : working.length) - dropSets)
    return { ...next, sets: [...warm, ...working.slice(0, keep)], notes: `${note} ${next.notes ?? ''}`.trim() }
  })
  return { template: { ...template, exercises }, loadMultiplier, noPush, notes }
}

export interface RunLike {
  targetDesc: string
  targetDurSec: number | null
}

/**
 * Fighter runs: an applied ease or a lower-body injury turns the run into an
 * easy walk or bike; the return ramp trims time; the single-run cap (F11,
 * 110% of the 30-day longest) applies to every run.
 */
export function adjustFighterRun<T extends RunLike>(p: T, state: SessionCoachState, longestLast30Sec: number | null): T & { coach: { eased: boolean; reasons: string[] } } {
  const reasons: string[] = []
  const injuryWalk = state.injuryAction.action === 'walk_or_bike'
  if (injuryWalk || state.coachEase?.kind === 'run_to_walk') {
    const why = injuryWalk ? state.injuryAction.note ?? '' : state.coachEase?.reason ?? ''
    const min = Math.min(30, Math.max(15, Math.round((p.targetDurSec ?? 1800) / 60)))
    return { ...p, targetDesc: `Easy walk or bike, ${min} min. ${why}`.trim(), targetDurSec: min * 60, coach: { eased: true, reasons: [why] } }
  }
  let dur = p.targetDurSec
  let desc = p.targetDesc
  if (dur != null && state.returnCtx.active) {
    dur = Math.round(dur * state.returnCtx.volumeFactor)
    if (state.returnCtx.reason) reasons.push(state.returnCtx.reason)
  }
  // A small coach ease on a run (felt hard, weekly ease): about 80% of the time.
  if (dur != null && state.coachEase?.kind === 'reduce') {
    dur = Math.round(dur * EASED_RUN_FACTOR)
    reasons.push(state.coachEase.reason)
  }
  if (dur != null) {
    const cap = singleRunCap(dur, longestLast30Sec)
    if (cap.capSec < dur) {
      dur = cap.capSec
      if (cap.reason) reasons.push(cap.reason)
    }
  }
  if (dur !== p.targetDurSec) desc = `Cut to ${Math.round((dur ?? 0) / 60)} min today. ${desc}`
  if (reasons.length > 0) desc = `${desc} ${reasons.join(' ')}`
  return { ...p, targetDesc: desc.trim(), targetDurSec: dur, coach: { eased: false, reasons } }
}

// ─── An accepted push (ramp-up ask) ───────────────────────────

export interface CoachPushLike {
  kind: 'extra_set' | 'load_step'
  factor?: number
  reason: string
}

export interface PushApplied {
  template: StrengthTemplate
  /** Multiplier on main working loads (1 for an extra set). */
  loadFactor: number
  note: string | null
  applied: boolean
}

/**
 * The athlete said yes to a push. +1 SET adds one working set (a copy of the
 * last) to each main lift; MORE WEIGHT raises main loads (the caller caps the
 * combined push at +5%). Never on a day the rules ease (return ramp, a coach
 * ease, an injury flag): then it is skipped with a note.
 */
export function applyCoachPush(template: StrengthTemplate, push: CoachPushLike | null, state: SessionCoachState): PushApplied {
  if (!push) return { template, loadFactor: 1, note: null, applied: false }
  if (state.returnCtx.active || state.coachEase != null || state.injuryAction.action !== 'none') {
    return { template, loadFactor: 1, note: 'The push waits: today is an easier day.', applied: false }
  }
  if (push.kind === 'load_step') {
    return { template, loadFactor: push.factor && push.factor > 1 ? push.factor : 1.05, note: push.reason, applied: true }
  }
  const exercises = template.exercises.map(tex => {
    if (tex.section !== 'main') return tex
    const working = tex.sets.filter((s: TemplateSet) => !s.isWarmup)
    const last = working[working.length - 1]
    if (!last || last.loadMultiplier != null) return tex
    return { ...tex, sets: [...tex.sets, { ...last }], notes: `${push.reason} ${tex.notes ?? ''}`.trim() }
  })
  return { template: { ...template, exercises }, loadFactor: 1, note: push.reason, applied: true }
}

/** One line for a lift's trend factor, so an automatic load change always says why. */
export function liftTrendReason(name: string, factor: number): string | null {
  if (factor > 1) return `${name}: beat the plan in 2 of the last 3 sessions. Load up ${Math.round((factor - 1) * 100)}%.`
  if (factor < 1) return `${name}: short of the plan lately. Load down ${Math.round((1 - factor) * 100)}%.`
  return null
}

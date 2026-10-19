// Small auto, big ask (plan, map #3). The mid-week coach's decision is sorted:
// SMALL changes keep the session and its day and only make it easier (reduce
// intensity, a run becomes a walk or bike, fewer sets, hold). They apply to
// the target session at once, with a note. BIG changes (a different session
// type, another day, an added session) are stored as a proposal the athlete
// accepts or rejects. Big changes are never applied on their own. Pure.

import type { ReactiveReplanOutput } from '../prompts/tools'
import { RUN_TYPES } from './sessions'

/**
 * What an applied ease does to the session. Stored in sessions.context_json.coachEase.
 * reduce: one set less and about 10% lighter (a run: about 80% of the time, or capMin);
 * run_to_walk: an easy walk or bike; one_set: one main set less, same weights
 * (the rebalance, page 56); rounds: a run-walk of this many rounds.
 */
export type CoachEaseKind = 'reduce' | 'run_to_walk' | 'one_set' | 'rounds'

export interface CoachEase {
  kind: CoachEaseKind
  reason: string
  source: 'reactive' | 'injury' | 'rebalance'
  /** Unix seconds. */
  at: number
  /** rounds: the run-walk's rounds. */
  rounds?: number
  /** reduce on a run: its minutes. */
  capMin?: number
}

const EASE_KINDS: ReadonlySet<string> = new Set(['reduce', 'run_to_walk', 'one_set', 'rounds'])

export type ReplanClass =
  | { size: 'small'; action: 'note' }
  | { size: 'small'; action: 'ease'; kind: CoachEaseKind }
  | { size: 'big'; action: 'swap' | 'move' | 'add' }

const EASIER_THAN_A_RUN = new Set(['active_recovery', 'mobility'])

/**
 * Sort one reactive decision. `target` is the planned session it is about,
 * when one was found.
 */
export function classifyReplan(output: Pick<ReactiveReplanOutput, 'shiftAction' | 'targetSessionType'>, target: { type: string; notes?: string | null } | null): ReplanClass {
  switch (output.shiftAction) {
    case 'hold':
      return { size: 'small', action: 'note' }
    case 'reduce_intensity':
      if (!target) return { size: 'small', action: 'note' }
      return { size: 'small', action: 'ease', kind: RUN_TYPES.has(target.type) ? 'run_to_walk' : 'reduce' }
    case 'swap':
      // A run becoming a walk, a bike or an easy run is an ease, not a new session.
      if (target && RUN_TYPES.has(target.type)) {
        if (EASIER_THAN_A_RUN.has(output.targetSessionType)) return { size: 'small', action: 'ease', kind: 'run_to_walk' }
        if (target.type === 'running' && target.notes === 'progression' && output.targetSessionType === 'foundation_run') {
          return { size: 'small', action: 'ease', kind: 'reduce' }
        }
      }
      return { size: 'big', action: 'swap' }
    case 'move':
      return { size: 'big', action: 'move' }
    case 'add_recovery':
      return { size: 'big', action: 'add' }
    default:
      return { size: 'small', action: 'note' }
  }
}

/** Read an applied ease back from a session's context_json. */
export function coachEaseFrom(contextJson: string | null | undefined): CoachEase | null {
  if (!contextJson) return null
  try {
    const parsed = JSON.parse(contextJson) as { coachEase?: CoachEase }
    const e = parsed.coachEase
    if (!e || !EASE_KINDS.has(e.kind) || typeof e.reason !== 'string') return null
    return e
  } catch {
    return null
  }
}

/** Merge a coach ease into existing context_json without dropping other keys. */
export function withCoachEase(contextJson: string | null | undefined, ease: CoachEase): string {
  let base: Record<string, unknown> = {}
  if (contextJson) {
    try { base = JSON.parse(contextJson) as Record<string, unknown> } catch { base = {} }
  }
  return JSON.stringify({ ...base, coachEase: ease })
}

/** Merge any keys into context_json, keeping what is there. */
export function mergeContext(contextJson: string | null | undefined, patch: Record<string, unknown>): string {
  let base: Record<string, unknown> = {}
  if (contextJson) {
    try { base = JSON.parse(contextJson) as Record<string, unknown> } catch { base = {} }
  }
  return JSON.stringify({ ...base, ...patch })
}

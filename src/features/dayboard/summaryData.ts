// The data an opened row reads (page 33's summary, page 73's lines): one
// fetch per session from the existing per-type endpoints.

import { apiFetch } from '@/lib/api'
import type { HardPlan } from '@/lib/brain/hardRuns'
import type { PostRunFacts } from '@/lib/postRun'
import type { ConditioningLog, ConditioningPlan } from '@/lib/coach/bagConditioning'

import { rowStatus, type DayBoardSession, type RunActuals, type RunPlan, type WorkoutExercise } from './rowState'

export interface RunPrescription extends RunPlan {
  targetDesc?: string | null
  /** A Block Zero run-walk as prescribed (caps included). */
  runWalk?: { runSec: number; walkSec: number; rounds: number; warmupSec: number } | null
  /** A hard run (page 76): its pieces, speeds and heart range. */
  hard?: HardPlan | null
  /** An easy run's treadmill speed (page 76), km/h. */
  easyKmh?: number | null
}

export type SummaryData =
  | { kind: 'strength'; exercises: WorkoutExercise[]; notes: string[]; plannedMin: number | null; brainLifts?: Array<{ exerciseId: string; change: string; explain?: string | null }> }
  | { kind: 'run'; plan: RunPrescription | null; run: RunActuals | null; post?: PostRunFacts | null }
  | { kind: 'mobility'; moves: Array<{ name: string; completed: boolean; sets?: number | null; holdSec?: number | null; reps?: number | null; perSide?: boolean; section?: string | null }>; plannedMin: number | null }
  | { kind: 'bag'; rounds: number; plannedMin: number | null; plannedSecs: number[]; roundSecs: number[] | null; restSec?: number | null; firstCombo?: string | null; roundCombos?: string[][] }
  | { kind: 'conditioning'; plan: ConditioningPlan | null; log: ConditioningLog | null; plannedMin: number | null }
  | { kind: 'rope'; rounds: number | null; roundSec: number | null; plannedMin: number | null; roundSecs: number[] | null }
  | { kind: 'mt'; plannedMin: number | null; durationMin: number | null; classType: string | null; focus: string | null; mtLogId: string | null; learned: boolean }
  | { kind: 'recovery'; hip: boolean | null; foam: boolean | null }
  | { kind: 'none' }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** The coach's reasons for today's loads, from the strength preview. */
function coachNotes(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as { coach?: Record<string, unknown>; blockZero?: Record<string, unknown> }
  const out: string[] = []
  const coach = r.coach ?? {}
  const ramp = coach.returnRamp as { reason?: unknown } | null | undefined
  const ease = coach.coachEase as { reason?: unknown } | null | undefined
  const injury = coach.injury as { note?: unknown } | null | undefined
  for (const v of [ramp?.reason, ease?.reason, injury?.note]) {
    const s = str(v)
    if (s) out.push(s)
  }
  if (Array.isArray(coach.notes)) for (const n of coach.notes) { const s = str(n); if (s) out.push(s) }
  const auto = r.blockZero?.autoEase as { eased?: unknown; reason?: unknown } | undefined
  if (auto?.eased) { const s = str(auto.reason); if (s) out.push(s) }
  return [...new Set(out)]
}

/** The data a row's summary reads, from the per-type endpoints (Program's and Today's opened rows, page 73). */
export async function loadSummary(s: DayBoardSession): Promise<SummaryData> {
  const done = rowStatus(s.status) === 'done'
  switch (s.type) {
    case 'strength': {
      // A started or finished session reads its logged rows; a planned one the preview.
      const res = await apiFetch<{ exercises?: WorkoutExercise[]; plannedMin?: number | null; brain?: { lifts?: Array<{ exerciseId: string; change: string }> } } & Record<string, unknown>>(done ? `/api/sessions/${s.id}/workout` : `/api/sessions/${s.id}/strength-preview`)
      return { kind: 'strength', exercises: res.exercises ?? [], notes: done ? [] : coachNotes(res), plannedMin: typeof res.plannedMin === 'number' ? res.plannedMin : null, brainLifts: res.brain?.lifts ?? [] }
    }
    case 'running':
    case 'foundation_run': {
      const path = s.type === 'foundation_run' ? 'foundation-run-workout' : 'run-workout'
      const res = await apiFetch<{ runSession: RunActuals | null; prescription: RunPrescription | null; post?: PostRunFacts | null }>(`/api/sessions/${s.id}/${path}`)
      return { kind: 'run', plan: res.prescription ?? null, run: res.runSession ?? s.runSession ?? null, post: res.post ?? null }
    }
    case 'mobility': {
      const res = await apiFetch<{ exercises?: Array<{ completed?: number | boolean; exercise?: { name: string } | null; sets?: number | null; holdSec?: number | null; reps?: number | null; perSide?: boolean; section?: string | null }>; plannedMin?: number | null }>(`/api/sessions/${s.id}/mobility-workout`)
      return { kind: 'mobility', moves: (res.exercises ?? []).map(e => ({ name: e.exercise?.name ?? 'Move', completed: e.completed === 1 || e.completed === true, sets: e.sets ?? null, holdSec: e.holdSec ?? null, reps: e.reps ?? null, perSide: e.perSide === true, section: e.section ?? null })), plannedMin: res.plannedMin ?? null }
    }
    case 'bag_work': {
      const res = await apiFetch<{ rounds?: Array<{ durationSec: number; restSec: number; combos?: Array<{ combo?: { text?: string } | null }> }>; plannedMin?: number | null; roundSecs?: number[] | null }>(`/api/sessions/${s.id}/bag-workout`)
      const rounds = res.rounds ?? []
      return { kind: 'bag', rounds: rounds.length, plannedMin: res.plannedMin ?? null, plannedSecs: rounds.map(r => r.durationSec), roundSecs: res.roundSecs ?? null, restSec: rounds[0]?.restSec ?? null, firstCombo: rounds[0]?.combos?.[0]?.combo?.text ?? null, roundCombos: rounds.map(r => (r.combos ?? []).map(c => c.combo?.text ?? '').filter(Boolean)) }
    }
    case 'bag_conditioning': {
      // page 93: the plan (kept once started; before, the coach's pick as it would be now) and the per-part log
      const res = await apiFetch<{ plan?: ConditioningPlan | null; log?: ConditioningLog | null; plannedMin?: number | null }>(`/api/sessions/${s.id}/bag-conditioning`)
      return { kind: 'conditioning', plan: res.plan ?? null, log: res.log ?? null, plannedMin: res.plannedMin ?? null }
    }
    case 'skip_rope': {
      const res = await apiFetch<{ skipSession: { roundCount: number; roundDurSec: number } | null; plannedMin?: number | null; roundSecs?: number[] | null }>(`/api/sessions/${s.id}/skip-rope-workout`)
      return { kind: 'rope', rounds: res.skipSession?.roundCount ?? null, roundSec: res.skipSession?.roundDurSec ?? null, plannedMin: res.plannedMin ?? null, roundSecs: res.roundSecs ?? null }
    }
    case 'mt_class': {
      const res = await apiFetch<{ mtLog: { id: string; classType: string | null; focusSkill: string | null; durationMin: number | null; learnedNote?: string | null } | null; plannedMin?: number | null }>(`/api/sessions/${s.id}/mt-class-workout`)
      return { kind: 'mt', plannedMin: res.plannedMin ?? null, durationMin: res.mtLog?.durationMin ?? null, classType: res.mtLog?.classType ?? null, focus: res.mtLog?.focusSkill ?? null, mtLogId: res.mtLog?.id ?? null, learned: Boolean(res.mtLog?.learnedNote) }
    }
    case 'active_recovery': {
      const res = await apiFetch<{ recoverySession: { hipMobility: number; foamRolling: number } | null }>(`/api/sessions/${s.id}/recovery-workout`)
      const r = res.recoverySession
      return { kind: 'recovery', hip: r ? r.hipMobility === 1 : null, foam: r ? r.foamRolling === 1 : null }
    }
    default:
      return { kind: 'none' }
  }
}


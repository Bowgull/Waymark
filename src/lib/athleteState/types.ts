// Athlete-State data model. See docs/ATHLETE_STATE_SPEC.md §1.
import type { LiftDirection, LiftVerdict, SessionSignal } from './liftTrends'

export type ReadinessLevel = 'fresh' | 'normal' | 'taxed' | 'overreached'
export type WeekShape = 'as_planned' | 'pull_back' | 'add_recovery' | 'push_volume'
export type FlagKind = 'pain' | 'plateau' | 'overreach' | 'undertrained'

export interface LiftAssessment {
  exerciseId: string
  exerciseName: string
  verdict: LiftVerdict
  loadFactor: number
  rationale: string
  trendSummary: string
}

export interface AthleteStateFlag {
  kind: FlagKind
  detail: string
}

// The persisted artifact every downstream surface reads.
export interface AthleteState {
  readiness: ReadinessLevel
  readinessRationale: string
  lifts: LiftAssessment[]
  weekShape: WeekShape
  weekShapeRationale: string
  flags: AthleteStateFlag[]
  note: string
  computedAtEpoch: number
  trigger: string
  modelVersion: string
}

// ─── Assembled context (input to the reasoning pass, Phase 2) ──────

export interface LiftContext {
  exerciseId: string
  exerciseName: string
  direction: LiftDirection
  verdict: LiftVerdict
  loadFactor: number
  // newest-first session signals over the window
  sessions: Array<{ epochDay: number; signal: SessionSignal }>
}

export interface EffortPoint {
  epochDay: number
  type: string
  rpe: number | null
  difficulty: number | null
}

export interface WellnessPoint {
  epochDay: number
  sleepHours: number | null
  soreness: number | null
  alcoholScale: number | null
}

export interface NotePoint {
  epochDay: number
  source: 'session' | 'daily_log'
  text: string
}

export interface RunQualityPoint {
  epochDay: number
  completionStatus: string | null
  paceSecKm: number | null
  avgHr: number | null
  maxHr: number | null
  shortReason: string | null
}

export interface AthleteContext {
  todayEpochDay: number
  todayDow: number
  weekStart: number
  weekEnd: number
  lifts: LiftContext[]
  effort: EffortPoint[]
  wellness: WellnessPoint[]
  notes: NotePoint[]
  runs: RunQualityPoint[]
  adherenceBlock: string | null
  hrBlock: string | null
  comboRatings: Array<{ epochDay: number; rating: number }>
  bodyweightKg: number | null
  trainingMaxes: Array<{ exerciseName: string; weightKg: number }>
  // Prior conclusion, read back from coaching_outputs. Phase 2 populates this;
  // null until the reasoning pass has run at least once (the memory hook).
  priorState: AthleteState | null
}

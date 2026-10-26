// Coach brain P1 (coach-brain.md §4): what the athlete model reads and what it
// holds. Pure types. The model is built by folding logged events in day order
// (athleteModel.ts); the server loads the events from D1 and stores the result
// in athlete_estimates (server/athleteModel.ts). P1 changes no decision or dose:
// the estimates are shadow facts for P2.

/** Evidence state of an estimate (§4): GUESS → LEARNING → KNOWN. */
export type EstimateState = 'GUESS' | 'LEARNING' | 'KNOWN'

export type AreaKind = 'lift' | 'run' | 'bag' | 'class' | 'recovery' | 'back' | 'adherence' | 'load' | 'level'

/** Reasons that mean "it didn't fit the day", never "it was too hard" (Josh, 2026-10-20). */
export const SCHEDULE_REASONS: ReadonlySet<string> = new Set(['schedule', 'time', 'no_time', 'class_time'])

export function isScheduleReason(reason: string | null | undefined): boolean {
  return reason != null && SCHEDULE_REASONS.has(reason)
}

// ─── Events (what was logged) ────────────────────────────────

export interface ModelSession {
  id: string
  type: string
  status: string
  /** Local epoch day it was planned for. */
  day: number
  /** Planned slot. */
  slot: 'am' | 'pm' | null
  /** Local minute of day it was started (0-1439), from started_at and the athlete's time zone. */
  startMin: number | null
  durationSec: number | null
  rpe: number | null
  skipReason: string | null
  /** 'template' | 'ad_hoc' | 'coach' | 'replace' | null. ad_hoc / replace = his own pick. */
  source: string | null
  blockType: string | null
  notes: string | null
  /** Average HR for the session when a strap or watch recorded one (any type). */
  avgHr?: number | null
  /** He swapped this in for another session (page 56 replace): the type it replaced. */
  replacedFrom?: string | null
}

export interface ModelSet {
  sessionId: string
  day: number
  exerciseId: string
  section: string | null
  setNumber: number
  weightKg: number | null
  reps: number
  plannedWeightKg: number | null
  plannedReps: number | null
  /** 0-3, 3 = "3 or more". Null when not logged. */
  rir: number | null
  isWarmup: boolean
  /** Logged by him (completed_at set). Pre-filled sets he never touched are not. */
  logged: boolean
  /** Loading kind from the library ('barbell' | 'dumbbell' | 'machine' | 'none'). */
  equipment: 'barbell' | 'dumbbell' | 'machine' | 'landmine' | 'none'
}

export interface ModelRun {
  sessionId: string
  day: number
  type: string
  durationSec: number | null
  plannedDurationSec: number | null
  distanceKm: number | null
  avgHr: number | null
  maxHr: number | null
  /** Per-km splits with HR, when the run had them (Strava). */
  splits: Array<{ durationSec: number; avgHr: number | null }>
  isIndoor: boolean
  completionStatus: string | null
  shortReason: string | null
  rpe: number | null
  /** The run piece (seconds of running per interval): the run-walk's, or the whole run when continuous. */
  pieceSec: number | null
  /** The ladder rung the coach's dose aimed at (P2 dose_json), when it had one. */
  rungSec?: number | null
  /** Its dose was an easy walk or bike (no running): it never moves the run rung (audit #8). */
  walkOnly?: boolean
  /**
   * A hard run (Tempo, Intervals, the 5K test; rebuild Phase 3): judged on its own targets, never
   * against the easy line, and kept out of the easy-run rung. Its heart top from its dose.
   */
  hard?: 'tempo' | 'intervals' | '5k_test' | null
  hardTop?: number | null
  /** The week's longer Zone 2 Run (the week plan's long mark): it grows on its own path. */
  long?: boolean
}

export interface ModelBag {
  sessionId: string
  day: number
  status: string
  roundsPlanned: number
  /** Distinct rounds he rated (null when nothing was rated: rounds done unknown). */
  roundsRated: number | null
  /** Rounds he actually worked (the finish's per-round seconds), rated or not. */
  roundsDone?: number | null
  /** Why he ended early (the one-tap reason): 'no_time' holds, never "too hard". */
  endReason?: string | null
  /** Combo ratings, 1-3 (3 = Sharp, 2 = Solid). */
  ratings: number[]
  rpe: number | null
  skipReason: string | null
}

export interface ModelCheckIn {
  day: number
  sleepHours: number | null
  sleepQuality: number | null
  energy: number | null
  soreness: number | null
  stress: number | null
  mood: number | null
  backToday: number | null
}

export interface ModelNote {
  day: number
  text: string
  source: 'check_in' | 'session' | 'journal' | 'back'
}

/** His own move of a session from one day to another (page 56 move / pull forward). */
export interface ModelMove {
  fromDay: number
  toDay: number
  type: string
}

export interface ModelEvents {
  profile: { dob: string | null; maxHr: number | null; backSensitive: boolean }
  sessions: ModelSession[]
  sets: ModelSet[]
  runs: ModelRun[]
  talkTests: Array<{ day: number; bpm: number }>
  bag: ModelBag[]
  checkIns: ModelCheckIn[]
  notes: ModelNote[]
  moves: ModelMove[]
  /** MT class logs: whether "What you learned" was written (page 49). */
  classLogs: Array<{ sessionId: string; day: number; learned: boolean; /** The class type he logged afterwards (only for a default effort). */ classType?: string | null }>
  /** Training maxes on file: a GUESS prior for a lift with no logged sets. */
  trainingMaxes: Array<{ exerciseId: string; weightKg: number; day: number }>
  /** Open raven plans by region (body_alerts not cleared). */
  openBodyAlerts: Array<{ region: string; stage: string }>
}

// ─── The model ───────────────────────────────────────────────

export interface Confidence {
  /** Evidence state from the KNOWN criteria (§4 table), before ageing. */
  evidence: EstimateState
  /** State as reported: from u after ageing (a layoff turns KNOWN back into LEARNING / GUESS). */
  state: EstimateState
  n: number
  /** Last local day with an observation for this area. */
  lastDay: number | null
  /** 0-1: 1 = GUESS, ~0.5 = LEARNING, ~0.15 = KNOWN, +0.1 per 7 days without data. */
  u: number
}

export interface LiftExposure {
  day: number
  /** Heaviest working weight he used, and what was prescribed. */
  topKg: number | null
  plannedKg: number | null
  /** Reported RIR on the last working set. */
  lastRir: number | null
  /** He lowered the weight below the prescription mid-session (Josh, §6.2). */
  lowered: boolean
  /** He raised it and still hit the target reps. */
  raised: boolean
  /** A set not finished: fewer reps than prescribed, or a prescribed set never logged. */
  incomplete: boolean
  /** Short of the reps while saying 2+ were left on that set: a reporting gap (his RIR bias), not a miss. */
  claimedShort?: boolean
  /** Working sets he logged, and whether every one hit its planned reps. */
  workSets?: number
  allReps?: boolean
  /** Lowest RIR he reported on a working set. */
  minRir?: number | null
  /** Last-set e1RM of this exposure (null without RIR). */
  e1rmKg: number | null
}

export interface LiftEstimate extends Confidence {
  exerciseId: string
  /** Smoothed e1RM (EWMA α 0.3, ≤3% a session), after the detraining prior. Null with no RIR yet. */
  e1rmKg: number | null
  /** Spread of the last-set e1RMs (sd, kg). */
  e1rmSdKg: number | null
  /** Working weight for the default target (8 reps at RIR 2), snapped; else the weight he last used. */
  workingKg: number | null
  workingSource: 'e1rm' | 'used' | 'training_max' | 'history' | null
  /** Started from his history before the block (no exposure in the block yet), with the time-off discount. */
  seed?: { lastKg: number; lastDay: number; daysOff: number; discount: number; /** The most a first session works up to (kg). */ capKg: number } | null
  /** His RIR bias in reps (+ = more in reserve than he says), ±0.25 a session, clamped ±1.5. */
  rirBias: number
  equipment: ModelSet['equipment']
  /** Exposures with RIR on the last set. */
  rirExposures: number
  exposures: number
  last: LiftExposure | null
  /** The last three exposures, oldest first. */
  recent?: LiftExposure[]
  /** Consecutive latest exposures with an ease sign (lowered / incomplete / last RIR ≤ 1). */
  easeStreak: number
}

export interface RunObservation {
  day: number
  sessionId: string
  durationSec: number | null
  pieceSec: number | null
  /** Share of running time under the line (0-1), and where it came from. */
  u: number | null
  uSource: 'splits' | 'avg' | 'max' | 'none'
  driftBpm: number | null
  avgHr: number | null
  rpe: number | null
  hasHr: boolean
  isIndoor: boolean
  /** Less running than planned, or an early end. */
  cutShort: boolean
  /** The cut-short reason was time / schedule: HOLD, never "too hard". */
  scheduleCut: boolean
  /** HR above the line (U under 70%). */
  tooFast: boolean
  /** U near 100%, HR 10+ under the line, effort ≤4. */
  tooSlow: boolean
  /** Handled at U ≥85% and effort ≤5 (or no effort logged and HR fine). */
  handled: boolean
  /** Not handled: U <70%, effort ≥7, drift ≥10, a calf/shin note, or cut short (not for time). */
  struggled: boolean
}

/** A hard run judged on its own targets (rebuild Phase 3): done in full, heart under its top. */
export interface HardObservation {
  day: number
  sessionId: string
  kind: 'tempo' | 'intervals' | '5k_test'
  /** Done as planned: not cut short, nine tenths of it or more. */
  completed: boolean
  /** The highest heart rate and the run's top (null: no strap, or no top on file). */
  maxHr: number | null
  top: number | null
  rpe: number | null
}

export interface RunEstimate extends Confidence {
  /** Talk-test line (bpm) and where it came from. */
  lineBpm: number
  lineSource: 'talk_test' | 'prior'
  /** The age prior (0.78 × Tanaka), for comparison. */
  linePriorBpm: number
  talkTests: number
  lastTalkTestDay: number | null
  /** A talk-test recheck is due: ≥21 days since the last, or U and drift disagree with the line. */
  recheckDue: boolean
  recheckWhy: string | null
  /** EWMA over the last 3 runs. */
  uShare: number | null
  driftBpm: number | null
  /** Longest run piece handled (sec), after the detraining prior. */
  rungSec: number
  /** The day the rung last went up (one rung a week at most). */
  rungUpDay?: number | null
  /**
   * Where the rung came from: his runs in the block, or his history before it
   * (no run in the block yet). From 10 min it is a continuous easy run, not a run-walk piece.
   */
  rungSource?: 'block' | 'history' | 'prior'
  /** The history the rung was seeded from (typical and longest run, sec; average HR). */
  seed?: { medianSec: number; longestSec: number; runs: number; avgHr: number | null; lastDay: number; daysOff: number } | null
  longestLast30Sec: number | null
  /** Pace (sec/km) of runs held at the line (U ≥85%), indoor or out. */
  easyPaceSecKm: number | null
  runsWithHr: number
  runs: number
  lastRunHadHr: boolean | null
  /** The last easy runs (hard runs are never in here: they have their own targets). */
  recent: RunObservation[]
  /** The last hard runs (Tempo, Intervals, 5K tests), oldest first. */
  hardRecent?: HardObservation[]
  /**
   * The week's longer Zone 2 Run: the length the last one aimed at, and how many good ones
   * (handled, not cut short) in a row at that length. Null before the first.
   */
  long?: { lastSec: number; goodInRow: number; lastDay: number } | null
  /**
   * The longest run in 30 days other than the week's longer run (run-walks and hard runs
   * included): an easy run shorter than this is no new load, so it may catch up faster.
   */
  catchUpSec?: number | null
}

export interface BagEstimate extends Confidence {
  roundsTolerated: number | null
  finishersAllowed: boolean
  /** Share of combo ratings Solid or Sharp, last 2 sessions. */
  solidShare: number | null
  wristShinFlags: number
  sessions: number
  lastEffort: number | null
  scheduleCuts: number
}

export interface BetaCell {
  alpha: number
  beta: number
  /** Observations (weighted). */
  n: number
  /** Posterior mean. */
  p: number
}

/**
 * One weekday's class-day fit. Attended and his own adds count for the day;
 * skips for time / schedule and unexplained misses count against it; skips for
 * a recovery reason (tired, sore, sick) are kept out: they say nothing about the day.
 */
export interface ClassDay extends BetaCell {
  /** Classes the coach (or template) put on this day. */
  suggested: number
  attended: number
  scheduleSkips: number
  /** Missed or skipped with no reason. */
  unexplained: number
  /** Skipped for a recovery reason: not counted in the fit. */
  recoverySkips: number
}

export interface ClassEstimate extends Confidence {
  /** Classes a week he recovers from (1 → 2 → 3). */
  perWeekTolerated: number
  classes: number
  learnedNotes: number
  /**
   * Class-day fit per weekday (0 = Sunday): suggested vs attended vs skipped
   * for schedule. Its own signal, never fatigue (Josh, 2026-10-20).
   */
  days: Record<number, ClassDay>
}

export interface RecoveryItemBaseline {
  mean: number
  sd: number
  /** 3-day recent window. */
  recent: number | null
  values: number
}

export interface RecoveryEstimate extends Confidence {
  /** Live baselines (28 days; live from 4 values in any 10 days). */
  baseline: Partial<Record<keyof Omit<ModelCheckIn, 'day'>, RecoveryItemBaseline>>
  checkIns: number
  /** Next-morning change vs baseline after each session kind (after ≥3 instances). */
  response: Partial<Record<'legs' | 'run' | 'class' | 'bag', { soreness: number | null; energy: number | null; instances: number }>>
}

export interface BackEstimate extends Confidence {
  /** EWMA of back scores (1 bad .. 5 fine). */
  level: number | null
  firstWeekMean: number | null
  last21Mean: number | null
  /** last21Mean − firstWeekMean (negative = worse). */
  trend: number | null
  /** Next-morning back score after hinge / squat vs other days (after ≥3 exposures). */
  sensitivity: Partial<Record<'hinge' | 'squat', { delta: number; exposures: number }>>
  scores: number
  backNotes: number
  openPlans: number
  profileSensitive: boolean
}

export type SlotCellKey = 'am-weekday' | 'am-weekend' | 'pm-weekday' | 'pm-weekend'

export interface AdherenceEstimate extends Confidence {
  /** Beta(α, β) per slot × weekday group: the chance a planned session gets done. */
  cells: Record<SlotCellKey, BetaCell & { state: EstimateState }>
  /** His usual start (local minute) per session type, from the densest cluster of starts. */
  usualStart: Record<string, { minute: number; of: number; inCluster: number }>
  /** Share of done sessions started after noon. */
  pmShareOfDone: number | null
  /** Preferred rest days per weekday (0 = Sunday), learned from where he rests and where he moves things. */
  restDays: Record<number, BetaCell>
  preferredRestDays: number[]
  /** Skips / replaces / cuts for time or schedule, kept apart from effort and recovery. */
  scheduleSkips: { total: number; byType: Record<string, number>; recent: Array<{ day: number; type: string; reason: string }> }
}

// ─── Load pools, levels, his own eases (approved 2026-10-21, ideas 3, 4, 10, 11, 12) ─

export type LoadPool = 'strength' | 'endurance'

/** One done session's training load in session-RPE units (effort x minutes). */
export interface SessionLoad {
  sessionId: string
  day: number
  type: string
  pool: LoadPool
  minutes: number
  /** The effort used: his logged RPE, else a default for the type (a class: its type). */
  rpe: number
  rpeSource: 'logged' | 'default'
  rpeLoad: number
  /** From average HR when there was one (an RPE-equivalent of %HRmax x minutes). */
  hrLoad: number | null
  /** The load counted: bag and class take the larger of HR and RPE (wrist HR undercounts striking). */
  load: number
}

/**
 * Two pools with their own decay. Endurance (runs, bag, class, rope) has a
 * short fatigue and a long fitness; strength fatigue decays slower and counts
 * toward fatigue only, never fitness. Arbitrary units, facts for the AI and the
 * builders; no dose reads them.
 */
export interface LoadEstimate {
  strengthFatigue: number
  enduranceFatigue: number
  enduranceFitness: number
  /** strengthFatigue + enduranceFatigue. */
  fatigue: number
  fitness: number
  /** fitness - fatigue (negative: carrying fatigue). */
  form: number
  last7: Record<LoadPool, number>
  /** The last 14 days' sessions, oldest first. */
  recent: SessionLoad[]
}

export type LevelDomain = 'run' | 'squat' | 'hinge' | 'press' | 'pull' | 'mtConditioning'

/** A progression level per domain (TrainerRoad style), 1-10, moved by completion and effort only. */
export interface DomainLevel {
  level: number
  sessions: number
  lastDay: number | null
  /** The last session's move (+ up, - down). */
  lastChange: number
}

/** Something he did himself that says "easier": a weight he lowered, a set he dropped, a skip for how he felt, a swap to something lighter. */
export interface OwnEase {
  day: number
  domain: 'strength' | 'run' | 'bag'
  kind: 'lowered' | 'dropped_sets' | 'skipped' | 'swapped'
  /** The skip or swap reason code, when he gave one. */
  reason: string | null
}

export interface AthleteModel {
  version: number
  asOfDay: number
  lifts: Record<string, LiftEstimate>
  run: RunEstimate
  bag: BagEstimate
  klass: ClassEstimate
  recovery: RecoveryEstimate
  back: BackEstimate
  adherence: AdherenceEstimate
  load: LoadEstimate
  levels: Record<LevelDomain, DomainLevel>
  /** His own eases in the last 7 days, oldest first. Each holds that domain's next session (no push), no guilt, nothing made up. */
  ownEases: OwnEase[]
}

/** One athlete_estimates row (§13.5). */
export interface EstimateRow {
  kind: AreaKind
  key: string
  valueJson: string
  state: EstimateState
  n: number
  uncertainty: number
}

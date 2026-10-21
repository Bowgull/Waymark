// The replay harness (coach-brain P0, §12): what a replay feeds the coach and
// what it writes down. Pure types; the driver that runs a script against the
// real app lives in src/server/replay/driver.ts.
//
// A script is a day-by-day list of what the athlete did (check-ins, sessions
// with their sets and runs, skips, adds). The driver opens the app the way
// the phone does, starts each session through the real start route (so the
// dose is exactly what the coach would have prescribed that day), logs what
// the athlete really did, finishes it, and runs the nightly job at 07:00 UTC.

export type LiftPattern = 'squat' | 'hinge' | 'press' | 'pull' | 'other'

export interface LoggedSet {
  weightKg: number | null
  reps: number | null
  /** Reps in reserve, 0-3 (3 = 3 or more). Null when not logged. */
  rir: number | null
}

export interface LoggedLift {
  pattern: LiftPattern
  exerciseId?: string
  sets: LoggedSet[]
}

/** How a simulated athlete lifts: every prescribed working set at the prescribed weight. */
export interface AsPrescribed {
  rir: number
  /** Reps short of the prescription on each set (a missed rep). Default 0. */
  repsShort?: number
  /** Weight he actually used vs the prescription (1 = as prescribed). */
  weightFactor?: number
}

export interface RunLog {
  durationSec: number
  distanceKm?: number | null
  avgHr?: number | null
  maxHr?: number | null
  isIndoor?: boolean
}

export interface CheckInLog {
  sleepHours?: number | null
  sleepQuality?: number | null
  energy?: number | null
  soreness?: number | null
  stress?: number | null
  mood?: number | null
  backToday?: number | null
  alcoholScale?: number | null
  herbScale?: number | null
  notes?: string | null
  regionRatings?: Record<string, number> | null
}

/** Minutes after local midnight. */
export type LocalMinute = number

export type ReplayAction =
  | { kind: 'open'; at: LocalMinute }
  | { kind: 'checkin'; at: LocalMinute; log: CheckInLog }
  | {
    kind: 'session'
    at: LocalMinute
    /** Session type as stored (strength, foundation_run, running, mt_class, bag_work, ...). */
    type: string
    slot: 'am' | 'pm'
    durationMin: number
    rpe: number | null
    notes?: string
    /** Logged lifts (real history) or "as prescribed" (simulated athletes). */
    lifts?: LoggedLift[] | AsPrescribed
    run?: RunLog | 'as_prescribed'
    /** Raise the run's logged time by this factor (1 = as prescribed). */
    runFactor?: number
    /** Ad-hoc add when nothing of this type is planned today (his own pick). Default true. */
    addIfMissing?: boolean
  }
  | { kind: 'skip'; at: LocalMinute; type: string; reason: string; detail?: string | null }
  | { kind: 'add'; at: LocalMinute; type: string; slot: 'am' | 'pm'; label?: string }
  /** The raven (page 58): apply its plan, or answer FEELS BETTER. */
  | { kind: 'body'; at: LocalMinute; answer: 'apply' | 'better' }
  /**
   * Do whatever the plan holds today (a simulated athlete): AM sessions at
   * `at`, PM sessions at `pmAt`, each as prescribed. `rpe` per type falls
   * back to `rpe.default`. Types in `skipTypes` are left alone.
   */
  | {
    kind: 'planned'
    at: LocalMinute
    pmAt?: LocalMinute
    rpe: Partial<Record<string, number>> & { default: number }
    lifts: AsPrescribed
    runFactor?: number
    skipTypes?: string[]
    notes?: string
  }

export interface ReplayDay {
  day: number
  actions: ReplayAction[]
}

export interface ReplayScript {
  name: string
  /** First and last epoch day the clock runs (inclusive). */
  fromDay: number
  toDay: number
  /** Start a block on this day (local). Omit when the database already has one. */
  startBlock?: { type: 'block_zero' | 'fighter'; day: number }
  days: ReplayDay[]
  /** Athlete's offset from UTC in minutes (Toronto summer: -240). */
  tzOffsetMin: number
  /** The heart rate he gives when Log your run asks the talk-test question (none: he skips it). */
  talkTestBpm?: number | null
}

// ─── What the driver writes down ─────────────────────────────

export interface DoseLayers {
  leadIn: boolean
  /** Return ramp after a gap (coach/gap.ts). */
  returnRamp: { tier: string; gapDays: number; loadFactor: number; volumeFactor: number } | null
  /** An applied coach ease on the session (weekly pass, felt-hard, rebalance, reactive). */
  coachEase: { kind: string; reason: string } | null
  /** Readiness ease (R10, two items x two days) at start. */
  readinessEase: boolean
  /** The daily rolling-load flag at start (Block Zero R5). */
  loadFlag: boolean
  loadReason: string | null
  /** The prescription itself said it eased (auto-ease / walk instead of run). */
  autoEased: boolean
  autoEaseReason: string | null
  injury: string | null
  /** The brain's level was PUSH today. */
  push: boolean
  /** The coach brain's dose (P2): its level, the readiness state it sat under, the model's u. */
  brain?: { level: string; state: string; u: number | null; modelState: string | null } | null
}

export interface DoseRecord {
  day: number
  sessionId: string
  type: string
  label: string | null
  slot: string | null
  source: string | null
  weekNumber: number | null
  layers: DoseLayers
  /** Main-lift working sets in today's template vs what was prescribed. */
  baselineMainSets: number | null
  prescribedMainSets: number | null
  /** Main-lift weights prescribed, per exercise. */
  loads: Array<{ exerciseId: string; weightKg: number | null; change: string | null }>
  /** Running seconds (run pieces only, no walks) in the week's shape vs prescribed. */
  baselineRunSec: number | null
  prescribedRunSec: number | null
  /** The run became a walk or bike. */
  walkOnly: boolean
  prescribedTotalSec: number | null
  longestLast30Sec: number | null
  /** The easy-run HR ceiling the run was given, and the average HR he then ran at. */
  hrCeilingBpm: number | null
  loggedAvgHr: number | null
  /** prescribed / baseline, for sets or run time. Null when there is nothing to compare. */
  volumeRatio: number | null
  /** Fighter strength: prescribed main-lift weight / (TM x the wave's %), averaged. */
  loadRatio: number | null
  /** Strength: any main-lift set with RIR was on file before this session. */
  rirOnFile: boolean
  why: string[]
}

export interface ChangeRecord {
  day: number
  /** 'nightly' (cron), 'day' (during the day: his actions and what they set off). */
  when: 'nightly' | 'day'
  actor: string
  kind: string
  sessionType: string | null
  targetDay: number | null
  targetSlot: string | null
  why: string | null
}

export interface AiCallRecord {
  day: number
  /** Which caller asked (from the request's system prompt and model). */
  caller: string
  model: string
  when: 'nightly' | 'day'
}

export interface DayRecord {
  day: number
  /** The day had any athlete action (check-in, session, skip, add). */
  active: boolean
  /** What the plan held for the day in the morning (before his actions). */
  planned: Array<{ id: string; type: string; label: string | null; slot: string | null; status: string; eased: boolean }>
  did: string[]
  readiness: { ease: boolean; fresh: boolean; flaggedItems: number; loadFlag: boolean; state?: string } | null
}

export interface ReplayResult {
  name: string
  fromDay: number
  toDay: number
  days: DayRecord[]
  doses: DoseRecord[]
  changes: ChangeRecord[]
  aiCalls: AiCallRecord[]
  /** Every session at the end, for checks over the plan. */
  sessions: Array<{ id: string; day: number | null; type: string; label: string | null; slot: string | null; status: string; source: string | null; contextJson: string | null; rpe: number | null; durationSec: number | null }>
  errors: string[]
  /** The nightly decisions (coach brain P3, coach_decisions rows). */
  decisions?: Array<{
    day: number
    source: string
    calls: number
    final: { today: Array<{ sessionId: string; candidateId: string; level: string; tweak: { setsDelta: number; loadStep: number; roundsDelta: number }; why: string | null; from: string }>; week: { from: string; actions: unknown[] } }
    candidates: Array<{ id: string; sessionId: string; level: string; rules: boolean }>
    verifyErrors: string[]
  }>
  /**
   * The athlete model (coach brain P1) as the nightly job stored it each morning
   * (compact: state and u per row), and as it stood after the last day.
   */
  model?: {
    byDay: Array<{ day: number; rows: Array<{ kind: string; key: string; state: string; n: number; u: number }> }>
    final: Array<{ kind: string; key: string; state: string; n: number; u: number; value: unknown }>
    summary: string[]
  }
}

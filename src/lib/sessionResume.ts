// Session resume: the state a guided workout needs to come back exactly where
// it was after a reload, an app kill or a long lock. Pure: storage is passed
// in, the clock is passed in, nothing touches the DOM or the network.
//
// Rules
// - Saved on every step, keyed by session id (one entry per session).
// - Timers are wall-clock anchored: a running timer stores its END time, a
//   paused one its remaining ms. Remaining time is always `endsAt - now`,
//   never a tick count, so a frozen WebView or a reload shows the right time.
// - Restore advances phases whose time ran out while the app was away (a bag
//   round that ended becomes its rest, a rest that ended becomes the next
//   round's ready screen) from the real end times, not from "now".
// - Nothing is discarded by age. Up to RESUME_AUTO_MAX_MS the session resumes
//   by itself; after that the athlete is asked: resume or end.

export type ResumeEngine =
  | 'strength'
  | 'bag_work'
  | 'mobility'
  | 'foundation_run'
  | 'running'
  | 'skip_rope'
  | 'active_recovery'
  | 'mt_class'

/** A countdown. Running stores its end; paused stores what was left. */
export type TimerSnap =
  | { state: 'running'; startedAtMs: number; endsAtMs: number; durationSec: number }
  | { state: 'paused'; remainingMs: number; durationSec: number }

/** A count-up clock (runs). Running stores its virtual start. */
export type StopwatchSnap =
  | { state: 'running'; startedAtMs: number }
  | { state: 'paused'; elapsedMs: number }

export type RoundSub = 'ready' | 'fighting' | 'rest'
export type RecoveryPhase = 'intro' | 'walk' | 'hip' | 'roll-intro' | 'roll' | 'done'
export type RunSub = 'ready' | 'running' | 'logging'

export type EngineState =
  /** Strength: the rest countdown between sets (WorkoutPage owns it). */
  | { kind: 'strength'; restTimer: TimerSnap | null }
  /** Skip-rope warm-up before bag work or strength. */
  | { kind: 'warmup'; timer: TimerSnap | null }
  /** Bag work and skip rope: round, round sub-phase and its timer. */
  | { kind: 'rounds'; round: number; sub: RoundSub; timer: TimerSnap | null; /** Page 86: this is the last round and the finisher follows its rest. */ toFinisher?: true }
  /** Foundation holds (mobility and the Zone 2 warm-up): step within the set. */
  | { kind: 'hold'; stepIdx: number; timer: TimerSnap | null }
  /** Runs: sub-phase, the clock, the indoor choice and the log draft. */
  | {
      kind: 'run'
      sub: RunSub
      stopwatch: StopwatchSnap | null
      isIndoor: boolean
      media?: 'one_pace' | 'naruto'
      draft?: Record<string, string>
      /** Page 74: the recorder's id for this run; the same id rejoins the recording after a relaunch. */
      runId?: string
    }
  /** Reset: the easy walk or bike, the hip block, then foam rolling, each with its own timer. */
  | {
      kind: 'recovery'
      phase: RecoveryPhase
      /** The walk-or-bike step's clock (absent in an older save). */
      walkTimer?: TimerSnap | null
      hipIdx: number
      hipTimer: TimerSnap | null
      rollIdx: number
      rollTimer: TimerSnap | null
    }
  /** MT class log: the unsaved form. */
  | { kind: 'mt'; draft: Record<string, string> }
  /**
   * Page 86, the bag finisher after the last round: one wall clock for all its
   * sets and rests (the interval timer's: its start, when paused, time paused).
   */
  | { kind: 'finisher'; clock: FinisherClockSnap }

/** The finisher's clock (lib/timers/intervalTimer IntervalClock). */
export interface FinisherClockSnap {
  startedAtMs: number
  pausedAtMs: number | null
  pausedMs: number
}

export interface SessionResumeState {
  v: 1
  sessionId: string
  engine: ResumeEngine
  /** WorkoutPage phase ('exercise', 'rest', 'bag-preview', 'fr-run', ...). */
  phase: string
  exerciseIdx: number
  setIdx: number
  roundIdx: number
  engineState: EngineState | null
  savedAt: number
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const RESUME_KEY_PREFIX = 'waymark_session_resume:'
/** The single-slot key the old recovery code used. Read once, then removed. */
export const LEGACY_RECOVERY_KEY = 'waymark_workout_recovery'
/** Resume by itself up to 12 h; after that ask (never silently discard). */
export const RESUME_AUTO_MAX_MS = 12 * 60 * 60 * 1000
/** Rest between skip-rope rounds. */
export const SKIP_ROPE_REST_SEC = 60

/** A cue more than this late is not played: it would replay en masse. */
export const STALE_CUE_MS = 2000

/** The entrance replays on its own; every other phase (the close screen too) resumes. */
const NON_RESUMABLE_PHASES = new Set(['entrance'])

const ENGINES = new Set<ResumeEngine>([
  'strength', 'bag_work', 'mobility', 'foundation_run', 'running', 'skip_rope', 'active_recovery', 'mt_class',
])

export function resumeKey(sessionId: string): string {
  return `${RESUME_KEY_PREFIX}${sessionId}`
}

/** The engine for a session type (every non-listed type runs the strength engine). */
export function engineForType(type: string): ResumeEngine {
  return ENGINES.has(type as ResumeEngine) ? type as ResumeEngine : 'strength'
}

export function isResumablePhase(phase: string): boolean {
  return !NON_RESUMABLE_PHASES.has(phase)
}

// ─── Storage ──────────────────────────────────────────────────

export function saveResume(storage: StorageLike | null, state: Omit<SessionResumeState, 'v' | 'savedAt'>, nowMs: number): void {
  if (!storage) return
  try {
    const data: SessionResumeState = { ...state, v: 1, savedAt: nowMs }
    storage.setItem(resumeKey(state.sessionId), JSON.stringify(data))
  } catch {
    // storage full or blocked: the session still runs, it just can't resume
  }
}

function isTimerSnap(t: unknown): t is TimerSnap {
  if (!t || typeof t !== 'object') return false
  const s = t as Record<string, unknown>
  if (typeof s.durationSec !== 'number') return false
  if (s.state === 'running') return typeof s.endsAtMs === 'number' && typeof s.startedAtMs === 'number'
  if (s.state === 'paused') return typeof s.remainingMs === 'number'
  return false
}

function validTimerOrNull(t: unknown): TimerSnap | null {
  return isTimerSnap(t) ? t : null
}

/** The saved state for this session, or null. Old age is not a reason to drop it. */
export function loadResume(storage: StorageLike | null, sessionId: string): SessionResumeState | null {
  if (!storage) return null
  let raw: string | null = null
  try {
    raw = storage.getItem(resumeKey(sessionId))
  } catch {
    return null
  }
  if (raw) {
    try {
      const data = JSON.parse(raw) as Partial<SessionResumeState>
      if (data.v !== 1 || data.sessionId !== sessionId) return null
      if (typeof data.phase !== 'string' || !ENGINES.has(data.engine as ResumeEngine)) return null
      if (typeof data.savedAt !== 'number') return null
      return {
        v: 1,
        sessionId,
        engine: data.engine as ResumeEngine,
        phase: data.phase,
        exerciseIdx: Number.isInteger(data.exerciseIdx) ? data.exerciseIdx! : 0,
        setIdx: Number.isInteger(data.setIdx) ? data.setIdx! : 0,
        roundIdx: Number.isInteger(data.roundIdx) ? data.roundIdx! : 0,
        engineState: sanitizeEngineState(data.engineState ?? null),
        savedAt: data.savedAt,
      }
    } catch {
      return null
    }
  }
  return loadLegacy(storage, sessionId)
}

/** The old single-slot recovery entry, converted. It had no engine state. */
function loadLegacy(storage: StorageLike, sessionId: string): SessionResumeState | null {
  try {
    const raw = storage.getItem(LEGACY_RECOVERY_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { sessionId?: string; exerciseIdx?: number; setIdx?: number; roundIdx?: number; phase?: string; savedAt?: number }
    if (data.sessionId !== sessionId || typeof data.phase !== 'string') return null
    storage.removeItem(LEGACY_RECOVERY_KEY)
    return {
      v: 1,
      sessionId,
      engine: data.phase.startsWith('fr-') ? 'foundation_run' : data.phase.startsWith('bag-') ? 'bag_work' : 'strength',
      phase: data.phase === 'rest' ? 'exercise' : data.phase,
      exerciseIdx: data.exerciseIdx ?? 0,
      setIdx: data.setIdx ?? 0,
      roundIdx: data.roundIdx ?? 0,
      engineState: null,
      savedAt: data.savedAt ?? 0,
    }
  } catch {
    return null
  }
}

function sanitizeEngineState(es: unknown): EngineState | null {
  if (!es || typeof es !== 'object') return null
  const e = es as Record<string, unknown>
  switch (e.kind) {
    case 'strength':
      return { kind: 'strength', restTimer: validTimerOrNull(e.restTimer) }
    case 'warmup':
      return { kind: 'warmup', timer: validTimerOrNull(e.timer) }
    case 'rounds': {
      const sub = e.sub === 'fighting' || e.sub === 'rest' ? e.sub : 'ready'
      return { kind: 'rounds', round: Number.isInteger(e.round) ? e.round as number : 0, sub, timer: sub === 'ready' ? null : validTimerOrNull(e.timer), ...(e.toFinisher === true ? { toFinisher: true as const } : {}) }
    }
    case 'hold':
      return { kind: 'hold', stepIdx: Number.isInteger(e.stepIdx) ? e.stepIdx as number : 0, timer: validTimerOrNull(e.timer) }
    case 'run': {
      const sub = e.sub === 'running' || e.sub === 'logging' ? e.sub : 'ready'
      const sw = e.stopwatch as Record<string, unknown> | null | undefined
      const stopwatch: StopwatchSnap | null = sw && sw.state === 'running' && typeof sw.startedAtMs === 'number'
        ? { state: 'running', startedAtMs: sw.startedAtMs }
        : sw && sw.state === 'paused' && typeof sw.elapsedMs === 'number'
          ? { state: 'paused', elapsedMs: sw.elapsedMs }
          : null
      const run: Extract<EngineState, { kind: 'run' }> = { kind: 'run', sub, stopwatch, isIndoor: e.isIndoor === true }
      if (e.media === 'naruto' || e.media === 'one_pace') run.media = e.media
      if (e.draft && typeof e.draft === 'object') run.draft = e.draft as Record<string, string>
      if (typeof e.runId === 'string' && e.runId) run.runId = e.runId
      return run
    }
    case 'recovery': {
      const phases: RecoveryPhase[] = ['intro', 'walk', 'hip', 'roll-intro', 'roll', 'done']
      return {
        kind: 'recovery',
        phase: phases.includes(e.phase as RecoveryPhase) ? e.phase as RecoveryPhase : 'intro',
        ...(validTimerOrNull(e.walkTimer) ? { walkTimer: validTimerOrNull(e.walkTimer) } : {}),
        hipIdx: Number.isInteger(e.hipIdx) ? e.hipIdx as number : 0,
        hipTimer: validTimerOrNull(e.hipTimer),
        rollIdx: Number.isInteger(e.rollIdx) ? e.rollIdx as number : 0,
        rollTimer: validTimerOrNull(e.rollTimer),
      }
    }
    case 'mt':
      return { kind: 'mt', draft: e.draft && typeof e.draft === 'object' ? e.draft as Record<string, string> : {} }
    case 'finisher': {
      const c = e.clock as Record<string, unknown> | null | undefined
      const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
      if (!c || !num(c.startedAtMs) || !num(c.pausedMs) || !(c.pausedAtMs == null || num(c.pausedAtMs))) return null
      return { kind: 'finisher', clock: { startedAtMs: c.startedAtMs as number, pausedAtMs: (c.pausedAtMs as number | null | undefined) ?? null, pausedMs: Math.max(0, c.pausedMs as number) } }
    }
    default:
      return null
  }
}

export function clearResume(storage: StorageLike | null, sessionId: string): void {
  if (!storage) return
  try {
    storage.removeItem(resumeKey(sessionId))
    const legacy = storage.getItem(LEGACY_RECOVERY_KEY)
    if (legacy && legacy.includes(sessionId)) storage.removeItem(LEGACY_RECOVERY_KEY)
  } catch {
    // nothing to do
  }
}

/** 'resume' on its own while fresh; 'ask' (resume or end) once older. Never 'discard'. */
export function resumeDecision(state: Pick<SessionResumeState, 'savedAt'>, nowMs: number, maxAutoMs = RESUME_AUTO_MAX_MS): 'resume' | 'ask' {
  return nowMs - state.savedAt <= maxAutoMs ? 'resume' : 'ask'
}

// ─── Timer math ───────────────────────────────────────────────

export function timerStart(durationSec: number, nowMs: number): TimerSnap {
  return { state: 'running', startedAtMs: nowMs, endsAtMs: nowMs + durationSec * 1000, durationSec }
}

/** A timer that started when the previous one ended (no gap, no stretch). */
export function timerStartAt(startMs: number, durationSec: number): TimerSnap {
  return { state: 'running', startedAtMs: startMs, endsAtMs: startMs + durationSec * 1000, durationSec }
}

export function timerRemainingMs(t: TimerSnap, nowMs: number): number {
  return t.state === 'running' ? t.endsAtMs - nowMs : t.remainingMs
}

export function timerRemainingSec(t: TimerSnap, nowMs: number): number {
  return Math.round(timerRemainingMs(t, nowMs) / 1000)
}

export function timerDone(t: TimerSnap, nowMs: number): boolean {
  return t.state === 'running' && t.endsAtMs <= nowMs
}

/**
 * Pause. A lock-screen Pause reaches JS late (the WebView was suspended), so
 * when the native side reports what was left at the moment of the tap, that
 * wins over `endsAt - now`.
 */
export function timerPause(t: TimerSnap, nowMs: number, pausedRemainingMs?: number): TimerSnap {
  if (t.state === 'paused') return t
  const remaining = pausedRemainingMs != null && Number.isFinite(pausedRemainingMs)
    ? pausedRemainingMs
    : t.endsAtMs - nowMs
  return { state: 'paused', remainingMs: Math.max(0, remaining), durationSec: t.durationSec }
}

/** Resume. An explicit end time (the Live Activity's) wins, so both clocks agree. */
export function timerResume(t: TimerSnap, nowMs: number, endsAtMs?: number): TimerSnap {
  if (t.state === 'running') return t
  const ends = endsAtMs != null && Number.isFinite(endsAtMs) ? endsAtMs : nowMs + t.remainingMs
  return { state: 'running', startedAtMs: nowMs, endsAtMs: ends, durationSec: t.durationSec }
}

export function stopwatchElapsedMs(s: StopwatchSnap, nowMs: number): number {
  return s.state === 'running' ? Math.max(0, nowMs - s.startedAtMs) : s.elapsedMs
}

export function stopwatchPause(s: StopwatchSnap, nowMs: number): StopwatchSnap {
  return s.state === 'paused' ? s : { state: 'paused', elapsedMs: Math.max(0, nowMs - s.startedAtMs) }
}

export function stopwatchResume(s: StopwatchSnap, nowMs: number): StopwatchSnap {
  return s.state === 'running' ? s : { state: 'running', startedAtMs: nowMs - s.elapsedMs }
}

/** True when an event at `atMs` is too far in the past to play its cue. */
export function isStaleCue(atMs: number, nowMs: number): boolean {
  return nowMs - atMs > STALE_CUE_MS
}

// ─── Elapsed-phase advancement ────────────────────────────────

export interface RoundSpec {
  durationSec: number
  restSec: number
}

export interface RoundsPosition {
  round: number
  sub: RoundSub
  timer: TimerSnap | null
}

export interface RoundsAdvance extends RoundsPosition {
  /** The last round's time ran out: the session moves on to its close (or its finisher). */
  completed: boolean
  /** With a finisher (page 86): when the last round's rest ran out, the finisher's start. */
  finisherAtMs?: number
  /** Phase ends crossed while away (newest last). Only fresh ones get a cue. */
  crossed: Array<{ type: 'round_end' | 'rest_end'; atMs: number }>
}

/**
 * Walk a round timeline forward to `now`. A round that ended starts its rest
 * at the round's END time; a rest that ended leaves the next round on its
 * ready screen (a round only starts on a tap). Paused timers do not move.
 */
export function advanceRounds(
  rounds: RoundSpec[],
  pos: RoundsPosition,
  nowMs: number,
  opts: { restAutoEnds?: boolean; finisher?: boolean } = {},
): RoundsAdvance {
  const restAutoEnds = opts.restAutoEnds ?? true
  // Page 86: with a finisher the last round has its rest too, and the finisher starts as it ends.
  const lastRest = opts.finisher === true
  let { round, sub, timer } = pos
  const crossed: RoundsAdvance['crossed'] = []
  for (let guard = 0; guard < rounds.length * 2 + 2; guard++) {
    if (!timer || timer.state !== 'running' || timer.endsAtMs > nowMs) break
    const endedAt = timer.endsAtMs
    if (sub === 'fighting') {
      crossed.push({ type: 'round_end', atMs: endedAt })
      if (round >= rounds.length - 1 && !(lastRest && rounds[round].restSec > 0)) {
        return { round, sub: 'fighting', timer: null, completed: true, crossed, ...(lastRest ? { finisherAtMs: endedAt } : {}) }
      }
      sub = 'rest'
      timer = timerStartAt(endedAt, rounds[round].restSec)
    } else if (sub === 'rest' && restAutoEnds) {
      crossed.push({ type: 'rest_end', atMs: endedAt })
      if (round >= rounds.length - 1) {
        return { round, sub: 'rest', timer: null, completed: true, crossed, ...(lastRest ? { finisherAtMs: endedAt } : {}) }
      }
      round += 1
      sub = 'ready'
      timer = null
    } else {
      break
    }
  }
  return { round, sub, timer, completed: false, crossed }
}

export interface StrengthPosition {
  exerciseIdx: number
  setIdx: number
}

/** The set after this one, or 'done' after the last set of the last exercise. */
export function nextStrengthPosition(pos: StrengthPosition, setCounts: number[]): StrengthPosition | 'done' {
  const count = setCounts[pos.exerciseIdx] ?? 0
  if (pos.setIdx < count - 1) return { exerciseIdx: pos.exerciseIdx, setIdx: pos.setIdx + 1 }
  for (let e = pos.exerciseIdx + 1; e < setCounts.length; e++) {
    if ((setCounts[e] ?? 0) > 0) return { exerciseIdx: e, setIdx: 0 }
  }
  return 'done'
}

/** Clamp a saved position to the workout as it is now (sets can change). */
export function clampStrengthPosition(pos: StrengthPosition, setCounts: number[]): StrengthPosition {
  if (setCounts.length === 0) return { exerciseIdx: 0, setIdx: 0 }
  const exerciseIdx = Math.min(Math.max(0, pos.exerciseIdx), setCounts.length - 1)
  const count = setCounts[exerciseIdx] ?? 0
  const setIdx = count > 0 ? Math.min(Math.max(0, pos.setIdx), count - 1) : 0
  return { exerciseIdx, setIdx }
}

/**
 * Where a strength session stands from the server rows: the first set with
 * no log (completedAt), counting sets still waiting in this phone's outbox as
 * logged. Used when there is no saved state (another device, cleared storage).
 */
export function deriveStrengthPosition(
  exercises: Array<{ sets: Array<{ id: string; completedAt?: number | null }> }>,
  loggedLocally: ReadonlySet<string> = new Set(),
): StrengthPosition | 'done' {
  let anyLogged = false
  for (let e = 0; e < exercises.length; e++) {
    const sets = exercises[e].sets
    for (let s = 0; s < sets.length; s++) {
      const logged = sets[s].completedAt != null || loggedLocally.has(sets[s].id)
      if (logged) anyLogged = true
      else return { exerciseIdx: e, setIdx: s }
    }
  }
  return anyLogged ? 'done' : { exerciseIdx: 0, setIdx: 0 }
}

/** The first Foundation exercise not marked complete on the server. */
export function deriveMobilityPosition(exercises: Array<{ completed: number }>): number | 'done' {
  const idx = exercises.findIndex(e => e.completed !== 1)
  if (idx >= 0) return idx
  return exercises.length > 0 ? 'done' : 0
}

export interface StrengthRestAdvance {
  phase: 'exercise' | 'rest' | 'mark-earned'
  exerciseIdx: number
  setIdx: number
  restTimer: TimerSnap | null
}

/** A strength rest that ran out while away moves on to the next set. */
export function advanceStrengthRest(
  pos: StrengthPosition,
  restTimer: TimerSnap | null,
  setCounts: number[],
  nowMs: number,
): StrengthRestAdvance {
  if (!restTimer) return { phase: 'exercise', ...pos, restTimer: null }
  if (!timerDone(restTimer, nowMs)) return { phase: 'rest', ...pos, restTimer }
  const next = nextStrengthPosition(pos, setCounts)
  if (next === 'done') return { phase: 'mark-earned', ...pos, restTimer: null }
  return { phase: 'exercise', ...next, restTimer: null }
}

export interface RollAdvance {
  rollIdx: number
  timer: TimerSnap | null
  /** The last zone's time ran out. */
  finished: boolean
}

/** Foam rolling auto-advances zone to zone; each zone starts when the last ended. */
export function advanceRoll(stepSecs: number[], rollIdx: number, timer: TimerSnap | null, nowMs: number): RollAdvance {
  let idx = rollIdx
  let t = timer
  for (let guard = 0; guard <= stepSecs.length; guard++) {
    if (!t || !timerDone(t, nowMs)) return { rollIdx: idx, timer: t, finished: false }
    if (idx >= stepSecs.length - 1) return { rollIdx: idx, timer: t, finished: true }
    const endedAt = (t as Extract<TimerSnap, { state: 'running' }>).endsAtMs
    idx += 1
    t = timerStartAt(endedAt, stepSecs[idx])
  }
  return { rollIdx: idx, timer: t, finished: false }
}

/**
 * Bring a saved state up to `now`: every engine's elapsed phases advance from
 * their real end times. Returns the state to render and the cue to play, if
 * any (only a fresh one, never a backlog).
 */
export function restoreForNow(
  state: SessionResumeState,
  nowMs: number,
  ctx: { rounds?: RoundSpec[]; restAutoEnds?: boolean; setCounts?: number[]; rollSecs?: number[]; finisherSec?: number | null } = {},
): { state: SessionResumeState; completed: boolean } {
  const es = state.engineState
  if (!es) return { state, completed: false }
  const finisherSec = ctx.finisherSec != null && ctx.finisherSec > 0 ? ctx.finisherSec : null
  if (es.kind === 'rounds' && ctx.rounds) {
    const adv = advanceRounds(ctx.rounds, { round: es.round, sub: es.sub, timer: es.timer }, nowMs, { restAutoEnds: ctx.restAutoEnds, finisher: finisherSec != null })
    // Page 86: the rounds ran out while away; the finisher runs on from the last rest's end.
    if (adv.completed && adv.finisherAtMs != null && finisherSec != null) {
      return restoreForNow({ ...state, phase: 'bag-finisher', roundIdx: adv.round, engineState: { kind: 'finisher', clock: { startedAtMs: adv.finisherAtMs, pausedAtMs: null, pausedMs: 0 } } }, nowMs, ctx)
    }
    return {
      state: {
        ...state,
        roundIdx: adv.round,
        engineState: { kind: 'rounds', round: adv.round, sub: adv.completed ? 'ready' : adv.sub, timer: adv.timer },
      },
      completed: adv.completed,
    }
  }
  if (es.kind === 'finisher' && finisherSec != null) {
    // Its clock is wall time: once all of it has gone by, on to the ratings.
    const c = es.clock
    const elapsedMs = (c.pausedAtMs ?? nowMs) - c.startedAtMs - c.pausedMs
    return { state: { ...state, phase: 'bag-finisher' }, completed: elapsedMs >= finisherSec * 1000 }
  }
  if (es.kind === 'strength' && ctx.setCounts && state.phase === 'rest') {
    const pos = clampStrengthPosition({ exerciseIdx: state.exerciseIdx, setIdx: state.setIdx }, ctx.setCounts)
    const adv = advanceStrengthRest(pos, es.restTimer, ctx.setCounts, nowMs)
    return {
      state: { ...state, phase: adv.phase, exerciseIdx: adv.exerciseIdx, setIdx: adv.setIdx, engineState: { kind: 'strength', restTimer: adv.restTimer } },
      completed: adv.phase === 'mark-earned',
    }
  }
  if (es.kind === 'recovery' && ctx.rollSecs && es.phase === 'roll') {
    const adv = advanceRoll(ctx.rollSecs, es.rollIdx, es.rollTimer, nowMs)
    return { state: { ...state, engineState: { ...es, rollIdx: adv.rollIdx, rollTimer: adv.timer } }, completed: false }
  }
  return { state, completed: false }
}

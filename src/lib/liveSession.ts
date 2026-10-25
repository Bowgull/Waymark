// Stepping out of a session and coming back (page 61 part 3, approved
// 2026-10-19). Pure: storage and the clock are passed in.
//
// - ‹ TODAY steps out without ending: the session keeps running in true time
//   (its timers are wall-clock anchored in the resume save), and the live
//   strip above the tabs shows it, one tap from going back.
// - After iOS closed the app (or the phone restarted) it comes back paused
//   where it was, with what is saved listed: BACK IN YOUR SESSION.

import {
  stopwatchElapsedMs,
  timerRemainingMs,
  type EngineState,
  type SessionResumeState,
  type StopwatchSnap,
  type StorageLike,
  type TimerSnap,
} from './sessionResume'

// ─── Back in your session ─────────────────────────────────────

/** A running timer stopped at `atMs`: what was left then stays left. */
function timerPausedAt(t: TimerSnap | null, atMs: number): TimerSnap | null {
  if (!t || t.state === 'paused') return t
  return { state: 'paused', remainingMs: Math.max(0, t.endsAtMs - atMs), durationSec: t.durationSec }
}

function stopwatchPausedAt(s: StopwatchSnap | null, atMs: number): StopwatchSnap | null {
  if (!s || s.state === 'paused') return s
  return { state: 'paused', elapsedMs: Math.max(0, atMs - s.startedAtMs) }
}

/**
 * The save paused at `atMs` (its last save, when iOS closed the app): it comes
 * back where it was, not run on through the time away. RESUME carries on.
 */
export function pauseAt(state: SessionResumeState, atMs: number): SessionResumeState {
  const e = state.engineState
  if (!e) return state
  let engineState: EngineState = e
  switch (e.kind) {
    case 'strength': engineState = { ...e, restTimer: timerPausedAt(e.restTimer, atMs) }; break
    case 'warmup': engineState = { ...e, timer: timerPausedAt(e.timer, atMs) }; break
    case 'rounds': engineState = { ...e, timer: timerPausedAt(e.timer, atMs) }; break
    case 'hold': engineState = { ...e, timer: timerPausedAt(e.timer, atMs) }; break
    case 'run': engineState = { ...e, stopwatch: stopwatchPausedAt(e.stopwatch, atMs) }; break
    case 'recovery': engineState = { ...e, hipTimer: timerPausedAt(e.hipTimer, atMs), rollTimer: timerPausedAt(e.rollTimer, atMs) }; break
    case 'mt': break
    case 'finisher': engineState = e.clock.pausedAtMs != null ? e : { ...e, clock: { ...e.clock, pausedAtMs: Math.max(e.clock.startedAtMs, atMs) } }; break
  }
  return { ...state, engineState }
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface SavedLineOut { name: string; detail: string }

/**
 * Page 61, 3E: where it closed ("in round 3") and what is saved on the phone,
 * line by line (ROUNDS 1–2 DONE, ROUND 3 1:42 LEFT).
 */
export function savedSummary(state: SessionResumeState): { where: string; lines: SavedLineOut[] } {
  const e = state.engineState
  const at = state.savedAt
  if (state.phase === 'combo-rating') return { where: 'at the combo ratings', lines: [{ name: 'ROUNDS', detail: 'ALL DONE' }, { name: 'COMBO RATINGS', detail: 'TO DO' }] }
  if (state.phase === 'complete' || state.phase === 'mark-earned') return { where: 'at the close', lines: [{ name: 'SESSION', detail: 'TO CLOSE' }] }
  if (e?.kind === 'finisher') return { where: 'in the finisher', lines: [{ name: 'ROUNDS', detail: 'ALL DONE' }, { name: 'FINISHER', detail: 'TO DO' }] }
  if (e?.kind === 'rounds') {
    const done = e.sub === 'rest' ? e.round + 1 : e.round
    const lines: SavedLineOut[] = []
    if (done > 0) lines.push({ name: done === 1 ? 'ROUND 1' : `ROUNDS 1–${done}`, detail: 'DONE' })
    if (e.sub === 'rest') lines.push({ name: `REST BEFORE ROUND ${e.round + 2}`, detail: e.timer ? `${mmss(timerRemainingMs(e.timer, at))} LEFT` : 'PAUSED' })
    else lines.push({ name: `ROUND ${e.round + 1}`, detail: e.timer ? `${mmss(timerRemainingMs(e.timer, at))} LEFT` : 'READY' })
    return { where: `in round ${e.sub === 'rest' ? e.round + 2 : e.round + 1}`, lines }
  }
  if (e?.kind === 'run') {
    const ms = e.stopwatch ? stopwatchElapsedMs(e.stopwatch, at) : 0
    return { where: 'mid-run', lines: [{ name: e.sub === 'logging' ? 'RUN · TO LOG' : 'RUN', detail: mmss(ms) }] }
  }
  if (e?.kind === 'mt') return { where: 'at the class log', lines: [{ name: 'CLASS LOG', detail: 'KEPT' }] }
  if (e?.kind === 'warmup') return { where: 'in the warm-up', lines: [{ name: 'WARM-UP', detail: e.timer ? `${mmss(timerRemainingMs(e.timer, at))} LEFT` : 'READY' }] }
  if (e?.kind === 'hold') return { where: `at step ${e.stepIdx + 1}`, lines: [{ name: `EXERCISE ${state.exerciseIdx + 1}`, detail: `STEP ${e.stepIdx + 1}` }] }
  if (e?.kind === 'recovery') return { where: 'mid-session', lines: [{ name: e.phase.startsWith('roll') ? 'FOAM ROLLING' : 'HIP BLOCK', detail: 'IN PROGRESS' }] }
  const lines: SavedLineOut[] = [{ name: `EXERCISE ${state.exerciseIdx + 1}`, detail: `SET ${state.setIdx + 1}` }]
  if (e?.kind === 'strength' && e.restTimer) lines.push({ name: 'REST', detail: `${mmss(timerRemainingMs(e.restTimer, at))} LEFT` })
  return { where: `at set ${state.setIdx + 1}`, lines }
}

// ─── The live session: the strip above the tabs ───────────────

export const LIVE_SESSION_KEY = 'waymark_live_session'

export interface LiveSession {
  sessionId: string
  type: string
  /** On the strip's flap: BAG WORK, STRENGTH A. */
  name: string
  /** Painted icon key (bag, strength, zone2...). */
  icon: string
  /** Rounds in the session, when it has rounds. */
  roundTotal?: number | null
  startedAtMs: number
}

export function readLiveSession(storage: StorageLike | null): LiveSession | null {
  try {
    const raw = storage?.getItem(LIVE_SESSION_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as LiveSession
    return v && typeof v.sessionId === 'string' && typeof v.name === 'string' && typeof v.startedAtMs === 'number' ? v : null
  } catch {
    return null
  }
}

export function writeLiveSession(storage: StorageLike | null, live: LiveSession): void {
  try { storage?.setItem(LIVE_SESSION_KEY, JSON.stringify(live)) } catch { /* storage full or blocked */ }
}

/** Off the strip (the session ended); only this session's record when an id is given. */
export function clearLiveSession(storage: StorageLike | null, sessionId?: string): void {
  const now = readLiveSession(storage)
  if (sessionId && now && now.sessionId !== sessionId) return
  try { storage?.removeItem(LIVE_SESSION_KEY) } catch { /* blocked */ }
}

/**
 * The strip's words and clock (page 61, 3B): "Round 3 of 6 · work", the time
 * left in it and the progress line; a run counts up; a set counts the time
 * since the session started.
 */
export function liveLine(live: LiveSession, saved: SessionResumeState | null, nowMs: number): { line: string; clock: string; fill: number } {
  const e = saved?.engineState ?? null
  const since = mmss(nowMs - live.startedAtMs)
  const frac = (t: TimerSnap, left: number) => Math.min(1, Math.max(0, 1 - left / (t.durationSec * 1000)))
  if (e?.kind === 'rounds') {
    const of = live.roundTotal ? ` of ${live.roundTotal}` : ''
    const word = e.sub === 'fighting' ? 'work' : e.sub === 'rest' ? 'rest' : 'ready'
    const n = e.sub === 'rest' ? e.round + 2 : e.round + 1
    if (!e.timer) return { line: `Round ${n}${of} · ${word}`, clock: since, fill: 0 }
    const left = timerRemainingMs(e.timer, nowMs)
    return { line: `Round ${n}${of} · ${word}`, clock: mmss(left), fill: frac(e.timer, left) }
  }
  if (e?.kind === 'run') {
    const ms = e.stopwatch ? stopwatchElapsedMs(e.stopwatch, nowMs) : 0
    return { line: e.stopwatch?.state === 'paused' ? 'Run · paused' : 'Run · going', clock: mmss(ms), fill: 0 }
  }
  if (e?.kind === 'strength' && e.restTimer) {
    const left = timerRemainingMs(e.restTimer, nowMs)
    return { line: `Set ${(saved?.setIdx ?? 0) + 1} · rest`, clock: mmss(left), fill: frac(e.restTimer, left) }
  }
  if (e?.kind === 'warmup') return { line: 'Warm-up', clock: e.timer ? mmss(timerRemainingMs(e.timer, nowMs)) : since, fill: 0 }
  if (e?.kind === 'hold') return { line: `Exercise ${(saved?.exerciseIdx ?? 0) + 1}`, clock: since, fill: 0 }
  if (saved && saved.phase === 'exercise') return { line: `Exercise ${saved.exerciseIdx + 1} · set ${saved.setIdx + 1}`, clock: since, fill: 0 }
  return { line: 'In progress', clock: since, fill: 0 }
}

// ─── Launch ───────────────────────────────────────────────────

let launched = false
/**
 * True once per app launch (a cold start, a reload): the first screen to ask
 * takes it. Only then does Today go back into an open session by itself; any
 * other time the strip is the way back (Today never pulls him in).
 */
export function takeLaunch(): boolean {
  if (launched) return false
  launched = true
  return true
}

/**
 * Where a waymark:// link goes (page 61, M6): waymark://session/live is the
 * open session (from the live record), waymark://session/<id> that session.
 * Anything else: null.
 */
export function sessionPathFor(url: string, liveId: () => string | null): string | null {
  const m = /^waymark:\/\/session\/([A-Za-z0-9_-]+)\/?$/.exec(url.trim())
  if (!m) return null
  const id = m[1] === 'live' ? liveId() : m[1]
  return id ? `/session/${id}` : '/today'
}

import assert from 'node:assert/strict'

import {
  LEGACY_RECOVERY_KEY,
  RESUME_AUTO_MAX_MS,
  SKIP_ROPE_REST_SEC,
  advanceRoll,
  advanceRounds,
  advanceStrengthRest,
  clampStrengthPosition,
  clearResume,
  deriveMobilityPosition,
  deriveStrengthPosition,
  engineForType,
  isResumablePhase,
  isStaleCue,
  loadResume,
  nextStrengthPosition,
  restoreForNow,
  resumeDecision,
  resumeKey,
  saveResume,
  stopwatchElapsedMs,
  stopwatchPause,
  stopwatchResume,
  timerPause,
  timerRemainingMs,
  timerRemainingSec,
  timerResume,
  timerStart,
  timerStartAt,
  type EngineState,
  type SessionResumeState,
  type StorageLike,
} from './sessionResume'

/** A phone's localStorage: survives a "kill" (a new reader of the same map). */
function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
    removeItem: k => { map.delete(k) },
  }
}

const T0 = 1_760_000_000_000
const S = 1000

function base(engine: SessionResumeState['engine'], engineState: EngineState | null, extra: Partial<SessionResumeState> = {}) {
  return { sessionId: 's1', engine, phase: 'exercise', exerciseIdx: 0, setIdx: 0, roundIdx: 0, engineState, ...extra }
}

// ─── Persist / restore round-trip, every engine ───────────────
{
  const states: Array<Omit<SessionResumeState, 'v' | 'savedAt'>> = [
    base('strength', { kind: 'strength', restTimer: timerStart(90, T0) }, { phase: 'rest', exerciseIdx: 2, setIdx: 1 }),
    base('strength', { kind: 'warmup', timer: timerStart(180, T0) }, { phase: 'strength-warmup-skip' }),
    base('bag_work', { kind: 'rounds', round: 3, sub: 'fighting', timer: timerStart(180, T0) }, { roundIdx: 3 }),
    base('bag_work', { kind: 'rounds', round: 1, sub: 'rest', timer: timerPause(timerStart(60, T0), T0 + 20 * S) }, { roundIdx: 1 }),
    base('mobility', { kind: 'hold', stepIdx: 2, timer: timerStart(30, T0) }, { exerciseIdx: 4, setIdx: 1 }),
    base('foundation_run', { kind: 'hold', stepIdx: 0, timer: null }, { phase: 'fr-warmup', exerciseIdx: 3 }),
    base('foundation_run', { kind: 'run', sub: 'running', stopwatch: { state: 'running', startedAtMs: T0 }, isIndoor: false }, { phase: 'fr-run' }),
    base('running', { kind: 'run', sub: 'logging', stopwatch: { state: 'paused', elapsedMs: 1500 * S }, isIndoor: true, media: 'naruto', draft: { distance: '5.2', duration: '25:00' } }),
    base('skip_rope', { kind: 'rounds', round: 2, sub: 'rest', timer: timerStart(SKIP_ROPE_REST_SEC, T0) }),
    base('active_recovery', { kind: 'recovery', phase: 'roll', hipIdx: 5, hipTimer: null, rollIdx: 2, rollTimer: timerStart(60, T0) }),
    base('mt_class', { kind: 'mt', draft: { classType: 'sparring', focusSkill: 'teeps' } }),
  ]
  for (const st of states) {
    const storage = memoryStorage()
    saveResume(storage, st, T0)
    // "Kill": a fresh read of the same storage.
    const back = loadResume(storage, 's1')
    assert.ok(back, `${st.engine}/${st.engineState?.kind} round-trips`)
    assert.deepEqual(back!.engineState, st.engineState, `${st.engine}/${st.engineState?.kind} engine state survives`)
    assert.equal(back!.phase, st.phase)
    assert.equal(back!.exerciseIdx, st.exerciseIdx)
    assert.equal(back!.setIdx, st.setIdx)
    assert.equal(back!.roundIdx, st.roundIdx)
    assert.equal(back!.savedAt, T0)
  }
}

// Keyed by session: two sessions never overwrite each other; another id reads nothing.
{
  const storage = memoryStorage()
  saveResume(storage, base('strength', null, { sessionId: 'a', setIdx: 1 }), T0)
  saveResume(storage, base('bag_work', null, { sessionId: 'b', roundIdx: 2 }), T0)
  assert.equal(loadResume(storage, 'a')?.setIdx, 1)
  assert.equal(loadResume(storage, 'b')?.roundIdx, 2)
  assert.equal(loadResume(storage, 'c'), null)
  clearResume(storage, 'a')
  assert.equal(loadResume(storage, 'a'), null)
  assert.ok(loadResume(storage, 'b'), 'clearing one session leaves the other')
}

// Corrupt or foreign data is ignored, not thrown; a broken timer is dropped, the step kept.
{
  const storage = memoryStorage()
  storage.setItem(resumeKey('s1'), '{not json')
  assert.equal(loadResume(storage, 's1'), null)
  storage.setItem(resumeKey('s1'), JSON.stringify({ v: 1, sessionId: 'other', engine: 'strength', phase: 'exercise', savedAt: T0 }))
  assert.equal(loadResume(storage, 's1'), null, 'a save for another session id is not used')
  storage.setItem(resumeKey('s1'), JSON.stringify({ v: 1, sessionId: 's1', engine: 'bag_work', phase: 'exercise', savedAt: T0, roundIdx: 2, engineState: { kind: 'rounds', round: 2, sub: 'fighting', timer: { state: 'running' } } }))
  const r = loadResume(storage, 's1')
  assert.equal(r?.roundIdx, 2)
  assert.deepEqual(r?.engineState, { kind: 'rounds', round: 2, sub: 'fighting', timer: null })
  // Storage that throws (private mode) never breaks the session.
  const throwing: StorageLike = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  saveResume(throwing, base('strength', null), T0)
  assert.equal(loadResume(throwing, 's1'), null)
  clearResume(throwing, 's1')
  saveResume(null, base('strength', null), T0)
  assert.equal(loadResume(null, 's1'), null)
}

// The old single-slot save is converted once (rest -> its set card), then removed.
{
  const storage = memoryStorage()
  storage.setItem(LEGACY_RECOVERY_KEY, JSON.stringify({ sessionId: 's1', exerciseIdx: 2, setIdx: 1, roundIdx: 0, phase: 'rest', savedAt: T0 }))
  const r = loadResume(storage, 's1')
  assert.equal(r?.engine, 'strength')
  assert.equal(r?.phase, 'exercise')
  assert.equal(r?.exerciseIdx, 2)
  assert.equal(storage.getItem(LEGACY_RECOVERY_KEY), null)
  storage.setItem(LEGACY_RECOVERY_KEY, JSON.stringify({ sessionId: 's1', phase: 'fr-run', savedAt: T0 }))
  assert.equal(loadResume(storage, 's1')?.engine, 'foundation_run')
}

// ─── Max-age policy: resume by itself, then ask; never discard ──
{
  assert.equal(resumeDecision({ savedAt: T0 }, T0 + 5 * 60 * S), 'resume')
  assert.equal(resumeDecision({ savedAt: T0 }, T0 + RESUME_AUTO_MAX_MS), 'resume', '12 h exactly still resumes')
  assert.equal(resumeDecision({ savedAt: T0 }, T0 + RESUME_AUTO_MAX_MS + 1), 'ask')
  assert.equal(resumeDecision({ savedAt: T0 }, T0 + 30 * 24 * 3600 * S), 'ask', 'a month old: still asked, not dropped')
  const storage = memoryStorage()
  saveResume(storage, base('bag_work', null), T0)
  assert.ok(loadResume(storage, 's1'), 'loading never drops an old save')
  assert.equal(isResumablePhase('entrance'), false)
  assert.equal(isResumablePhase('complete'), true, 'a kill on the close screen comes back to it')
  assert.equal(engineForType('bag_work'), 'bag_work')
  assert.equal(engineForType('strength_push'), 'strength', 'unknown types run the strength engine')
}

// ─── Timer math: from timestamps, never ticks ─────────────────
{
  const t = timerStart(90, T0)
  assert.equal(timerRemainingSec(t, T0 + 30 * S), 60)
  assert.equal(timerRemainingSec(t, T0 + 95 * S), -5, 'past the end reads negative (overtime)')
  // Pause / resume: what is left is kept exactly.
  const paused = timerPause(t, T0 + 40 * S)
  assert.deepEqual(paused, { state: 'paused', remainingMs: 50 * S, durationSec: 90 })
  assert.equal(timerRemainingMs(paused, T0 + 3600 * S), 50 * S, 'a paused timer does not move')
  const resumed = timerResume(paused, T0 + 100 * S)
  assert.equal(resumed.state === 'running' && resumed.endsAtMs, T0 + 150 * S)
  // The Live Activity's end time wins so both clocks agree.
  const fromLa = timerResume(paused, T0 + 100 * S, T0 + 149_500)
  assert.equal(fromLa.state === 'running' && fromLa.endsAtMs, T0 + 149_500)
  // Lock-screen Pause that reaches JS late: the native remaining wins over endsAt - now.
  const latePause = timerPause(t, T0 + 200 * S, 37 * S)
  assert.equal(latePause.state === 'paused' && latePause.remainingMs, 37 * S, 'the timer does not jump to 0')
  assert.equal(timerPause(t, T0 + 200 * S).state === 'paused' && (timerPause(t, T0 + 200 * S) as { remainingMs: number }).remainingMs, 0)
  // Idempotent.
  assert.equal(timerPause(paused, T0 + 999 * S), paused)
  assert.equal(timerResume(t, T0 + 1), t)
  // A run clock: count-up, paused keeps elapsed.
  const sw = { state: 'running' as const, startedAtMs: T0 }
  assert.equal(stopwatchElapsedMs(sw, T0 + 600 * S), 600 * S)
  const swPaused = stopwatchPause(sw, T0 + 600 * S)
  assert.equal(stopwatchElapsedMs(swPaused, T0 + 9999 * S), 600 * S)
  assert.equal(stopwatchElapsedMs(stopwatchResume(swPaused, T0 + 700 * S), T0 + 760 * S), 660 * S)
  // Stale cues.
  assert.equal(isStaleCue(T0, T0 + 500), false)
  assert.equal(isStaleCue(T0, T0 + 60 * S), true)
}

// ─── Elapsed-phase advancement ────────────────────────────────
const BAG = [
  { durationSec: 180, restSec: 60 },
  { durationSec: 180, restSec: 60 },
  { durationSec: 180, restSec: 45 },
]
{
  // Back from a lock 20 s after a round ended: rest started AT the round's end.
  const fighting = { round: 0, sub: 'fighting' as const, timer: timerStart(180, T0) }
  const a = advanceRounds(BAG, fighting, T0 + 200 * S)
  assert.equal(a.sub, 'rest')
  assert.equal(a.round, 0)
  assert.equal(a.timer?.state === 'running' && a.timer.endsAtMs, T0 + 240 * S, 'rest ends 60 s after the round ended, not 60 s after unlock')
  assert.equal(timerRemainingSec(a.timer!, T0 + 200 * S), 40)
  assert.deepEqual(a.crossed.map(c => c.type), ['round_end'])
  assert.equal(isStaleCue(a.crossed[0].atMs, T0 + 200 * S), true, 'the 20 s old round-end bell is not replayed')

  // Away through the round AND its rest: the next round waits on its ready screen.
  const b = advanceRounds(BAG, fighting, T0 + 600 * S)
  assert.deepEqual({ round: b.round, sub: b.sub, timer: b.timer, completed: b.completed }, { round: 1, sub: 'ready', timer: null, completed: false })
  assert.deepEqual(b.crossed.map(c => c.type), ['round_end', 'rest_end'])

  // Last round ran out: the session moves to its close.
  const c = advanceRounds(BAG, { round: 2, sub: 'fighting', timer: timerStart(180, T0) }, T0 + 181 * S)
  assert.equal(c.completed, true)

  // Nothing elapsed: unchanged. Paused: never moves.
  assert.equal(advanceRounds(BAG, fighting, T0 + 60 * S).sub, 'fighting')
  const pausedRound = { round: 1, sub: 'fighting' as const, timer: timerPause(timerStart(180, T0), T0 + 10 * S) }
  assert.deepEqual(advanceRounds(BAG, pausedRound, T0 + 99_999 * S).timer, pausedRound.timer)

  // Skip rope rest runs into overtime until a tap: it does not end by itself.
  const skip = advanceRounds(BAG, fighting, T0 + 900 * S, { restAutoEnds: false })
  assert.equal(skip.sub, 'rest')
  assert.ok(timerRemainingSec(skip.timer!, T0 + 900 * S) < 0)
}
{
  // Strength: rest ran out while locked -> next set; the last set -> close.
  const counts = [3, 2]
  assert.deepEqual(nextStrengthPosition({ exerciseIdx: 0, setIdx: 1 }, counts), { exerciseIdx: 0, setIdx: 2 })
  assert.deepEqual(nextStrengthPosition({ exerciseIdx: 0, setIdx: 2 }, counts), { exerciseIdx: 1, setIdx: 0 })
  assert.equal(nextStrengthPosition({ exerciseIdx: 1, setIdx: 1 }, counts), 'done')
  assert.deepEqual(nextStrengthPosition({ exerciseIdx: 0, setIdx: 2 }, [3, 0, 4]), { exerciseIdx: 2, setIdx: 0 }, 'skips an exercise with no sets')
  const rest = timerStart(120, T0)
  assert.equal(advanceStrengthRest({ exerciseIdx: 0, setIdx: 0 }, rest, counts, T0 + 60 * S).phase, 'rest')
  assert.deepEqual(advanceStrengthRest({ exerciseIdx: 0, setIdx: 0 }, rest, counts, T0 + 121 * S), { phase: 'exercise', exerciseIdx: 0, setIdx: 1, restTimer: null })
  assert.equal(advanceStrengthRest({ exerciseIdx: 1, setIdx: 1 }, rest, counts, T0 + 121 * S).phase, 'mark-earned')
  // Saved position past the end of a changed workout: clamped, never "expired".
  assert.deepEqual(clampStrengthPosition({ exerciseIdx: 9, setIdx: 9 }, counts), { exerciseIdx: 1, setIdx: 1 })
  assert.deepEqual(clampStrengthPosition({ exerciseIdx: 0, setIdx: 7 }, counts), { exerciseIdx: 0, setIdx: 2 })
  assert.deepEqual(clampStrengthPosition({ exerciseIdx: 3, setIdx: 0 }, []), { exerciseIdx: 0, setIdx: 0 })
}
{
  // New device / cleared storage: position from the server rows.
  const ex = [
    { sets: [{ id: 'a', completedAt: 1 }, { id: 'b', completedAt: 2 }] },
    { sets: [{ id: 'c', completedAt: null }, { id: 'd', completedAt: null }] },
  ]
  assert.deepEqual(deriveStrengthPosition(ex), { exerciseIdx: 1, setIdx: 0 })
  assert.deepEqual(deriveStrengthPosition(ex, new Set(['c'])), { exerciseIdx: 1, setIdx: 1 }, 'a set still in the outbox counts as logged')
  assert.equal(deriveStrengthPosition(ex, new Set(['c', 'd'])), 'done')
  assert.deepEqual(deriveStrengthPosition([{ sets: [{ id: 'x' }] }]), { exerciseIdx: 0, setIdx: 0 })
  assert.equal(deriveMobilityPosition([{ completed: 1 }, { completed: 0 }, { completed: 0 }]), 1)
  assert.equal(deriveMobilityPosition([{ completed: 1 }]), 'done')
  assert.equal(deriveMobilityPosition([]), 0)
}
{
  // Foam rolling: zones chain from the real end of the last one.
  const secs = [60, 60, 45]
  const r = advanceRoll(secs, 0, timerStart(60, T0), T0 + 100 * S)
  assert.equal(r.rollIdx, 1)
  assert.equal(r.timer?.state === 'running' && r.timer.endsAtMs, T0 + 120 * S)
  const end = advanceRoll(secs, 0, timerStart(60, T0), T0 + 1000 * S)
  assert.equal(end.rollIdx, 2)
  assert.equal(end.finished, true)
  const paused = advanceRoll(secs, 1, timerPause(timerStart(60, T0), T0 + 5 * S), T0 + 1000 * S)
  assert.equal(paused.rollIdx, 1, 'a paused zone holds')
  assert.equal(timerStartAt(T0, 10).state === 'running' && timerStartAt(T0, 10).endsAtMs, T0 + 10 * S)
}

// ─── Kill / background / resume, per engine (no device) ───────
// Each case: the engine saves at T0, the app is killed, the phone reopens
// later and the saved state is brought up to now.
function killAndReopen(st: Omit<SessionResumeState, 'v' | 'savedAt'>, awayMs: number, ctx: Parameters<typeof restoreForNow>[2] = {}) {
  const storage = memoryStorage()
  saveResume(storage, st, T0)
  const saved = loadResume(storage, st.sessionId)!
  return restoreForNow(saved, T0 + awayMs, ctx)
}
{
  // Strength: reload mid-rest -> the same rest with the right time left.
  const r = killAndReopen(base('strength', { kind: 'strength', restTimer: timerStart(120, T0) }, { phase: 'rest', exerciseIdx: 1, setIdx: 0 }), 45 * S, { setCounts: [3, 3] })
  assert.equal(r.state.phase, 'rest')
  const es = r.state.engineState as Extract<EngineState, { kind: 'strength' }>
  assert.equal(timerRemainingSec(es.restTimer!, T0 + 45 * S), 75)
  // Killed through the rest: the next set's card.
  const r2 = killAndReopen(base('strength', { kind: 'strength', restTimer: timerStart(120, T0) }, { phase: 'rest', exerciseIdx: 1, setIdx: 2 }), 600 * S, { setCounts: [3, 3] })
  assert.equal(r2.state.phase, 'mark-earned', 'rest after the last set ran out: the close')
  // Paused rest stays paused with what was left, however long away.
  const r3 = killAndReopen(base('strength', { kind: 'strength', restTimer: timerPause(timerStart(120, T0), T0 + 30 * S) }, { phase: 'rest' }), 5 * 3600 * S, { setCounts: [3] })
  assert.equal(timerRemainingSec((r3.state.engineState as Extract<EngineState, { kind: 'strength' }>).restTimer!, T0 + 5 * 3600 * S), 90)
}
{
  // Bag: reload mid-rest -> the rest with the right time left; mid-round past its end -> rest from the round's end.
  const r = killAndReopen(base('bag_work', { kind: 'rounds', round: 1, sub: 'rest', timer: timerStart(60, T0) }, { roundIdx: 1 }), 25 * S, { rounds: BAG })
  const es = r.state.engineState as Extract<EngineState, { kind: 'rounds' }>
  assert.equal(es.sub, 'rest')
  assert.equal(timerRemainingSec(es.timer!, T0 + 25 * S), 35)
  const r2 = killAndReopen(base('bag_work', { kind: 'rounds', round: 0, sub: 'fighting', timer: timerStart(180, T0) }), 200 * S, { rounds: BAG })
  const es2 = r2.state.engineState as Extract<EngineState, { kind: 'rounds' }>
  assert.equal(es2.sub, 'rest')
  assert.equal(timerRemainingSec(es2.timer!, T0 + 200 * S), 40)
  const r3 = killAndReopen(base('bag_work', { kind: 'rounds', round: 2, sub: 'fighting', timer: timerStart(180, T0) }, { roundIdx: 2 }), 400 * S, { rounds: BAG })
  assert.equal(r3.completed, true, 'the last round ended while away: on to rating')
}
{
  // Foundation hold: the hold timer comes back with its end time (the view advances one step if it ran out).
  const r = killAndReopen(base('mobility', { kind: 'hold', stepIdx: 1, timer: timerStart(45, T0) }, { exerciseIdx: 3 }), 15 * S)
  const es = r.state.engineState as Extract<EngineState, { kind: 'hold' }>
  assert.equal(es.stepIdx, 1)
  assert.equal(timerRemainingSec(es.timer!, T0 + 15 * S), 30)
  assert.equal(r.state.exerciseIdx, 3)
  // Zone 2 (foundation run): warm-up position and the run clock.
  const fr = killAndReopen(base('foundation_run', { kind: 'run', sub: 'running', stopwatch: { state: 'running', startedAtMs: T0 }, isIndoor: false }, { phase: 'fr-run' }), 1200 * S)
  const run = fr.state.engineState as Extract<EngineState, { kind: 'run' }>
  assert.equal(fr.state.phase, 'fr-run')
  assert.equal(stopwatchElapsedMs(run.stopwatch!, T0 + 1200 * S), 1200 * S, 'the run clock kept running through the kill')
}
{
  // Run: indoor Naruto choice and the half-typed log survive.
  const r = killAndReopen(base('running', { kind: 'run', sub: 'logging', stopwatch: { state: 'paused', elapsedMs: 1800 * S }, isIndoor: true, media: 'naruto', draft: { distance: '6' } }), 3600 * S)
  const es = r.state.engineState as Extract<EngineState, { kind: 'run' }>
  assert.equal(es.sub, 'logging')
  assert.equal(es.media, 'naruto')
  assert.equal(es.draft?.distance, '6')
}
{
  // Skip rope: mid-round past the end -> rest anchored; the rest itself waits for a tap.
  const rounds = Array.from({ length: 5 }, () => ({ durationSec: 120, restSec: SKIP_ROPE_REST_SEC }))
  const r = killAndReopen(base('skip_rope', { kind: 'rounds', round: 2, sub: 'fighting', timer: timerStart(120, T0) }), 150 * S, { rounds, restAutoEnds: false })
  const es = r.state.engineState as Extract<EngineState, { kind: 'rounds' }>
  assert.equal(es.sub, 'rest')
  assert.equal(timerRemainingSec(es.timer!, T0 + 150 * S), 30)
  const r2 = killAndReopen(base('skip_rope', { kind: 'rounds', round: 2, sub: 'rest', timer: timerStart(60, T0) }), 300 * S, { rounds, restAutoEnds: false })
  assert.equal((r2.state.engineState as Extract<EngineState, { kind: 'rounds' }>).sub, 'rest')
}
{
  // Reset (active recovery): foam rolling lands on the right zone.
  const secs = [60, 60, 45, 45]
  const r = killAndReopen(base('active_recovery', { kind: 'recovery', phase: 'roll', hipIdx: 0, hipTimer: null, rollIdx: 0, rollTimer: timerStart(60, T0) }), 130 * S, { rollSecs: secs })
  const es = r.state.engineState as Extract<EngineState, { kind: 'recovery' }>
  assert.equal(es.rollIdx, 2)
  assert.equal(timerRemainingSec(es.rollTimer!, T0 + 130 * S), 35)
  // Hip hold: kept as saved (the view shows Done when it ran out).
  const hip = killAndReopen(base('active_recovery', { kind: 'recovery', phase: 'hip', hipIdx: 3, hipTimer: timerStart(45, T0), rollIdx: 0, rollTimer: null }), 10 * S, { rollSecs: secs })
  assert.equal((hip.state.engineState as Extract<EngineState, { kind: 'recovery' }>).hipIdx, 3)
}
{
  // MT class: the typed log comes back.
  const r = killAndReopen(base('mt_class', { kind: 'mt', draft: { weakness: 'dropping the right hand' } }), 7200 * S)
  assert.equal((r.state.engineState as Extract<EngineState, { kind: 'mt' }>).draft.weakness, 'dropping the right hand')
}

console.log('sessionResume tests passed')

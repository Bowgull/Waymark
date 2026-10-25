// Run: tsx src/lib/liveSession.test.ts
// Page 61 part 3: stepping out of a session and coming back.
import assert from 'node:assert/strict'

import { clearLiveSession, liveLine, mmss, pauseAt, readLiveSession, savedSummary, sessionPathFor, takeLaunch, writeLiveSession, type LiveSession } from './liveSession'
import type { SessionResumeState, StorageLike } from './sessionResume'
import { isEdgeSwipe } from '../design/dismiss'

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, removeItem: k => { data.delete(k) } }
}

const T0 = 1_800_000_000_000
const bag = (sub: 'ready' | 'fighting' | 'rest', round: number, endsInMs: number | null): SessionResumeState => ({
  v: 1, sessionId: 's1', engine: 'bag_work', phase: 'exercise', exerciseIdx: 0, setIdx: 0, roundIdx: round, savedAt: T0,
  engineState: { kind: 'rounds', round, sub, timer: endsInMs == null ? null : { state: 'running', startedAtMs: T0 - (180_000 - endsInMs), endsAtMs: T0 + endsInMs, durationSec: 180 } },
})

// ─── mm:ss ──
assert.equal(mmss(102_000), '1:42')
assert.equal(mmss(-5), '0:00')

// ─── after iOS closed it: paused where it was ──
{
  const saved = bag('fighting', 2, 102_000)
  const paused = pauseAt(saved, saved.savedAt)
  assert.deepEqual(paused.engineState, { kind: 'rounds', round: 2, sub: 'fighting', timer: { state: 'paused', remainingMs: 102_000, durationSec: 180 } }, '1:42 left stays 1:42 left')
  const run: SessionResumeState = { ...saved, engine: 'running', engineState: { kind: 'run', sub: 'running', stopwatch: { state: 'running', startedAtMs: T0 - 600_000 }, isIndoor: false } }
  const pr = pauseAt(run, T0)
  assert.deepEqual(pr.engineState && pr.engineState.kind === 'run' ? pr.engineState.stopwatch : null, { state: 'paused', elapsedMs: 600_000 })
  const already = { ...saved, engineState: { kind: 'rounds' as const, round: 1, sub: 'rest' as const, timer: { state: 'paused' as const, remainingMs: 5000, durationSec: 60 } } }
  assert.deepEqual(pauseAt(already, T0 + 99_000), already, 'a paused timer is left as it is')
}

// ─── BACK IN YOUR SESSION: what is saved, as page 61 3E lists it ──
{
  const s = savedSummary(bag('fighting', 2, 102_000))
  assert.equal(s.where, 'in round 3')
  assert.deepEqual(s.lines, [{ name: 'ROUNDS 1–2', detail: 'DONE' }, { name: 'ROUND 3', detail: '1:42 LEFT' }])
  assert.deepEqual(savedSummary(bag('ready', 0, null)).lines, [{ name: 'ROUND 1', detail: 'READY' }])
  assert.equal(savedSummary(bag('rest', 0, 30_000)).where, 'in round 2')
  // Page 86: killed in the last round's rest, with the finisher next.
  const last = bag('rest', 5, 30_000)
  const lastFin = { ...last, engineState: { ...(last.engineState as Extract<SessionResumeState['engineState'], { kind: 'rounds' }>), toFinisher: true as const } }
  assert.deepEqual(savedSummary(lastFin), { where: 'before the finisher', lines: [{ name: 'ROUNDS 1–6', detail: 'DONE' }, { name: 'REST BEFORE THE FINISHER', detail: '0:30 LEFT' }] })
  const strength: SessionResumeState = { v: 1, sessionId: 's2', engine: 'strength', phase: 'exercise', exerciseIdx: 1, setIdx: 2, roundIdx: 0, savedAt: T0, engineState: { kind: 'strength', restTimer: null } }
  assert.deepEqual(savedSummary(strength), { where: 'at set 3', lines: [{ name: 'EXERCISE 2', detail: 'SET 3' }] })
  assert.deepEqual(savedSummary({ ...strength, phase: 'combo-rating' }).lines[1], { name: 'COMBO RATINGS', detail: 'TO DO' })
}

// ─── the live strip ──
{
  const live: LiveSession = { sessionId: 's1', type: 'bag_work', name: 'BAG WORK', icon: 'bag', roundTotal: 6, startedAtMs: T0 - 15 * 60_000 }
  const v = liveLine(live, bag('fighting', 2, 102_000), T0)
  assert.equal(v.line, 'Round 3 of 6 · work')
  assert.equal(v.clock, '1:42')
  assert.ok(Math.abs(v.fill - (1 - 102 / 180)) < 1e-9, 'the progress line')
  // it ticks in true time while he is on Today
  assert.equal(liveLine(live, bag('fighting', 2, 102_000), T0 + 60_000).clock, '0:42')
  assert.equal(liveLine(live, bag('rest', 2, 40_000), T0).line, 'Round 4 of 6 · rest')
  assert.equal(liveLine({ ...live, roundTotal: null }, bag('ready', 0, null), T0).line, 'Round 1 · ready')
  assert.equal(liveLine(live, null, T0).clock, '15:00', 'no save: the time since it started')

  const m = memory()
  assert.equal(readLiveSession(m), null)
  writeLiveSession(m, live)
  assert.deepEqual(readLiveSession(m), live)
  clearLiveSession(m, 'other')
  assert.ok(readLiveSession(m), "another session's end leaves it")
  clearLiveSession(m, 's1')
  assert.equal(readLiveSession(m), null)
  m.setItem('waymark_live_session', '{nope')
  assert.equal(readLiveSession(m), null)
}

// ─── the Live Activity's link ──
assert.equal(sessionPathFor('waymark://session/live', () => 'abc'), '/session/abc')
assert.equal(sessionPathFor('waymark://session/live', () => null), '/today', 'nothing open: Today')
assert.equal(sessionPathFor('waymark://session/xyz-1', () => null), '/session/xyz-1')
assert.equal(sessionPathFor('https://evil.example/session/x', () => 'abc'), null)

// ─── a launch is taken once ──
assert.equal(takeLaunch(), true)
assert.equal(takeLaunch(), false, 'only the first screen after a launch goes back in by itself')

// ─── the left-edge swipe (page 61 rule 4) ──
assert.equal(isEdgeSwipe({ x: 8, y: 300 }, { x: 90, y: 310 }), true)
assert.equal(isEdgeSwipe({ x: 60, y: 300 }, { x: 200, y: 300 }), false, 'not from the edge')
assert.equal(isEdgeSwipe({ x: 8, y: 300 }, { x: 40, y: 300 }), false, 'too short')
assert.equal(isEdgeSwipe({ x: 8, y: 300 }, { x: 90, y: 420 }), false, 'mostly down: a scroll')

console.log('liveSession tests passed')

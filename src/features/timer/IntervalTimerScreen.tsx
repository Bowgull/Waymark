import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { FlapLabel, useEdgeBack } from '@/design'
import { GrassZone, SessionFrame, TimerFace, type TimerTrack } from '@/components/timers'
import { playClips } from '@/lib/cuePlayer'
import { intervalIsNative, intervalNative } from '@/lib/intervalNative'
import { endLiveActivity } from '@/lib/liveActivity'
import { intervalActivityState, INTERVAL_SESSION_LABEL } from '@/lib/timers/intervalActivity'
import { clockAt, cueSchedule, doneWord, elapsedSec, partClip, pauseClock, phaseWord, plan, positionAt, resumeClock, startClock, type IntervalClock, type IntervalSetup } from '@/lib/timers/intervalTimer'
import { ENDED_SHOW_MS } from '@/lib/timers/timerLook'
import { useSessionLiveActivity, type LiveActivityConfig } from '@/features/session/useSessionLiveActivity'

import '@/features/session/session.css'
import './intervalTimer.css'

/** How long DONE · 8 ROUNDS shows before Settings (page 81). */
const DONE_SHOW_MS = 2600

/**
 * The interval timer running (page 81): the app's grass timer screen with
 * INTERVAL TIMER on top and the × (held 3 s, it just ends), the phase plate
 * over the big flap clock, ROUND 3 OF 8 under it. 10 s GET READY (teal), then
 * WORK (gold) and REST (teal) per round; orange near the end of each part
 * (the grass, the clock and the plate ease over about a second). Tap the
 * grass to pause, hold it 3 s to end. Nothing is logged anywhere.
 */
export function IntervalTimerScreen({ setup, onClose }: { setup: IntervalSetup; onClose: () => void }) {
  const parts = useMemo(() => plan(setup), [setup])
  const [clock, setClock] = useState<IntervalClock>(() => startClock(Date.now()))
  const [now, setNow] = useState(() => Date.now())
  const [ended, setEnded] = useState(false)
  const paused = clock.pausedAtMs != null
  const pos = positionAt(parts, elapsedSec(clock, now))
  const done = pos.done

  // The 10 Hz face clock.
  useEffect(() => {
    if (ended) return
    const t = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(t)
  }, [ended])

  // The phone: the native timer keeps the beeps, Poppy and the lock card going with the screen off.
  useEffect(() => {
    void intervalNative.start({ parts: parts.map(p => ({ ph: p.ph, len: p.len, round: p.round })), rounds: setup.rounds, cues: cueSchedule(setup), startedAtMs: clock.startedAtMs })
    return () => { void intervalNative.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Back from the lock screen: the native clock is the truth (a pause or resume may have happened there).
  const sync = useCallback(async () => {
    const st = await intervalNative.state()
    if (!st || !st.active) return
    const t = Date.now()
    setClock(clockAt(st.elapsedMs, st.paused, t))
    setNow(t)
  }, [])
  useEffect(() => {
    if (!intervalIsNative) return
    const onVis = () => { if (document.visibilityState === 'visible') void sync() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [sync])

  // The web: the sounds play here (on the phone the native timer plays them).
  const heard = useRef<{ index: number; tick: number; done: boolean }>({ index: -1, tick: -1, done: false })
  useEffect(() => {
    if (intervalIsNative || ended || paused) return
    const h = heard.current
    if (done) {
      if (!h.done) { h.done = true; void playClips(['chime_done', 't_done']) }
      return
    }
    if (pos.index !== h.index) {
      h.index = pos.index
      h.tick = pos.shown
      void playClips(['t_change', partClip(pos.part, setup.rounds)])
      return
    }
    if (pos.warn && pos.shown !== h.tick) { h.tick = pos.shown; void playClips(['t_tick']) }
  }, [pos.index, pos.shown, pos.warn, pos.part, done, ended, paused, setup.rounds])

  // Leaving: the lock card goes, the native timer stops, back to Settings.
  const leaving = useRef(false)
  const leave = useCallback((afterMs: number) => {
    if (leaving.current) return
    leaving.current = true
    void intervalNative.stop()
    window.setTimeout(() => { void endLiveActivity(); onClose() }, afterMs)
  }, [onClose])
  useEffect(() => { if (done) leave(DONE_SHOW_MS) }, [done, leave])
  /** Held through (the grass or the ×): it just ends. */
  const endNow = useCallback(() => {
    if (ended || done) return
    setEnded(true)
    leave(ENDED_SHOW_MS)
  }, [ended, done, leave])

  const togglePause = useCallback(() => {
    if (ended || done) return
    const t = Date.now()
    setNow(t)
    const next = clock.pausedAtMs != null ? resumeClock(clock, t) : pauseClock(clock, t)
    setClock(next)
    void (next.pausedAtMs != null ? intervalNative.pause() : intervalNative.resume())
  }, [ended, done, clock])

  // Nothing leaves by the edge swipe while it runs (Settings' back sits under it).
  useEdgeBack(() => {})

  // The lock card and the island (on the web the state is kept in window.__wmActivity).
  const laState = done || ended ? null : intervalActivityState(pos, clock, setup.rounds)
  const laConfig: LiveActivityConfig | null = laState ? { sessionType: 'interval_timer', sessionLabel: INTERVAL_SESSION_LABEL, state: laState } : null
  useSessionLiveActivity(laConfig, {
    onPause: () => { if (intervalIsNative) void sync(); else if (!paused) togglePause() },
    onResume: () => { if (intervalIsNative) void sync(); else if (paused) togglePause() },
  })

  // ─── the face ───
  const { part } = pos
  const working = part.ph === 'work'
  const warn = pos.warn && !paused && !done
  const shown = done ? 0 : pos.shown
  const track: TimerTrack = {
    durationSec: part.len,
    endsAtMs: paused || done || ended ? null : now + pos.left * 1000,
    remainingMs: (done ? 0 : pos.left) * 1000,
  }
  const tint = done ? ' c-done' : paused ? ' c-pause' : warn ? ' c-warn' : working ? '' : ' c-rest'
  // The phase plate over the clock (page 81): GET READY / REST teal, WORK gold, orange near the end,
  // PAUSED, DONE · 8 ROUNDS, ENDED once held through. It settles in; no letter flips on a tap.
  const plate = ended ? { text: 'ENDED', tone: 'clay' as const, cls: '' }
    : done ? { text: doneWord(setup.rounds), tone: 'gold' as const, cls: '' }
      : paused ? { text: 'PAUSED', tone: 'dim' as const, cls: '' }
        : { text: phaseWord(part.ph), tone: (working ? 'gold' : 'teal') as 'gold' | 'teal', cls: warn ? 'it-orange' : '' }
  const rof = `ROUND ${part.round} OF ${setup.rounds}`

  const screen = (
    <SessionFrame
      title="INTERVAL TIMER"
      onEndHeld={endNow}
      paused={paused && !ended}
      className={`it-run${tint}`}
      grass={
        <GrassZone
          track={track}
          kind="work"
          mode={working || done ? 'work' : 'rest'}
          orange={warn}
          state={paused ? 'paused' : 'running'}
          onTap={togglePause}
          hold={{ onHeld: endNow, held: ended }}
          holdWords={['HOLD · END', 'ENDING']}
          label={paused ? 'Timer paused. Tap to go on. Hold for 3 seconds to end.' : 'Timer. Tap to pause. Hold for 3 seconds to end.'}
        />
      }
    >
      <div className="ss-runmid it-mid" data-interval data-phase={done ? 'done' : part.ph} data-warn={warn ? '1' : '0'}>
        <div className="ss-phase it-phase">
          <span key={plate.text + plate.cls} className="it-settle"><FlapLabel text={plate.text} size="md" tone={plate.cls ? 'ink' : plate.tone} className={plate.cls} animate={false} /></span>
        </div>
        <TimerFace big seconds={shown} kind="work" tone="ink" />
        <div className="it-rof">
          <span key={rof} className="it-settle"><FlapLabel text={rof} size="sm" animate={false} /></span>
        </div>
      </div>
      {paused && <span className="sr-only" role="status">Paused</span>}
    </SessionFrame>
  )
  return createPortal(screen, document.body)
}

import { useEffect, useRef, useState } from 'react'
import { SplashScreen } from '@capacitor/splash-screen'

import { Crest, FlapLabel, useReducedMotion } from '@/design'
import { loadWorldEngine } from './loadEngine'
import type { CrestStage } from './engine'
import { SPLASH_HOLD_MS, SPLASH_LEAVING_EVENT, SPLASH_TIMELINE, SPLASH_TITLE_AT, splashGesture, splashSkip, type SplashGesture } from './splashSkip'

// The splash (page 38, A, approved): about 8 s, "think Iron Man". The still
// crest (iOS's static frame) unlocks, its pieces lift away turning and hang,
// then come home one layer at a time with a small overshoot and lock; the eye
// ignites last with a warm bloom; WAYMARK flaps in under the crest; then
// Today fades up.
// Skipping it (Josh, 2026-10-19): ONE TAP skips the building straight to the
// title screen (the crest whole and lit, WAYMARK under it), which then lifts as
// usual; HOLD skips the whole splash into the app.
// Reduce Motion: the finished crest and the word, then a crossfade; a hold still skips it.

export function Splash({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<CrestStage | null>(null)
  const started = useRef(false)
  const mounted = useRef(true)
  const stillRef = useRef(reduced)
  const [phase, setPhase] = useState<'wait' | 'run' | 'fallback'>('wait')
  const [flare, setFlare] = useState(false)
  const [word, setWord] = useState(reduced)
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])
  const timers = useRef<number[]>([])
  const playedAt = useRef(0)
  const skipped = useRef<SplashGesture | null>(null)
  const press = useRef<{ timer: number; at: number } | null>(null)

  // One canvas holds one WebGL context: create once (StrictMode runs effects twice); a real unmount disposes.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stageRef.current?.dispose(); stageRef.current = null }
  }, [])
  useEffect(() => {
    const canvas = canvasRef.current
    if (started.current || !canvas) return
    started.current = true
    const hideNative = () => { SplashScreen.hide().catch(() => {}) }
    loadWorldEngine()
      .then(m => m.createCrestStage(canvas, 'splash', { still: stillRef.current }))
      .then(s => {
        if (!mounted.current) { s.dispose(); return }
        stageRef.current = s
        requestAnimationFrame(hideNative)
        setPhase('run')
      })
      .catch(() => { hideNative(); if (mounted.current) setPhase('fallback') })
  }, [])

  const clear = () => { timers.current.forEach(t => window.clearTimeout(t)); timers.current = [] }
  const at = (s: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, s * 1000)) }
  const lift = () => { setLeaving(true); window.dispatchEvent(new Event(SPLASH_LEAVING_EVENT)) }

  /** The rest of the splash after a tap or a hold `elapsed` seconds into it. */
  function playSkip(g: SplashGesture, elapsed: number) {
    const still = phase === 'fallback' || stillRef.current
    // Still (Reduce Motion, no WebGL): the title is already up; only a hold changes anything.
    if (still && g === 'tap') return
    const plan = splashSkip(g, elapsed, SPLASH_TIMELINE)
    clear()
    if (plan.crestAt != null) stageRef.current?.jumpTo(plan.crestAt)
    setFlare(false)
    setWord(true)
    at(plan.leave, lift)
    at(plan.gone, () => setGone(true))
    at(plan.end, () => done.current())
  }

  // The timeline, once the crest is up (or straight on without WebGL).
  useEffect(() => {
    if (phase === 'wait') return
    playedAt.current = performance.now()
    if (skipped.current) {
      // tapped or held while the crest was still loading
      if (skipped.current === 'tap') stageRef.current?.jumpTo(SPLASH_TITLE_AT)
      const g = skipped.current
      skipped.current = null
      playSkip(g, 0)
      return clear
    }
    if (phase === 'fallback' || stillRef.current) {
      at(0, () => setWord(true)); at(1.5, lift); at(2.2, () => setGone(true)); at(2.5, () => done.current())
    } else {
      at(SPLASH_TIMELINE.flareOn, () => setFlare(true))
      at(SPLASH_TIMELINE.flareOff, () => setFlare(false))
      at(SPLASH_TIMELINE.word, () => setWord(true))
      at(SPLASH_TIMELINE.leave, lift)
      at(SPLASH_TIMELINE.gone, () => setGone(true))
      at(SPLASH_TIMELINE.end, () => done.current())
    }
    return clear
    // playSkip reads the phase it was made with; the timeline runs once per phase
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function skip(g: SplashGesture) {
    if (gone) return
    if (phase === 'wait') { skipped.current = g === 'hold' || skipped.current === 'hold' ? 'hold' : 'tap'; if (g === 'hold') playSkip('hold', 0); return }
    playSkip(g, (performance.now() - playedAt.current) / 1000)
  }
  function onPointerDown() {
    if (press.current) window.clearTimeout(press.current.timer)
    const p = { at: performance.now(), timer: 0 }
    p.timer = window.setTimeout(() => { press.current = null; skip('hold') }, SPLASH_HOLD_MS)
    press.current = p
  }
  function onPointerUp() {
    const p = press.current
    if (!p) return
    press.current = null
    window.clearTimeout(p.timer)
    skip(splashGesture(performance.now() - p.at))
  }
  function onPointerCancel() {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }

  return (
    <div
      className={`wm-splash${leaving ? ' is-leaving' : ''}${gone ? ' is-gone' : ''}`}
      aria-label="Waymark. Tap to skip, hold to go straight in."
      role="img"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="wm-splash-stage">
        <canvas ref={canvasRef} style={phase === 'fallback' ? { display: 'none' } : undefined} />
        {phase === 'fallback' && <div className="wm-splash-still"><Crest big width={200} still /></div>}
        <div className={`wm-splash-flare${flare ? ' is-on' : ''}`} />
      </div>
      <div className={`wm-splash-word${word ? ' is-on' : ''}`}>
        {word && <FlapLabel text="WAYMARK" size="lg" tone="gold" animate={reduced ? false : 'mount'} />}
      </div>
    </div>
  )
}

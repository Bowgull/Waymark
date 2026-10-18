import { useEffect, useRef, useState } from 'react'
import { SplashScreen } from '@capacitor/splash-screen'

import { Crest, FlapLabel, useReducedMotion } from '@/design'
import { loadWorldEngine } from './loadEngine'
import type { CrestStage } from './engine'

// The splash (page 38, A, approved): about 8 s, "think Iron Man". The still
// crest (iOS's static frame) unlocks, its pieces lift away turning and hang,
// then come home one layer at a time with a small overshoot and lock; the eye
// ignites last with a warm bloom; WAYMARK flaps in under the crest; then
// Today fades up. The mockup has no skip, so there isn't one.
// Reduce Motion: the finished crest and the word, then a crossfade.

export const SPLASH_TIMELINE = { flareOn: 6.0, flareOff: 7.4, word: 6.8, leave: 9.0, gone: 9.7 } as const

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
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])

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

  // The timeline, once the crest is up (or straight on without WebGL).
  useEffect(() => {
    if (phase === 'wait') return
    const timers: number[] = []
    const at = (s: number, fn: () => void) => timers.push(window.setTimeout(fn, s * 1000))
    if (phase === 'fallback' || stillRef.current) {
      at(0, () => setWord(true)); at(1.5, () => setLeaving(true)); at(2.2, () => done.current())
    } else {
      at(SPLASH_TIMELINE.flareOn, () => setFlare(true))
      at(SPLASH_TIMELINE.flareOff, () => setFlare(false))
      at(SPLASH_TIMELINE.word, () => setWord(true))
      at(SPLASH_TIMELINE.leave, () => setLeaving(true))
      at(SPLASH_TIMELINE.gone, () => done.current())
    }
    return () => timers.forEach(t => window.clearTimeout(t))
  }, [phase])

  return (
    <div className={`wm-splash${leaving ? ' is-leaving' : ''}`} aria-label="Waymark" role="img">
      <canvas ref={canvasRef} style={phase === 'fallback' ? { display: 'none' } : undefined} />
      {phase === 'fallback' && <div className="wm-splash-still"><Crest big width={200} still /></div>}
      <div className={`wm-splash-flare${flare ? ' is-on' : ''}`} />
      <div className={`wm-splash-word${word ? ' is-on' : ''}`}>
        {word && <FlapLabel text="WAYMARK" size="lg" tone="gold" animate={reduced ? false : 'mount'} />}
      </div>
    </div>
  )
}

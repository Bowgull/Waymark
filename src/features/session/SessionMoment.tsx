import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Crest, FlapLabel, useReducedMotion } from '@/design'
import { loadWorldEngine } from '@/world/loadEngine'
import type { CrestStage } from '@/world/engine'

import './session.css'

const RUNES = '<>YX|^+<>YX|^+<>YX|'
const DUR_MS = 3200
/** After WELL TRAVELED lands, a beat before Today. */
const HOLD_AFTER_MS = 1400

interface Dust { x: number; y: number; vy: number; ph: number; c: string; ch: string; life: number }

/**
 * The moment (page 19 #6, approved: "The close / PR moment"): the taken-apart
 * crest snaps together, fairy dust rises off it, the runes around it light gold
 * then teal, shafts of light break through, the lantern flares; then WELL
 * TRAVELED (the app's own words) with the session and its effort. About 3 s;
 * a tap moves on. Reduce Motion: the crest whole and the words at once.
 */
export function SessionMoment({ line, onDone }: { line: string; onDone: () => void }) {
  const reduced = useReducedMotion()
  const glRef = useRef<HTMLCanvasElement>(null)
  const dustRef = useRef<HTMLCanvasElement>(null)
  const [k, setK] = useState(reduced ? 1 : 0)
  const [fallback, setFallback] = useState(false)
  const doneRef = useRef(onDone)
  useLayoutEffect(() => { doneRef.current = onDone })
  const finished = useRef(false)
  const finish = () => { if (finished.current) return; finished.current = true; doneRef.current() }

  // the crest: one canvas holds one WebGL context, so create it once (StrictMode runs effects
  // twice; disposing the first stage would lose the canvas's context); a real unmount disposes.
  const stageRef = useRef<CrestStage | null>(null)
  const started = useRef(false)
  const mounted = useRef(true)
  const stillRef = useRef(reduced)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stageRef.current?.dispose(); stageRef.current = null }
  }, [])
  useEffect(() => {
    const canvas = glRef.current
    if (started.current || !canvas) return
    started.current = true
    const lost = () => setFallback(true)
    canvas.addEventListener('webglcontextlost', lost)
    loadWorldEngine()
      .then(m => m.createCrestStage(canvas, 'moment', { still: stillRef.current, shieldY: 0.6, transparent: true }))
      .then(st => { if (!mounted.current) st.dispose(); else stageRef.current = st })
      .catch(() => { if (mounted.current) setFallback(true) })
  }, [])

  // the clock of the moment, the dust, and the way out
  useEffect(() => {
    if (reduced) {
      const t = window.setTimeout(finish, 2400)
      return () => window.clearTimeout(t)
    }
    const t0 = performance.now()
    let raf = 0, dust: Dust[] = []
    const frame = (now: number) => {
      // once it has moved on, it stops: a state update every frame would keep restarting Today's render (a transition) under it
      if (finished.current) return
      raf = requestAnimationFrame(frame)
      const kk = (now - t0) / DUR_MS
      setK(kk)
      const cv = dustRef.current
      if (!cv) return
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1)
      if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr) }
      const gx = cv.getContext('2d')
      if (!gx) return
      gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.clearRect(0, 0, r.width, r.height)
      const t = now / 1000
      if (kk > 0.45 && kk < 2.5 && dust.length < 140) {
        for (let i = 0; i < 3; i++) dust.push({ x: r.width / 2 + (Math.random() - 0.5) * 160, y: r.height * 0.42 + (Math.random() - 0.5) * 120, vy: -(0.3 + Math.random() * 0.8), ph: Math.random() * 6.28, c: Math.random() > 0.35 ? '255,224,150' : '150,230,210', ch: ".+*'"[Math.floor(Math.random() * 4)], life: 0 })
      }
      gx.font = '700 12px "JetBrains Mono", monospace'
      for (const d of dust) { d.life += 0.012; d.y += d.vy; d.x += Math.sin(t * 2 + d.ph) * 0.4; const a = Math.max(0, Math.min(1, d.life * 3) * (1 - d.life)); gx.fillStyle = `rgba(${d.c},${a})`; gx.fillText(d.ch, d.x, d.y) }
      dust = dust.filter(d => d.life < 1)
      if (kk * DUR_MS > DUR_MS * 0.95 + HOLD_AFTER_MS) finish()
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  const n = Math.floor(Math.max(0, (k - 0.45) / 0.35) * RUNES.length)
  const words = k > 0.95
  return (
    <div className="ss-moment" role="button" tabIndex={0} aria-label={`Well traveled. ${line}. Tap to go on.`} onClick={finish} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') finish() }}>
      <canvas ref={glRef} className="ss-moment-gl" style={fallback ? { display: 'none' } : undefined} aria-hidden />
      {fallback && <span className="ss-moment-fallback"><Crest big width={190} /></span>}
      <div className={`ss-shafts${k > 0.5 ? ' is-on' : ''}`} aria-hidden />
      <div className={`ss-flare${k > 0.55 ? ' is-on' : ''}`} aria-hidden />
      <div className="ss-runes" aria-hidden>
        {[...RUNES].map((r, i) => {
          const a = (i / RUNES.length) * Math.PI * 2
          const cls = i < n - 6 ? 'is-lit is-t' : i < n ? 'is-lit' : ''
          return <span key={i} className={cls} style={{ transform: `translate(${Math.cos(a) * 168 - 6}px,${Math.sin(a) * 175 - 10}px)` }}>{r}</span>
        })}
      </div>
      <canvas ref={dustRef} className="ss-moment-dust" aria-hidden />
      <div className="ss-moment-words" style={{ opacity: words ? 1 : 0 }}>
        {words && <FlapLabel text="WELL TRAVELED" size="lg" tone="gold" animate="mount" />}
        {words && <div style={{ marginTop: 12 }}><FlapLabel text={line} size="sm" animate="mount" /></div>}
      </div>
    </div>
  )
}

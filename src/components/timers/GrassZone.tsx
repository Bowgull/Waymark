import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useReducedMotion } from '@/design'
import { drawGrass, grassGrid, type GrassMode, type GrassParams } from '@/lib/timers/grassScene'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'
import { HEAT_RGB, progressOf, pullAmount, releaseAction, settlePull, swellBreath, swellK, trackRemainingMs, type Heat, type TimerKind, type TimerTrack } from '@/lib/timers/timerLook'

const CALM_FINGER: [number, number, number] = [170, 236, 214]
const WORK_FINGER: [number, number, number] = [236, 206, 120]

/** Set once the grass has started a timer on this phone (page 71: the boxed TAP THE GRASS TO START shows the first time only). */
const GRASS_TAUGHT_KEY = 'wm.grassStartTaught'

/**
 * Where the timer is (page 71): ready = not started (the grass starts it),
 * running = TAP · PAUSE, paused = PAUSED · TAP TO GO ON.
 */
export type GrassState = 'ready' | 'running' | 'paused'

/** The hint at the grass's foot for each state (page 71). */
function grassHint(state: GrassState, taught: boolean): string {
  if (state === 'ready') return taught ? 'TAP TO START' : 'TAP THE GRASS TO START'
  return state === 'paused' ? 'PAUSED · TAP TO GO ON' : 'TAP · PAUSE'
}

function grassLabel(state: GrassState, canSkip: boolean): string {
  const skip = canSkip ? ' Swipe up to skip.' : ''
  if (state === 'ready') return 'Timer. Tap to start.'
  if (state === 'paused') return `Timer paused. Tap to go on.${skip}`
  return `Timer. Tap to pause.${skip}`
}

interface GrassZoneProps {
  track: TimerTrack
  /** work: lit gold, wind rising; hold / rest: calm teal with the 5 s glow. */
  kind: TimerKind
  /** Rest between rounds of a work timer draws teal too. */
  mode?: GrassMode
  heat?: Heat | null
  /** Tap the grass: start (ready), pause / go on (running, paused). */
  onTap?: () => void
  /** Where the timer is: sets the hint and the label (page 71). Running by default. */
  state?: GrassState
  /** A full pull up the grass, released: skip to the next phase. */
  onSkip?: () => void
  label?: string
  /**
   * The bag round's fixed band (page 55 layout 1): the grass takes this share
   * of the screen (0.34) and carries no hint, so nothing sits on it. Every
   * other timer keeps page 19's half screen and its TAP · PAUSE hint. The
   * band still says TAP TO START before the round and PAUSED · TAP TO GO ON
   * while paused (page 71), so the grass is never a hidden control.
   */
  band?: number
}

/**
 * The half-screen glyph grass of every timer (page 19 `.grasshalf`): 47% of the
 * screen, faded in at its top edge, the giant tap zone. Tap pauses; swipe up
 * skips (a beam rises with the pull, a full pull skips on release, letting go
 * early settles back); the blades part around the finger with a light under it
 * and a drag leaves a fading wake.
 */
export function GrassZone({ track, kind, mode, heat, onTap, onSkip, state = 'running', label, band }: GrassZoneProps) {
  const reduced = useReducedMotion()
  // Page 71: the first time, TAP THE GRASS TO START sits in a small box mid-grass; after the
  // grass has started a timer once on this phone it is the quiet line at the foot.
  const [taught, setTaught] = useState(() => storageGet(GRASS_TAUGHT_KEY) === '1')
  const stateRef = useRef(state)
  useLayoutEffect(() => { stateRef.current = state })
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ track, kind, mode, heat })
  useLayoutEffect(() => { live.current = { track, kind, mode, heat } })
  const touch = useRef<Pick<GrassParams, 'finger' | 'trail' | 'pull' | 'fcol' | 'touch'>>({})
  // An early pull let go settles back: the beam sinks from where it was (timerLook settlePull).
  const settle = useRef<{ x: number; y: number; from: number; at: number } | null>(null)
  const handlers = useRef({ onTap, onSkip })
  useLayoutEffect(() => { handlers.current = { onTap, onSkip } })
  const tap = () => {
    if (stateRef.current === 'ready' && handlers.current.onTap && !taught) { storageSet(GRASS_TAUGHT_KEY, '1'); setTaught(true) }
    handlers.current.onTap?.()
  }

  useEffect(() => {
    const box = boxRef.current, canvas = canvasRef.current
    if (!box || !canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    let grid = grassGrid(1, 1), raf = 0, last = 0
    const fit = () => {
      const r = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
      grid = grassGrid(r.width, r.height)
      canvas.width = Math.round(grid.cols * grid.cw * dpr); canvas.height = Math.round(grid.rows * grid.ch * dpr)
      canvas.style.width = `${grid.cols * grid.cw}px`; canvas.style.height = `${grid.rows * grid.ch}px`
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.font = '700 14px "JetBrains Mono", "Cascadia Mono", Consolas, monospace'
      g.textBaseline = 'top'
    }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(box)
    const fps = reduced ? 2 : 20
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < 1000 / fps) return
      last = now
      const { track: tr, kind: k, mode: m, heat: h } = live.current
      const remaining = trackRemainingMs(tr)
      const calm = k !== 'work'
      const params: GrassParams = {
        progress: progressOf(remaining, tr.durationSec),
        mode: m ?? (calm ? 'rest' : 'work'),
        hot: !!h,
        hotCol: h ? HEAT_RGB[h] : undefined,
        glow: calm ? swellBreath(swellK(remaining / 1000, k), Date.now()) : 0,
        ...touch.current,
      }
      const st = settle.current
      if (st) {
        const k = reduced ? 0 : settlePull(st.from, performance.now() - st.at)
        if (k > 0) params.settle = { x: st.x, y: st.y, k }
        else settle.current = null
      }
      drawGrass(g, grid, reduced ? 0 : now / 1000, params, performance.now() / 1000)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro?.disconnect() }
  }, [reduced])

  // ── the finger ──
  const gesture = useRef({ down: false, y0: 0 })
  const at = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, h: r.height }
  }
  const fcol = () => (live.current.kind !== 'work' || live.current.mode === 'rest' ? CALM_FINGER : WORK_FINGER)

  return (
    <>
      <div
        ref={boxRef}
        className={`tm-grass${band != null ? ' is-band' : ''}`}
        style={band != null ? { height: `${band * 100}%` } : undefined}
        role="button"
        tabIndex={0}
        aria-label={label ?? grassLabel(state, !!onSkip)}
        aria-disabled={onTap ? undefined : true}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap() }
          if (e.key === 'ArrowUp' && handlers.current.onSkip) { e.preventDefault(); handlers.current.onSkip() }
        }}
        onPointerDown={e => {
          const p = at(e)
          gesture.current = { down: true, y0: e.clientY }
          settle.current = null
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not capturable */ }
          touch.current = { finger: { x: p.x, y: p.y, on: true }, trail: [], pull: 0, fcol: fcol(), touch: { x: p.x, y: p.y, at: performance.now() / 1000, col: fcol() } }
        }}
        onPointerMove={e => {
          if (!gesture.current.down) return
          const p = at(e)
          const trail = [...(touch.current.trail ?? []), { x: p.x, y: p.y, at: performance.now() / 1000 }].slice(-24)
          const pull = handlers.current.onSkip ? pullAmount(gesture.current.y0, e.clientY, p.h) : 0
          touch.current = { ...touch.current, finger: { x: p.x, y: p.y, on: true }, trail, pull, fcol: fcol() }
        }}
        onPointerUp={e => {
          if (!gesture.current.down) return
          gesture.current.down = false
          const pull = touch.current.pull ?? 0
          const f = touch.current.finger
          touch.current = { ...touch.current, finger: { x: 0, y: 0, on: false }, pull: 0 }
          const act = handlers.current.onSkip ? releaseAction(pull, e.clientY - gesture.current.y0) : 'tap'
          if (act !== 'skip' && pull > 0 && f) settle.current = { x: f.x, y: f.y, from: pull, at: performance.now() }
          if (act === 'skip') handlers.current.onSkip?.()
          else if (act === 'tap') tap()
        }}
        onPointerCancel={() => { gesture.current.down = false; touch.current = { ...touch.current, finger: { x: 0, y: 0, on: false }, pull: 0 } }}
      >
        <canvas ref={canvasRef} aria-hidden />
      </div>
      {(band == null || state !== 'running') && (
        state === 'ready' && !taught
          ? <div className="tm-ghint is-mid" aria-hidden data-hint><span>{grassHint(state, taught)}</span></div>
          : <div className="tm-ghint" aria-hidden data-hint><span>{grassHint(state, taught)}</span><span /></div>
      )}
    </>
  )
}

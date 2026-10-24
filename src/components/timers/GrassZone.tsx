import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { FlapLabel, useReducedMotion } from '@/design'
import { tapHaptic } from '@/lib/haptics'
import { ZONE_TINT, type HrZone } from '@/lib/hrZoneState'
import { drawGrass, grassGrid, type GrassMode, type GrassParams } from '@/lib/timers/grassScene'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'
import { FINISHING_AFTER_MS, GRASS_HOLD_MS, HEAT_RGB, HOLD_GRACE_MS, HOLD_LOG_DELAY_MS, holdReleaseLeft, HOLD_SLOP_PX, HOLD_TAP_MS, progressOf, pullAmount, releaseAction, settlePull, swellBreath, swellK, trackRemainingMs, zoneEase, type Heat, type TimerKind, type TimerTrack } from '@/lib/timers/timerLook'

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

function grassLabel(state: GrassState, canSkip: boolean, canHold = false, canBack = false): string {
  const skip = `${canSkip ? ' Swipe up to skip.' : ''}${canBack ? ' Swipe down to go back.' : ''}${canHold ? ' Hold for 3 seconds to finish.' : ''}`
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
  /** Page 85: a full pull down, released: back (the screen decides: restart, then the part before). */
  onBack?: () => void
  label?: string
  /**
   * The bag round's fixed band (page 55 layout 1): the grass takes this share
   * of the screen (0.34) and carries no hint, so nothing sits on it. Every
   * other timer keeps page 19's half screen and its TAP · PAUSE hint. The
   * band still says TAP TO START before the round and PAUSED · TAP TO GO ON
   * while paused (page 71), so the grass is never a hidden control.
   */
  band?: number
  /**
   * Page 74, a run: the heart-rate zone's tint through the grass (teal, gold,
   * ember), easing over about 1 s (instant with Reduce Motion).
   */
  zone?: HrZone
  /**
   * Page 74, a run's finish (bend, Josh's pick): hold the grass 3 s and it
   * flattens in a widening wave from the thumb; HOLD · FINISH turns FINISHING
   * after 1 s; at full a light haptic, then `onHeld`. Let go early and it eases
   * back (450 ms). A short tap still pauses. `held` keeps it flat while Log your
   * run is up; when it turns false again (tapped outside) the grass eases back.
   * Page 85: it sits beside the swipes; a finger that moves is a swipe, never a hold.
   */
  hold?: { onHeld: () => void; held: boolean }
  /** The hold's words at the foot: [the hint, the flap after 1 s]. Page 81's timer: HOLD · END, ENDING. */
  holdWords?: readonly [string, string]
  /**
   * Page 81, the interval timer's orange near the end of a part: the grass
   * takes the warning orange, easing over about 1 s (instant with Reduce Motion).
   */
  orange?: boolean
}

/**
 * The half-screen glyph grass of every timer (page 19 `.grasshalf`): 44% (page 84) of the
 * screen, faded in at its top edge, the giant tap zone. Tap pauses; swipe up
 * skips (a beam rises with the pull, a full pull skips on release, letting go
 * early settles back); the blades part around the finger with a light under it
 * and a drag leaves a fading wake.
 */
export function GrassZone({ track, kind, mode, heat, onTap, onSkip, onBack, state = 'running', label, band, zone, hold, holdWords = ['HOLD · FINISH', 'FINISHING'], orange = false }: GrassZoneProps) {
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
  const touch = useRef<Pick<GrassParams, 'finger' | 'trail' | 'pull' | 'pullDown' | 'fcol' | 'touch'>>({})
  // An early pull let go settles back: the beam sinks from where it was (timerLook settlePull).
  const settle = useRef<{ x: number; y: number; from: number; at: number; down?: boolean } | null>(null)
  const handlers = useRef({ onTap, onSkip, onBack, onHeld: hold?.onHeld })
  useLayoutEffect(() => { handlers.current = { onTap, onSkip, onBack, onHeld: hold?.onHeld } })
  // The zone tint, eased (page 59 ease-out, ~1 s): from where it was to the zone's mix.
  const tint = useRef<{ from: readonly [number, number, number]; to: readonly [number, number, number]; at: number }>({ from: ZONE_TINT[zone ?? 'none'], to: ZONE_TINT[zone ?? 'none'], at: -1e9 })
  useLayoutEffect(() => {
    const to = ZONE_TINT[zone ?? 'none'], t = tint.current
    if (to === t.to) return
    const now = performance.now()
    tint.current = { from: zoneEase(t.from, t.to, now - t.at, reduced), to, at: now }
  }, [zone, reduced])
  // Page 81: the orange, eased the same way (one channel of the same ease).
  const orangeT = useRef<{ from: readonly [number, number, number]; to: readonly [number, number, number]; at: number }>({ from: [orange ? 1 : 0, 0, 0], to: [orange ? 1 : 0, 0, 0], at: -1e9 })
  useLayoutEffect(() => {
    const to: readonly [number, number, number] = [orange ? 1 : 0, 0, 0], t = orangeT.current
    if (to[0] === t.to[0]) return
    const now = performance.now()
    orangeT.current = { from: zoneEase(t.from, t.to, now - t.at, reduced), to, at: now }
  }, [orange, reduced])
  // The finish hold: when it started (null: not holding), where an early let-go eases back from, and fired.
  const hd = useRef<{ start: number | null; from: number; at: number; full: boolean; wx: number; wy: number; timers: number[] }>({ start: null, from: 0, at: -1e9, full: false, wx: 0.5, wy: 0.9, timers: [] })
  const [finishing, setFinishing] = useState(false)
  const holdK = (now: number): number => {
    const h = hd.current
    if (h.full) return 1
    if (h.start != null) return Math.min(1, (now - h.start) / GRASS_HOLD_MS)
    return holdReleaseLeft(h.from, now - h.at, reduced)
  }
  const clearHoldTimers = () => { for (const t of hd.current.timers) window.clearTimeout(t); hd.current.timers = [] }
  const letGo = (now: number) => {
    const h = hd.current
    h.from = holdK(now); h.at = now; h.start = null; h.full = false
    clearHoldTimers()
    setFinishing(false)
  }
  /** The hold filled: the haptic and the action together, once. */
  const completeHold = () => {
    const h = hd.current
    if (h.full || h.start == null) return
    h.full = true; h.start = null
    clearHoldTimers()
    setFinishing(true)
    void tapHaptic()
    if (HOLD_LOG_DELAY_MS > 0) h.timers.push(window.setTimeout(() => handlers.current.onHeld?.(), HOLD_LOG_DELAY_MS))
    else handlers.current.onHeld?.()
    // Nothing took it (the board never came): ease back rather than stay flat.
    h.timers.push(window.setTimeout(() => { if (h.full && !wasHeld.current) letGo(performance.now()) }, HOLD_LOG_DELAY_MS + 1500))
  }
  // Log your run closed by a tap outside (held back to false): the grass eases back.
  const heldNow = !!hold?.held
  const wasHeld = useRef(heldNow)
  useEffect(() => {
    if (wasHeld.current && !heldNow && hd.current.full) letGo(performance.now())
    wasHeld.current = heldNow
  })
  useEffect(() => () => clearHoldTimers(), [])
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
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // 60 fps while the grass bends or the tint eases (page 74), else the calm 20 (2 with Reduce Motion).
      const pnow = performance.now()
      // The hold ends on the frame it fills (a busy phone can run setTimeout late).
      if (hd.current.start != null && pnow - hd.current.start >= GRASS_HOLD_MS) completeHold()
      const wave = holdK(pnow)
      const tn = tint.current, on = orangeT.current, easing = !reduced && (pnow - tn.at < 1000 || pnow - on.at < 1000)
      const fps = reduced ? (wave > 0 && wave < 1 ? 20 : 2) : wave > 0 || easing ? 60 : 20
      if (now - last < 1000 / fps - 1) return
      last = now
      const { track: tr, kind: k, mode: m, heat: h } = live.current
      const zt = zoneEase(tn.from, tn.to, pnow - tn.at, reduced)
      const ok = zoneEase(on.from, on.to, pnow - on.at, reduced)[0]
      const remaining = trackRemainingMs(tr)
      const calm = k !== 'work'
      const params: GrassParams = {
        progress: progressOf(remaining, tr.durationSec),
        mode: m ?? (calm ? 'rest' : 'work'),
        hot: !!h,
        hotCol: h ? HEAT_RGB[h] : undefined,
        glow: calm ? swellBreath(swellK(remaining / 1000, k), Date.now()) : 0,
        ...touch.current,
        ...(zt[0] > 0 || zt[1] > 0 || zt[2] > 0 ? { zone: zt } : {}),
        ...(wave > 0 ? { wave, wx: hd.current.wx, wy: hd.current.wy } : {}),
        ...(ok > 0 ? { orange: ok } : {}),
      }
      const st = settle.current
      if (st) {
        const k = reduced ? 0 : settlePull(st.from, performance.now() - st.at)
        if (k > 0) params.settle = { x: st.x, y: st.y, k, down: st.down }
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
        aria-label={label ?? grassLabel(state, !!onSkip, !!hold, !!onBack)}
        aria-disabled={onTap ? undefined : true}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap() }
          if (e.key === 'ArrowUp' && handlers.current.onSkip) { e.preventDefault(); handlers.current.onSkip() }
          if (e.key === 'ArrowDown' && handlers.current.onBack) { e.preventDefault(); handlers.current.onBack() }
        }}
        onPointerDown={e => {
          const p = at(e)
          gesture.current = { down: true, y0: e.clientY }
          settle.current = null
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not capturable */ }
          touch.current = { finger: { x: p.x, y: p.y, on: true }, trail: [], pull: 0, pullDown: 0, fcol: fcol(), touch: { x: p.x, y: p.y, at: performance.now() / 1000, col: fcol() } }
          // The finish hold starts with the touch (a new hold always starts from flat-out empty).
          if (handlers.current.onHeld && !hd.current.full) {
            const h = hd.current
            clearHoldTimers()
            h.start = performance.now(); h.from = 0; h.wx = p.x; h.wy = p.y
            setFinishing(false)
            h.timers.push(window.setTimeout(() => setFinishing(true), FINISHING_AFTER_MS))
            h.timers.push(window.setTimeout(completeHold, GRASS_HOLD_MS))
          }
        }}
        onPointerMove={e => {
          if (!gesture.current.down) return
          const p = at(e)
          const trail = [...(touch.current.trail ?? []), { x: p.x, y: p.y, at: performance.now() / 1000 }].slice(-24)
          const pull = handlers.current.onSkip ? pullAmount(gesture.current.y0, e.clientY, p.h) : 0
          const pullDown = handlers.current.onBack ? pullAmount(e.clientY, gesture.current.y0, p.h) : 0
          touch.current = { ...touch.current, finger: { x: p.x, y: p.y, on: true }, trail, pull, pullDown, fcol: fcol() }
          // A finger that travels is a swipe or a drag, never the hold: the hold lets go at once.
          if (hd.current.start != null && !hd.current.full && Math.abs(gesture.current.y0 - e.clientY) > HOLD_SLOP_PX && (handlers.current.onSkip || handlers.current.onBack)) letGo(performance.now())
        }}
        onPointerUp={e => {
          if (!gesture.current.down) return
          gesture.current.down = false
          const pull = touch.current.pull ?? 0
          const pullDown = touch.current.pullDown ?? 0
          const f = touch.current.finger
          touch.current = { ...touch.current, finger: { x: 0, y: 0, on: false }, pull: 0, pullDown: 0 }
          const act = releaseAction(pull, e.clientY - gesture.current.y0, pullDown)
          const settleBack = () => {
            if (f && pull > 0) settle.current = { x: f.x, y: f.y, from: pull, at: performance.now() }
            else if (f && pullDown > 0) settle.current = { x: f.x, y: f.y, from: pullDown, at: performance.now(), down: true }
          }
          if (handlers.current.onHeld) {
            // The finish hold: at full the board takes over; let go a breath before full and it
            // still counts; let go early and the grass eases back; a short press is the tap.
            const h = hd.current
            if (h.full) return
            const heldMs = h.start != null ? performance.now() - h.start : 0
            if (h.start != null && heldMs >= GRASS_HOLD_MS - HOLD_GRACE_MS) { completeHold(); return }
            const swiped = h.start == null
            letGo(performance.now())
            if (act === 'skip' && handlers.current.onSkip) { handlers.current.onSkip(); return }
            if (act === 'back' && handlers.current.onBack) { handlers.current.onBack(); return }
            if (act === 'none') { settleBack(); return }
            if (!swiped && heldMs < HOLD_TAP_MS) tap()
            return
          }
          if (act === 'skip' && handlers.current.onSkip) handlers.current.onSkip()
          else if (act === 'back' && handlers.current.onBack) handlers.current.onBack()
          else { settleBack(); if (act === 'tap') tap() }
        }}
        onContextMenu={e => e.preventDefault()}
        onPointerCancel={() => {
          gesture.current.down = false
          touch.current = { ...touch.current, finger: { x: 0, y: 0, on: false }, pull: 0, pullDown: 0 }
          if (handlers.current.onHeld && !hd.current.full) letGo(performance.now())
        }}
      >
        <canvas ref={canvasRef} aria-hidden />
      </div>
      {(band == null || state !== 'running') && (
        state === 'ready' && !taught
          ? <div className="tm-ghint is-mid" aria-hidden data-hint><span>{grassHint(state, taught)}</span></div>
          : <div className="tm-ghint" aria-hidden data-hint>
              <span>{grassHint(state, taught)}</span>
              {hold && state !== 'ready'
                ? <span className="tm-fin"><span className={`tm-fin-h${finishing ? ' is-gone' : ''}`}>{holdWords[0]}</span><span className={`tm-fin-w${finishing ? ' is-on' : ''}`} data-finishing={finishing ? '' : undefined}><FlapLabel text={holdWords[1]} size="xs" tone="gold" animate={false} /></span></span>
                : <span />}
            </div>
      )}
    </>
  )
}

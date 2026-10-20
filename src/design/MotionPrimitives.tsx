import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cascadeArmed } from './cascade'
import { prefersReducedMotion } from './motion'
import { flipInLabels, play, riseIn, sinkOut, SWAP, type SwapState } from './motionKit'
import { glowRow } from './popFlap'
import { MOTION } from './tokens'
import { registerSceneWindow, SCENE } from './sceneScroll'
import { completeHaptic, tapHaptic } from '@/lib/haptics'

// The shared motion primitives (page 59 §5.3, approved 2026-10-19). One system
// for every row, card and board: Expand (and AutoHeight), Strike, Tick, Swap,
// Flip and Rise. Transform, opacity and (for the two height primitives) a
// container's height, nothing else; every one lands at its end state under
// Reduce Motion (a short fade at most). CSS in motion.css.

const EASE_OUT = MOTION.easeOut
const EASE_INOUT = MOTION.easeInOut

// ─── Expand / Collapse ─────────────────────────────────────────

export interface ExpandProps {
  open: boolean
  children: ReactNode
  className?: string
  /** Called once the content has gone (after the close). */
  onClosed?: () => void
}

/**
 * Content that opens below a row. Height opens in 320 ms --ease-out while the
 * content fades in and drops 4 px (180 ms, 60 ms late); closing, the content
 * fades first, then the height closes (240 ms --ease-inout). The rows below
 * glide because this box's height animates (grid-template-rows 0fr -> 1fr).
 * The content stays mounted until the close has finished.
 * Reduce Motion: the height at once, a 120 ms fade.
 */
export function Expand({ open, children, className = '', onClosed }: ExpandProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  const closed = useRef(onClosed)
  useEffect(() => { closed.current = onClosed })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (open) {
      if (el.dataset.state !== 'open') {
        el.dataset.state = 'closed'
        // one style read so the open below transitions from closed (style only, no layout)
        void getComputedStyle(el).gridTemplateRows
        el.dataset.state = 'open'
      }
      const t = window.setTimeout(() => { el.dataset.settled = '1' }, MOTION.moveMs + 80)
      return () => window.clearTimeout(t)
    }
    delete el.dataset.settled
    el.dataset.state = 'closed'
    if (!mounted) return
    const t = window.setTimeout(() => { setMounted(false); closed.current?.() }, prefersReducedMotion() ? 120 : 120 + 240 + 20)
    return () => window.clearTimeout(t)
  }, [open, mounted])

  if (!mounted) return null
  return (
    <div ref={ref} className={`wm-expand ${className}`.trim()}>
      <div className="wm-expand-in">{children}</div>
    </div>
  )
}

/**
 * A box whose content swaps for something taller or shorter (the Waybook line
 * growing into its box, page 59 §5.3): its height glides from the old to the
 * new (320 ms --ease-out growing, 240 ms --ease-inout shrinking) and the new
 * content fades in, dropping 4 px. Reduce Motion: at once.
 */
export function AutoHeight({ children, className = '' }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = outer.current
    const content = inner.current
    if (!box || !content || typeof ResizeObserver === 'undefined') return
    let last = 0
    let anim: Animation | null = null
    const ro = new ResizeObserver(entries => {
      const e = entries[entries.length - 1]
      const h = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height
      const from = last
      last = h
      // hidden (a kept tab) or first laid out: nothing to glide from
      if (!from || !h || Math.abs(h - from) < 8 || prefersReducedMotion()) return
      anim?.cancel()
      const grow = h > from
      anim = play(box, [{ height: `${from}px` }, { height: `${h}px` }], { duration: grow ? MOTION.moveMs : 240, easing: grow ? EASE_OUT : EASE_INOUT })
      play(content, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: MOTION.quickMs, delay: 60, easing: EASE_OUT, fill: 'backwards' })
    })
    ro.observe(content)
    return () => { ro.disconnect(); anim?.cancel() }
  }, [])
  return (
    <div ref={outer} className={`wm-autoh ${className}`.trim()}>
      <div ref={inner}>{children}</div>
    </div>
  )
}

// ─── Strike / Tick ─────────────────────────────────────────────

/**
 * A clay line drawn through a name, left to right (scaleX 0 -> 1, 220 ms
 * --ease-out), then the name dims (motion.css); undone, it retracts right to
 * left (180 ms --ease-in). Already struck when it first shows: drawn, no motion.
 * A light haptic when it draws. Sits over its (position: relative) parent.
 */
export function Strike({ on, className = '', quiet = false }: { on: boolean; className?: string; quiet?: boolean }) {
  const was = useRef(on)
  useEffect(() => {
    if (on && !was.current && !quiet && !cascadeArmed()) void tapHaptic()
    was.current = on
  }, [on, quiet])
  return <span aria-hidden className={`wm-strike${on ? ' is-on' : ''} ${className}`.trim()} />
}

/**
 * A ✓ that flips in (one flip, 120 ms) when something gets done while you
 * look, its row glowing teal for 900 ms. On a screen opening it is simply
 * there. `session` gives the success haptic (a session done); a set, a light one.
 */
export function Tick({ children = '✓', className = '', label = 'done', session = true }: { children?: ReactNode; className?: string; label?: string; session?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (cascadeArmed() || prefersReducedMotion()) return
    const el = ref.current
    play(el, [{ transform: 'perspective(120px) rotateX(-90deg)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 120, easing: EASE_OUT })
    glowRow(el?.closest('.td-row, .db-row, .wm-row'), 'good')
    void (session ? completeHaptic() : tapHaptic())
    // only on first show: a ✓ that was there stays still
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <span ref={ref} className={`wm-tick ${className}`.trim()} aria-label={label}>{children}</span>
}

// ─── Swap (REPLACE and its UNDO) ───────────────────────────────

/**
 * One row of a swapping list. Leaving: struck, then it collapses. Arriving
 * (while another leaves): it opens 340 ms in with an 8 px drop and its name
 * flips in at half open; a light haptic as it lands. Reduce Motion: a 160 ms
 * crossfade.
 */
export function SwapRow({ state, children, afterExit = false }: { state: SwapState; children: ReactNode; afterExit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [struck, setStruck] = useState(false)
  const [open, setOpen] = useState(state !== 'exit')
  const entered = useRef(state !== 'enter')
  useEffect(() => {
    if (state !== 'exit') return
    const t0 = window.setTimeout(() => setStruck(true), 0)
    const t1 = window.setTimeout(() => setOpen(false), prefersReducedMotion() ? 0 : SWAP.strikeMs)
    return () => { window.clearTimeout(t0); window.clearTimeout(t1) }
  }, [state])
  useLayoutEffect(() => {
    if (entered.current) return
    entered.current = true
    const el = ref.current
    if (prefersReducedMotion()) { play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); return }
    const delay = afterExit ? SWAP.enterAfterMs : 0
    play(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: MOTION.moveMs, delay, easing: EASE_OUT, fill: 'backwards' })
    play(el, [{ height: '0px', overflow: 'hidden' }, { height: `${el?.offsetHeight ?? 0}px`, overflow: 'hidden' }], { duration: MOTION.moveMs, delay, easing: EASE_OUT, fill: 'backwards' })
    flipInLabels(el, delay + MOTION.moveMs / 2)
    const t = window.setTimeout(() => { void tapHaptic() }, delay + MOTION.moveMs)
    return () => window.clearTimeout(t)
  }, [afterExit])
  if (state === 'exit') {
    return (
      <div className="wm-swap is-out" inert>
        <Expand open={open}>
          <div className="wm-swap-face">{children}<Strike on={struck} className="is-row" quiet /></div>
        </Expand>
      </div>
    )
  }
  return <div ref={ref} className="wm-swap">{children}</div>
}

// ─── Rise / Sink (cards) ───────────────────────────────────────

/**
 * A card that rises in when shown and sinks out before it goes: keep `show`
 * false and it stays mounted for the sink, then unmounts.
 */
export function Rise({ show, children, className = '' }: { show: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(show)
  if (show && !mounted) setMounted(true)
  useLayoutEffect(() => {
    if (show) { riseIn(ref.current); return }
    if (!mounted) return
    let alive = true
    void sinkOut(ref.current).then(() => { if (alive) setMounted(false) })
    return () => { alive = false }
  }, [show, mounted])
  if (!mounted) return null
  return <div ref={ref} className={className || undefined}>{children}</div>
}

/**
 * The window (page 67, Scroll reveals): the open stretch between a world tab's
 * header and its first board, sized so the boards start `at` of the screen
 * down (46%, Today 40%). It is outside every board, so a tap on it closes an
 * open one (page 61); it takes no tap of its own. See sceneScroll.ts.
 */
export function SceneWindow({ at = SCENE.boardsAt }: { at?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    return registerSceneWindow(el, at)
  }, [at])
  return <div ref={ref} className="wm-scene-window" aria-hidden />
}

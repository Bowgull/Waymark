// The motion system's pieces that aren't components (page 59 §5.3): the WAAPI
// helper, label flip-in, the swap list's bookkeeping, tile flips and the card
// rise / sink. The components are in MotionPrimitives.tsx.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { FLIP, openFrames } from './flap'
import { flipLabel, landedOf } from './flapEngine'
import { prefersReducedMotion } from './motion'
import { MOTION } from './tokens'

const EASE_OUT = MOTION.easeOut
const EASE_IN = MOTION.easeIn

/** element.animate(), or nothing where it isn't there. */
export function play(el: Element | null | undefined, frames: Keyframe[], timing: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return null
  try { return (el as HTMLElement).animate(frames, timing) } catch { return null }
}

/** Every flap label inside `scope` flips in from blank now (two flips a tile). */
export function flipInLabels(scope: Element | null, delayMs = 0): void {
  if (!scope) return
  const start = performance.now() + delayMs
  scope.querySelectorAll<HTMLElement>('.wm-flap').forEach(root => {
    const text = landedOf(root)
    if (text == null) return
    const frames = [...text].map(openFrames)
    flipLabel(root, frames, start, FLIP.openMaxMs)
  })
}

/** How a row in a swapping list stands. */
export type SwapState = 'enter' | 'stay' | 'exit'

/** Strike (220) -> the old row collapses (120 fade + 240 height) -> the new row opens from 340 ms. */
export const SWAP = { strikeMs: 220, exitMs: 220 + 120 + 240, enterAfterMs: 220 + 120 } as const

interface SwapTrack<T> {
  keys: ReadonlyArray<string>
  /** The items as they were when the keys last changed (a leaving row shows its last look). */
  items: ReadonlyArray<T>
  entering: ReadonlySet<string>
  leaving: ReadonlyArray<{ item: T; key: string; at: number }>
}

/**
 * A list whose rows can be swapped: rows that leave stay a moment to be struck
 * and collapse; rows that arrive (after the first render) open in.
 */
export function useSwapList<T>(items: ReadonlyArray<T>, keyOf: (item: T) => string): Array<{ item: T; key: string; state: SwapState; afterExit: boolean }> {
  const keys = items.map(keyOf)
  const [track, setTrack] = useState<SwapTrack<T>>(() => ({ keys, items, entering: new Set(), leaving: [] }))
  // derived state: what left and what arrived since the keys last changed (only then: the
  // items array is new on every render)
  const changed = track.keys.length !== keys.length || track.keys.some((k, i) => k !== keys[i])
  if (changed) {
    const gone = track.keys.flatMap((k, i) => (keys.includes(k) ? [] : [{ item: track.items[i], key: k, at: i }]))
    setTrack({
      keys,
      items,
      entering: new Set(keys.filter(k => !track.keys.includes(k))),
      leaving: [...track.leaving.filter(l => !keys.includes(l.key) && !gone.some(g => g.key === l.key)), ...gone],
    })
  }
  const leaving = track.leaving
  useEffect(() => {
    if (leaving.length === 0) return
    const t = window.setTimeout(() => setTrack(tr => ({ ...tr, leaving: [] })), prefersReducedMotion() ? 160 : SWAP.exitMs)
    return () => window.clearTimeout(t)
  }, [leaving])
  const afterExit = leaving.length > 0
  const out: Array<{ item: T; key: string; state: SwapState; afterExit: boolean }> = items.map((item, i) => ({
    item,
    key: keys[i],
    state: track.entering.has(keys[i]) ? 'enter' : 'stay',
    afterExit,
  }))
  for (const l of leaving) out.splice(Math.min(l.at, out.length), 0, { item: l.item, key: l.key, state: 'exit', afterExit })
  return out
}

// ─── Flip (a tile turning over) ────────────────────────────────

/**
 * Tiles that turn over when what they show changes (the week strip's days when
 * the week changes): each child matching `selector` flips (rotateX, 240 ms),
 * 30 ms apart. Not on first show. Reduce Motion: none.
 */
export function useFlipOnChange(ref: React.RefObject<HTMLElement | null>, key: string, selector = ':scope > *'): void {
  const last = useRef(key)
  useLayoutEffect(() => {
    if (last.current === key) return
    last.current = key
    if (prefersReducedMotion() || !ref.current) return
    Array.from(ref.current.querySelectorAll(selector)).slice(0, 8).forEach((el, i) => {
      play(el, [{ transform: 'perspective(300px) rotateX(-90deg)', opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 240, delay: i * 30, easing: EASE_OUT, fill: 'backwards' })
    })
  }, [ref, key, selector])
}

/** A card rising in: opacity, 14 px up, scale .96 -> 1, 300 ms --ease-out. Reduce Motion: a fade. */
export function riseIn(el: Element | null, delayMs = 0): Animation | null {
  if (prefersReducedMotion()) return play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: delayMs, fill: 'backwards' })
  return play(el, [{ opacity: 0, transform: 'translateY(14px) scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: delayMs, easing: EASE_OUT, fill: 'backwards' })
}

/** A card sinking out: 8 px down and gone, 180 ms --ease-in. Resolves when it's done. */
export function sinkOut(el: Element | null): Promise<void> {
  const a = prefersReducedMotion()
    ? play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })
    : play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }], { duration: MOTION.quickMs, easing: EASE_IN, fill: 'forwards' })
  return a ? a.finished.then(() => undefined, () => undefined) : Promise.resolve()
}


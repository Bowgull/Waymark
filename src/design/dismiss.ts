// One way out for every board (page 61 part 2, approved 2026-10-19).
//
// Every open board registers a layer here. The newest layer is "the top":
//   - Escape (the web build) closes the top layer only;
//   - a swipe in from the left edge closes the top layer, or, with none open,
//     goes back the way the page's ‹ link does;
//   - re-tapping the tab you're on closes every layer (and scrolls to the top).
// Layers that must not close by accident (a running session's cards) simply
// don't register a close, or register one that does nothing.

import { useEffect, useRef, type RefObject } from 'react'

interface Layer {
  id: number
  close: () => void
}

let nextId = 1
const layers: Layer[] = []
const backs: Array<{ id: number; back: () => void }> = []

/** Opens a layer; the returned function removes it (call it on unmount). */
export function pushLayer(close: () => void): () => void {
  const layer = { id: nextId++, close }
  layers.push(layer)
  return () => {
    const i = layers.findIndex(l => l.id === layer.id)
    if (i >= 0) layers.splice(i, 1)
  }
}

export function layerCount(): number {
  return layers.length
}

/** Closes the newest layer. False when none is open. */
export function closeTop(): boolean {
  const top = layers[layers.length - 1]
  if (!top) return false
  top.close()
  return true
}

/** Closes every open layer, newest first (a re-tap on the tab you're on). */
export function closeAll(): void {
  for (const l of [...layers].reverse()) l.close()
}

/** A page's back (its ‹ link): the edge swipe does the same. The newest page wins. */
export function pushBack(back: () => void): () => void {
  const entry = { id: nextId++, back }
  backs.push(entry)
  return () => {
    const i = backs.findIndex(b => b.id === entry.id)
    if (i >= 0) backs.splice(i, 1)
  }
}

/** What the edge swipe and Escape do: close the top board, else go back. */
export function goBackOrClose(): boolean {
  if (closeTop()) return true
  const b = backs[backs.length - 1]
  if (!b) return false
  b.back()
  return true
}

// ─── hooks ────────────────────────────────────────────────────

/** Registers a board while `open`; Escape, the edge swipe and a tab re-tap call `close`. */
export function useDismissLayer(open: boolean, close: (() => void) | undefined): void {
  const ref = useRef(close)
  useEffect(() => { ref.current = close })
  useEffect(() => {
    if (!open || !ref.current) return
    return pushLayer(() => ref.current?.())
  }, [open])
}

/** A page's ‹ back: the left-edge swipe does the same thing. */
export function useEdgeBack(back: (() => void) | null | undefined): void {
  const ref = useRef(back)
  useEffect(() => { ref.current = back })
  const on = back != null
  useEffect(() => {
    if (!on) return
    return pushBack(() => ref.current?.())
  }, [on])
}

/**
 * An opened row closes on a tap anywhere outside it (page 61 rule 1), and with
 * Escape, the edge swipe or a re-tap on the tab. Taps inside a board, the tabs
 * or a pop-up don't count; tapping another row opens that one instead.
 *
 * `on: 'click'` (the day lists, page 71): close on the tap itself, not on the
 * finger going down. Closing on pointerdown collapsed the open row while the
 * finger was still on the glass, so the rows below slid up and the click
 * landed on whatever moved under it; on the click, the tap has already landed
 * on what was under the finger. A scroll (no click) leaves the row open.
 */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void, opts: { on?: 'pointerdown' | 'click' } = {}) {
  const on = opts.on ?? 'pointerdown'
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })
  useDismissLayer(open, () => closeRef.current())
  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (!t || ref.current?.contains(t)) return
      if (t.closest('[role="dialog"], .wm-scrim, .pl-veil, .wm-tabs, .wm-pop-host, .wm-live')) return
      closeRef.current()
    }
    document.addEventListener(on, onDown, true)
    return () => document.removeEventListener(on, onDown, true)
  }, [open, ref, on])
}

// ─── the gestures, wired once ─────────────────────────────────

/** A touch starting this close to the left edge... */
export const EDGE_PX = 22
/** ...and travelling this far right (mostly sideways) is the iOS back swipe. */
export const EDGE_TRAVEL_PX = 60

/** Pure: is this touch the edge swipe? */
export function isEdgeSwipe(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  const dx = end.x - start.x
  const dy = Math.abs(end.y - start.y)
  return start.x <= EDGE_PX && dx >= EDGE_TRAVEL_PX && dx > dy * 1.5
}

let wired = false
/** Escape and the left-edge swipe, for the whole app. Call once at start. */
export function wireDismissGestures(): void {
  if (wired || typeof window === 'undefined') return
  wired = true
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (closeTop()) e.preventDefault()
  })
  let start: { x: number; y: number } | null = null
  window.addEventListener('touchstart', e => {
    const t = e.touches[0]
    start = t && t.clientX <= EDGE_PX ? { x: t.clientX, y: t.clientY } : null
  }, { passive: true })
  window.addEventListener('touchend', e => {
    const s = start
    start = null
    const t = e.changedTouches[0]
    if (!s || !t) return
    if (isEdgeSwipe(s, { x: t.clientX, y: t.clientY })) goBackOrClose()
  }, { passive: true })
}

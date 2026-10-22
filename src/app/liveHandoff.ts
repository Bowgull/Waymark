// Page 71 item 6 (approved 2026-10-21): the running session moves between
// Today's list and the live strip. Stepping out (‹ TODAY), its row lifts out of
// the day list and slides down into the strip, normal colour to the live gold,
// while the list closes the gap; finished, the strip slides back up into the
// list and the row lands with its teal ✓. About half a second, on the page 59
// motion (its easings and timings). Reduce Motion: nothing moves, the end state.
//
// The session screen marks the handoff; Today plays it once its rows are drawn.
// While a lift is pending the strip keeps its place but is not shown yet (so
// neither it nor the tab bar jumps); a handoff nobody plays runs out.

import { useSyncExternalStore } from 'react'

import { prefersReducedMotion } from '@/design'
import { play } from '@/design/motionKit'
import { MOTION } from '@/design/tokens'

export type HandoffKind = 'lift' | 'land'

/** A handoff nobody plays (Today never drew the row) runs out after this. */
const HANDOFF_TTL_MS = 4000
/** The flight. */
export const HANDOFF_MS = 500

let pending: { kind: HandoffKind; id: string; at: number } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

function live(kind: HandoffKind, id: string): boolean {
  return pending != null && pending.kind === kind && pending.id === id && Date.now() - pending.at < HANDOFF_TTL_MS
}

/** The session screen: the row should move (not under Reduce Motion: then it is just the end state). */
export function markHandoff(kind: HandoffKind, id: string): void {
  if (prefersReducedMotion()) return
  pending = { kind, id, at: Date.now() }
  emit()
  window.setTimeout(() => { if (pending && Date.now() - pending.at >= HANDOFF_TTL_MS) { pending = null; emit() } }, HANDOFF_TTL_MS + 50)
}

export function hasHandoff(kind: HandoffKind, id: string): boolean {
  return live(kind, id)
}

/** Played (or given up): the strip shows. */
export function endHandoff(kind: HandoffKind, id: string): void {
  if (pending && pending.kind === kind && pending.id === id) { pending = null; emit() }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** The strip: hold back while a lift into it is pending. */
export function useLiftPending(id: string | null): boolean {
  return useSyncExternalStore(subscribe, () => (id != null && live('lift', id)), () => false)
}

// ─── the flight ───────────────────────────────────────────────

interface Box { left: number; top: number; width: number; height: number }

let stripSeen: Box | null = null
/** The strip notes where it sits, so a landing starts from there once it has gone. */
export function noteStripBox(el: HTMLElement | null): void {
  if (!el) return
  const r = el.getBoundingClientRect()
  if (r.height > 0) stripSeen = { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Where the strip is (or was): above the tab bar. */
function stripBox(): Box | null {
  const strip = document.querySelector<HTMLElement>('.wm-live')
  if (strip) {
    const r = strip.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  if (stripSeen) return stripSeen
  const tabs = document.querySelector<HTMLElement>('.wm-tabs')
  if (!tabs) return null
  const t = tabs.getBoundingClientRect()
  return { left: t.left + 10, top: t.top - 8 - 56, width: t.width - 20, height: 56 }
}

const PLAIN = { background: 'rgba(14, 22, 18, 0)', boxShadow: 'inset 0 0 0 1px rgba(232, 200, 96, 0), 0 0 0 rgba(184, 152, 74, 0)', borderRadius: '6px' }
const GOLD = { background: 'rgba(30, 24, 8, 0.9)', boxShadow: 'inset 0 0 0 1px rgba(232, 200, 96, 0.5), 0 0 16px rgba(184, 152, 74, 0.16)', borderRadius: '12px' }

/** A copy of the row, fixed over everything below the tabs, to fly. */
function ghostOf(row: HTMLElement, from: Box): HTMLElement {
  const g = row.cloneNode(true) as HTMLElement
  g.classList.add('td-ghost')
  g.setAttribute('aria-hidden', 'true')
  g.removeAttribute('data-sid')
  Object.assign(g.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, margin: '0', zIndex: '31', pointerEvents: 'none', overflow: 'hidden', boxSizing: 'border-box', paddingLeft: '8px', paddingRight: '8px' })
  document.body.appendChild(g)
  return g
}

const boxFrame = (b: Box) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` })

/**
 * Lift: the row (already drawn in the list) flies down into the strip and turns
 * gold; its place in the list closes (Expand's close: 240 ms --ease-inout). The
 * strip shows as the copy lands on it. `done` runs at the end (or at once when
 * there is nothing to fly).
 */
export function flyRowToStrip(row: HTMLElement, done: () => void): () => void {
  const to = stripBox()
  const r = row.getBoundingClientRect()
  if (!to || r.height === 0) { done(); return () => {} }
  const from = { left: r.left, top: r.top, width: r.width, height: r.height }
  const ghost = ghostOf(row, from)
  row.style.visibility = 'hidden'
  row.style.overflow = 'hidden'
  const gap = play(row, [{ height: `${r.height}px`, paddingTop: getComputedStyle(row).paddingTop, paddingBottom: getComputedStyle(row).paddingBottom }, { height: '0px', paddingTop: '0px', paddingBottom: '0px' }], { duration: 240, delay: 120, easing: MOTION.easeInOut, fill: 'forwards' })
  const fly = play(ghost, [{ ...boxFrame(from), ...PLAIN }, { ...boxFrame(to), ...GOLD }], { duration: HANDOFF_MS, easing: MOTION.easeInOut, fill: 'forwards' })
  let over = false
  const finish = () => {
    if (over) return
    over = true
    // the copy hands over to the strip underneath it
    const fade = play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.tapMs * 2, fill: 'forwards' })
    if (fade) fade.finished.then(() => ghost.remove(), () => ghost.remove())
    else ghost.remove()
    done()
  }
  if (fly) fly.finished.then(finish, finish)
  else finish()
  // stopped early (Today left): the end state at once; after the landing the copy fades out by itself
  return () => { if (over) return; over = true; fly?.cancel(); gap?.cancel(); ghost.remove(); done() }
}

/**
 * Land: the strip's copy (gold) flies up from where the strip was into the
 * row's place, which opens for it (Expand's open: 320 ms --ease-out), and turns
 * back to the row's own look; the row shows with its teal ✓ as it lands.
 */
export function flyStripToRow(row: HTMLElement, done: () => void): () => void {
  const from = stripBox()
  const r = row.getBoundingClientRect()
  if (!from || r.height === 0) { done(); return () => {} }
  const to = { left: r.left, top: r.top, width: r.width, height: r.height }
  const ghost = ghostOf(row, from)
  row.style.visibility = 'hidden'
  row.style.overflow = 'hidden'
  const cs = getComputedStyle(row)
  const gap = play(row, [{ height: '0px', paddingTop: '0px', paddingBottom: '0px' }, { height: `${r.height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom }], { duration: MOTION.moveMs, easing: MOTION.easeOut })
  const fly = play(ghost, [{ ...boxFrame(from), ...GOLD }, { ...boxFrame(to), ...PLAIN }], { duration: HANDOFF_MS, easing: MOTION.easeInOut, fill: 'forwards' })
  let over = false
  const finish = () => {
    if (over) return
    over = true
    row.style.visibility = ''
    row.style.overflow = ''
    ghost.remove()
    done()
  }
  if (fly) fly.finished.then(finish, finish)
  else finish()
  return () => { fly?.cancel(); gap?.cancel(); finish() }
}

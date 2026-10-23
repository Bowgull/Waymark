// Page 71 item 6 (approved 2026-10-21, made bigger 2026-10-22): the running
// session moves between Today's list and the live strip. Stepping out
// (‹ TODAY), Today opens with its row still in place (scrolled into sight if
// its place was below the fold); the row lifts (rises, scales up, a shadow and
// a gold edge, 180 ms), then travels down into the strip's spot turning gold
// while the list closes the gap (560 ms), and hands over to the strip (a 140 ms
// crossfade). Finished, the reverse: the strip's copy lifts, travels up into
// the list and settles as the done row with its teal ✓. About 0.8 s, on page
// 59's easings. Reduce Motion: nothing moves, the end state. The copy never
// takes a tap.
//
// The session screen marks the handoff; Today plays it once its rows are drawn.
// While a lift is pending the strip keeps its place but is not shown yet (so
// neither it nor the tab bar jumps). Once Today has the row the strip waits for
// the landing however long Today took; a handoff nobody plays runs out.

import { useSyncExternalStore } from 'react'

import { prefersReducedMotion } from '@/design'
import { cascadeRiseAt } from '@/design/cascade'
import { landFlip } from '@/design/flapEngine'
import { play } from '@/design/motionKit'
import { MOTION } from '@/design/tokens'

export type HandoffKind = 'lift' | 'land'

/** A handoff nobody plays (Today never drew the row) runs out after this. */
const HANDOFF_TTL_MS = 4000
/** The lift: rises, scales up, gains a shadow and a gold edge. */
export const LIFT_MS = 180
/** The travel, down into the strip or up into the list (page 59's --ease-inout). */
export const TRAVEL_MS = 560
/** The copy hands over to the strip: a crossfade, no pop. */
export const HANDOVER_MS = 140

let pending: { kind: HandoffKind; id: string; at: number; held?: boolean } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

function live(kind: HandoffKind, id: string): boolean {
  // once Today has the row and the flight is set, it holds until it lands (time is no longer the judge)
  return pending != null && pending.kind === kind && pending.id === id && (pending.held === true || Date.now() - pending.at < HANDOFF_TTL_MS)
}

/** The session screen: the row should move (not under Reduce Motion: then it is just the end state). */
export function markHandoff(kind: HandoffKind, id: string): void {
  if (prefersReducedMotion()) return
  pending = { kind, id, at: Date.now() }
  emit()
  window.setTimeout(() => { if (pending && !pending.held && Date.now() - pending.at >= HANDOFF_TTL_MS) { pending = null; emit() } }, HANDOFF_TTL_MS + 50)
}

export function hasHandoff(kind: HandoffKind, id: string): boolean {
  return live(kind, id)
}

/** Today has drawn the row and set the flight: hold the strip back until it lands. */
export function holdHandoff(kind: HandoffKind, id: string): void {
  if (pending && pending.kind === kind && pending.id === id) pending.held = true
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
    if (r.height > 0) return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  if (stripSeen) return stripSeen
  const tabs = document.querySelector<HTMLElement>('.wm-tabs')
  if (!tabs) return null
  const t = tabs.getBoundingClientRect()
  return { left: t.left + 10, top: t.top - 8 - 56, width: t.width - 20, height: 56 }
}

/** The part of the screen the list shows: inside the scroller, under the header, above the strip's spot and the tabs. */
function viewBand(): { top: number; bottom: number } {
  const view = document.querySelector<HTMLElement>('main')?.getBoundingClientRect()
  const strip = stripBox()
  const tabs = document.querySelector<HTMLElement>('.wm-tabs')?.getBoundingClientRect()
  return {
    top: (view?.top ?? 0) + 70,
    bottom: Math.min(view?.bottom ?? window.innerHeight, strip ? strip.top : Infinity, tabs ? tabs.top : Infinity) - 16,
  }
}

/**
 * Today opens with the row in sight, so the eye finds it: a row low in the list
 * (or below the fold, under the strip or the tabs) is scrolled up into the upper
 * part of the view as Today arrives, before anything lifts.
 */
export function bringIntoSight(row: HTMLElement, aimHigh = true): DOMRect {
  const r = row.getBoundingClientRect()
  const main = document.querySelector<HTMLElement>('main')
  if (!main || r.height === 0) return r
  const band = viewBand()
  // it sits in the upper part of what the list shows, so the trip to the strip reads (as far as the list scrolls)
  const aim = band.top + (band.bottom - band.top) * 0.42 - r.height / 2
  // (at the lift itself only a row still out of sight moves: no second scroll just before it lifts)
  if (aimHigh ? r.top > aim : r.bottom > band.bottom) main.scrollTop += aimHigh ? r.top - aim : r.bottom - band.bottom
  else if (r.top < band.top) main.scrollTop -= band.top - r.top
  return row.getBoundingClientRect()
}

/**
 * Waits for the row to stand where it will stay: the screen's own arrival (the
 * boards' rise, heights still gliding in its board) has finished. Then `go`.
 */
export function whenSettled(el: HTMLElement, go: () => void): () => void {
  let off = false
  // the boards' rise is set for cascadeRiseAt (TabStack's arrival); look once it has begun
  const wait = Math.max(120, cascadeRiseAt() + 40 - performance.now())
  const t = window.setTimeout(() => {
    const board = el.closest('.wm-board')
    const moving = typeof document.getAnimations === 'function'
      ? document.getAnimations().filter(a => {
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null | undefined
          // a loop (the pixel cursor's bob) never finishes: it is not part of the arrival
          if (a.effect?.getTiming().iterations === Infinity) return false
          return !!target && (target.contains(el) || (board?.contains(target) ?? false))
        })
      : []
    void Promise.all(moving.map(a => a.finished.catch(() => undefined))).then(() => {
      if (!off) requestAnimationFrame(() => { if (!off) go() })
    })
  }, wait)
  return () => { off = true; window.clearTimeout(t) }
}

const PLAIN = { background: 'rgba(14, 22, 18, 0)', boxShadow: 'inset 0 0 0 1px rgba(232, 200, 96, 0), 0 0 0 rgba(0, 0, 0, 0)', borderRadius: '6px' }
const LIFTED = { background: 'rgba(22, 24, 14, 0.94)', boxShadow: 'inset 0 0 0 1px rgba(232, 200, 96, 0.65), 0 12px 26px rgba(0, 0, 0, 0.6)', borderRadius: '10px' }
const GOLD = { background: 'rgba(30, 24, 8, 0.94)', boxShadow: 'inset 0 0 0 1px rgba(232, 200, 96, 0.5), 0 0 16px rgba(184, 152, 74, 0.16)', borderRadius: '12px' }
const UP = 'translateY(-4px) scale(1.03)'

/** A copy of the row (its flaps landed), fixed over the screen below the tabs, to fly. */
function ghostOf(row: HTMLElement, from: Box): HTMLElement {
  row.querySelectorAll<HTMLElement>('.wm-flap').forEach(f => landFlip(f))
  const g = row.cloneNode(true) as HTMLElement
  g.classList.add('td-ghost')
  g.setAttribute('aria-hidden', 'true')
  g.removeAttribute('data-sid')
  g.querySelectorAll('[role], [tabindex]').forEach(n => { n.removeAttribute('role'); n.removeAttribute('tabindex') })
  g.querySelectorAll('.wm-expand').forEach(n => n.remove())
  Object.assign(g.style, {
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    margin: '0', zIndex: '31', pointerEvents: 'none', overflow: 'hidden', boxSizing: 'border-box',
    paddingLeft: '8px', paddingRight: '8px', visibility: 'visible', transformOrigin: '50% 50%',
  })
  document.body.appendChild(g)
  return g
}

const boxFrame = (b: Box) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` })
const LIFT_AT = LIFT_MS / (LIFT_MS + TRAVEL_MS)

/** The lift then the travel, as one animation: it rises in place (--ease-out), then makes the trip (--ease-inout). */
function flight(ghost: HTMLElement, from: Box, to: Box, fromLook: Record<string, string>, toLook: Record<string, string>): Animation | null {
  return play(ghost, [
    { offset: 0, ...boxFrame(from), ...fromLook, transform: 'none', easing: MOTION.easeOut },
    { offset: LIFT_AT, ...boxFrame(from), ...LIFTED, transform: UP, easing: MOTION.easeInOut },
    { offset: 1, ...boxFrame(to), ...toLook, transform: 'none' },
  ], { duration: LIFT_MS + TRAVEL_MS, fill: 'forwards' })
}

function padsOf(el: HTMLElement): { paddingTop: string; paddingBottom: string } {
  const cs = getComputedStyle(el)
  return { paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom }
}

/** The copy fades out over what it handed over to, then goes. */
function handOver(ghost: HTMLElement): void {
  const fade = play(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: HANDOVER_MS, easing: 'linear', fill: 'forwards' })
  if (fade) {
    fade.finished.then(() => ghost.remove(), () => ghost.remove())
    // a busy compositor can start the fade late (or never): the copy still goes
    window.setTimeout(() => ghost.remove(), HANDOVER_MS + SETTLE_SLACK_MS)
  } else ghost.remove()
}

/** Past an animation's own end: its finish runs even if the browser never reports it. */
const SETTLE_SLACK_MS = 400
function finishBy(fly: Animation | null, finish: () => void): void {
  if (!fly) { finish(); return }
  fly.finished.then(finish, finish)
  window.setTimeout(finish, LIFT_MS + TRAVEL_MS + SETTLE_SLACK_MS)
}

/**
 * Lift: the row, in its place and in sight, lifts, then travels down into the
 * strip's spot turning gold while its place closes behind it; the strip fades
 * in under the copy as it lands. `done` runs at the landing (at once when there
 * is nothing to fly).
 */
export function flyRowToStrip(row: HTMLElement, done: () => void): () => void {
  const to = stripBox()
  if (!to) { row.style.visibility = 'hidden'; done(); return () => {} }
  const r = bringIntoSight(row, false)
  if (r.height === 0) { done(); return () => {} }
  const from = { left: r.left, top: r.top, width: r.width, height: r.height }
  const ghost = ghostOf(row, from)
  row.style.visibility = 'hidden'
  row.style.overflow = 'hidden'
  // the gap closes behind it as it travels (Expand's close: --ease-inout)
  const gap = play(row, [{ height: `${r.height}px`, ...padsOf(row) }, { height: '0px', paddingTop: '0px', paddingBottom: '0px' }], { duration: 320, delay: LIFT_MS + 60, easing: MOTION.easeInOut, fill: 'forwards' })
  const fly = flight(ghost, from, to, PLAIN, GOLD)
  let over = false
  const finish = () => {
    if (over) return
    over = true
    done()
    handOver(ghost)
  }
  finishBy(fly, finish)
  // stopped early (Today left): the end state at once; after the landing the copy fades out by itself
  return () => { if (over) return; over = true; fly?.cancel(); gap?.cancel(); ghost.remove(); done() }
}

/**
 * Land: the strip's copy (gold, where the strip was) lifts, travels up into the
 * row's place, which opens for it, and settles as the done row with its ✓.
 */
export function flyStripToRow(row: HTMLElement, done: () => void): () => void {
  const from = stripBox()
  if (!from) { row.style.visibility = ''; done(); return () => {} }
  row.style.visibility = 'hidden'
  const r = bringIntoSight(row, false)
  if (r.height === 0) { row.style.visibility = ''; done(); return () => {} }
  const to = { left: r.left, top: r.top, width: r.width, height: r.height }
  const ghost = ghostOf(row, from)
  row.style.overflow = 'hidden'
  // its place opens as it comes (Expand's open: --ease-out)
  const gap = play(row, [{ height: '0px', paddingTop: '0px', paddingBottom: '0px' }, { height: `${r.height}px`, ...padsOf(row) }], { duration: MOTION.moveMs, delay: LIFT_MS, easing: MOTION.easeOut, fill: 'backwards' })
  const fly = flight(ghost, from, to, GOLD, PLAIN)
  let over = false
  const finish = () => {
    if (over) return
    over = true
    row.style.visibility = ''
    row.style.overflow = ''
    handOver(ghost)
    done()
  }
  finishBy(fly, finish)
  return () => {
    if (over) return
    over = true
    fly?.cancel(); gap?.cancel(); ghost.remove()
    row.style.visibility = ''; row.style.overflow = ''
    done()
  }
}

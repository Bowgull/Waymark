// The tab switch, option A "World first" (page 59 §5.1, approved 2026-10-19).
//
//   0 ms     the tab icon lifts, a selection haptic; the new tab's data is in hand
//   0-140    the old boards sink (opacity 1 -> 0, 6 px down, --ease-in)
//   0-900    the camera glides to the new place (world.ts), the boards out of its way
//   560      the first board (the header) rises: opacity 0 -> 1, 14 px up, 320 ms --ease-out
//   +60 each the next boards, top to bottom, at most four staggered
//   +120     each board's flap labels flip in, two flips a tile (flapEngine)
//   ~1.3 s   everything has landed; the boards take taps from the moment they rise
//
// A tap during a switch lands it (the rise and the flips finish at once) and
// the camera retargets. Reduce Motion: the world dips to dark (WorldLayer) and
// the boards crossfade in 160 ms; the flaps land at once.

import { markBusy } from './busy'
import { armCascade, onCascadeLand } from './cascade'
import { RISE_BLOCK, replayOpen } from './flapEngine'

export const SWITCH = {
  sinkMs: 140,
  sinkPx: 6,
  /** The boards rise this long after the tap: the glide has the screen to itself until then. */
  riseAtMs: 560,
  /** With no world to show (WebGL off), the boards rise once the old ones have sunk. */
  riseAtNoWorldMs: 140,
  riseMs: 320,
  risePx: 14,
  boardGapMs: 60,
  /** At most this many boards are staggered; the rest rise with the last. */
  staggerMax: 3,
  /** The pane's own fade at the rise (whatever isn't a board comes with it). */
  paneFadeMs: 180,
  /** Reduce Motion: a crossfade. */
  reducedMs: 160,
  /** Boards that arrive this long after the rise (late data) still rise in. */
  lateMs: 1600,
} as const

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'

const canAnimate = (el: Element): el is HTMLElement => typeof (el as HTMLElement).animate === 'function'

/** The top-level blocks of a pane, in order: its boards, header and Waybook line, not ones nested in another. */
export function riseBlocks(pane: HTMLElement): HTMLElement[] {
  return Array.from(pane.querySelectorAll<HTMLElement>(RISE_BLOCK)).filter(el => {
    const up = el.parentElement?.closest(RISE_BLOCK)
    return !up || !pane.contains(up)
  })
}

/** When the next tab's boards rise, from the tap. */
export function riseDelayMs(worldShown: boolean): number {
  return worldShown ? SWITCH.riseAtMs : SWITCH.riseAtNoWorldMs
}

/** The old boards sink out (140 ms). Returns the animation (null without WAAPI or under Reduce Motion). */
export function sinkPane(pane: HTMLElement, reduced: boolean): Animation | null {
  if (reduced || !canAnimate(pane)) return null
  try {
    return pane.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${SWITCH.sinkPx}px)` }],
      { duration: SWITCH.sinkMs, easing: EASE_IN, fill: 'forwards' },
    )
  } catch {
    return null
  }
}

function rise(el: HTMLElement, delay: number, out: Animation[]) {
  if (!canAnimate(el)) return
  try {
    out.push(el.animate(
      [{ opacity: 0, transform: `translateY(${SWITCH.risePx}px)` }, { opacity: 1, transform: 'none' }],
      { duration: SWITCH.riseMs, delay, easing: EASE_OUT, fill: 'backwards' },
    ))
  } catch { /* shown as is */ }
}

export interface ArriveOptions {
  /** performance.now() time the boards rise. */
  riseAt: number
  reduced: boolean
  /** A kept tab coming back: its labels flip in again. */
  replay: boolean
}

/**
 * The new tab's boards arrive. The pane waits unseen until `riseAt`, then its
 * blocks rise 60 ms apart and their labels flip in; blocks that come later
 * (data still landing) rise as they come. Returns a function that lands it
 * all at once (a tap, another switch, unmount).
 */
export function arrivePane(pane: HTMLElement, { riseAt, reduced, replay }: ArriveOptions): () => void {
  const anims: Animation[] = []
  const timers: number[] = []
  let done = false
  if (reduced) {
    if (canAnimate(pane)) {
      try { anims.push(pane.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWITCH.reducedMs, easing: 'linear' })) } catch { /* shown */ }
    }
    return () => { anims.forEach(a => a.finish()) }
  }

  const t0 = performance.now()
  const wait = Math.max(0, riseAt - t0)
  armCascade(riseAt)
  if (replay) replayOpen(pane)
  markBusy(wait + SWITCH.riseMs + 900)
  const seen = new Set<HTMLElement>()
  let risen = false
  if (wait > 0) pane.classList.add('is-waiting')

  const riseNow = () => {
    if (done) return
    risen = true
    pane.classList.remove('is-waiting')
    if (canAnimate(pane)) {
      try { anims.push(pane.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWITCH.paneFadeMs, easing: EASE_OUT })) } catch { /* shown */ }
    }
    riseBlocks(pane).forEach((el, i) => { seen.add(el); rise(el, Math.min(i, SWITCH.staggerMax) * SWITCH.boardGapMs, anims) })
  }
  if (wait > 0) timers.push(window.setTimeout(riseNow, wait))
  else riseNow()

  // late boards: rise as they arrive, staggered among themselves
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => {
    if (!risen || done) return
    const fresh = riseBlocks(pane).filter(el => !seen.has(el))
    fresh.forEach((el, i) => { seen.add(el); rise(el, Math.min(i, SWITCH.staggerMax) * SWITCH.boardGapMs, anims) })
    if (fresh.length) markBusy(SWITCH.riseMs + 600)
  }) : null
  mo?.observe(pane, { childList: true, subtree: true })
  timers.push(window.setTimeout(() => mo?.disconnect(), wait + SWITCH.lateMs))

  const land = () => {
    if (done) return
    done = true
    timers.forEach(t => window.clearTimeout(t))
    mo?.disconnect()
    pane.classList.remove('is-waiting')
    anims.forEach(a => { try { a.finish() } catch { /* gone */ } })
    off()
  }
  const off = onCascadeLand(land)
  return land
}

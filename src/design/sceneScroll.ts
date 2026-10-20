// Scroll reveals (page 67, approved): each world tab opens with its place in
// the top of the screen, and the boards start under it and scroll up over it.
//
//   - the boards start 46% down (40% on Today): a spacer, the window, sits
//     between the header and the first board
//   - the scene follows at 40% of the scroll (parallax, transform only) and
//     darkens to 60% as the boards cover the window; Reduce Motion: no
//     parallax, the darkening only
//   - the header always has its top scrim; a dark backing fades in (180 ms)
//     once the boards slide under it
//   - the first board's top edge always shows above the tab bar
//   - once the boards cover the window fully, the world idles at 15 fps
//
// One scroller (the shell's main), one window at a time (the shown tab's),
// any number of scene layers (the world's scene, the Ledger's pond rings).
// Tab switches land at the window (TabStack sets the scroll to 0); a tap on
// the tab you're on scrolls back to it in 320 ms (scrollToWindow).

import { prefersReducedMotion } from './motion'
import { MOTION } from './tokens'

export const SCENE = {
  /** Where the boards start, as a share of the screen's height (page 67 item 2). */
  boardsAt: 0.46,
  /** Today's start: a little higher, so the whole day board fits without a scroll. */
  boardsAtToday: 0.4,
  /** The scene moves this much of the scroll (parallax). */
  parallax: 0.4,
  /** The veil over the scene once the window is covered. */
  veilMax: 0.6,
  /** The header's backing fades in this many px before the boards reach it. */
  solidBeforePx: 40,
  /** At least this much of the first board shows above the tab bar (its top edge, the "there's more" cue). */
  peekPx: 56,
  /** The world's frame rate once the window is covered (world-and-ui-plan's idle rate). */
  coveredFps: 15,
  /** A tap on the tab you're on scrolls back to the window (--t-move, --ease-out). */
  returnMs: MOTION.moveMs,
} as const

interface WindowReg { el: HTMLElement; at: number; pane: HTMLElement | null; gap: number }

let scroller: HTMLElement | null = null
let win: WindowReg | null = null
const layers = new Map<HTMLElement, { dim: boolean }>()
let veil: HTMLElement | null = null
let covered = false
const coverListeners = new Set<() => void>()
let returning = 0
let reducedMq: MediaQueryList | null = null
let reduced = false

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Pure: the scroll's effects for a scroll of s px over a window w px tall (0 = no window). */
export function sceneAt(s: number, w: number, reducedMotion: boolean): { shift: number; veil: number; solid: boolean; covered: boolean } {
  const y = Math.max(0, s)
  if (w <= 0) return { shift: 0, veil: 0, solid: y > 0, covered: false }
  const k = clamp01(y / w)
  return {
    shift: reducedMotion || y === 0 ? 0 : -SCENE.parallax * y,
    veil: SCENE.veilMax * k,
    solid: y > Math.max(0, w - SCENE.solidBeforePx),
    covered: k >= 1,
  }
}

/**
 * Pure: the window's height, so the first board starts at `at` of the screen
 * (shell) height, but never so low that its top edge hides behind the tab bar.
 */
export function windowHeight(o: { at: number; shellH: number; viewH: number; top: number; gap: number }): number {
  const start = Math.min(Math.round(o.at * o.shellH), o.viewH - SCENE.peekPx)
  return Math.max(0, Math.round(start - o.top - o.gap))
}

/** The window's top inside the pane (layout only: rises and sinks move it by transform, never this). */
function topInPane(el: HTMLElement, pane: HTMLElement | null): number {
  let y = 0
  let n: HTMLElement | null = el
  while (n) {
    y += n.offsetTop
    const p = n.offsetParent as HTMLElement | null
    if (!p || !pane || !pane.contains(p) || p === pane) {
      // the pane sits at the top of the scroller's content
      if (p && pane && !pane.contains(p) && pane.offsetParent === p) y -= pane.offsetTop
      break
    }
    n = p
  }
  return y
}

function headerOf(): HTMLElement | null {
  return win?.pane?.querySelector<HTMLElement>('.wm-scene-hd') ?? scroller?.querySelector<HTMLElement>('.wm-pane:not([style*="display: none"]) .wm-scene-hd') ?? null
}

/** Size the window for this screen (on register, resize, a header or tab bar change). */
export function sizeWindow(): void {
  if (!win || !scroller) return
  const parent = win.el.parentElement
  // the gap the page's column keeps after the window (the first board starts past it)
  win.gap = parent ? parseFloat(getComputedStyle(parent).rowGap) || 0 : 0
  const shellH = scroller.parentElement?.clientHeight || window.innerHeight
  const h = windowHeight({ at: win.at, shellH, viewH: scroller.clientHeight, top: topInPane(win.el, win.pane), gap: win.gap })
  if (win.el.style.height !== `${h}px`) win.el.style.height = `${h}px`
  update()
}

function setCovered(c: boolean) {
  if (c === covered) return
  covered = c
  coverListeners.forEach(l => l())
}

function update(): void {
  const s = scroller?.scrollTop ?? 0
  const w = win ? win.el.offsetHeight + win.gap : 0
  const st = sceneAt(s, w, reduced)
  const tf = st.shift ? `translate3d(0, ${st.shift.toFixed(1)}px, 0)` : ''
  for (const [el, o] of layers) {
    if (el.style.transform !== tf) el.style.transform = tf
    if (o.dim) el.style.opacity = st.veil ? (1 - st.veil).toFixed(3) : ''
  }
  if (veil) veil.style.opacity = st.veil.toFixed(3)
  headerOf()?.classList.toggle('is-solid', st.solid)
  setCovered(st.covered)
}

const onScroll = () => update()
let ro: ResizeObserver | null = null
const observe = () => {
  if (!ro) return
  ro.disconnect()
  if (scroller) ro.observe(scroller)
  const hd = headerOf()
  if (hd) ro.observe(hd)
}

/** The shell's scroller drives it all. Call once (ShellLayout); returns the unwire. */
export function wireSceneScroll(el: HTMLElement): () => void {
  scroller = el
  try {
    reducedMq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  } catch { reducedMq = null }
  reduced = prefersReducedMotion()
  const onReduced = () => { reduced = prefersReducedMotion(); update() }
  reducedMq?.addEventListener('change', onReduced)
  el.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', sizeWindow)
  ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => sizeWindow()) : null
  observe()
  sizeWindow()
  update()
  return () => {
    el.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', sizeWindow)
    reducedMq?.removeEventListener('change', onReduced)
    ro?.disconnect(); ro = null
    if (scroller === el) scroller = null
  }
}

/** The shown tab's window (SceneWindow). Returns the unregister. */
export function registerSceneWindow(el: HTMLElement, at: number): () => void {
  const reg: WindowReg = { el, at, pane: el.closest<HTMLElement>('.wm-pane'), gap: 0 }
  win = reg
  observe()
  sizeWindow()
  return () => {
    if (win !== reg) return
    win = null
    headerOf()?.classList.remove('is-solid')
    observe()
    update()
  }
}

/** Something that moves with the scene (parallax); `dim` fades it with the veil (a layer drawn over the veil). */
export function registerSceneLayer(el: HTMLElement, opts: { dim?: boolean } = {}): () => void {
  layers.set(el, { dim: !!opts.dim })
  update()
  return () => {
    layers.delete(el)
    el.style.transform = ''
    if (opts.dim) el.style.opacity = ''
  }
}

/** The veil that darkens the scene as the boards cover it. */
export function registerSceneVeil(el: HTMLElement): () => void {
  veil = el
  update()
  return () => { if (veil === el) { veil.style.opacity = ''; veil = null } }
}

/** True while the boards cover the window fully (the world idles at 15 fps). */
export function sceneCovered(): boolean {
  return covered
}

export function subscribeSceneCovered(l: () => void): () => void {
  coverListeners.add(l)
  return () => { coverListeners.delete(l) }
}

/** Pure: the --ease-out curve (cubic-bezier(0.16, 1, 0.3, 1)) at t in 0..1. */
export function easeOut(t: number): number {
  const x = clamp01(t)
  // solve the bezier's x(u) = t by Newton steps, then return y(u)
  const cx = 3 * 0.16, bx = 3 * (0.3 - 0.16) - cx, ax = 1 - cx - bx
  const cy = 3 * 1, by = 3 * (1 - 1) - cy, ay = 1 - cy - by
  let u = x
  for (let i = 0; i < 8; i++) {
    const fx = ((ax * u + bx) * u + cx) * u - x
    const d = (3 * ax * u + 2 * bx) * u + cx
    if (Math.abs(fx) < 1e-6 || d === 0) break
    u = clamp01(u - fx / d)
  }
  return ((ay * u + by) * u + cy) * u
}

/**
 * Back to the window: a tap on the tab you're on (the iOS habit). 320 ms
 * --ease-out; under Reduce Motion, at once. A finger on the screen stops it.
 */
export function scrollToWindow(): void {
  const el = scroller
  if (!el) return
  cancelAnimationFrame(returning)
  const from = el.scrollTop
  if (from <= 0) return
  if (reduced) { el.scrollTop = 0; update(); return }
  const t0 = performance.now()
  const stop = () => { cancelAnimationFrame(returning); el.removeEventListener('touchstart', stop); el.removeEventListener('wheel', stop) }
  el.addEventListener('touchstart', stop, { passive: true, once: true })
  el.addEventListener('wheel', stop, { passive: true, once: true })
  const step = (now: number) => {
    const k = easeOut((now - t0) / SCENE.returnMs)
    el.scrollTop = Math.round(from * (1 - k))
    if (k < 1) returning = requestAnimationFrame(step)
    else stop()
  }
  returning = requestAnimationFrame(step)
}

/** A tab arriving lands at its window (TabStack). */
export function landAtWindow(): void {
  cancelAnimationFrame(returning)
  if (scroller) scroller.scrollTop = 0
  sizeWindow()
  update()
}

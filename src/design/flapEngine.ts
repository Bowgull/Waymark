// The flap engine (page 59 §5.2, approved 2026-10-19): one scheduler for every
// split-flap label on screen.
//   - one requestAnimationFrame loop; every glyph due in a frame is written in
//     that frame, together, so a frame pays one style pass however many tiles
//     flip;
//   - time-based: a phone that falls behind skips frames, it never stretches a
//     flip out (the 0.9 s rule holds on any phone);
//   - no layout reads at all: the fold runs with element.animate() on the
//     tile's own leaf, and a label's place in the screen's stagger comes from
//     its board's order, not getBoundingClientRect();
//   - only the tiles that change flip.
// React renders the tiles (FlapLabel); the engine owns their glyph text nodes.

import { markBusy } from './busy'
import { cascadeRiseAt, onCascadeLand } from './cascade'
import { FLIP, openFrames, openStartMs, planFlip, type FlipStep } from './flap'

/** What the screen's boards are, for the stagger: a board, a page's header, the Waybook line. */
export const RISE_BLOCK = '.wm-board, header, .td-wline'

interface Run {
  cells: HTMLElement[]
  steps: FlipStep[]
  next: number
  done: () => void
}

const runs = new Map<HTMLElement, Run>()
const pendingOpen = new Map<HTMLElement, string>()
const landed = new WeakMap<HTMLElement, string>()
let raf = 0
let openBudget: number = FLIP.maxOpenTiles
let budgetFor = Number.NaN

const now = () => performance.now()
const FOLD: Keyframe[] = [{ opacity: 1, transform: 'rotateX(0deg)' }, { opacity: 1, transform: 'rotateX(-90deg)' }]
const FOLD_TIMING: KeyframeAnimationOptions = { duration: FLIP.foldMs, easing: 'cubic-bezier(0.4, 0, 1, 1)' }

/** The tiles of a label (its .wm-cell children). */
function cellsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children) as HTMLElement[]
}

/** Write one tile's glyph into its own text node (created on first write). */
export function writeGlyph(cell: HTMLElement, glyph: string): void {
  const v = glyph === ' ' ? '' : glyph
  const first: Node | null = cell.firstChild
  let text: CharacterData
  if (first && first.nodeType === 3) text = first as CharacterData
  else {
    text = document.createTextNode('') as unknown as CharacterData
    cell.insertBefore(text as unknown as Node, first)
  }
  if (text.data !== v) text.data = v
}

/** Every tile of a label shows `target` now. */
export function writeAll(root: HTMLElement, target: string): void {
  const chars = [...target]
  cellsOf(root).forEach((cell, i) => writeGlyph(cell, chars[i] ?? ' '))
}

function fold(cell: HTMLElement) {
  const leaf = cell.lastElementChild as HTMLElement | null
  if (!leaf || typeof leaf.animate !== 'function') return
  try { leaf.animate(FOLD, FOLD_TIMING) } catch { /* no WAAPI: the glyph still changes */ }
}

function schedule() {
  if (raf || typeof requestAnimationFrame === 'undefined') return
  raf = requestAnimationFrame(tick)
}

function landRun(root: HTMLElement, run: Run) {
  // the last glyph each tile was going to show
  const last = new Map<number, string>()
  for (let i = run.next; i < run.steps.length; i++) last.set(run.steps[i].cell, run.steps[i].glyph)
  for (const [i, g] of last) { const c = run.cells[i]; if (c) writeGlyph(c, g) }
  runs.delete(root)
  run.done()
}

function tick() {
  raf = 0
  const t = now()
  resolveOpen(t)
  for (const [root, run] of runs) {
    if (!root.isConnected) { runs.delete(root); continue }
    // the latest due frame per tile: a late frame skips ahead, never stretches
    const due = new Map<number, FlipStep>()
    while (run.next < run.steps.length && run.steps[run.next].at <= t) {
      const st = run.steps[run.next++]
      due.set(st.cell, st)
    }
    for (const st of due.values()) {
      const cell = run.cells[st.cell]
      if (!cell) continue
      writeGlyph(cell, st.glyph)
      fold(cell)
    }
    if (run.next >= run.steps.length) { runs.delete(root); run.done() }
  }
  if (runs.size > 0 || pendingOpen.size > 0) {
    markBusy(250)
    schedule()
  }
}

/**
 * Flip a label: `frames[i]` are the glyphs tile i shows on its way (none: it
 * stays). Starts at `start` (performance time). Replaces any flip already
 * running on the label. `onLand` runs when the last tile lands.
 */
export function flipLabel(root: HTMLElement, frames: ReadonlyArray<ReadonlyArray<string>>, start: number = now(), maxMs: number = FLIP.maxMs, onLand?: () => void): void {
  const old = runs.get(root)
  if (old) runs.delete(root)
  const steps = planFlip(frames, start, maxMs).sort((a, b) => a.at - b.at)
  if (steps.length === 0) { onLand?.(); return }
  runs.set(root, { cells: cellsOf(root), steps, next: 0, done: onLand ?? (() => {}) })
  markBusy(250)
  schedule()
}

/** True while a label is still flipping (or waiting to flip in). */
export function isFlipping(root: HTMLElement): boolean {
  return runs.has(root) || pendingOpen.has(root)
}

/** Stop a label's flip where it is (it is going away or about to flip again). */
export function cancelFlip(root: HTMLElement): void {
  runs.delete(root)
  pendingOpen.delete(root)
}

/** Land a label now: its last glyphs, no more flips. */
export function landFlip(root: HTMLElement): void {
  const target = pendingOpen.get(root)
  if (target != null) { pendingOpen.delete(root); writeAll(root, target) }
  const run = runs.get(root)
  if (run) landRun(root, run)
}

/** Land every label on screen (a touch during a switch lands the boards). */
export function landAllFlips(): void {
  for (const [root, target] of pendingOpen) writeAll(root, target)
  pendingOpen.clear()
  for (const [root, run] of runs) landRun(root, run)
}

/** What a label shows once landed (null: never rendered by FlapLabel). */
export function landedOf(root: HTMLElement): string | null {
  return landed.get(root) ?? null
}

/** What a label shows once landed, for replaying its flip-in when its tab comes back. */
export function setLanded(root: HTMLElement, target: string): void {
  landed.set(root, target)
}

/**
 * A screen opening: the label shows blank tiles now and flips in with its
 * board (two flips a tile, 14 ms a column), worked out on the next frame once
 * the whole screen has rendered.
 */
export function openLabel(root: HTMLElement, target: string): void {
  writeAll(root, '')
  runs.delete(root)
  pendingOpen.set(root, target)
  markBusy(250)
  schedule()
}

/** The outermost block (board, header) a label sits in, and that block's place on its screen. */
function blockIndex(root: HTMLElement, cache: Map<Element, Element[]>): number {
  let block: Element | null = root.closest(RISE_BLOCK)
  if (!block) return 0
  for (let up = block.parentElement?.closest(RISE_BLOCK) ?? null; up; up = up.parentElement?.closest(RISE_BLOCK) ?? null) block = up
  const screen = block.closest('[data-tab-pane]') ?? document.body
  let list = cache.get(screen)
  if (!list) {
    list = Array.from(screen.querySelectorAll(RISE_BLOCK)).filter(el => {
      const up = el.parentElement?.closest(RISE_BLOCK)
      return !up || !screen.contains(up)
    })
    cache.set(screen, list)
  }
  return Math.max(0, list.indexOf(block))
}

function resolveOpen(t: number) {
  if (pendingOpen.size === 0) return
  const rise = cascadeRiseAt()
  if (rise !== budgetFor) { budgetFor = rise; openBudget = FLIP.maxOpenTiles }
  const cache = new Map<Element, Element[]>()
  for (const [root, target] of pendingOpen) {
    if (!root.isConnected) continue
    const chars = [...target]
    const tiles = chars.filter(c => c !== ' ').length
    if (tiles > openBudget) { writeAll(root, target); continue }
    openBudget -= tiles
    const start = openStartMs(rise, blockIndex(root, cache), t)
    const frames = chars.map(openFrames)
    const steps = planFlip(frames, start, FLIP.openMaxMs).sort((a, b) => a.at - b.at)
    if (steps.length === 0) { writeAll(root, target); continue }
    runs.set(root, { cells: cellsOf(root), steps, next: 0, done: () => {} })
  }
  pendingOpen.clear()
}

/**
 * A kept tab coming back (page 59 §5.1): every label on it flips in again with
 * its board. Labels inside [data-no-cascade] stay as they are.
 */
export function replayOpen(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLElement>('.wm-flap').forEach(root => {
    const target = landed.get(root)
    if (target == null || root.closest('[data-no-cascade]')) return
    openLabel(root, target)
  })
}

/** Reduce Motion: the text changes with a 90 ms fade. */
export function fadeLabel(root: HTMLElement): void {
  if (typeof root.animate !== 'function') return
  try { root.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 90, easing: 'linear' }) } catch { /* lands anyway */ }
}

if (typeof window !== 'undefined') onCascadeLand(landAllFlips)

// Split-flap logic, pure (no DOM). The board rules from the mockups:
// - a label never truncates: a set length only pads, it never cuts;
// - a space between words is a clear, narrower gap, never a dark tile;
//   trailing padding stays as dark tiles so rows line up;
// - a digit only ever flips through digits, the short way (9 -> 8, one flip);
//   a letter only through letters; anything else just lands.

export type FlapCellKind = 'char' | 'gap' | 'pad'

export interface FlapCell {
  char: string
  kind: FlapCellKind
}

/** Upper-case the text and split it into cells. `len` pads with blank tiles, never cuts. */
export function flapCells(text: string, len = 0): FlapCell[] {
  const upper = text.toUpperCase()
  const chars = [...upper]
  let last = chars.length - 1
  while (last >= 0 && chars[last] === ' ') last--
  const cells: FlapCell[] = chars.map((char, i) => {
    if (char === ' ') return { char: ' ', kind: i < last ? 'gap' : 'pad' }
    return { char, kind: 'char' }
  })
  while (cells.length < len) cells.push({ char: ' ', kind: 'pad' })
  return cells
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const isDigit = (c: string) => c >= '0' && c <= '9'
const isLetter = (c: string) => c >= 'A' && c <= 'Z'

/**
 * The glyphs one cell shows on its way from `from` to `to`, ending on `to`.
 * Digits step the short way, one digit per flip. Letters step forward through
 * the alphabet (a few flips, deterministic so tests and replays agree).
 * Anything else, or an unchanged cell, lands at once.
 */
export function flipFrames(from: string, to: string, letterFlips = 5): string[] {
  if (from === to) return [to]
  if (isDigit(to)) {
    const target = Number(to)
    const cur = isDigit(from) ? Number(from) : (target + 9) % 10
    const fwd = (target - cur + 10) % 10
    const back = (cur - target + 10) % 10
    const dir = back < fwd ? -1 : 1
    const n = Math.max(1, Math.min(fwd, back))
    const frames: string[] = []
    let d = cur
    for (let i = 0; i < n; i++) {
      d = (d + dir + 10) % 10
      frames.push(String(d))
    }
    return frames
  }
  if (isLetter(to)) {
    const target = LETTERS.indexOf(to)
    const start = isLetter(from) ? LETTERS.indexOf(from) : (target - letterFlips + 26) % 26
    const dist = (target - start + 26) % 26
    const n = Math.max(1, Math.min(letterFlips, dist))
    const frames: string[] = []
    for (let i = n - 1; i >= 0; i--) frames.push(LETTERS[(target - i + 26) % 26])
    return frames
  }
  return [to]
}

/** Per-cell stagger so a whole label lands within `maxMs` (motion rule: <= 0.9 s). */
export function flapStaggerMs(cellCount: number, framesMax: number, stepMs = 55, maxMs = 900, preferredStagger = 28): number {
  if (cellCount <= 1) return 0
  const room = maxMs - framesMax * stepMs
  return Math.max(0, Math.min(preferredStagger, Math.floor(room / (cellCount - 1))))
}

/** Short pop-up titles fit on a flap; anything longer is shown as plain words under a flap heading. */
export const FLAP_TITLE_MAX = 16

export function fitsOnFlap(text: string): boolean {
  return text.trim().length > 0 && text.trim().length <= FLAP_TITLE_MAX
}

/** Font size (px) and tile gap (px) per flap size, as in design.css. */
export const FLAP_SIZES = {
  xs: { font: 14, gap: 1 },
  sm: { font: 17, gap: 1.5 },
  md: { font: 20, gap: 2 },
  lg: { font: 32, gap: 3 },
  xl: { font: 62, gap: 4 },
} as const

export type FlapSizeKey = keyof typeof FLAP_SIZES

/** Width in px a label takes at a size: full tiles 0.74em, word gaps 0.38em. */
export function flapWidth(text: string, size: FlapSizeKey, len = 0): number {
  const { font, gap } = FLAP_SIZES[size]
  const cells = flapCells(text, len)
  const widths = cells.reduce((w, c) => w + (c.kind === 'gap' ? 0.38 : 0.74) * font, 0)
  return widths + Math.max(0, cells.length - 1) * gap
}

/**
 * The largest size, from `preferred` down to xs, at which the label fits
 * `maxWidth`. Labels never truncate: if even xs doesn't fit, xs it is and
 * the row wraps around it.
 */
export function fitFlapSize(text: string, maxWidth: number, preferred: FlapSizeKey = 'md'): FlapSizeKey {
  const order: FlapSizeKey[] = ['xl', 'lg', 'md', 'sm', 'xs']
  for (const size of order.slice(order.indexOf(preferred))) {
    if (flapWidth(text, size) <= maxWidth) return size
  }
  return 'xs'
}

// ─── The flip (page 59 §5.2, approved 2026-10-19) ──────────────────
// One flip pass, only the tiles that change. A screen opening: each tile flips
// twice (blank -> a nearby glyph -> its glyph). A change: letters at most
// three flips, digits the short way. A flip every 55 ms with an 80 ms fold,
// 14 ms per column left to right (Vestaboard's "Fast" wave), so a label lands
// within 400 ms and a screen's flaps within 0.9 s of their board.

export const FLIP = {
  stepMs: 55,
  foldMs: 80,
  columnMs: 14,
  /** At most this many flips for a letter on a change. */
  changeFlips: 3,
  /** A label opening lands within this. */
  openMaxMs: 400,
  /** Any flip lands within this (the motion rule). */
  maxMs: 900,
  /** Boards rise 60 ms apart; the 4th and everything after it together. */
  boardGapMs: 60,
  boardStaggerMax: 3,
  /** A board's labels start flipping this long after the board starts rising. */
  afterRiseMs: 120,
  /** At most this many tiles flip as a screen opens; the rest land at once. */
  maxOpenTiles: 120,
} as const

/** A screen opening: blank -> the glyph before it -> the glyph. A gap stays clear; anything else lands in one. */
export function openFrames(ch: string): string[] {
  if (ch === ' ') return []
  if (isLetter(ch)) return [LETTERS[(LETTERS.indexOf(ch) + 25) % 26], ch]
  if (isDigit(ch)) return [String((Number(ch) + 9) % 10), ch]
  return [ch]
}

/** A change: letters through at most three, digits the short way, the rest land. */
export function changeFrames(from: string, to: string): string[] {
  return flipFrames(from, to, FLIP.changeFlips)
}

/** When the labels on board `boardIndex` start flipping, given when the screen's boards rise. Never in the past. */
export function openStartMs(riseAt: number, boardIndex: number, now: number): number {
  const board = riseAt + Math.min(Math.max(0, boardIndex), FLIP.boardStaggerMax) * FLIP.boardGapMs
  return Math.max(now, board + FLIP.afterRiseMs)
}

/** One glyph write: tile `cell` shows `glyph` from `at` ms. */
export interface FlipStep { cell: number; at: number; glyph: string }

/**
 * Every write a label's flip makes, from `start`: per tile its frames `stepMs`
 * apart, tiles `columnMs` apart (squeezed so the last lands within `maxMs`).
 * Tiles with no frames are left alone.
 */
export function planFlip(frames: ReadonlyArray<ReadonlyArray<string>>, start: number, maxMs: number = FLIP.maxMs): FlipStep[] {
  const longest = Math.max(1, ...frames.map(f => f.length))
  const last = frames.reduce((n, f, i) => (f.length > 0 ? i : n), 0)
  const column = flapStaggerMs(last + 1, longest, FLIP.stepMs, maxMs, FLIP.columnMs)
  const out: FlipStep[] = []
  frames.forEach((seq, i) => seq.forEach((glyph, k) => out.push({ cell: i, at: start + i * column + k * FLIP.stepMs, glyph })))
  return out
}

/**
 * The frame a tile should show at time `t` (-1: not started). Time-based, so a
 * phone that falls behind skips frames instead of stretching the flip out.
 */
export function frameAt(start: number, stepMs: number, count: number, t: number): number {
  if (count <= 0 || t < start) return -1
  return Math.min(count - 1, Math.floor((t - start) / stepMs))
}

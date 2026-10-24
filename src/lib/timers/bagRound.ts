// The bag round, pure (no DOM): mockup page 55, approved 2026-10-19.
//
// In the app (layout 1, "Round and clock on the grass"):
// - The round's combo is stacked at the top, one strike per line, joined by
//   gold ⌄ arrows. Every combo in the session shares one size, fitted to the
//   session's longest combo (its strike count and its longest word).
// - The cue shows for the first 20 s of a round and in rest; its space stays.
// - The clock reads M:SS (2:41, not 02:41).
//
// On the lock screen ("combo on two lines"): the combo on one centred line, or
// two balanced lines broken at an arrow when it is long, at one size per
// session (at most 19 pt, at least 14).

/** The cue shows for this long after the bell, then flips away (its space stays). */
export const CUE_SHOW_SEC = 20

/** Whether the combo's cue shows: before the bell, in rest, and the first 20 s of a round. */
export function cueShown(phase: 'ready' | 'fighting' | 'rest', elapsedSec: number): boolean {
  if (phase !== 'fighting') return true
  return !(elapsedSec >= CUE_SHOW_SEC)
}

/** The round clock: M:SS, minutes unpadded (2:41, 0:05, 12:00). */
export function roundClockText(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ─── flap metrics (design.css .wm-flap: a cell is 0.74em × 1.28em, a space 0.38em) ───

const CELL_EM = 0.74
const GAP_CELL_EM = 0.38
const TILE_H_EM = 1.28

/** Width of a flap label of `text` at font size `px`, with `gapPx` between cells. */
export function flapWidth(text: string, px: number, gapPx: number): number {
  const chars = [...text]
  if (chars.length === 0) return 0
  const cells = chars.reduce((w, ch) => w + (ch === ' ' ? GAP_CELL_EM : CELL_EM) * px, 0)
  return cells + (chars.length - 1) * gapPx
}

// ─── the in-app combo size (page 55 layout 1, `fitSession`) ───

/** What the combo zone shows in a round (and in the rest before it): the stacked combo and the THEN combos under it. */
export interface BagRoundView {
  /** The stacked combo's strikes (JAB, CROSS, HOOK). */
  now: string[]
  /** The round's other combos, each a list of strikes, on the small THEN line(s). */
  then: string[][]
}

/** Page 55's zone: padding 8 / 14 / 10, 10 between the stack, the cue slot and THEN. */
export const ZONE = {
  padTop: 8,
  padBottom: 10,
  padX: 14,
  gap: 10,
  /** The cue's reserved slot. */
  cue: 26,
  /** The ⌄ between two strikes. */
  arrow: 18,
  /** Page 55 keeps about 25 px clear at each side of the widest strike (X11: never edge to edge). */
  sideMargin: 25,
} as const

/** The THEN line: a 12 px label, xs (14 px) strike flaps with 1 px between cells, 13 px › arrows; 6 px across, 4 px down. */
const THEN = { label: 39, flap: 14, cellGap: 1, arrow: 7.8, colGap: 6, rowGap: 4, lineH: 14 * TILE_H_EM } as const

/** The session combo size bounds (page 55: 60 down to 16). */
export const COMBO_MAX = 60
export const COMBO_MIN = 16

/** Height of the stacked combo of `n` strikes at `px`. */
export function stackHeight(n: number, px: number): number {
  if (n <= 0) return 0
  return n * TILE_H_EM * px + (n - 1) * ZONE.arrow
}

/** Height of the THEN block in a zone `contentW` wide: each combo is a wrapping row, the first led by the label. */
export function thenHeight(then: string[][], contentW: number): number {
  const rows = then.filter(c => c.length > 0)
  if (rows.length === 0) return 0
  let h = 0
  rows.forEach((strikes, r) => {
    const items: number[] = []
    if (r === 0) items.push(THEN.label)
    strikes.forEach((s, i) => {
      if (i > 0) items.push(THEN.arrow)
      items.push(flapWidth(s, THEN.flap, THEN.cellGap))
    })
    let lines = 1
    let x = 0
    for (const w of items) {
      const next = x === 0 ? w : x + THEN.colGap + w
      if (x > 0 && next > contentW) { lines++; x = w } else x = next
    }
    h += lines * THEN.lineH + (lines - 1) * THEN.rowGap
    if (r > 0) h += THEN.rowGap
  })
  return h
}

/** Whether one view fits a zone `width` × `height` with its combo at `px`. */
export function viewFits(view: BagRoundView, px: number, width: number, height: number): boolean {
  const maxW = width - 2 * ZONE.sideMargin
  if (view.now.some(s => flapWidth(s, px, px * 0.05) > maxW)) return false
  const th = thenHeight(view.then, width - 2 * ZONE.padX)
  const parts = [stackHeight(view.now.length, px), ZONE.cue, th].filter(h => h > 0)
  const h = ZONE.padTop + ZONE.padBottom + parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * ZONE.gap
  // Page 55 lets the zone scroll by a pixel of rounding (scrollHeight <= clientHeight + 1).
  return h <= height + 1.5
}

/**
 * The session's one combo size: the largest whole px (60 down to 16) at which
 * every round's view fits the zone. Set by the longest combo, in strikes (the
 * stack's height) or in letters (its longest word's width).
 */
export function bagComboSize(views: BagRoundView[], box: { width: number; height: number }, max = COMBO_MAX, min = COMBO_MIN): number {
  if (!(box.width > 0) || !(box.height > 0)) return min
  const shown = views.filter(v => v.now.length > 0)
  for (let px = max; px > min; px--) {
    if (shown.every(v => viewFits(v, px, box.width, box.height))) return px
  }
  return min
}

// ─── the lock screen (page 55 "combo on two lines") ───

/** The lock card's combo: at most 19 pt (the 160 pt card), never below the xs minimum. */
export const LOCK_COMBO_MAX = 19
export const LOCK_COMBO_MIN = 14
/** The width a combo line may take: the card (364 pt) less a little of its padding. */
export const LOCK_LINE_W = 356
/** A strike's flap has 1.5 pt between cells; the › is 14 pt heavy mono; 4 pt between items. */
const LOCK = { cellGap: 1.5, arrow: 8.4, gap: 4 } as const

/**
 * Two balanced lines, broken at an arrow (page 55 `split2`): the break that
 * makes the longer line shortest, counting letters and 1.6 per strike.
 * A single strike stays one line.
 */
export function splitTwoLines(strikes: string[]): string[][] {
  if (strikes.length < 2) return [strikes]
  const w = (a: string[]) => a.join('').length + a.length * 1.6
  let best = { m: Infinity, i: 1 }
  for (let i = 1; i < strikes.length; i++) {
    const m = Math.max(w(strikes.slice(0, i)), w(strikes.slice(i)))
    if (m < best.m) best = { m, i }
  }
  return [strikes.slice(0, best.i), strikes.slice(best.i)]
}

/** Width of one lock-card line at `pt`; `more` adds the trailing › when a second line follows. */
export function lockLineWidth(strikes: string[], pt: number, more = false): number {
  const flaps = strikes.reduce((w, s) => w + flapWidth(s, pt, LOCK.cellGap), 0)
  const arrows = Math.max(0, strikes.length - 1) + (more ? 1 : 0)
  const items = strikes.length + arrows
  return flaps + arrows * LOCK.arrow + Math.max(0, items - 1) * LOCK.gap
}

/** The lines a combo takes on the card at `pt`: one when it fits, else two balanced ones. */
export function lockComboLines(strikes: string[], pt: number, width = LOCK_LINE_W): string[][] {
  if (lockLineWidth(strikes, pt) <= width) return [strikes]
  return splitTwoLines(strikes)
}

/** Whether a combo fits the card at `pt` (in one line, or in two). */
export function lockComboFits(strikes: string[], pt: number, width = LOCK_LINE_W): boolean {
  const lines = lockComboLines(strikes, pt, width)
  return lines.every((l, i) => lockLineWidth(l, pt, i < lines.length - 1) <= width)
}

/** The session's lock-card combo size: the largest whole pt (19 down to 14) at which every combo fits. */
export function lockComboSize(combos: string[][], width = LOCK_LINE_W): number {
  const shown = combos.filter(c => c.length > 0)
  for (let pt = LOCK_COMBO_MAX; pt > LOCK_COMBO_MIN; pt--) {
    if (shown.every(c => lockComboFits(c, pt, width))) return pt
  }
  return LOCK_COMBO_MIN
}

// ─── the swipe down (page 85; bag rounds and skip rope rounds alike) ───

/** Where a rounds session stands: the round (0-based) and its part. */
export interface RoundSpot {
  round: number
  sub: 'ready' | 'fighting' | 'rest'
}

/**
 * Where a swipe down lands. Restart keeps the part (its timer goes back to
 * full); previous goes to the part before: a rest's own round, a round's rest
 * before it (or the round before when that rest is 0:00). The first round only
 * restarts. A round still at READY has not begun, so it goes straight back.
 * `restAfter(r)`: the rest after round r, seconds.
 */
export function roundsBack(at: RoundSpot, step: 'restart' | 'previous', restAfter: (round: number) => number): RoundSpot {
  if (step === 'restart' && at.sub !== 'ready') return at
  if (at.sub === 'rest') return { round: at.round, sub: 'fighting' }
  if (at.round <= 0) return at
  const prev = at.round - 1
  return { round: prev, sub: restAfter(prev) > 0 ? 'rest' : 'fighting' }
}

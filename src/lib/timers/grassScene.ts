// The timer grass (page 19/31 `.grasshalf`): the mockups' WM.mountAscii 'timer' scene from
// shared/wm.js, ported unchanged. Pure per cell; `drawGrass` paints one frame on a 2D canvas.
// The lit part is time gone, the wind rises through the round, the heat colour burns the tips
// in the last 10 s, rest breathes teal (and glows near the end), and the grass follows the
// finger: blades part around it with a light under it, a drag leaves a fading wake, pulling up
// raises a beam, and a tap rings out.

type RGB = [number, number, number]

const RAMP = ' .,:;-~=+*#%@'
export const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s) }
export function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const clamp = (v: number) => Math.max(0, Math.min(1, v))

const C = { forest: [45, 107, 79] as RGB, forestL: [74, 186, 138] as RGB, teal: [74, 202, 170] as RGB, tealD: [30, 138, 104] as RGB, gold: [232, 200, 96] as RGB, clay: [196, 90, 60] as RGB }

export interface Cell { b: number; c: RGB; ch?: string | null }

function grass(x: number, y: number, t: number, horizon: number, wind = 1, ox = 0): Cell {
  const depth = clamp((y - horizon) / (1 - horizon))
  const w = (Math.sin(x * 9 + t * (0.8 + wind) + noise(x * 4 + t * 0.3, y * 3) * 3) + noise(x * 6 - t * 0.8 * wind, y * 5) - 0.5) * (0.35 + wind * 0.65)
  const ch = w > 0.55 ? (w > 1.1 ? '_' : '/') : w < -0.55 ? '\\' : (hash(x * 99 + ox, y * 77) > 0.6 ? '|' : '\'')
  const b = 0.3 + depth * 0.5 + noise(x * 12, y * 12) * 0.2
  return { b, c: mix(C.forest, C.forestL, clamp(depth + w * 0.15)), ch }
}

export type GrassMode = 'work' | 'rest' | 'ready'

export interface GrassParams {
  /** 0..1 of the countdown gone (the lit part). */
  progress: number
  mode: GrassMode
  /** Last 10 s of a work timer. */
  hot?: boolean
  /** The heat colour (yellow, orange, red). */
  hotCol?: RGB
  /** Holds and rest near the end: the strong glow (0..1). */
  glow?: number
  /** The finger on the grass (0..1 of the zone). */
  finger?: { x: number; y: number; on: boolean } | null
  /** The drag's wake: recent finger points with their time (s). */
  trail?: { x: number; y: number; at: number }[]
  /** How far up the finger has pulled (0..1); 1 = a full pull, skip on release. */
  pull?: number
  /** The finger's light colour. */
  fcol?: RGB
  /** An early pull let go: the beam sinking back where the finger was (0..1 of the zone; k = what is left of the pull). */
  settle?: { x: number; y: number; k: number } | null
  /** A tap ripple: where and when (s). */
  touch?: { x: number; y: number; at: number; col?: RGB } | null
  calm?: boolean
}

/** The pull's beam of light up the grass above the finger at (fx, fy), as strong as the pull k. */
function beam(cell: Cell, x: number, y: number, fx: number, fy: number, k0: number, FC: RGB) {
  if (Math.abs(x - fx) >= 0.09 || y >= fy) return
  const k = k0 * (1 - Math.abs(x - fx) / 0.09) * (0.4 + 0.6 * (1 - (fy - y)))
  cell.c = mix(cell.c, FC, Math.min(1, k)); cell.b = clamp(cell.b + k * 0.9); if (k > 0.35) cell.ch = '|'
}

/** One cell of the timer scene (wm.js SCENES.timer). `now` is the wall clock in seconds (trail, touch). */
export function timerCell(x: number, y: number, t: number, p: GrassParams, now: number): Cell {
  const prog = p.progress ?? 0, mode = p.mode ?? 'work'
  const wind = mode === 'work' ? 0.4 + prog * 1.6 : mode === 'rest' ? 0.25 : 0.35
  const speed = p.calm ? 0.15 : 1
  const cell = grass(x, y * 0.9 + 0.1, t * speed, 0, wind * (p.calm ? 0.4 : 1))
  const lit = x < prog
  if (mode === 'work') {
    cell.b = lit ? clamp(cell.b + 0.35) : cell.b * 0.45
    cell.c = lit ? mix(C.forestL, C.gold, clamp(y < 0.35 ? 0.7 : 0.25)) : C.forest
    const HC = p.hotCol ?? C.clay
    if (p.hot && lit) { cell.c = mix(cell.c, HC, y < 0.45 ? 0.95 : 0.55); cell.b = clamp(cell.b + (y < 0.45 ? 0.45 : 0.15)) }
    if (Math.abs(x - prog) < 0.012) return { b: 1, c: p.hot ? HC : C.gold, ch: y < 0.5 ? '*' : '|' }
  } else if (mode === 'rest') {
    // breathing: a slow swell of light travels across the field
    const swell = (Math.sin(x * 4 - t * 1.1) + 1) / 2
    cell.b = 0.25 + swell * 0.35 * (lit ? 1 : 0.6)
    cell.c = mix(C.tealD, C.teal, swell * (lit ? 1 : 0.5))
    if (p.glow) { cell.b = clamp(cell.b + p.glow * 0.8); cell.c = mix(cell.c, [185, 246, 228], p.glow * 0.78) }
  } else { cell.b *= 0.5 }
  const FC = p.fcol ?? C.gold
  if (p.trail) for (const q of p.trail) { const age = now - q.at; if (age > 0.7) continue; const d = Math.hypot(x - q.x, y - q.y); if (d < 0.07) { const k = (1 - d / 0.07) * (1 - age / 0.7) * 0.8; cell.c = mix(cell.c, FC, k); cell.b = clamp(cell.b + k * 0.7); if (k > 0.3) cell.ch = x < q.x ? '\\' : '/' } }
  if (p.finger && p.finger.on) {
    const f = p.finger, d = Math.hypot(x - f.x, y - f.y), pull = p.pull ?? 0
    if (d < 0.17) { const k = 1 - d / 0.17; cell.ch = d < 0.035 ? '*' : (x < f.x ? '\\' : '/'); cell.c = mix(cell.c, FC, k * 0.9); cell.b = clamp(cell.b + k * 0.9) }
    if (pull > 0) beam(cell, x, y, f.x, f.y, pull, FC)
    if (pull >= 1 && y < 0.12) { cell.c = FC; cell.b = 1 }
  }
  if (p.settle && p.settle.k > 0 && !(p.finger && p.finger.on)) beam(cell, x, y, p.settle.x, p.settle.y, p.settle.k, FC)
  if (p.touch) {
    const dt = now - p.touch.at
    if (dt >= 0 && dt < 1.4) {
      const d = Math.hypot(x - p.touch.x, y - p.touch.y), r = dt * 0.8
      const ring = Math.max(0, 1 - Math.abs(d - r) / 0.06) * (1 - dt / 1.4), core = Math.max(0, 1 - d / 0.14) * Math.max(0, 1 - dt / 0.55), k = Math.max(ring, core)
      if (k > 0.04) { cell.c = mix(cell.c, p.touch.col ?? C.gold, k); cell.b = clamp(cell.b + k * 0.85); if (k > 0.55 && !cell.ch) cell.ch = '*' }
    }
  }
  return cell
}

/** The glyph and fill for a cell (wm.js mountAscii), or null when it draws nothing. */
export function cellGlyph(cell: Cell, dim = 1): { glyph: string; fill: string } | null {
  const b = Math.pow(clamp(cell.b), 0.6) * dim
  if (b < 0.1 && !cell.ch) return null
  const glyph = cell.ch && cell.ch !== ' ' ? cell.ch : RAMP[Math.floor(b * (RAMP.length - 1))]
  if (glyph === ' ') return null
  const k = 0.35 + b * 0.65, col = cell.c
  return { glyph, fill: `rgb(${(col[0] * k) | 0},${(col[1] * k) | 0},${(col[2] * k) | 0})` }
}

/** Grid for a zone: the mockups' `fit` (font 14: cells 8.4 × 16.1 px). */
export function grassGrid(width: number, height: number, font = 14): { cols: number; rows: number; cw: number; ch: number } {
  const cw = font * 0.6, ch = font * 1.15
  return { cols: Math.max(1, Math.floor(width / cw)), rows: Math.max(1, Math.floor(height / ch)), cw, ch }
}

/** Paint one frame. `t` drives the wind (s), `now` the finger effects (s). */
export function drawGrass(g: CanvasRenderingContext2D, grid: { cols: number; rows: number; cw: number; ch: number }, t: number, p: GrassParams, now: number): void {
  g.clearRect(0, 0, grid.cols * grid.cw, grid.rows * grid.ch)
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const out = cellGlyph(timerCell(c / grid.cols, r / grid.rows, t, p, now))
    if (!out) continue
    g.fillStyle = out.fill
    g.fillText(out.glyph, c * grid.cw, r * grid.ch)
  }
}

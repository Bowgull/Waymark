// The heart container's pixels and palette (page 74, shared/heart-family.js option I),
// shared by the canvas component; WaymarkActivityWidget.swift draws the same grid.

export type HeartState = 'under' | 'gold' | 'over' | 'idle' | 'search'

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
export const css = (c: RGB, a = 1) => `rgba(${c.map(v => Math.round(v)).join(',')},${a})`
export const lerp = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
export const easeOut = (k: number) => 1 - Math.pow(1 - k, 3)

export type HeartPal = { lit: RGB; mid: RGB; rim: RGB; pip: RGB; out: RGB; glow: RGB }
const P = (lit: string, mid: string, rim: string, pip: string, out: string, glow: string): HeartPal => ({ lit: hex(lit), mid: hex(mid), rim: hex(rim), pip: hex(pip), out: hex(out), glow: hex(glow) })
/** heart-family.js PAL (lit, mid, rim, pip, outline, glow). */
export const HEART_PAL: Record<Exclude<HeartState, 'search'>, HeartPal> = {
  under: P('#5ac8aa', '#2a8a6c', '#9ee0c6', '#e8f8f4', '#04140f', '#4acaaa'),
  gold: P('#eac860', '#c8a030', '#f6e2a0', '#fff6dc', '#1c1304', '#e8c860'),
  over: P('#ec8a5e', '#b0583a', '#ffc7aa', '#fff0e6', '#1e0904', '#ec8a5e'),
  idle: P('#6b7d77', '#495a54', '#87918c', '#a9b4b0', '#0a100e', '#000000'),
}

/** The heart container's pixels (heart-family.js GI): O outline, R rim, W pip, B body, D shade. */
export const HEART_GRID = ['..OOO...OOO..', '.ORRRO.ORRRO.', 'ORWWBBOBBBBRO', 'ORWBBBBBBBBDO', 'ORBBBBBBBBBDO', '.OBBBBBBBBDO.', '..OBBBBBBDO..', '...OBBBBDO...', '....OBBDO....', '.....ODO.....', '......O......']

/** The calm beat (heart-family.js calm): 0..1 at `nowMs` for `bpm`. */
export function calmBeat(nowMs: number, bpm: number): number {
  const per = 60 / bpm, ph = ((nowMs / 1000) % per) / per, amp = Math.min(1, Math.pow(90 / bpm, 2))
  return ph < 0.55 ? amp * Math.pow(Math.sin((Math.PI * ph) / 0.55), 2) : 0
}

export function drawHeartPixels(g: CanvasRenderingContext2D, W: number, p: HeartPal, lift: number) {
  const w = HEART_GRID[0].length, h = HEART_GRID.length
  const sc = Math.max(1, Math.floor(W / (w + 1))), ox = Math.round((W - w * sc) / 2), oy = Math.round((W - h * sc) / 2)
  const C: Record<string, RGB> = { O: p.out, R: lerp(p.rim, p.pip, lift * 0.5), W: p.pip, B: lerp(p.lit, p.rim, lift * 0.5), D: lerp(p.mid, p.lit, lift * 0.4) }
  g.imageSmoothingEnabled = false
  HEART_GRID.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return
    g.fillStyle = css(C[c])
    g.fillRect(ox + x * sc, oy + y * sc, sc, sc)
  }))
}


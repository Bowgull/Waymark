import { useEffect, useRef } from 'react'

import { useReducedMotion } from '@/design'

// The heart container (page 74, Josh's pick, option I in shared/heart-family.js):
// an original pixel heart in the N64 Zelda spirit, crisp pixels, a dark outline,
// a lighter rim, a bright pip. One drawing everywhere: the run screen (84),
// Settings (18); the lock screen and the island draw the same grid in Swift.
//
// The beat is calm: on each beat it brightens and a soft glow rises and falls
// (a gentle sine over 55% of the beat, still between), gentler as the rate
// climbs; the pixels never swell. Teal in the zone, gold at the top, ember over,
// dim when there's no strap; each change eases over about 1 s. Search shimmers.
// Reduce Motion: a steady heart, colour changes instant.

export type HeartState = 'under' | 'gold' | 'over' | 'idle' | 'search'

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const css = (c: RGB, a = 1) => `rgba(${c.map(v => Math.round(v)).join(',')},${a})`
const lerp = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3)

type Pal = { lit: RGB; mid: RGB; rim: RGB; pip: RGB; out: RGB; glow: RGB }
const P = (lit: string, mid: string, rim: string, pip: string, out: string, glow: string): Pal => ({ lit: hex(lit), mid: hex(mid), rim: hex(rim), pip: hex(pip), out: hex(out), glow: hex(glow) })
/** heart-family.js PAL (lit, mid, rim, pip, outline, glow). */
export const HEART_PAL: Record<Exclude<HeartState, 'search'>, Pal> = {
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

function drawPix(g: CanvasRenderingContext2D, W: number, p: Pal, lift: number) {
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

interface Props {
  size: number
  bpm?: number | null
  state: HeartState
  className?: string
  label?: string
}

/** The heart container on a canvas: display only, never a button. */
export function HeartContainer({ size, bpm, state, className = '', label }: Props) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ bpm: bpm ?? 70, state, reduced })
  live.current = { bpm: bpm && bpm > 0 ? bpm : 70, state, reduced }
  const pal = useRef<{ from: Exclude<HeartState, 'search'>; to: Exclude<HeartState, 'search'>; t0: number } | null>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.max(2, Math.round(window.devicePixelRatio || 1))
    const pad = Math.ceil(size * 0.14)
    const W = (size + pad * 2) * dpr, S = size * dpr, o = pad * dpr
    cv.width = cv.height = W
    const off = document.createElement('canvas')
    off.width = off.height = S
    const q = off.getContext('2d'), g = cv.getContext('2d')
    if (!q || !g) return
    let raf = 0
    const frame = (now: number) => {
      const { bpm: b, state: st0, reduced: red } = live.current
      const st = st0 === 'search' ? (red || Math.floor(now / 520) % 2 ? 'under' : 'idle') : st0
      let pp = pal.current
      if (!pp) pp = pal.current = { from: st, to: st, t0: -1e9 }
      if (pp.to !== st) { pp.from = pp.to; pp.to = st; pp.t0 = now }
      const k = red ? 1 : easeOut(Math.min(1, (now - pp.t0) / 1000))
      const A = HEART_PAL[pp.from], B = HEART_PAL[pp.to]
      const p: Pal = { lit: lerp(A.lit, B.lit, k), mid: lerp(A.mid, B.mid, k), rim: lerp(A.rim, B.rim, k), pip: lerp(A.pip, B.pip, k), out: lerp(A.out, B.out, k), glow: lerp(A.glow, B.glow, k) }
      const beating = st0 !== 'idle' && st0 !== 'search' && !red
      const e = beating ? calmBeat(now, b) : 0
      q.clearRect(0, 0, S, S)
      drawPix(q, S, p, e)
      g.clearRect(0, 0, W, W)
      g.save()
      if (e > 0.01) { g.shadowColor = css(p.glow, (size <= 24 ? 0.25 : 0.55) * e); g.shadowBlur = W * (0.04 + 0.06 * e) }
      g.imageSmoothingEnabled = false
      g.drawImage(off, o, o, S, S)
      g.restore()
      // Keep drawing while it beats, shimmers or eases; a steady heart stops the loop.
      if (beating || st0 === 'search' || k < 1) raf = requestAnimationFrame(frame)
      else raf = 0
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size, state, reduced])

  const pad = Math.ceil(size * 0.14)
  return (
    <canvas
      ref={ref}
      className={`wm-heart ${className}`}
      data-state={state}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size + pad * 2, height: size + pad * 2, margin: -pad, display: 'block', flex: 'none' }}
    />
  )
}

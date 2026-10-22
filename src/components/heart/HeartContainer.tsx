import { useEffect, useLayoutEffect, useRef } from 'react'

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

export type { HeartState } from './heartPixels'
import type { HeartState } from './heartPixels'

import { calmBeat, css, drawHeartPixels, easeOut, HEART_PAL, lerp, type HeartPal } from './heartPixels'

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
  useLayoutEffect(() => { live.current = { bpm: bpm && bpm > 0 ? bpm : 70, state, reduced } })
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
      const p: HeartPal = { lit: lerp(A.lit, B.lit, k), mid: lerp(A.mid, B.mid, k), rim: lerp(A.rim, B.rim, k), pip: lerp(A.pip, B.pip, k), out: lerp(A.out, B.out, k), glow: lerp(A.glow, B.glow, k) }
      const beating = st0 !== 'idle' && st0 !== 'search' && !red
      const e = beating ? calmBeat(now, b) : 0
      q.clearRect(0, 0, S, S)
      drawHeartPixels(q, S, p, e)
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
    // The first frame now (a heart is never blank, even before the page paints again).
    frame(performance.now())
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

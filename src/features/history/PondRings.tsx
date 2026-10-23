import { useEffect, useRef, useState } from 'react'

import { registerSceneLayer, useReducedMotion } from '@/design'
import { RING_COLOUR, type LedgerRing } from '@/lib/ledger'

// The same three rings over the pond (page 32, "The Ledger · together"), floating (page 79, approved
// 2026-10-23: like a relic hovering over water, never snappy, never a loop you can see). Each ring
// hovers on its own sum of slow sine waves scaled to its size (up and down 2.4% of its width, a hair
// sideways, the faintest tilt and breath), a shared slow swell reaches each a little later (they ride
// the same water), and a faint mirrored reflection on the water drops as the ring rises. Now and then
// (1.5-4 s, never on a beat) a glyph lifts off a rising ring in its colour and fades: an even mix of
// ASCII marks, code characters and Elder Futhark runes. Each ring is its own small composited layer
// (transform and opacity only), one rAF loop drives everything, and it pauses while the page is
// hidden or off screen. Reduce Motion: the rings stay still.

/**
 * Page 32 draws the rings in the phone's 390×844 space; the pond view scales with the height.
 * Page 67 frames the pond 450 px higher (its water in the window), so the rings rest 450 px up too.
 */
const POND_LIFT_PX = 450
function geometry(w: number, h: number) {
  const k = h / 844
  return { k, cx: w / 2 + 5 * k, cy: h / 2 + (268 - POND_LIFT_PX) * k }
}

const PAD = 8
/** How far below its ring the reflection sits (px). */
const REFL = 10
const TAU = Math.PI * 2
const ASCII = ['+', '*', '·', '~', "'", '`', ':', ';', '/', '\\', '|']
const CODE = ['<', '>', '{', '}', '[', ']', '0', '1', '=', ';', '#', '$']
/** Dagaz, Algiz, Sowilo, Fehu, Raido, Tiwaz, drawn as crisp strokes like the app's Dagaz rune. */
const RUNES = ['M2.5 2v16M13.5 2v16M2.5 2l11 16M13.5 2l-11 16', 'M8 2v16M8 9L2.5 2M8 9l5.5-7', 'M11 2L4.5 9.5l7 1.5-7 7', 'M4.5 2v16M4.5 6.5l8-4.5M4.5 11.5l8-4.5', 'M4.5 2v16M4.5 2l7 4.5-7 4.5 7 7', 'M8 2v16M8 2L2.5 7.5M8 2l5.5 5.5']
const GLYPH_LIFE = 1.4
const SVG_NS = 'http://www.w3.org/2000/svg'

type Wave = { amp: number; p: number[]; ph: number[]; w: number[] }
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
const wave = (amp: number, pa: number, pb: number, pc: number): Wave => ({ amp, p: [pa * rnd(0.9, 1.1), pb * rnd(0.9, 1.1), pc * rnd(0.9, 1.1)], ph: [rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)], w: [0.55, 0.3, 0.15] })
const val = (o: Wave, t: number) => o.amp * (o.w[0] * Math.sin(TAU * t / o.p[0] + o.ph[0]) + o.w[1] * Math.sin(TAU * t / o.p[1] + o.ph[1]) + o.w[2] * Math.sin(TAU * t / o.p[2] + o.ph[2]))

const ringSize = (i: number, k: number) => ({ rx: (70 + i * 46) * k, ry: (16 + i * 11) * k })

export function PondRings({ rings }: { rings: LedgerRing[] }) {
  const reduced = useReducedMotion()
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const layers = useRef<(SVGSVGElement | null)[]>([])
  const refls = useRef<(SVGSVGElement | null)[]>([])
  const host = useRef<HTMLDivElement | null>(null)
  const colours = useRef<string[]>([])
  const ringKeys = rings.map(r => r.key).join(',')
  useEffect(() => { colours.current = ringKeys.split(',').map(k => RING_COLOUR[k as LedgerRing['key']] ?? '#c9a656') }, [ringKeys])

  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const { k, cx, cy } = geometry(size.w, size.h)
  const n = rings.length

  // the rings ride the water: they follow the scene's parallax and darken with its veil (page 67)
  useEffect(() => {
    const el = host.current
    return el ? registerSceneLayer(el, { dim: true }) : undefined
  }, [])

  useEffect(() => {
    const pond = host.current
    if (!pond) return
    if (reduced) {
      layers.current.forEach(l => { if (l) l.style.transform = '' })
      refls.current.forEach(r => { if (r) r.style.transform = `translate3d(0,${REFL}px,0)` })
      return
    }
    const RINGS = Array.from({ length: n }, (_, i) => {
      const { rx, ry } = ringSize(i, k)
      // the float scales with the ring (the same share of its size), so all three look equally alive
      return {
        i, rx, ry, cx: 0, cy: 0, prev: 0, lag: i * 0.45,
        y: wave(rx * 0.024, 6.1 + i * 0.7, 9.7 + i * 0.9, 14.3 + i * 1.3),
        x: wave(rx * 0.011, 8.3 + i, 12.9 + i * 1.1, 17.7 + i * 0.8),
        r: wave(0.45, 7.3 + i * 0.6, 11.1 + i, 15.9 + i),
        s: wave(0.006, 9.1 + i * 0.5, 13.7 + i * 0.7, 19.3 + i),
      }
    })
    // one slow swell under all three, reaching each ring a little later: they ride the same water
    const SWELL = wave(1.8, 8.3, 13.1, 21.7)
    const parts: { el: HTMLSpanElement; ring: (typeof RINGS)[number]; th: number; born: number; rise: number; sway: number; sp: number; sph: number }[] = []
    let kindN = Math.floor(Math.random() * 3)
    let t = 0
    let last = performance.now()
    let nextEmit = rnd(1.2, 2.5)
    let raf = 0
    let running = false
    let onScreen = true

    // the glyphs: an even mix, cycled (one third each), random within a group, off a ring that is rising
    const emit = () => {
      const rising = RINGS.filter(x => x.cy < x.prev)
      const pool = rising.length ? rising : RINGS
      const r = pool[Math.floor(Math.random() * pool.length)]
      if (!r) return
      const col = colours.current[r.i] ?? '#c9a656'
      const kind = kindN++ % 3
      const el = document.createElement('span')
      el.className = 'rw-p'
      if (kind === 2) {
        const sv = document.createElementNS(SVG_NS, 'svg')
        sv.setAttribute('viewBox', '0 0 16 20')
        sv.setAttribute('aria-hidden', 'true')
        const path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', pick(RUNES))
        path.setAttribute('stroke', col)
        path.setAttribute('stroke-width', '2')
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke-linecap', 'square')
        path.setAttribute('shape-rendering', 'crispEdges')
        sv.appendChild(path)
        el.appendChild(sv)
      } else {
        const b = document.createElement('b')
        b.style.color = col
        b.textContent = pick(kind === 0 ? ASCII : CODE)
        el.appendChild(b)
      }
      el.style.opacity = '0'
      pond.appendChild(el)
      parts.push({ el, ring: r, th: Math.PI + rnd(0.15, 0.85) * Math.PI, born: t, rise: rnd(16, 26), sway: rnd(1.2, 2.6), sp: rnd(0.9, 1.4), sph: rnd(0, TAU) })
    }
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000) // a capped step: no jump after the page was hidden
      last = now
      t += dt
      for (const r of RINGS) {
        r.prev = r.cy
        r.cy = val(r.y, t) + val(SWELL, t - r.lag)
        r.cx = val(r.x, t)
        const rot = val(r.r, t)
        const sc = 1 + val(r.s, t)
        const L = layers.current[r.i]
        const R = refls.current[r.i]
        if (L) L.style.transform = `translate3d(${r.cx.toFixed(3)}px,${r.cy.toFixed(3)}px,0) rotate(${rot.toFixed(4)}deg) scale(${sc.toFixed(5)})`
        if (R) R.style.transform = `translate3d(${r.cx.toFixed(3)}px,${(REFL - r.cy).toFixed(3)}px,0) rotate(${(-rot).toFixed(4)}deg) scale(${(sc * (1 + 0.008 * Math.sin(TAU * t / 2.3 + r.lag))).toFixed(5)},${sc.toFixed(5)})`
      }
      if (t >= nextEmit) { emit(); if (Math.random() < 0.25) emit(); nextEmit = t + rnd(1.5, 4) }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        const age = t - p.born
        const kk = age / GLYPH_LIFE
        if (kk >= 1) { p.el.remove(); parts.splice(i, 1); continue }
        const x = cx + Math.cos(p.th) * p.ring.rx + p.ring.cx + p.sway * Math.sin(TAU * age / p.sp + p.sph)
        const y = cy + Math.sin(p.th) * p.ring.ry + p.ring.cy - p.rise * easeOut(kk)
        const op = age < 0.2 ? age / 0.2 : Math.pow(1 - (age - 0.2) / (GLYPH_LIFE - 0.2), 1.3)
        p.el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`
        p.el.style.opacity = (op * 0.9).toFixed(3)
      }
      if (running) raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (running || document.hidden || !onScreen) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const stop = () => { running = false; cancelAnimationFrame(raf) }
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    // off screen (another tab showing): no frames at all
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); if (onScreen) start(); else stop() })
      : null
    io?.observe(pond)
    start()
    return () => {
      stop()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      parts.forEach(p => p.el.remove())
    }
  }, [reduced, n, k, cx, cy])

  return (
    <div className="lg-pond" ref={host} aria-hidden>
      <div className="lg-glowwash" />
      {rings.map((r, i) => {
        const { rx, ry } = ringSize(i, k)
        const L = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
        const done = r.list.length ? r.list.filter(s => s === 'done').length / r.list.length : 0
        const col = RING_COLOUR[r.key]
        const x0 = cx - rx - PAD, y0 = cy - ry - PAD, w = 2 * (rx + PAD), h = 2 * (ry + PAD)
        const box = { left: x0, top: y0, transformOrigin: `${rx + PAD}px ${ry + PAD}px` }
        const body = (
          <>
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(220,240,235,.16)" strokeWidth={2 * k} />
            {done > 0 && (
              <ellipse
                className="lg-pr"
                cx={cx}
                cy={cy}
                rx={rx}
                ry={ry}
                fill="none"
                stroke={col}
                strokeWidth={3 * k}
                strokeDasharray={`${(L * done).toFixed(0)} ${L.toFixed(0)}`}
                style={{ ['--len' as string]: L.toFixed(0), filter: `drop-shadow(0 0 ${5 * k}px ${col})` }}
              />
            )}
          </>
        )
        return (
          <span key={r.key}>
            <svg ref={el => { refls.current[i] = el }} className="lg-pondlayer is-refl" viewBox={`${x0} ${y0} ${w} ${h}`} width={w} height={h} style={{ ...box, transform: `translate3d(0,${REFL}px,0)` }}>{body}</svg>
            <svg ref={el => { layers.current[i] = el }} className="lg-pondlayer" data-ring={r.key} viewBox={`${x0} ${y0} ${w} ${h}`} width={w} height={h} style={box}>{body}</svg>
          </span>
        )
      })}
    </div>
  )
}

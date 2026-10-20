import { useEffect, useRef, useState } from 'react'

import { registerSceneLayer, useReducedMotion } from '@/design'
import { RING_COLOUR, type LedgerRing } from '@/lib/ledger'

// The same three rings resting on the pond (page 32, "The Ledger · together" and its close-up):
// ellipses on the water, each lit as far round as the range has got. They drift on slow,
// never-repeating waves (about ±2.5 px, a tiny tilt; no loop, no bounce), and when a ring touches
// down, two or three runes and glyphs in its colour lift off the edge that touched and fade.
// The pond sits behind everything; the boards scroll over it.

const SPLASH = '<>YX|^*+.~:'

/**
 * Page 32 draws the rings in the phone's 390×844 space; the pond view scales with the height.
 * Page 67 frames the pond 450 px higher (its water in the window), so the rings rest 450 px up too.
 */
const POND_LIFT_PX = 450
function geometry(w: number, h: number) {
  const k = h / 844
  return { k, cx: w / 2 + 5 * k, cy: h / 2 + (268 - POND_LIFT_PX) * k }
}

export function PondRings({ rings }: { rings: LedgerRing[] }) {
  const reduced = useReducedMotion()
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const groups = useRef<(SVGGElement | null)[]>([])
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const { k, cx, cy } = geometry(size.w, size.h)

  // the rings ride the water: they follow the scene's parallax and darken with its veil (page 67)
  useEffect(() => {
    const el = host.current
    return el ? registerSceneLayer(el, { dim: true }) : undefined
  }, [])

  useEffect(() => {
    if (reduced) return
    const state = rings.map((_, i) => ({ seed: Math.random() * 100 + i * 3.1, y: 0, dy: 0, last: 0 }))
    const timers = new Set<number>()
    let raf = 0
    const spark = (i: number, a: number, yOff: number) => {
      const el = host.current
      if (!el) return
      const rx = (70 + i * 46) * k
      const ry = (16 + i * 11) * k
      const x = cx + Math.cos(a) * rx
      const y = cy + Math.sin(a) * ry + yOff
      const e = document.createElement('span')
      e.className = 'lg-spk'
      e.textContent = SPLASH[Math.floor(Math.random() * SPLASH.length)]
      e.style.color = RING_COLOUR[rings[i].key]
      e.style.left = `${(x - 3).toFixed(1)}px`
      e.style.top = `${(y - 6).toFixed(1)}px`
      e.style.setProperty('--dx', `${(Math.cos(a) * 6 + (Math.random() - 0.5) * 6).toFixed(1)}px`)
      e.style.setProperty('--dy', `${(-24 - Math.random() * 14).toFixed(1)}px`)
      e.style.setProperty('--life', `${(2.8 + Math.random() * 1.2).toFixed(2)}s`)
      e.style.setProperty('--o', (0.5 + Math.random() * 0.2).toFixed(2))
      el.appendChild(e)
      const t = window.setTimeout(() => { e.remove(); timers.delete(t) }, 4300)
      timers.add(t)
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const t = now / 1000
      state.forEach((d, i) => {
        const g = groups.current[i]
        if (!g) return
        const s0 = d.seed
        // px, smooth, never repeats exactly (three unrelated slow waves)
        const y = 1.5 * Math.sin(t * 0.41 + s0) + 0.8 * Math.sin(t * 0.67 + s0 * 1.7) + 0.4 * Math.sin(t * 1.07 + s0 * 2.3)
        const tilt = 0.18 * Math.sin(t * 0.29 + s0 * 0.7)
        const dy = y - d.y
        if (d.dy > 0 && dy <= 0 && y > 0.6 && t - d.last > 1.4) {
          d.last = t
          const n = 2 + Math.floor(Math.random() * 2)
          const a0 = 0.35 + Math.random() * 2.4
          for (let j = 0; j < n; j++) {
            const tm = window.setTimeout(() => { timers.delete(tm); spark(i, a0 + (j - 1) * 0.22, y * k) }, j * 110)
            timers.add(tm)
          }
        }
        d.dy = dy
        d.y = y
        g.style.transform = `translateY(${(y * k).toFixed(2)}px) rotate(${tilt.toFixed(3)}deg)`
      })
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); timers.forEach(t => window.clearTimeout(t)) }
  }, [reduced, rings, k, cx, cy])

  return (
    <div className="lg-pond" ref={host} aria-hidden>
      <div className="lg-glowwash" />
      <svg className="lg-pondrings" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
        {rings.map((r, i) => {
          const rx = (70 + i * 46) * k
          const ry = (16 + i * 11) * k
          const L = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
          const n = r.list.length
          const f = n ? r.list.filter(s => s === 'done').length / n : 0
          const col = RING_COLOUR[r.key]
          return (
            <g key={r.key} ref={el => { groups.current[i] = el }} className="lg-prg">
              <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(220,240,235,.16)" strokeWidth={2 * k} />
              {f > 0 && (
                <ellipse
                  className="lg-pr"
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  fill="none"
                  stroke={col}
                  strokeWidth={3 * k}
                  strokeDasharray={`${(L * f).toFixed(0)} ${L.toFixed(0)}`}
                  style={{ ['--len' as string]: L.toFixed(0), filter: `drop-shadow(0 0 ${5 * k}px ${col})` }}
                />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

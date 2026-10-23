import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { MOTION, prefersReducedMotion } from '@/design'

// The calm Ledger (page 77 A, approved 2026-10-23): under the toggle and the
// rings, one closed line per board (its real header and headline). A tap opens
// that exact board in place, one at a time; a tap on it again or anywhere
// outside closes it. Opening springs a touch past and settles (~0.4 s) with the
// board dropping 4 px 60 ms late, and the screen glides so the opened line sits
// just under the header (the list gets room below so even the last line can).
// Closing is a quick fade, then the height, no bounce. Reduce Motion: end
// states and an instant scroll. Lines start closed each visit.

export interface LedgerLineItem {
  key: string
  name: string
  /** The board's headline flap, as its own head shows it. */
  flap?: ReactNode
  board: ReactNode
}

/** Page 77's spring: the height runs about 4% past, then settles. */
export const LINE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
export const LINE_OPEN_MS = 400
const DROP_DELAY_MS = 60
const CLOSE_FADE_MS = 120
const CLOSE_HEIGHT_MS = 240

const CUR = (
  <svg className="cl-cur" width="10" height="14" viewBox="0 0 7 11" shapeRendering="crispEdges" aria-hidden>
    <path fill="#f0d27a" d="M0 0h1v11H0zM1 1h1v9H1zM2 2h1v7H2zM3 3h1v5H3zM4 4h1v3H4zM5 5h1v1H5z" />
  </svg>
)

export function LedgerLines({ items }: { items: LedgerLineItem[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [down, setDown] = useState<string | null>(null)
  const openRef = useRef<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const panels = useRef(new Map<string, HTMLDivElement>())
  const lines = useRef(new Map<string, HTMLButtonElement>())
  const snapRaf = useRef(0)
  const padTimer = useRef(0)

  const scroller = () => list.current?.closest('main') as HTMLElement | null
  const header = () => list.current?.closest('.lg-root')?.querySelector<HTMLElement>('.wm-scene-hd, .lg-hd') ?? null

  /** Every line shut, at once (each visit starts closed). */
  const reset = () => {
    cancelAnimationFrame(snapRaf.current)
    window.clearTimeout(padTimer.current)
    for (const p of panels.current.values()) {
      p.getAnimations().forEach(a => a.cancel())
      ;(p.firstElementChild as HTMLElement | null)?.getAnimations().forEach(a => a.cancel())
      p.style.height = '0px'
    }
    if (list.current) list.current.style.paddingBottom = ''
    openRef.current = null
    setOpen(null)
  }
  // Hiding the tab runs effect cleanups (the pane keeps its state): every line is shut for the next visit.
  useLayoutEffect(() => reset, [])

  /** Glide so the line sits just under the header; `shrink`: a panel above it about to close. */
  const snapTo = (line: HTMLElement, shrink: number) => {
    const m = scroller()
    if (!m) return
    const box = m.getBoundingClientRect()
    const hd = header()
    const under = hd ? Math.max(0, hd.getBoundingClientRect().bottom - box.top) : 0
    const target = Math.max(0, Math.min(m.scrollHeight, m.scrollTop + line.getBoundingClientRect().top - box.top - shrink - under - 6))
    cancelAnimationFrame(snapRaf.current)
    if (prefersReducedMotion()) { m.scrollTop = target; return }
    const from = m.scrollTop, d = target - from
    let t0 = -1
    const ease = (x: number) => 1 - Math.pow(1 - x, 3)
    const step = (n: number) => {
      if (t0 < 0) t0 = n
      const k = Math.min(1, (n - t0) / LINE_OPEN_MS)
      m.scrollTop = from + d * ease(k)
      if (k < 1) snapRaf.current = requestAnimationFrame(step)
    }
    snapRaf.current = requestAnimationFrame(step)
  }

  const animOpen = (key: string, shrink: number) => {
    const panel = panels.current.get(key)
    const line = lines.current.get(key)
    if (!panel || !line) return
    const inner = panel.firstElementChild as HTMLElement
    const h = inner.scrollHeight
    const m = scroller()
    window.clearTimeout(padTimer.current)
    if (list.current && m) {
      // just enough room below for the open board to reach the top
      const hd = header()
      const room = m.clientHeight - (hd ? hd.getBoundingClientRect().height : 0) - line.getBoundingClientRect().height - h - 24
      list.current.style.paddingBottom = `${Math.max(0, Math.round(room))}px`
    }
    panel.getAnimations().forEach(a => a.cancel())
    inner.getAnimations().forEach(a => a.cancel())
    // Reduce Motion: the panel above already closed at once (animClose), so there's nothing still to shrink
    if (prefersReducedMotion()) { panel.style.height = 'auto'; snapTo(line, 0); return }
    const a = panel.animate([{ height: '0px' }, { height: `${h}px` }], { duration: LINE_OPEN_MS, easing: LINE_SPRING })
    a.onfinish = () => { if (openRef.current === key) panel.style.height = 'auto' }
    panel.style.height = `${h}px`
    inner.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: MOTION.moveMs, delay: DROP_DELAY_MS, easing: MOTION.easeOut, fill: 'backwards' })
    snapTo(line, shrink)
  }

  const animClose = (key: string) => {
    const panel = panels.current.get(key)
    if (!panel) return
    const inner = panel.firstElementChild as HTMLElement
    const h = panel.getBoundingClientRect().height
    panel.getAnimations().forEach(a => a.cancel())
    if (prefersReducedMotion()) { panel.style.height = '0px'; inner.getAnimations().forEach(a => a.cancel()); return }
    panel.style.height = `${h}px`
    inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_FADE_MS, easing: MOTION.easeIn, fill: 'forwards' }).onfinish = () => {
      if (openRef.current === key) return
      const a = panel.animate([{ height: `${h}px` }, { height: '0px' }], { duration: CLOSE_HEIGHT_MS, easing: MOTION.easeInOut })
      panel.style.height = '0px'
      a.onfinish = () => { if (openRef.current !== key) inner.getAnimations().forEach(x => x.cancel()) }
    }
  }

  const closeOpen = () => {
    const key = openRef.current
    if (!key) return 0
    const panel = panels.current.get(key)
    const h = panel ? panel.getBoundingClientRect().height : 0
    openRef.current = null
    setOpen(null)
    animClose(key)
    window.clearTimeout(padTimer.current)
    padTimer.current = window.setTimeout(() => { if (!openRef.current && list.current) list.current.style.paddingBottom = '' }, CLOSE_FADE_MS + CLOSE_HEIGHT_MS)
    return h
  }

  const toggle = (key: string) => {
    const was = openRef.current
    const keys = items.map(i => i.key)
    const closing = was && was !== key && keys.indexOf(was) < keys.indexOf(key) ? (panels.current.get(was)?.getBoundingClientRect().height ?? 0) : 0
    closeOpen()
    if (was === key) return
    openRef.current = key
    setOpen(key)
    animOpen(key, closing)
  }

  // a tap anywhere outside the open board closes it; so does Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('.cl-panel') || t?.closest?.('.cl-line')) return
      closeOpen()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOpen() }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cl-list" ref={list}>
      {items.map(it => (
        <Fragment key={it.key}>
          <button
            type="button"
            data-line={it.key}
            ref={el => { if (el) lines.current.set(it.key, el); else lines.current.delete(it.key) }}
            className={`cl-line${open === it.key ? ' is-open' : ''}${down === it.key ? ' is-down' : ''}`}
            aria-expanded={open === it.key}
            onPointerDown={() => setDown(it.key)}
            onPointerUp={() => setDown(null)}
            onPointerLeave={() => setDown(null)}
            onPointerCancel={() => setDown(null)}
            onClick={() => toggle(it.key)}
          >
            {CUR}
            <span className="lg-head cl-head"><span>{it.name}</span>{it.flap}</span>
          </button>
          <div className="cl-panel" ref={el => { if (el) panels.current.set(it.key, el); else panels.current.delete(it.key) }} aria-hidden={open !== it.key}>
            <div className="cl-inner">{it.board}</div>
          </div>
        </Fragment>
      ))}
    </div>
  )
}

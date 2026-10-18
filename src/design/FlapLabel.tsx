import { useLayoutEffect, useRef, useState } from 'react'

import { fitFlapSize, flapCells, flapStaggerMs, flipFrames } from './flap'
import { useReducedMotion } from './motion'

export type FlapSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type FlapTone = 'ink' | 'gold' | 'teal' | 'clay' | 'dim' | 'struck'

export interface FlapLabelProps {
  text: string
  size?: FlapSize
  tone?: FlapTone
  /** Pad to this many cells (rows line up). Never cuts: longer text keeps every letter. */
  len?: number
  /**
   * 'change' (default): flips when the text changes, lands at once on first show.
   * 'mount': also flips in on first show (a screen opening).
   * false: never flips.
   */
  animate?: 'change' | 'mount' | false
  /**
   * Step down from `size` until the label fits its container's width (the
   * no-truncation rule). Measured once laid out, and again on resize.
   */
  fit?: boolean
  className?: string
}

const STEP_MS = 55

/**
 * A split-flap label: one tile per character. React renders the tiles; their
 * glyphs are written directly (React never owns the text nodes), so a flip
 * costs no re-render per frame in the iPhone web view. The words are the
 * accessible name; the tiles are hidden from screen readers.
 */
export function FlapLabel({ text, size = 'sm', tone = 'ink', len = 0, animate = 'change', fit = false, className = '' }: FlapLabelProps) {
  const reduced = useReducedMotion()
  const [fitted, setFitted] = useState<FlapSize | null>(null)
  const shownSize = fit && fitted ? fitted : size
  const cells = flapCells(text, len)
  const target = cells.map(c => c.char).join('')
  const rootRef = useRef<HTMLSpanElement>(null)
  const landedRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const from = landedRef.current
    landedRef.current = target
    const els = Array.from(root.children) as HTMLElement[]
    const targetChars = [...target]
    els.forEach((el, i) => {
      el.textContent = (targetChars[i] ?? ' ') === ' ' ? '' : targetChars[i]
      el.classList.remove('is-tick')
    })
    if (animate === false || reduced) return
    if (from == null && animate !== 'mount') return
    if (from === target) return
    const fromChars = [...(from ?? '').padEnd(targetChars.length, ' ')]
    const frames = targetChars.map((ch, i) => (ch === ' ' ? [] : flipFrames(fromChars[i] ?? ' ', ch)))
    const maxFrames = Math.max(1, ...frames.map(f => f.length))
    const stagger = flapStaggerMs(targetChars.length, maxFrames, STEP_MS)
    const timers: ReturnType<typeof setTimeout>[] = []
    let remaining = frames.reduce((n, f) => n + f.length, 0)
    frames.forEach((seq, i) => {
      const el = els[i]
      if (!el || seq.length === 0) return
      el.textContent = fromChars[i] === ' ' ? '' : fromChars[i]
      seq.forEach((glyph, k) => {
        timers.push(setTimeout(() => {
          el.classList.remove('is-tick')
          void el.offsetWidth
          el.classList.add('is-tick')
          el.textContent = glyph
          remaining--
        }, i * stagger + k * STEP_MS))
      })
    })
    // Interrupted (new text, unmount, StrictMode re-run): stop. A flip that
    // never finished counts as not landed, so a re-run flips it again.
    return () => {
      timers.forEach(clearTimeout)
      if (remaining > 0) landedRef.current = from
    }
  }, [target, animate, reduced])

  useLayoutEffect(() => {
    if (!fit) return
    const parent = rootRef.current?.parentElement
    if (!parent) return
    const measure = () => {
      const cs = getComputedStyle(parent)
      const room = parent.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
      if (room > 0) setFitted(fitFlapSize(text, room, size))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [fit, text, size])

  const classes = ['wm-flap', `is-${shownSize}`, tone !== 'ink' ? `is-${tone}` : '', className].filter(Boolean).join(' ')
  return (
    <span ref={rootRef} className={classes} role="img" aria-label={text.trim()}>
      {cells.map((cell, i) => (
        <span key={i} aria-hidden className={`wm-cell${cell.kind === 'gap' ? ' is-gap' : ''}${cell.kind === 'pad' ? ' is-pad' : ''}`} />
      ))}
    </span>
  )
}

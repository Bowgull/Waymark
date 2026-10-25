import { useLayoutEffect, useRef, useState } from 'react'

import { cascadeArmed } from './cascade'
import { changeFrames, fitFlapSize, flapCells, openFrames } from './flap'
import { cancelFlip, fadeLabel, flipLabel, isFlipping, openLabel, setLanded, writeAll } from './flapEngine'
import { useReducedMotion } from './motion'

export type FlapSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type FlapTone = 'ink' | 'gold' | 'teal' | 'clay' | 'dim' | 'struck' | 'red'

export interface FlapLabelProps {
  text: string
  size?: FlapSize
  tone?: FlapTone
  /** Pad to this many cells (rows line up). Never cuts: longer text keeps every letter. */
  len?: number
  /**
   * 'change' (default): flips when the text changes, lands at once on first show.
   * 'mount': also flips in on first show.
   * false: never flips on a change.
   * Whatever this is, a label that first shows as a screen opens cascades in
   * with the rest of the screen (page 17, design/cascade.ts) unless it sits
   * inside [data-no-cascade].
   */
  animate?: 'change' | 'mount' | false
  /**
   * Step down from `size` until the label fits its container's width (the
   * no-truncation rule). Measured once laid out, and again on resize.
   */
  fit?: boolean
  className?: string
}

/**
 * A split-flap label: one tile per character. React renders the tiles; their
 * glyphs are written directly by the flap engine (React never owns the text
 * nodes), so a flip costs no re-render, no layout read and one style pass per
 * frame in the iPhone web view. The words are the accessible name; the tiles
 * are hidden from screen readers.
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
    setLanded(root, target)
    // Interrupted (new text, unmount, StrictMode re-run): stop. A flip that
    // never finished counts as not landed, so a re-run flips it again.
    const stop = () => {
      if (isFlipping(root)) landedRef.current = from
      cancelFlip(root)
    }
    // A screen just opened (page 59 §5.1): blank tiles, then two flips each with the label's board.
    // Reduce Motion lands at once; the timer's digits and the overlays keep their own motion.
    if (from == null && !reduced && cascadeArmed() && !root.closest('[data-no-cascade]')) {
      openLabel(root, target)
      return stop
    }
    if (animate === false || from === target || (from == null && animate !== 'mount')) {
      writeAll(root, target)
      return
    }
    if (reduced) {
      writeAll(root, target)
      if (from != null) fadeLabel(root)
      return
    }
    // Only the tiles that change flip: a new tile flips in twice, a changed one the short way.
    const chars = [...target]
    const was = [...(from ?? '').padEnd(chars.length, ' ')]
    const frames = chars.map((ch, i) => (ch === ' ' || was[i] === ch ? [] : from == null ? openFrames(ch) : changeFrames(was[i] ?? ' ', ch)))
    writeAll(root, chars.map((ch, i) => (frames[i].length > 0 ? (was[i] ?? ' ') : ch)).join(''))
    flipLabel(root, frames)
    return stop
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
        <span key={i} aria-hidden className={`wm-cell${cell.kind === 'gap' ? ' is-gap' : ''}${cell.kind === 'pad' ? ' is-pad' : ''}`}>
          {cell.kind === 'char' && <i className="wm-leaf" />}
        </span>
      ))}
    </span>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { MOTION, prefersReducedMotion } from '@/design'
import { tapHaptic } from '@/lib/haptics'

import type { PlanLine } from './planLines'

/** Page 97: the turn's two halves (tip away edge-on, then the back turns up) and the beat between lines. */
const OUT_MS = 110
const IN_MS = 140
const STAGGER_MS = 40

export interface FlipLineProps {
  line: PlanLine & { back: PlanLine }
  /** Shows the back (the row's one side for every flip line). */
  back: boolean
  /** Its place among the row's flip lines: each turns a beat after the one above. */
  order: number
  onTurn: () => void
  face: (l: PlanLine) => ReactNode
}

/**
 * A line with two sides (page 97, approved C): the treadmill speed, and the
 * pace on its back. A tap turns it over top to bottom like a sign plank. Only
 * for looking: INDOOR or OUTDOOR is still picked after START. Both sides sit
 * in one cell, so the line never changes size.
 */
export function FlipLine({ line, back, order, onTurn, face }: FlipLineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(back)
  const shownRef = useRef(back)

  useEffect(() => {
    if (back === shownRef.current) return
    const el = ref.current
    const show = (v: boolean) => { shownRef.current = v; setShown(v) }
    if (!el) { show(back); return }
    let live = true
    const reduced = prefersReducedMotion()
    const turn = (from: string, to: string, ms: number, easing: string) =>
      el.animate(reduced ? [{ opacity: from === 'out' ? 1 : 0 }, { opacity: from === 'out' ? 0 : 1 }] : [{ transform: from }, { transform: to }], { duration: reduced ? 45 : ms, easing, fill: 'forwards' })
    const t = window.setTimeout(() => {
      turn(reduced ? 'out' : 'perspective(420px) rotateX(0deg)', 'perspective(420px) rotateX(90deg)', OUT_MS, MOTION.easeIn).finished
        .then(() => {
          if (!live) return
          show(back)
          return turn(reduced ? 'in' : 'perspective(420px) rotateX(-90deg)', 'perspective(420px) rotateX(0deg)', IN_MS, MOTION.easeOut).finished
        })
        .then(() => { if (live) el.getAnimations().forEach(a => a.cancel()) })
        .catch(() => {})
    }, order * STAGGER_MS)
    // a tap mid-turn: this one stops, the next turns from wherever it is
    return () => { live = false; window.clearTimeout(t); el.getAnimations().forEach(a => a.cancel()) }
  }, [back, order])

  const now = shown ? line.back : line
  return (
    <div
      ref={ref}
      className="pl-flip"
      role="button"
      tabIndex={0}
      aria-label={`${now.label} ${now.move?.load ?? now.move?.note ?? now.value}`}
      onClick={() => { void tapHaptic(); onTurn() }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void tapHaptic(); onTurn() } }}
    >
      <div className="pl-face" aria-hidden="true" data-on={!shown || undefined}>{face(line)}</div>
      <div className="pl-face" aria-hidden="true" data-on={shown || undefined}>{face(line.back)}</div>
    </div>
  )
}

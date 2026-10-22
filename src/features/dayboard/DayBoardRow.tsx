import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { AmPmFlap, FlapLabel, SessionIcon, useOutsideClose } from '@/design'
import { Rune } from '@/features/coach/Rune'

import { dayRowState, type DayBoardSession, type RowContext } from './rowState'
import { Expand } from '@/design/MotionPrimitives'
import { SessionSummary } from './SessionSummary'
import './dayboard.css'

// One row of the open day (page 33 d1 / d2 / d3 / d6, page 36 #rows):
// the big icon, the name on a flap, one detail line, ✓ when done, AM / PM.
// Tap: the summary opens in place (tap again to close). Swipe a to-do row
// left: it tucks into a square around its icon and REPLACE / SKIP fill the
// rest; tap the icon to put it back; let go short and it springs back. Done
// rows don't swipe. A row the coach changed carries the small rune before
// its detail (page 56 item 7); a skipped row opened shows the reason tiles.
// Page 71: today's running session opens like any row and reads "under way"
// (Program's plan line); the live strip at the bottom is the way back in.

/** The tucked face: a square around the icon. */
const TUCK_PX = 62
/** Past this the row stays tucked on release. */
const OPEN_AT_PX = 80

export interface DayBoardRowProps {
  session: DayBoardSession
  /** The plan line for a to-do and the row's rune. */
  context?: RowContext
  open: boolean
  onToggle: () => void
  onReplace?: (session: DayBoardSession) => void
  onSkip?: (session: DayBoardSession) => void
  /** The block week (Foundation's level in the summary). */
  weekNumber?: number | null
  /** Extra buttons inside the summary (Today's START). */
  summaryActions?: ReactNode
  /** Shown in place of the summary when open (a skip's reason tiles). */
  openContent?: ReactNode
}

export function DayBoardRow({ session, context, open, onToggle, onReplace, onSkip, weekNumber, summaryActions, openContent }: DayBoardRowProps) {
  const base = dayRowState(session, context)
  const variant = base.variant
  const swipeable = base.swipeable && Boolean(onReplace || onSkip)
  const [swiped, setSwiped] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const faceRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x0: number; y0: number; base: number; off: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const tucked = swiped && swipeable
  // page 61: an opened or swiped row closes (untucks) on a tap outside it; one at a time
  // closed on the tap, not on the finger going down: the rows don't move under the finger before it lands
  useOutsideClose(rowRef, open && !tucked, onToggle, { on: 'click' })
  useOutsideClose(rowRef, tucked, () => setSwiped(false), { on: 'click' })

  function endDrag(commit: boolean) {
    const d = drag.current
    drag.current = null
    const row = rowRef.current
    const face = faceRef.current
    if (!d || !d.moved || !row || !face) return
    suppressClick.current = true
    row.classList.remove('is-dragging', 'is-tucking')
    face.style.width = ''
    const stay = commit && d.off < -OPEN_AT_PX
    setSwiped(stay)
    if (stay && open) onToggle()
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    if (!swipeable || e.button !== 0) return
    const w = rowRef.current?.offsetWidth ?? 0
    drag.current = { x0: e.clientX, y0: e.clientY, base: tucked ? -(w - TUCK_PX) : 0, off: 0, moved: false }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const row = rowRef.current
    const face = faceRef.current
    if (!d || !row || !face) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!d.moved) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return }
      if (Math.abs(dx) < 8) return
      d.moved = true
      try { face.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      row.classList.add('is-dragging')
    }
    const w = row.offsetWidth
    const off = Math.min(0, Math.max(-(w - TUCK_PX), d.base + dx))
    d.off = off
    face.style.width = `${w + off}px`
    row.classList.toggle('is-tucking', off < -30)
  }

  function onClick() {
    if (suppressClick.current) { suppressClick.current = false; return }
    if (tucked) { setSwiped(false); return }
    onToggle()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onClick()
  }

  const nameTone = base.status === 'skipped' ? 'struck' : base.status === 'missed' ? 'dim' : 'ink'
  const cls = ['db-row', `is-${variant}`, open && !tucked ? 'is-open' : '', tucked ? 'is-swiped' : ''].filter(Boolean).join(' ')
  const a11y = `${base.name}, ${base.slot.toUpperCase()}, ${base.detail}${base.status === 'done' ? ', done' : ''}`

  return (
    <div ref={rowRef} className={cls}>
      {swipeable && (
        <div className="db-acts" aria-hidden={!tucked}>
          {onReplace && (
            <button type="button" className="db-act is-replace" tabIndex={tucked ? 0 : -1} aria-label={`Replace ${base.name}`} onClick={() => { setSwiped(false); onReplace(session) }}>
              <FlapLabel text="REPLACE" size="xs" />
            </button>
          )}
          {onSkip && (
            <button type="button" className="db-act is-skip" tabIndex={tucked ? 0 : -1} aria-label={`Skip ${base.name}`} onClick={() => { setSwiped(false); onSkip(session) }}>
              <FlapLabel text="SKIP" size="xs" />
            </button>
          )}
        </div>
      )}
      <div
        ref={faceRef}
        className="db-face"
        role="button"
        tabIndex={0}
        aria-expanded={open && !tucked}
        aria-label={tucked ? `${base.name}, tap to put it back` : a11y}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <SessionIcon kind={base.icon} size={40} label={base.name} />
        <div className="db-txt">
          <span className="db-nm"><FlapLabel text={base.name.toUpperCase()} size="sm" tone={nameTone} /></span>
          <span className="db-det">{base.rune && <Rune state={base.rune} size="row" />}{base.detail}</span>
        </div>
        {base.status === 'done' && <span className="db-tick" aria-hidden>✓</span>}
        <span className="db-slot"><AmPmFlap slot={base.slot} size="xs" /></span>
      </div>
      {/* the day board's row opens (page 59 §5.3 Expand) */}
      <Expand open={open && !tucked}>
        {openContent || (
          <SessionSummary
            session={session}
            weekNumber={weekNumber}
            onReplace={onReplace ? () => onReplace(session) : undefined}
            onSkip={onSkip ? () => onSkip(session) : undefined}
            actions={summaryActions}
          />
        )}
      </Expand>
    </div>
  )
}

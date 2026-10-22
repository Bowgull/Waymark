import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Expand, FlapLabel, SessionIcon } from '@/design'
import { Rune } from '@/features/coach/Rune'
import { loadSummary, type SummaryData } from '@/features/dayboard/summaryData'
import { iconFor, rowStatus, sessionDisplayName, type DayBoardSession } from '@/features/dayboard/rowState'
import type { RuneState } from '@/lib/coach/changes'
import { tapHaptic } from '@/lib/haptics'

import { PixelCursor } from './PixelCursor'
import { planLines, type LinesOpts } from './planLines'
import './plan.css'

/** The hold that opens the command window (page 73, page 59's motion). */
export const HOLD_MS = 500
/** A finger that moves this far is a scroll, not a hold. */
const MOVE_PX = 8

/** A coach change on the row: the rune, then the why with the old value struck. */
export interface RowChange {
  rune: RuneState
  why: string
  /** The old and new values ("30" struck, then "20 min"), when the change has them. */
  was?: string | null
  now?: string | null
}

export interface PlanRowProps {
  session: DayBoardSession
  /** The pixel cursor is on this row (its name turns gold). */
  on: boolean
  /** Its lines show under it. */
  open: boolean
  onTap: () => void
  /** Hold 500 ms (to-do and skipped rows): the command window. */
  onHold?: (row: HTMLElement) => void
  /** "~20min", "✓" or "—". */
  mins: ReactNode
  change?: RowChange | null
  linesOpts?: LinesOpts
  /** Under the lines: Today's ENTER ›, + What you learned. */
  extra?: ReactNode
  /** Extra classes on the row and on its tap target (Today's td-row / td-rowhit). */
  className?: string
  hitClassName?: string
}

/**
 * One session row (page 73 §1, the same on Program and Today): the icon, the
 * name on a flap, the minutes (✓ when done, — when skipped). Tap: its real
 * lines open small under it. Hold: the row darkens, a thin gold line traces
 * its foot over 500 ms, then a light haptic and the command window. Let go
 * early and both ease back. No boxes or glows: the cursor is the highlight.
 */
export function PlanRow({ session: s, on, open, onTap, onHold, mins, change, linesOpts, extra, className = '', hitClassName = '' }: PlanRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const hold = useRef<{ t: number; x: number; y: number } | null>(null)
  const held = useRef(false)
  const [press, setPress] = useState(false)
  const status = rowStatus(s.status)
  const skipped = status === 'skipped'
  const done = status === 'done'
  const name = sessionDisplayName(s).toUpperCase()

  // The lines, read once the row first opens (the summary's own endpoints).
  const key = `${s.id}:${s.status}`
  const [data, setData] = useState<{ key: string; data: SummaryData | null } | null>(null)
  const wanted = open || data != null
  useEffect(() => {
    if (!wanted || data?.key === key) return
    let cancelled = false
    loadSummary(s).then(d => { if (!cancelled) setData({ key, data: d }) }).catch(() => { if (!cancelled) setData({ key, data: null }) })
    return () => { cancelled = true }
    // The key covers the fields the fetch reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, key])
  useEffect(() => () => { if (hold.current) window.clearTimeout(hold.current.t) }, [])

  const cancel = () => {
    if (!hold.current) return
    window.clearTimeout(hold.current.t)
    hold.current = null
    setPress(false)
  }

  const ready = data?.key === key
  const lines = ready ? planLines(s, data.data, linesOpts) : []

  return (
    <div
      ref={ref}
      data-sid={s.id}
      className={`pl-row${done ? ' is-done' : ''}${skipped ? ' is-skip' : ''}${on ? ' is-on' : ''}${press ? ' is-press' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={e => {
        held.current = false
        if (!onHold || e.button !== 0) return
        const el = ref.current
        const x = e.clientX, y = e.clientY
        setPress(true)
        hold.current = {
          x, y,
          t: window.setTimeout(() => {
            hold.current = null
            setPress(false)
            held.current = true
            void tapHaptic()
            if (el) onHold(el)
          }, HOLD_MS),
        }
      }}
      onPointerMove={e => { if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > MOVE_PX) cancel() }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={e => e.preventDefault()}
    >
      {on && <PixelCursor />}
      <div
        className={`pl-hit${hitClassName ? ` ${hitClassName}` : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => { if (held.current) { held.current = false; return } onTap() }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap() } }}
      >
        <SessionIcon kind={iconFor(s)} size={40} label={name} />
        <span className="pl-nm"><span className="nmw"><FlapLabel text={name} size="md" len={11} /></span></span>
        <span className="pl-mins">{mins}</span>
      </div>
      <Expand open={open} className="pl-ols">
        <div className="pl-lines" onClick={e => e.stopPropagation()}>
          {change && !skipped && (
            <div className="pl-ol is-why">
              <Rune state={change.rune} size="row" />
              <span>{change.was ? <><s>{change.was}</s> {change.now ? `${change.now}: ` : ''}</> : null}{change.why}</span>
            </div>
          )}
          {!ready && <div className="pl-ol"><span className="lb" /><span className="v is-dim">Reading the plan.</span></div>}
          {lines.map((l, i) => (
            <div key={`${l.label}-${i}`} className="pl-ol">
              <span className="lb">{l.label}</span>
              <span className="v">{l.value}{l.tick && <> <b className="ck">✓</b></>}{l.mark === 'up' && <> <b className="up">↑</b></>}{l.mark === 'down' && <> <b className="dn">↓</b></>}</span>
            </div>
          ))}
          {extra}
        </div>
      </Expand>
    </div>
  )
}

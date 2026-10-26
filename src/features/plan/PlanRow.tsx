import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Expand, FlapLabel, SessionIcon } from '@/design'
import { Rune } from '@/features/coach/Rune'
import { loadSummary, type SummaryData } from '@/features/dayboard/summaryData'
import { iconFor, rowStatus, sessionDisplayName, type DayBoardSession } from '@/features/dayboard/rowState'
import type { RuneState } from '@/lib/coach/changes'
import { tapHaptic } from '@/lib/haptics'
import { runNameLine } from '@/lib/runNameLine'
import { useTreadmillUnit } from '@/lib/treadmillUnit'

import { Cmd } from './CommandWindow'
import { PixelCursor } from './PixelCursor'
import { planLines, type LinesOpts } from './planLines'
import './plan.css'

/** The hold that opens the command window (page 73, page 59's motion). */
export const HOLD_MS = 500
/** A finger that moves this far is a scroll, not a hold. */
const MOVE_PX = 12

/**
 * The finger lifting after a hold is not a tap. Its click lands on the command
 * window's veil or the page, where it would close the row that was open above
 * (the list shifts, that reads as a scroll, and the window closes with it).
 * Only a click inside the window still counts.
 */
function swallowReleaseClick(): void {
  const swallow = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('.pl-cmd')) return
    e.stopPropagation()
    e.preventDefault()
  }
  const lifted = () => {
    window.removeEventListener('pointerup', lifted, { capture: true })
    window.removeEventListener('pointercancel', lifted, { capture: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400)
  }
  window.addEventListener('click', swallow, { capture: true })
  window.addEventListener('pointerup', lifted, { capture: true })
  window.addEventListener('pointercancel', lifted, { capture: true })
}

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
  const status = rowStatus(s.status)
  const skipped = status === 'skipped'
  const done = status === 'done'
  const name = sessionDisplayName(s).toUpperCase()
  // Page 93: on an open run row, a tap on its name shows one plain line (tap away to close).
  const nameLine = s.type === 'foundation_run' || s.type === 'running' ? runNameLine(name) : null
  const [say, setSay] = useState<{ anchor: DOMRect; closing: boolean } | null>(null)

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
  }

  // Page 93: a line with a why (the PRESS line) opens one plain line in the command window; a tap away closes it.
  const [explain, setExplain] = useState<{ label: string; text: string; anchor: DOMRect; closing: boolean } | null>(null)

  const ready = data?.key === key
  // Page 76: every speed and pace follows the treadmill unit in Settings.
  const unit = useTreadmillUnit()
  const lines = ready ? planLines(s, data.data, { ...linesOpts, unit }) : []

  return (
    <div
      ref={ref}
      data-sid={s.id}
      className={`pl-row${done ? ' is-done' : ''}${skipped ? ' is-skip' : ''}${on ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={e => {
        held.current = false
        if (!onHold || e.button !== 0) return
        // the row's own controls (ENTER ›, the ×, a link) and its open lines are not the row's hold
        if (e.target instanceof Element && e.target.closest('button, a, .pl-lines')) return
        const el = ref.current
        const x = e.clientX, y = e.clientY
        hold.current = {
          x, y,
          t: window.setTimeout(() => {
            hold.current = null
            held.current = true
            void tapHaptic()
            swallowReleaseClick()
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
        onClick={e => {
          if (held.current) { held.current = false; return }
          if (open && nameLine && e.target instanceof Element && e.target.closest('.nmw')) {
            const hit = e.currentTarget.getBoundingClientRect()
            setSay({ anchor: hit, closing: false })
            return
          }
          onTap()
        }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap() } }}
      >
        <SessionIcon kind={iconFor(s)} size={40} label={name} />
        <span className="pl-nm"><span className="nmw"><FlapLabel text={name} size={name.length > 11 ? 'sm' : 'md'} len={name.length > 11 ? undefined : 11} /></span></span>
        <span className="pl-mins">{mins}</span>
      </div>
      {say && nameLine && (
        <Cmd anchor={say.anchor} place="below" closing={say.closing} onLeft={() => setSay(null)} onDismiss={() => setSay(x => x && { ...x, closing: true })} label={name}>
          <div className="pl-hdr"><FlapLabel text={name} size="xs" tone="gold" animate={false} /></div>
          <p className="pl-say">{nameLine}</p>
        </Cmd>
      )}
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
            <div
              key={`${l.label}-${i}`}
              className="pl-ol"
              {...(l.explain ? {
                role: 'button', tabIndex: 0, 'aria-label': `${l.label}: why`, style: { cursor: 'pointer' },
                onClick: (e: React.MouseEvent<HTMLDivElement>) => { void tapHaptic(); setExplain({ label: l.label, text: l.explain!, anchor: e.currentTarget.getBoundingClientRect(), closing: false }) },
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExplain({ label: l.label, text: l.explain!, anchor: e.currentTarget.getBoundingClientRect(), closing: false }) } },
              } : {})}
            >
              <span className="lb">{l.label}</span>
              <span className="v">{l.value}{l.tick && <> <b className="ck">✓</b></>}{l.mark === 'up' && <> <b className="up">↑</b></>}{l.mark === 'down' && <> <b className="dn">↓</b></>}{l.explain && <> <b className="pl-more">›</b></>}</span>
            </div>
          ))}
          {extra}
        </div>
      </Expand>
      {explain && (
        <Cmd anchor={explain.anchor} place="below" closing={explain.closing} onLeft={() => setExplain(null)} onDismiss={() => setExplain(x => (x ? { ...x, closing: true } : x))} label={`${explain.label}: why`}>
          <div className="pl-hdr"><FlapLabel text={explain.label} size="xs" tone="gold" animate={false} /></div>
          <p className="pl-say">{explain.text}</p>
        </Cmd>
      )}
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { FlapLabel, SessionIcon, prefersReducedMotion, sessionIconFor, useDismissLayer } from '@/design'

import { PixelCursor } from './PixelCursor'
import './plan.css'

// The command window (page 73 §2-4, FFX-like): a dark plate, a thin gold
// rule, crisp pixel corners. It pops from what it belongs to (scale 94% →
// 100% and fade, 180 ms ease-out) and leaves at 97% in 120 ms ease-in. A tap
// anywhere else, a scroll, Escape or the edge swipe closes it. Lines are 44 pt
// tall; the pixel cursor sits on the pointed one and its name turns gold.

export type CmdPlace = 'side' | 'below' | 'bottom'

/** The window's frame. `closing` plays the leave; `onLeft` follows it. */
export function Cmd({ anchor, place, closing, onLeft, onDismiss, label, className = '', children }: {
  anchor: DOMRect | null
  place: CmdPlace
  closing: boolean
  onLeft: () => void
  onDismiss: () => void
  label: string
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null)
  const opened = useRef(0)
  useEffect(() => { opened.current = Date.now() }, [])
  useDismissLayer(!closing, onDismiss)

  useLayoutEffect(() => {
    const w = ref.current
    if (!w || place === 'bottom' || !anchor) return
    const ww = w.offsetWidth, h = w.offsetHeight, vh = window.innerHeight
    let left: number, top: number, origin: string
    if (place === 'side') { left = anchor.right - ww + 4; top = anchor.top + anchor.height / 2 - h / 2; origin = 'right center' }
    else { left = Math.min(anchor.right - ww, anchor.left + 24); top = anchor.bottom + 6; origin = 'top center' }
    top = Math.max(60, Math.min(top, vh - 112 - h))
    left = Math.max(10, left)
    setPos({ left, top, origin })
  }, [anchor, place, children])

  // A scroll closes it (not the page's own reveal right after it opened).
  useEffect(() => {
    if (closing) return
    const onScroll = (e: Event) => { if (e.target instanceof Node && ref.current?.contains(e.target)) return; if (Date.now() - opened.current > 800) onDismiss() }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [closing, onDismiss])

  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(onLeft, prefersReducedMotion() ? 0 : 120)
    return () => window.clearTimeout(t)
  }, [closing, onLeft])

  const style = place === 'bottom' ? undefined : pos ? { left: pos.left, top: pos.top, transformOrigin: pos.origin } : { left: 0, top: 0, visibility: 'hidden' as const }
  return createPortal(
    <>
      <div className="pl-veil" onClick={() => { if (!closing) onDismiss() }} aria-hidden />
      <div ref={ref} className={`pl-cmd${place === 'bottom' ? ' is-pickw' : ''}${closing ? ' is-out' : ''} ${className}`.trim()} style={style} role="dialog" aria-label={label}>
        <i className="pc a" /><i className="pc b" /><i className="pc c" /><i className="pc d" />
        {children}
      </div>
    </>,
    document.body,
  )
}

/** A menu line: the cursor when pointed, 44 pt tall. */
export function CmdLine({ on, onClick, className = '', label, children }: { on: boolean; onClick: () => void; className?: string; label?: string; children: ReactNode }) {
  return (
    <div className={`pl-cl${on ? ' is-on' : ''} ${className}`.trim()} role="button" tabIndex={0} aria-label={label} aria-current={on ? 'true' : undefined}
      onClick={e => { e.stopPropagation(); onClick() }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
      {on && <PixelCursor />}
      {children}
    </div>
  )
}

// ─── The windows ───────────────────────────────────────────────

/** Hold a session: REPLACE and SKIP (ember) on their own lines; a skipped one: UNDO SKIP. */
export function ActBody({ skipped, onReplace, onSkip, onUnskip }: { skipped: boolean; onReplace: () => void; onSkip: () => void; onUnskip: () => void }) {
  if (skipped) return <CmdLine on onClick={onUnskip} label="Undo skip"><FlapLabel text="UNDO SKIP" size="sm" animate={false} /></CmdLine>
  return (
    <>
      <CmdLine on onClick={onReplace} label="Replace"><FlapLabel text="REPLACE" size="sm" animate={false} /></CmdLine>
      <CmdLine on={false} onClick={onSkip} className="is-ember" label="Skip"><FlapLabel text="SKIP" size="sm" animate={false} /></CmdLine>
    </>
  )
}

export interface ReasonChoice { label: string; code: string }

/** After a replace: TIME / BODY / JUST BECAUSE. After a skip: TIME / BODY / SICK / PAIN. Optional. */
export function WhyBody({ tiles, two, onPick }: { tiles: ReadonlyArray<ReasonChoice>; two: boolean; onPick: (code: string) => void }) {
  return (
    <>
      <div className="pl-hdr"><FlapLabel text="WHY?" size="xs" tone="dim" animate={false} /><small>optional</small></div>
      <div className={`pl-grid2${two ? '' : ' is-one'}`} role="group" aria-label="Why, optional">
        {tiles.map(t => (
          <div key={t.code} className="pl-cl" role="button" tabIndex={0} aria-label={t.label} onClick={e => { e.stopPropagation(); onPick(t.code) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(t.code) } }}>
            <FlapLabel text={t.label} size="xs" animate={false} />
          </div>
        ))}
      </div>
    </>
  )
}

/** A coach change: its why-line, then KEEP and UNDO; once undone, the line back and REDO. */
export function RuneBody({ say, undone, canUndo, canRedo, onKeep, onUndo, onRedo }: { say: ReactNode; undone: boolean; canUndo: boolean; canRedo: boolean; onKeep: () => void; onUndo: () => void; onRedo: () => void }) {
  if (undone) {
    return (
      <>
        <p className="pl-say">{say}</p>
        {canRedo && <CmdLine on onClick={onRedo} label="Redo"><FlapLabel text="REDO" size="sm" animate={false} /></CmdLine>}
      </>
    )
  }
  return (
    <>
      <p className="pl-say">{say}</p>
      <CmdLine on onClick={onKeep} className="is-teal" label="Keep"><FlapLabel text="KEEP" size="sm" animate={false} /></CmdLine>
      {canUndo && <CmdLine on={false} onClick={onUndo} label="Undo"><FlapLabel text="UNDO" size="sm" animate={false} /></CmdLine>}
    </>
  )
}

export interface PickRow {
  key: string
  type: string
  label: string
  runCategory?: string
  reason: string | null
  minutes: number | null
  lines: Array<[string, string] | [string, string, 'up' | 'down']>
}

function Inner({ lines }: { lines: PickRow['lines'] }) {
  return (
    <span className="pl-inn">
      {lines.slice(0, 5).map(([lb, v, mk], i) => (
        <span key={`${lb}-${i}`} className="pl-ol"><span className="lb">{lb}</span><span className="v">{v}{mk === 'up' && <> <b className="up">↑</b></>}{mk === 'down' && <> <b className="dn">↓</b></>}</span></span>
      ))}
    </span>
  )
}

/**
 * COACH PICKS for REPLACE and + add: the picks as menu lines, the cursor on
 * the first; the pointed one shows its reason and exactly what it would be
 * that day, and SWAP IN (ADD). Tapping a line only points at it. EVERYTHING
 * ELSE › is the full list in the same window; its last line goes back.
 */
export function PicksBody({ view, picks, all, cur, add, forWhat, busy, onPoint, onTake, onView }: {
  view: 'picks' | 'all'
  picks: PickRow[] | null
  all: PickRow[] | null
  cur: number
  add: boolean
  forWhat: string
  busy: boolean
  onPoint: (i: number) => void
  onTake: (row: PickRow) => void
  onView: (v: 'picks' | 'all') => void
}) {
  const list = view === 'all' ? all ?? [] : picks ?? []
  const take = (row: PickRow) => (
    <span className="pl-take" role="button" tabIndex={0} aria-label={add ? 'Add' : 'Swap in'} onClick={e => { e.stopPropagation(); if (!busy) onTake(row) }} onKeyDown={e => { if (e.key === 'Enter') onTake(row) }}>
      <FlapLabel text={add ? 'ADD' : 'SWAP IN'} size="xs" tone="gold" animate={false} />
    </span>
  )
  return (
    <>
      <div className="pl-hdr"><FlapLabel text={view === 'all' ? 'EVERYTHING' : 'COACH PICKS'} size="xs" tone="gold" animate={false} /><small>{forWhat}</small></div>
      {picks == null && <p className="pl-say is-dim">Asking the coach.</p>}
      {list.map((o, i) => (
        <CmdLine key={o.key} on={i === cur} onClick={() => onPoint(i)} label={o.label}>
          <SessionIcon kind={sessionIconFor(o.type, o.runCategory)} size={26} label="" />
          <span className="grow">
            <FlapLabel text={o.label.toUpperCase()} size="sm" animate={false} />
            {i === cur && (
              <>
                {view === 'picks' && o.reason && <span className="why2">{o.reason}</span>}
                <Inner lines={o.lines} />
                {take(o)}
              </>
            )}
          </span>
          <span className="pl-mins">{o.minutes != null ? `~${o.minutes}min` : '—'}</span>
        </CmdLine>
      ))}
      {picks != null && (view === 'all'
        ? <CmdLine on={false} onClick={() => onView('picks')} className="is-more" label="Coach picks"><span className="gt">‹</span><FlapLabel text="COACH PICKS" size="xs" animate={false} /></CmdLine>
        : <CmdLine on={false} onClick={() => onView('all')} className="is-more" label="Everything else"><span className="grow"><FlapLabel text="EVERYTHING ELSE" size="xs" animate={false} /></span><span className="gt">›</span></CmdLine>)}
    </>
  )
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { CentredCard, FlapLabel, SessionIcon, useEdgeBack, type FlapTone, type SessionIconKey } from '@/design'
import { tapHaptic } from '@/lib/haptics'
import { comboStrikes, END_HOLD_MS, ENDED_SHOW_MS, HOLD_GRACE_MS } from '@/lib/timers/timerLook'

/** A finger that slides this far off the × lets go (a rolling thumb doesn't). */
const END_SLOP_PX = 40
import { setWorldBackdrop } from '@/world/worldStore'

import { SessionEndedContext, getSessionNav } from './endedContext'
import { watchFreshControls } from './freshPress'
import { sentenceCase, useEaseAway } from './boardAway'

import './timers.css'

// ─── The × end button ─────────────────────────────────────────

/**
 * The end button (page 74, every session): a flap tile with a ×. Hold it 3 s
 * and a fill rises through the plate; at full, the close window opens (END AND
 * LOG · DISCARD). Let go early and the fill eases back. A brush or a tap does
 * nothing, so a glove can't end the session by accident. Enter / Space (the
 * keyboard, VoiceOver) opens the close window at once.
 */
export function EndButton({ onHeld, label = 'End. Hold for 3 seconds.' }: { onHeld?: () => void; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  // The hold, kept off React so the fill starts on the touch itself: when it began, where, and the frame loop.
  const hold = useRef<{ start: number; x: number; y: number; raf: number } | null>(null)
  const heldRef = useRef(onHeld)
  useLayoutEffect(() => { heldRef.current = onHeld })
  const stop = () => {
    const h = hold.current
    if (!h) return
    cancelAnimationFrame(h.raf)
    hold.current = null
    ref.current?.classList.remove('is-hold')
  }
  const fire = () => { stop(); void tapHaptic(); heldRef.current?.() }
  useEffect(() => () => { if (hold.current) cancelAnimationFrame(hold.current.raf) }, [])
  return (
    <button
      ref={ref}
      type="button"
      className="tm-x"
      aria-label={label}
      onPointerDown={e => {
        if (!heldRef.current || hold.current) return
        // The finger stays the button's until it lifts: a small drift never cancels the hold.
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
        e.currentTarget.classList.add('is-hold')
        const h = { start: performance.now(), x: e.clientX, y: e.clientY, raf: 0 }
        hold.current = h
        // Done on the frame the fill is full, the same moment the plate looks full.
        const tick = () => {
          if (hold.current !== h) return
          if (performance.now() - h.start >= END_HOLD_MS) { fire(); return }
          h.raf = requestAnimationFrame(tick)
        }
        h.raf = requestAnimationFrame(tick)
      }}
      onPointerMove={e => {
        const h = hold.current
        // Only a real slide away lets go (a thumb that rolls stays).
        if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > END_SLOP_PX) stop()
      }}
      onPointerUp={() => {
        const h = hold.current
        // Lifted as the plate filled: it still counts.
        if (h && performance.now() - h.start >= END_HOLD_MS - HOLD_GRACE_MS) fire()
        else stop()
      }}
      onPointerCancel={stop}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); heldRef.current?.() } }}
    >
      <i className="tm-xfill" aria-hidden />
      <span className="tm-xg" aria-hidden>×</span>
    </button>
  )
}

/**
 * The close window after the × hold (page 74): the session's name, END AND LOG
 * (gold, primary: saves what was done, then effort and the optional why) and a
 * small muted-ember DISCARD (back to planned, the coach sees nothing). No
 * helper text. A tap outside (or CLOSE) closes it and the session carries on
 * exactly as it was.
 */
export function CloseWindow({ head, onEndAndLog, onDiscard, onBack }: { head: string; onEndAndLog: () => void; onDiscard: () => void; onBack: () => void }) {
  const [leaving, away] = useEaseAway()
  return (
    <CentredCard label={`${head}: end`} head={head} onDismiss={() => away(onBack)} className={`tm-closewin${leaving ? ' is-leaving' : ''}`}>
      <div className="tm-closeb">
        <SessionButton label="END AND LOG" primary onClick={onEndAndLog} />
        <button type="button" className="wm-btn tm-discard" aria-label="DISCARD" onClick={onDiscard}>
          <FlapLabel text="DISCARD" size="xs" tone="ink" />
        </button>
      </div>
    </CentredCard>
  )
}

/**
 * The × and its close window, for any session screen. `onEndAndLog` overrides
 * the default end (a run opens Log your run, filled); DISCARD goes through the
 * session's nav (WorkoutPage), or `onEnd` on a gallery screen.
 */
export function EndControl({ head, onEnd, onEndAndLog, onEndStart }: { head: string; onEnd?: () => void; onEndAndLog?: () => void; /** The default END AND LOG (SessionFrame's ENDED flip, then the close). */ onEndStart?: () => void }) {
  const [open, setOpen] = useState(false)
  const end = () => {
    setOpen(false)
    if (onEndAndLog) onEndAndLog()
    else if (onEndStart) onEndStart()
    else { const nav = getSessionNav(); if (nav) nav.end(); else onEnd?.() }
  }
  const discard = () => {
    setOpen(false)
    const nav = getSessionNav()
    if (nav) nav.discard()
    else onEnd?.()
  }
  return (
    <>
      <EndButton onHeld={onEnd || onEndAndLog ? () => setOpen(true) : undefined} />
      {open && <CloseWindow head={head} onEndAndLog={end} onDiscard={discard} onBack={() => setOpen(false)} />}
    </>
  )
}

// ─── The screen ───────────────────────────────────────────────

/** Session screens mounted (one leaving while the next arrives still counts as up). */
let sessionScreens = 0

interface SessionFrameProps {
  /** The session on a flap (BAG WORK, WARM UP, STRENGTH A…). */
  title: string
  /** The title's plate (page 86: the bag finisher's FINISHER on its red). Ink by default. */
  titleTone?: FlapTone
  /** Right side: a count flap (3/6) or the session icon. */
  count?: string
  icon?: SessionIconKey
  /** Right side instead of a count or icon (the bag round's FIGHT / REST flap, page 55). */
  right?: ReactNode
  onEnd?: () => void
  /** END AND LOG in the × close window, instead of the default end (a run: Log your run, filled). */
  onEndAndLog?: () => void
  /** The close window's head (default: the title in sentence case). */
  closeHead?: string
  /** The grass zone (a timer screen) or nothing (the set screen). */
  grass?: ReactNode
  /** Over the forest (page 31 "A set") instead of the dark timer ground. */
  forest?: boolean
  paused?: boolean
  children?: ReactNode
  /** Extra overlays (cards). */
  overlay?: ReactNode
  className?: string
  /**
   * Page 81, the interval timer: no ‹ TODAY and no close window. Held through,
   * the × just ends (this is called); a long title steps down to fit the row.
   */
  onEndHeld?: () => void
}

/**
 * Every in-session screen (pages 19 and 31): the dark ground (or the forest),
 * the stop row (× end tile, the session on a flap, a count or the icon), the
 * body, and on timers the half-screen grass. Paused dims the whole screen.
 */
export function SessionFrame({ title, titleTone = 'ink', count, icon, right, onEnd, onEndAndLog, closeHead, grass, forest = false, paused = false, children, overlay, className = '', onEndHeld }: SessionFrameProps) {
  // Held through: ENDED flips in place (the timer's phase word, or the title on a screen with no
  // timer) and the clock stops; the session leaves once it has been read (page 19 `.xbtn`).
  const [ended, setEnded] = useState(false)
  const endRef = useRef(onEnd)
  useLayoutEffect(() => { endRef.current = onEnd })
  const pending = useRef<number | null>(null)
  // Held through: the session ends (WorkoutPage's end: the close); a gallery screen just calls onEnd.
  const leave = () => { if (pending.current == null) return; window.clearTimeout(pending.current); pending.current = null; const nav = getSessionNav(); if (nav) nav.end(); else endRef.current?.() }
  // ‹ TODAY and the left-edge swipe (page 61, 3A): out to Today without ending anything.
  const stepOut = () => { const nav = getSessionNav(); if (nav) nav.leave(); else endRef.current?.() }
  useEdgeBack(onEnd ? stepOut : null)
  const startEnd = () => {
    if (ended || pending.current != null) return
    setEnded(true)
    pending.current = window.setTimeout(leave, ENDED_SHOW_MS)
  }
  // Unmounted mid-way (the phase moved on underneath): still end, at once.
  useEffect(() => () => leave(), [])
  // A double tap never lands on what the first tap just put under the finger (freshPress).
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => (rootRef.current ? watchFreshControls(rootRef.current) : undefined), [])
  // Pops drop in under the session's top row while one is up (design.css: no :has() on body, page 59).
  useEffect(() => {
    sessionScreens++
    document.body.dataset.session = ''
    return () => { if (--sessionScreens === 0) delete document.body.dataset.session }
  }, [])
  // page 31 draws the set screen over the forest (the clearing, as the MT log)
  useEffect(() => {
    if (!forest) return
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [forest])
  return (
    <SessionEndedContext.Provider value={ended}>
    <div ref={rootRef} className={`tm-screen${forest ? ' is-forest' : ''}${paused ? ' is-paused' : ''}${ended ? ' is-ended' : ''} ${className}`}>
      {!forest && <div className="tm-ground" aria-hidden />}
      {forest && <div className="tm-forest-scrim" aria-hidden />}
      {grass}
      <div className="tm-ui">
        <div className="tm-stop">
          {onEnd ? <button type="button" className="tm-back" onClick={stepOut}>‹ TODAY</button> : <span />}
          {onEndHeld
            ? <span className="tm-title"><FlapLabel text={title} size="sm" fit animate={false} /></span>
            : <FlapLabel text={ended && !grass ? 'ENDED' : title} size="sm" tone={ended && !grass ? 'clay' : titleTone} />}
          <span className="tm-stop-r">
            {right ?? (icon ? <SessionIcon kind={icon} size={40} /> : count ? <FlapLabel text={count} size="sm" /> : null)}
            {onEnd ? <EndControl head={closeHead ?? sentenceCase(title)} onEnd={onEnd} onEndAndLog={onEndAndLog} onEndStart={startEnd} /> : <EndButton onHeld={onEndHeld} />}
          </span>
        </div>
        {children}
      </div>
      {overlay}
    </div>
    </SessionEndedContext.Provider>
  )
}

/** Round pips (page 19 `.pips`): done teal, now gold with a glow, to come dim. */
export function Pips({ total, now, small = false }: { total: number; now: number; small?: boolean }) {
  if (total <= 1) return null
  return (
    <div className={small ? 'tm-pips2' : 'tm-pips'} aria-label={`${now + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => <i key={i} className={i < now ? 'd' : i === now ? 'n' : ''} />)}
    </div>
  )
}

// ─── Combos as strike tiles ───────────────────────────────────

/**
 * A combo (design-decisions "Combos"): separate strike tiles joined by ›, on
 * page 31's board tiles. No combo letters (page 55, 2026-10-19).
 */
export function ComboStrikes({ text, size = 'xs', className = '', glove = false }: { text: string; size?: 'xs' | 'sm' | 'md'; className?: string; glove?: boolean }) {
  const strikes = comboStrikes(text)
  return (
    <span className={`tm-combo ${className}`} role="img" aria-label={`${strikes.join(', ')}${glove ? ', from class' : ''}`}>
      {strikes.map((s, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="arr" aria-hidden>›</span>}
          <span className="stk"><FlapLabel text={s} size={size} /></span>
        </span>
      ))}
      {/* page 49 section 3: a combo from class carries the MT Class glove, small, after its strikes */}
      {glove && <SessionIcon kind="mt" size={20} className="tm-glove" label="" />}
    </span>
  )
}

/** A flap word as a big button (page 31 `BTN`): primary = md gold, else sm. */
export function SessionButton({ label, onClick, primary = false, disabled = false, tone, className = '' }: { label: string; onClick?: () => void; primary?: boolean; disabled?: boolean; tone?: FlapTone; className?: string }) {
  return (
    <button type="button" className={`wm-btn${primary ? ' is-primary' : ''} ${className}`} onClick={onClick} disabled={disabled} aria-label={label}>
      <FlapLabel text={label} size={primary ? 'md' : 'sm'} tone={tone ?? (primary ? 'gold' : 'ink')} fit />
    </button>
  )
}

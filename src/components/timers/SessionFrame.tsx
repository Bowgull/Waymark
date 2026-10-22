import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { CentredCard, FlapLabel, SessionIcon, useEdgeBack, type FlapTone, type SessionIconKey } from '@/design'
import { tapHaptic } from '@/lib/haptics'
import { comboStrikes, END_HOLD_MS, ENDED_SHOW_MS } from '@/lib/timers/timerLook'
import { setWorldBackdrop } from '@/world/worldStore'

import { SessionEndedContext, getSessionNav } from './endedContext'
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
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | null>(null)
  const heldRef = useRef(onHeld)
  useLayoutEffect(() => { heldRef.current = onHeld })
  const stop = () => { if (timer.current != null) window.clearTimeout(timer.current); timer.current = null; setHolding(false) }
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current) }, [])
  return (
    <button
      type="button"
      className={`tm-x${holding ? ' is-hold' : ''}`}
      aria-label={label}
      onPointerDown={() => {
        if (!heldRef.current) return
        setHolding(true)
        timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); void tapHaptic(); heldRef.current?.() }, END_HOLD_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
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

interface SessionFrameProps {
  /** The session on a flap (BAG WORK, WARM UP, STRENGTH A…). */
  title: string
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
}

/**
 * Every in-session screen (pages 19 and 31): the dark ground (or the forest),
 * the stop row (× end tile, the session on a flap, a count or the icon), the
 * body, and on timers the half-screen grass. Paused dims the whole screen.
 */
export function SessionFrame({ title, count, icon, right, onEnd, onEndAndLog, closeHead, grass, forest = false, paused = false, children, overlay, className = '' }: SessionFrameProps) {
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
  // page 31 draws the set screen over the forest (the clearing, as the MT log)
  useEffect(() => {
    if (!forest) return
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [forest])
  return (
    <SessionEndedContext.Provider value={ended}>
    <div className={`tm-screen${forest ? ' is-forest' : ''}${paused ? ' is-paused' : ''}${ended ? ' is-ended' : ''} ${className}`}>
      {!forest && <div className="tm-ground" aria-hidden />}
      {forest && <div className="tm-forest-scrim" aria-hidden />}
      {grass}
      <div className="tm-ui">
        <div className="tm-stop">
          {onEnd ? <button type="button" className="tm-back" onClick={stepOut}>‹ TODAY</button> : <span />}
          <FlapLabel text={ended && !grass ? 'ENDED' : title} size="sm" tone={ended && !grass ? 'clay' : 'ink'} />
          <span className="tm-stop-r">
            {right ?? (icon ? <SessionIcon kind={icon} size={40} /> : count ? <FlapLabel text={count} size="sm" /> : null)}
            {onEnd ? <EndControl head={closeHead ?? sentenceCase(title)} onEnd={onEnd} onEndAndLog={onEndAndLog} onEndStart={startEnd} /> : <EndButton />}
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

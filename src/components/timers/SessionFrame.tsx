import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { FlapLabel, SessionIcon, type FlapTone, type SessionIconKey } from '@/design'
import { comboStrikes, END_HOLD_MS, ENDED_SHOW_MS } from '@/lib/timers/timerLook'
import { setWorldBackdrop } from '@/world/worldStore'

import { SessionEndedContext } from './endedContext'

import './timers.css'

// ─── The × end button ─────────────────────────────────────────

/**
 * The end button (design-decisions "End button (×)"): a flap tile with a ×.
 * Hold it 1.5 s to end; a clay bar fills along its foot. A brush or a tap
 * does nothing, so a glove can't end the session by accident.
 */
export function EndButton({ onEnd, label = 'End. Hold for 1.5 seconds.' }: { onEnd?: () => void; label?: string }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | null>(null)
  const endRef = useRef(onEnd)
  useLayoutEffect(() => { endRef.current = onEnd })
  const stop = () => { if (timer.current != null) window.clearTimeout(timer.current); timer.current = null; setHolding(false) }
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current) }, [])
  return (
    <button
      type="button"
      className={`tm-x${holding ? ' is-hold' : ''}`}
      aria-label={label}
      onPointerDown={() => {
        setHolding(true)
        timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); endRef.current?.() }, END_HOLD_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); endRef.current?.() } }}
    >
      ×
    </button>
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
export function SessionFrame({ title, count, icon, right, onEnd, grass, forest = false, paused = false, children, overlay, className = '' }: SessionFrameProps) {
  // Held through: ENDED flips in place (the timer's phase word, or the title on a screen with no
  // timer) and the clock stops; the session leaves once it has been read (page 19 `.xbtn`).
  const [ended, setEnded] = useState(false)
  const endRef = useRef(onEnd)
  useLayoutEffect(() => { endRef.current = onEnd })
  const pending = useRef<number | null>(null)
  const leave = () => { if (pending.current == null) return; window.clearTimeout(pending.current); pending.current = null; endRef.current?.() }
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
          <EndButton onEnd={onEnd ? startEnd : undefined} />
          <FlapLabel text={ended && !grass ? 'ENDED' : title} size="sm" tone={ended && !grass ? 'clay' : 'ink'} />
          {right ?? (icon ? <SessionIcon kind={icon} size={40} /> : count ? <FlapLabel text={count} size="sm" /> : <span style={{ width: 44 }} />)}
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

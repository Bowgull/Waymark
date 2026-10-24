import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Crest, FlapLabel, useEdgeBack, type FlapSize, type FlapTone } from '@/design'
import { tapHaptic } from '@/lib/haptics'
import './settings.css'

// The pieces page 37 builds Settings, Body metrics and Logs from: the solid
// dark screen (no world), the crest + flap title header, label rows and
// blocks, the time value on a row, and the ▲ ▼ drum of the time card.

const HOLD_MS = 700
/** A press longer than this was a hold let go early (it eases back), not a tap to go back. */
const TAP_MAX_MS = 300
/** Page 81: the crest's hidden hold. */
export const SECRET_HOLD_MS = 1000

/**
 * A full screen on the solid dark (page 37 `.solid`), the header (crest, the
 * title on a flap) fixed at the top and the boards scrolling under it. Tap the
 * crest to go back; hold it for Logs when `onHold` is given.
 */
export function SettingsScreen({ title, onBack, onHold, holdLabel = 'logs', onSecretHold, backLabel, children }: { title: string; onBack: () => void; onHold?: () => void; /** What holding the crest opens, for its label. */ holdLabel?: string; /**
   * Page 81: holding the crest about 1 s opens something nothing on screen
   * points to (the interval timer). The crest dips and a thin gold line traces
   * under it; let go early and it eases back; at full a light haptic.
   */ onSecretHold?: () => void; /** page 46: "‹ TODAY" in gold top left; the crest and title move right (the crest still goes back). */ backLabel?: string; children: ReactNode }) {
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const downAt = useRef(0)
  const [pressing, setPressing] = useState(false)
  const stop = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; setPressing(false) }
  const start = () => {
    held.current = false
    downAt.current = performance.now()
    if (onSecretHold) {
      setPressing(true)
      timer.current = window.setTimeout(() => { timer.current = null; held.current = true; setPressing(false); void tapHaptic(); onSecretHold() }, SECRET_HOLD_MS)
      return
    }
    if (!onHold) return
    timer.current = window.setTimeout(() => { held.current = true; onHold() }, HOLD_MS)
  }
  useEffect(() => stop, [])
  // page 61 rule 4: the swipe in from the left edge does what the ‹ back does
  useEdgeBack(onBack)
  return (
    <div className="st-screen">
      <div className="st-solid" aria-hidden />
      <header className={`st-hd${backLabel ? ' is-back' : ''}`}>
        {backLabel && <button type="button" className="st-bk" onClick={onBack}>‹ {backLabel}</button>}
        <button
          type="button"
          className={`st-brand${pressing ? ' is-press' : ''}`}
          aria-label={onHold && !onSecretHold ? `Back. Hold for ${holdLabel}.` : 'Back'}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          onContextMenu={e => e.preventDefault()}
          onClick={() => { const long = onSecretHold && downAt.current > 0 && performance.now() - downAt.current > TAP_MAX_MS; downAt.current = 0; if (!held.current && !long) onBack() }}
        >
          <span className="st-crest"><Crest width={backLabel ? 22 : 52} /></span>
          <FlapLabel text={title} size="sm" animate={false} />
          {onSecretHold && <i className="st-ctrace" aria-hidden />}
        </button>
      </header>
      <div className="st-scroll">{children}</div>
    </div>
  )
}

/** A label row: the bold name, its line, the control on the right (page 37 `.srow`). */
export function SRow({ label, sub, children, onClick, ariaLabel }: { label: ReactNode; sub?: ReactNode; children?: ReactNode; onClick?: () => void; ariaLabel?: string }) {
  const body = (
    <>
      <div className="st-sl">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </div>
      {children}
    </>
  )
  if (onClick) {
    return (
      <div className="st-row is-tap" role="button" tabIndex={0} aria-label={ariaLabel} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
        {body}
      </div>
    )
  }
  return <div className="st-row">{body}</div>
}

/** A label block with its control underneath (page 37 `.sblock`). */
export function SBlock({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="st-block">
      <div className="st-sl">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </div>
      {children}
    </div>
  )
}

export const SUN_MARK = (
  <svg className="st-mk" viewBox="0 0 16 16" fill="#c9a656" aria-hidden>
    <circle cx="8" cy="8" r="3.3" />
    <g stroke="#c9a656" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 1.2v1.9M8 12.9v1.9M1.2 8h1.9M12.9 8h1.9M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M3.2 12.8l1.3-1.3M11.5 4.5l1.3-1.3" />
    </g>
  </svg>
)
export const MOON_MARK = (
  <svg className="st-mk" viewBox="0 0 16 16" fill="#c9a656" aria-hidden>
    <path d="M10.6 1.6A6.6 6.6 0 1 0 14.4 12 5.5 5.5 0 0 1 10.6 1.6z" />
  </svg>
)

/** A time on a row: sun or moon, "6:30" on a flap, AM teal / PM clay (page 37 `TIME`). */
export function TimeValue({ text, slot }: { text: string; slot: 'am' | 'pm' }) {
  return (
    <span className="st-val">
      {slot === 'am' ? SUN_MARK : MOON_MARK}
      <FlapLabel text={text} size="sm" />
      <FlapLabel text={slot === 'am' ? 'AM' : 'PM'} size="xs" tone={slot === 'am' ? 'teal' : 'clay'} />
    </span>
  )
}

/** A value on a flap with the gold chevron (page 37 `.val` + `.chev`). */
export function ChevValue({ text, tone = 'ink', emptyCells = 2 }: { text: string; tone?: FlapTone; emptyCells?: number }) {
  return (
    <span className="st-val st-val-chev">
      <span className="st-valtxt"><FlapLabel text={text} size="sm" tone={tone} len={text ? 0 : emptyCells} fit /></span>
      <span className="st-chev" aria-hidden>›</span>
    </span>
  )
}

/** One drum of the time card: ▲, the value on a big flap, ▼ (page 37 `.drum`). */
export function VDrum({ label, value, onUp, onDown, size = 'lg', tone = 'ink', children }: { label: string; value?: string; onUp: () => void; onDown: () => void; size?: FlapSize; tone?: FlapTone; children?: ReactNode }) {
  return (
    <div className="st-drum" role="group" aria-label={label}>
      <button type="button" className="st-ar" aria-label={`${label} up`} onClick={onUp}>▲</button>
      {children ?? <FlapLabel text={value ?? ''} size={size} tone={tone} />}
      <button type="button" className="st-ar" aria-label={`${label} down`} onClick={onDown}>▼</button>
    </div>
  )
}

/**
 * A number on flap tiles that you tap to type (Body metrics' fields; the
 * episode and max HR drums). The input sits over the flap, invisible; the
 * flap shows what's typed.
 */
export function FlapNumber({ value, onChange, label, size = 'lg', tone = 'ink', minCells = 0, placeholderCells = 3, decimal = false, maxChars = 5, fit = false }: { value: string; onChange: (v: string) => void; label: string; size?: FlapSize; tone?: FlapTone; minCells?: number; placeholderCells?: number; decimal?: boolean; maxChars?: number; fit?: boolean }) {
  return (
    <span className="st-fnum">
      <FlapLabel text={value} size={size} tone={tone} len={value ? minCells : placeholderCells} fit={fit} />
      <input
        aria-label={label}
        inputMode={decimal ? 'decimal' : 'numeric'}
        enterKeyHint="done"
        value={value}
        maxLength={maxChars}
        onChange={e => onChange(e.target.value)}
        onFocus={e => e.currentTarget.select()}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    </span>
  )
}


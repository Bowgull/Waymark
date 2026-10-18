import { useEffect, type MouseEvent, type ReactNode } from 'react'

import crestBig from './assets/crest-big.webp'
import crestSmall from './assets/crest-small.png'
import { FlapLabel, type FlapSize, type FlapTone } from './FlapLabel'
import { useReducedMotion } from './motion'
import { SESSION_ICON_NAME, SESSION_ICON_SRC, type SessionIconKey } from './sessionIcons'

// ─── Session icon ─────────────────────────────────────────────

/** A painted session icon. `size` is the drawn size in CSS px (the image is 192 px). */
export function SessionIcon({ kind, size = 40, className = '', label }: { kind: SessionIconKey; size?: number; className?: string; label?: string }) {
  return (
    <img
      src={SESSION_ICON_SRC[kind]}
      width={size}
      height={size}
      alt={label ?? SESSION_ICON_NAME[kind]}
      decoding="async"
      draggable={false}
      className={`wm-sicon ${className}`}
    />
  )
}

// ─── The crest ────────────────────────────────────────────────

/**
 * THE Waymark mark (the page-08 crest). Small marks are the crisp render,
 * big ones the glyph print. It turns slowly; still under Reduce Motion.
 */
export function Crest({ big = false, width, still = false, className = '', dim = false }: { big?: boolean; width: number; still?: boolean; className?: string; dim?: boolean }) {
  const reduced = useReducedMotion()
  return (
    <img
      src={big ? crestBig : crestSmall}
      width={width}
      height={Math.round(width * 1.12)}
      alt="Waymark"
      decoding="async"
      draggable={false}
      className={`wm-crest${still || reduced ? ' is-still' : ''} ${className}`}
      style={dim ? { opacity: 0.55, filter: 'grayscale(0.4) drop-shadow(0 0 6px rgba(184,152,74,.25))' } : undefined}
    />
  )
}

// ─── Boards ───────────────────────────────────────────────────

export type BoardEdge = 'none' | 'good' | 'bad' | 'brass'

export interface BoardProps {
  /** Small Cinzel heading on the board (gold). */
  head?: ReactNode
  /** Right side of the heading row. */
  headRight?: ReactNode
  edge?: BoardEdge
  solid?: boolean
  className?: string
  children?: ReactNode
  onClick?: () => void
}

/** A board: glass with brass rivets, reduced opacity over the world. */
export function Board({ head, headRight, edge = 'none', solid = false, className = '', children, onClick }: BoardProps) {
  const cls = ['wm-board', solid ? 'is-solid' : '', edge !== 'none' ? `is-${edge}` : '', className].filter(Boolean).join(' ')
  const content = (
    <>
      {(head || headRight) && (
        <div className="wm-board-head">
          <span>{head}</span>
          {headRight}
        </div>
      )}
      {children}
    </>
  )
  if (onClick) {
    return (
      <div role="button" tabIndex={0} className={cls} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}>
        {content}
      </div>
    )
  }
  return <div className={cls}>{content}</div>
}

export interface CentredCardProps extends Omit<BoardProps, 'onClick' | 'solid'> {
  /** Tap on the scrim (outside the card). Omit to make the card modal. */
  onDismiss?: () => void
  /** One line under the heading. */
  sub?: ReactNode
  /** Accessible name for the dialog. */
  label: string
}

/** Every selection sits in the centre of the screen (no bottom sheets). */
export function CentredCard({ onDismiss, sub, label, head, headRight, edge, className = '', children }: CentredCardProps) {
  useEffect(() => {
    if (!onDismiss) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])
  return (
    <div className="wm-scrim" onClick={e => { if (e.target === e.currentTarget) onDismiss?.() }}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`wm-board is-solid wm-card ${edge && edge !== 'none' ? `is-${edge}` : ''} ${className}`}>
        {(head || headRight) && (
          <div className="wm-board-head">
            <span>{head}</span>
            {headRight}
          </div>
        )}
        {sub && <p className="wm-card-sub">{sub}</p>}
        {children}
      </div>
    </div>
  )
}

// ─── Buttons, chips, tiles ────────────────────────────────────

export interface FlapButtonProps {
  label: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  primary?: boolean
  quiet?: boolean
  disabled?: boolean
  size?: FlapSize
  tone?: FlapTone
  type?: 'button' | 'submit'
  className?: string
  /** Extra content before the label (an icon). */
  leading?: ReactNode
}

/** A flap label on a board. Primary = brass tiles. */
export function FlapButton({ label, onClick, primary = false, quiet = false, disabled = false, size, tone, type = 'button', className = '', leading }: FlapButtonProps) {
  const cls = ['wm-btn', primary ? 'is-primary' : '', quiet ? 'is-quiet' : '', className].filter(Boolean).join(' ')
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} aria-label={label}>
      {leading}
      <FlapLabel text={label} size={size ?? (primary ? 'md' : 'sm')} tone={tone ?? (primary ? 'gold' : 'ink')} fit />
    </button>
  )
}

/** One short flap word, tappable. */
export function FlapChip({ label, onClick, tone = 'ink', leading, className = '', disabled = false }: { label: string; onClick?: () => void; tone?: FlapTone; leading?: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button type="button" className={`wm-chip ${className}`} onClick={onClick} aria-label={label} disabled={disabled}>
      {leading}
      <FlapLabel text={label} size="xs" tone={tone} />
    </button>
  )
}

/** A single flap tile holding anything (a digit, an icon). */
export function FlapTile({ children, size = 46, className = '' }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <span className={`wm-tile ${className}`} style={{ width: size, height: size }}>
      {children}
    </span>
  )
}

export interface TileOption<T> {
  value: T
  label: string
  /** A small word under the flap ("easy", "deep"). */
  sub?: string
  tone?: FlapTone
  /** A small colour bar under the label (soreness key colours). */
  swatch?: string
}

/** Big choice tiles: one tap answers (check-in, effort, class type). */
export function TileChoice<T extends string | number>({
  options,
  selected,
  onPick,
  columns,
  refused,
  size = 'md',
  label,
}: {
  options: ReadonlyArray<TileOption<T>>
  selected?: T | null
  onPick: (value: T) => void
  columns?: number
  /** A value the server refused (clay). */
  refused?: T | null
  size?: FlapSize
  label: string
}) {
  const cols = columns ?? Math.min(options.length, 5)
  return (
    <div className="wm-tiles" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const on = selected === o.value
        const isRefused = refused === o.value
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            aria-label={o.sub ? `${o.label}, ${o.sub}` : o.label}
            className={`wm-choice${on ? ' is-on' : ''}${isRefused ? ' is-refused' : ''}`}
            onClick={() => onPick(o.value)}
          >
            <FlapLabel text={o.label} size={size} tone={isRefused ? 'clay' : on ? 'gold' : (o.tone ?? 'ink')} />
            {o.sub && <span className="wm-choice-sub">{o.sub}</span>}
            {o.swatch && <span aria-hidden style={{ width: 22, height: 4, borderRadius: 2, background: o.swatch }} />}
          </button>
        )
      })}
    </div>
  )
}

// ─── AM / PM ──────────────────────────────────────────────────

const SUN = (
  <svg viewBox="0 0 16 16" fill="#c9a656" aria-hidden>
    <circle cx="8" cy="8" r="3.3" />
    <g stroke="#c9a656" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 1.2v1.9M8 12.9v1.9M1.2 8h1.9M12.9 8h1.9M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M3.2 12.8l1.3-1.3M11.5 4.5l1.3-1.3" />
    </g>
  </svg>
)
const MOON = (
  <svg viewBox="0 0 16 16" fill="#c9a656" aria-hidden>
    <path d="M10.6 1.6A6.6 6.6 0 1 0 14.4 12 5.5 5.5 0 0 1 10.6 1.6z" />
  </svg>
)

/**
 * AM is a teal flap, PM a clay flap, with a small brass sun or moon to the
 * left (page 26, option 1). On a picker row, tapping flips it.
 */
export function AmPmFlap({ slot, onChange, size = 'sm' }: { slot: 'am' | 'pm'; onChange?: (next: 'am' | 'pm') => void; size?: FlapSize }) {
  const text = slot === 'am' ? 'AM' : 'PM'
  return (
    <button
      type="button"
      className="wm-ampm"
      disabled={!onChange}
      aria-label={onChange ? `${text}, tap for ${slot === 'am' ? 'PM' : 'AM'}` : text}
      onClick={e => { e.stopPropagation(); onChange?.(slot === 'am' ? 'pm' : 'am') }}
    >
      {slot === 'am' ? SUN : MOON}
      <FlapLabel text={text} size={size} tone={slot === 'am' ? 'teal' : 'clay'} />
    </button>
  )
}

/** The AM / PM group header on Today: the same mark and flap, not tappable. */
export function AmPmHeader({ slot }: { slot: 'am' | 'pm' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 4px' }}>
      <AmPmFlap slot={slot} size="xs" />
    </div>
  )
}

// ─── ON / OFF switch ──────────────────────────────────────────

/**
 * Every switch is a flap that reads ON (teal) or OFF (page 37's TOG): the bare
 * flap, no box and no padding tile. The tap area reaches past the flap (44 pt)
 * without changing the row's layout.
 */
export function FlapSwitch({ on, onChange, label, disabled = false }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      style={{ position: 'relative', display: 'inline-flex', flex: 'none', padding: 0, border: 0, background: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
      onClick={e => { e.stopPropagation(); onChange(!on) }}
    >
      <span aria-hidden style={{ position: 'absolute', inset: '-13px -8px' }} />
      <FlapLabel text={on ? 'ON' : 'OFF'} size="sm" tone={on ? 'teal' : 'dim'} />
    </button>
  )
}

// ─── Number drum (▲ ▼) ────────────────────────────────────────

/** A number on flap tiles with big ▲ / ▼ (test entries, times). */
export function FlapDrum({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  unit,
  label,
  format = (v: number) => String(v),
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  label: string
  format?: (v: number) => string
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const arrow = 'wm-btn'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} role="group" aria-label={label}>
      <button type="button" className={arrow} style={{ width: 64, minHeight: 64 }} aria-label={`${label} down`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
        <FlapLabel text="▼" size="sm" animate={false} />
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8 }} aria-live="polite">
        <FlapLabel text={format(value)} size="lg" tone="gold" />
        {unit && <span className="wm-label">{unit}</span>}
      </div>
      <button type="button" className={arrow} style={{ width: 64, minHeight: 64 }} aria-label={`${label} up`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
        <FlapLabel text="▲" size="sm" animate={false} />
      </button>
    </div>
  )
}

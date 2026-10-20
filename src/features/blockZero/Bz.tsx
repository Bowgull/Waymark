import type { ReactNode } from 'react'

import { FlapLabel, useDismissLayer } from '@/design'

import './blockZero.css'

// Page 45's small pieces for the check-in cards.

/** Progress dots: teal when done, gold for the one now. */
export function BzDots({ n, now, done }: { n: number; now: number; done: (i: number) => boolean }) {
  return (
    <div className="bz-dots" aria-hidden>
      {Array.from({ length: n }, (_, i) => <i key={i} className={done(i) ? 'is-done' : i === now ? 'is-now' : ''} />)}
    </div>
  )
}

export interface BzTileOption<T> {
  value: T
  label: string
  sub?: string
  /** A colour square instead of the flap (soreness, the Ledger's colours). */
  swatch?: string
}

/** Big tiles (page 45 .tiles / .tl): a flap and a small word; the picked one gold. */
export function BzTiles<T extends string | number>({ options, selected, onPick, columns, label }: { options: ReadonlyArray<BzTileOption<T>>; selected: T | null | undefined; onPick: (v: T) => void; columns: number; label: string }) {
  return (
    <div className="bz-tiles" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const on = selected === o.value
        return (
          <button
            key={String(o.value)}
            type="button"
            className={`bz-tl${on ? ' is-on' : ''}${o.swatch ? ' is-sw' : ''}`}
            aria-pressed={on}
            aria-label={o.sub ? `${o.label}, ${o.sub}` : o.label}
            onClick={() => onPick(o.value)}
          >
            {o.swatch ? <span className="sw" style={{ background: o.swatch }} /> : <FlapLabel text={o.label} size="md" tone={on ? 'gold' : 'ink'} />}
            {o.sub && <small>{o.sub}</small>}
          </button>
        )
      })}
    </div>
  )
}

/** The centred column over the veil. A tap on the veil around it closes it (page 61), when it can close. */
export function BzOverlay({ className = '', label, children, onDismiss }: { className?: string; label: string; children: ReactNode; onDismiss?: () => void }) {
  useDismissLayer(onDismiss != null, onDismiss)
  return (
    <div className={`bz-overlay ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={e => { if (onDismiss && (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('bz-col'))) onDismiss() }}>
      <div className="bz-col">{children}</div>
    </div>
  )
}

import type { RuneState } from '@/lib/coach/changes'

import './coach.css'

// The day runes (page 56 §0, approved 2026-10-19), carved like the app's
// rune-stone buttons: straight strokes with squared ends, a dark groove under
// a lit cut. Dagaz ᛞ (teal): the coach changed this day. Nauthiz ᚾ (ember): a
// missed session. New: a soft pulse; seen: dim and still; no pulse under
// reduced motion (coach.css).
const GLYPH = {
  dagaz: 'M2.5 2v16M13.5 2v16M2.5 2l11 16M13.5 2l-11 16',
  nauthiz: 'M8 1.5v17M4 6.5l8 6',
} as const

/** tile: 15 × 19 at the foot of a day tile; row: 10 × 13 by a row's minutes; log: 9 × 12 in the week log. */
export function Rune({ state, size, className = '' }: { state: RuneState; size: 'tile' | 'row' | 'log'; className?: string }) {
  const d = GLYPH[state === 'miss' || state === 'missseen' ? 'nauthiz' : 'dagaz']
  const place = size === 'tile' ? 'wm-rn' : size === 'row' ? 'wm-rmk' : 'wm-lrn'
  return (
    <span className={`wm-rune ${place} is-${state} ${className}`.trim()} aria-hidden>
      <svg viewBox="0 0 16 20">
        <path className="groove" d={d} />
        <path className="cut" d={d} />
        <path className="chip" d={d} transform="translate(-.5 -.6)" />
      </svg>
    </span>
  )
}

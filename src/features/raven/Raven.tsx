import { useId } from 'react'

import './raven.css'

/**
 * The raven (page 58, approved 2026-10-19): the coach's messenger for the
 * body, painted like the session icons (three hard bands, one light from the
 * upper left, a brass eye). It carries a rolled note with a brass band and a
 * plain wax seal, no rune (so it can't be read as Algiz or Dagaz).
 *
 *   fly: arriving, wings up, a 1.9 s flight path onto the Morning Report
 *   watch: the note is unread; it looks round every 5.5 s and the seal glows
 *   held: read; perched and still
 *   settled: a teal seal, the day it clears
 *   leave: it flies off, the day after
 *
 * Still under Reduce Motion (raven.css).
 */
export type RavenState = 'fly' | 'watch' | 'held' | 'settled' | 'leave'

export function RavenSvg() {
  const id = useId().replace(/:/g, '')
  const body = `rvBody${id}`, wing = `rvWing${id}`
  return (
    <svg viewBox="0 0 64 56" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stopColor="#3a464c" /><stop offset=".38" stopColor="#3a464c" /><stop offset=".39" stopColor="#232b30" /><stop offset=".72" stopColor="#232b30" /><stop offset=".73" stopColor="#14191c" /></linearGradient>
        <linearGradient id={wing} x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stopColor="#40585a" /><stop offset=".34" stopColor="#40585a" /><stop offset=".35" stopColor="#26343a" /><stop offset=".7" stopColor="#26343a" /><stop offset=".71" stopColor="#151b1f" /></linearGradient>
      </defs>
      <path d="M37 33 L62 42 L61 45.5 L57.5 44.5 L59 48.5 L55 47.5 L35 39Z" fill="#161c1f" />
      <path d="M14 22 C13 13 21 9 28 11 C38 14 46 24 43 34 C41 41 31 43 24 40 C17 37 14 30 14 22Z" fill={`url(#${body})`} />
      <path d="M16 30 C19 38 27 41 35 40 C28 43 19 41 15.5 33Z" fill="#0c1012" />
      <g className="rv-wing"><path d="M21 19 C31 15 43 21 50 36 C42 38.5 31 37 25 30Z" fill={`url(#${wing})`} /><path d="M29 24.5 L45 34.6 M27 28 L40 36 M33 22.5 L47 31.5" stroke="#0b0f11" strokeWidth=".9" fill="none" /></g>
      <path className="rv-wup" d="M24 21 C21 8 30 -3 47 -5 C43 -1 47 0 52 0 C46 3 49 5 54 6 C47 8.5 48 11.5 52 13.5 C42 15.5 34 19 30 26Z" fill={`url(#${wing})`} />
      <path d="M7 16 C7 9 12 5 18 6 C23 7 26 11 24 17 C21 20.5 13 21.5 7 16Z" fill={`url(#${body})`} />
      <path d="M8.2 10.6 L0 15 L8.6 17.6Z" fill="#2a2e31" /><path d="M8.2 10.6 L1 14.6" stroke="#6a7276" strokeWidth=".8" />
      <path d="M9 18 l2 3.4 l1.2-2.6 l2 3.4 l1.2-3.2 l2 2.8 l.6-3" fill="#161c1f" />
      <circle cx="12.6" cy="11.4" r="1.45" fill="#e8c878" /><circle cx="13" cy="11" r=".5" fill="#fff6d8" />
      <path d="M17 12 C24 10.6 33 14.5 38.5 21" stroke="#5b8a86" strokeWidth="1.1" fill="none" opacity=".75" />
      <g className="rv-legs">
        <path d="M25 40 L24 49 M30 40 L30 49" stroke="#2b2d2f" strokeWidth="1.7" /><path d="M20.5 49.2 h7 M26.5 49.2 h7" stroke="#2b2d2f" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="18.5" y="41.6" width="16" height="5.4" rx="2.7" fill="#e6dab4" /><rect x="18.5" y="41.6" width="16" height="2" rx="1" fill="#f4ecd0" opacity=".7" /><rect x="22" y="41.6" width="1.6" height="5.4" fill="#b8984a" />
        <circle className="rv-seal" cx="27" cy="44.5" r="3.9" fill="#a8603e" /><circle cx="26.2" cy="43.6" r="1.3" fill="rgba(255,230,190,.35)" />
      </g>
    </svg>
  )
}

/** The raven perched on the Morning Report's top edge. A tap opens what it brought. */
export function Raven({ state, onTap, label }: { state: RavenState; onTap?: () => void; label: string }) {
  return (
    <button type="button" className={`rv-raven is-${state}`} aria-label={label} onClick={e => { e.stopPropagation(); onTap?.() }}>
      <RavenSvg />
    </button>
  )
}

/** The small, still raven in the top-left corner of every board it brings (teal-sealed on the good news). */
export function RavenMark({ settled = false }: { settled?: boolean }) {
  return (
    <span className="rv-mark" aria-hidden="true">
      <span className={`rv-raven is-${settled ? 'settled' : 'held'}`}><RavenSvg /></span>
    </span>
  )
}

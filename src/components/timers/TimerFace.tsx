import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { FlapLabel, useReducedMotion, type FlapTone } from '@/design'
import { SessionEndedContext } from './endedContext'
import { roundClockText } from '@/lib/timers/bagRound'
import { clockDigits, HEAT_RED_SCALE, heroPx, swellBreath, swellK, swellStyle, trackRemainingMs, type Heat, type TimerKind, type TimerTrack } from '@/lib/timers/timerLook'

interface TimerFaceProps {
  /** Whole seconds shown. */
  seconds: number
  kind: TimerKind
  /** Work timers, last 10 s. */
  heat?: Heat | null
  /** Digits tone outside the heat: ink while working, teal for holds and rest. */
  tone?: 'ink' | 'teal'
  /** The phase word under the clock (FIGHT, REST, HOLD…). */
  label?: string
  labelTone?: FlapTone
  /** For the 5 s swell of holds and rest. */
  track?: TimerTrack
  /** Page 31 spacing (clock 16 px down, 110 tall, phase 10 px under) instead of page 19's (18, 118, 12). */
  compact?: boolean
  /** Page 74 (a run, the content fills the page): bigger flaps (84 px), the clock and phase spaced by the parent. */
  big?: boolean
}

/**
 * The calm split-flap clock (page 19 #1): MM:SS on four xl flap tiles, the
 * colon on its own tile. Each second only the digit that changes flips once,
 * the short way, through digits. Work timers heat yellow, orange, red in the
 * last 10 s (digits and the phase word; the clock grows 6% at red); holds and
 * rest swell, brighten and breathe from 5 s out.
 */
export function TimerFace({ seconds: liveSeconds, kind, heat, tone = 'ink', label: liveLabel, labelTone = 'gold', track, compact = false, big = false }: TimerFaceProps) {
  // Held × (page 19): the clock stops where it was and the phase word flips to ENDED.
  const ended = useContext(SessionEndedContext)
  const [stoppedAt, setStoppedAt] = useState<number | null>(null)
  if (ended && stoppedAt == null) setStoppedAt(liveSeconds)
  const seconds = ended && stoppedAt != null ? stoppedAt : liveSeconds
  const label = ended ? 'ENDED' : liveLabel
  const reduced = useReducedMotion()
  const clockRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<HTMLDivElement>(null)
  const live = useRef(track)
  useLayoutEffect(() => { live.current = track })
  const calm = kind !== 'work'
  const nearEnd = calm && track != null && seconds <= 6 && seconds > 0

  useClockSwell(clockRef, phaseRef, nearEnd, kind, live, reduced)

  const d = clockDigits(seconds)
  const digitClass = heat ? `is-${heat}` : ''
  const digitTone: FlapTone = heat ? 'ink' : tone
  const red = heat === 'hr'
  return (
    <>
      <div
        ref={clockRef}
        className={`tm-clock${compact ? ' is-compact' : ''}${big ? ' is-big' : ''}${red ? ' is-red' : ''}`}
        data-no-cascade
        role="timer"
        aria-label={`${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`}
        style={red ? { transform: `scale(${HEAT_RED_SCALE})` } : undefined}
      >
        <FlapLabel text={d[0]} size="xl" tone={digitTone} className={digitClass} />
        <FlapLabel text={d[1]} size="xl" tone={digitTone} className={digitClass} />
        <FlapLabel text=":" size="xl" animate={false} />
        <FlapLabel text={d[2]} size="xl" tone={digitTone} className={digitClass} />
        <FlapLabel text={d[3]} size="xl" tone={digitTone} className={digitClass} />
      </div>
      {label && (
        <div ref={phaseRef} className={`tm-phase${compact ? ' is-compact' : ''}${big ? ' is-big' : ''}`}>
          <FlapLabel text={label} size="md" tone={heat ? 'ink' : labelTone} className={heat ? `is-${heat}` : ''} />
        </div>
      )}
    </>
  )
}

/**
 * The calm swell of holds and rest (page 19): from 5 s out the clock eases
 * into a swell, brightens and breathes. Runs every frame, only near the end.
 */
function useClockSwell(
  clockRef: React.RefObject<HTMLDivElement | null>,
  phaseRef: React.RefObject<HTMLDivElement | null>,
  nearEnd: boolean,
  kind: TimerKind,
  live: React.RefObject<TimerTrack | undefined>,
  reduced: boolean,
) {
  useEffect(() => {
    const ck = clockRef.current, ph = phaseRef.current
    if (!ck) return
    if (!nearEnd || reduced) { ck.style.transform = ''; ck.style.filter = ''; if (ph) ph.style.filter = ''; return }
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const tr = live.current
      if (!tr) return
      const br = swellBreath(swellK(trackRemainingMs(tr) / 1000, kind), Date.now())
      if (br <= 0) { ck.style.transform = ''; ck.style.filter = ''; if (ph) ph.style.filter = ''; return }
      const s = swellStyle(br)
      ck.style.transform = `scale(${s.scale.toFixed(4)})`
      ck.style.filter = `brightness(${s.brightness.toFixed(3)}) drop-shadow(0 0 ${s.glowPx.toFixed(1)}px rgba(120,220,190,${s.glowAlpha.toFixed(2)}))`
      if (ph) ph.style.filter = `brightness(${(1 + 0.3 * br).toFixed(3)})`
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ck.style.transform = ''; ck.style.filter = ''; if (ph) ph.style.filter = '' }
  }, [clockRef, phaseRef, live, nearEnd, kind, reduced])
}

interface RoundClockProps {
  /** Whole seconds shown. */
  seconds: number
  kind: TimerKind
  /** Work timers, last 10 s. */
  heat?: Heat | null
  /** Digits tone outside the heat: ink while working, teal in rest. */
  tone?: 'ink' | 'teal'
  /** For the 5 s swell of rest. */
  track?: TimerTrack
  /** Font size of the tiles (page 55: 84). */
  px?: number
}

/**
 * The bag round's clock (page 55 layout 1): M:SS on bare flap tiles, no box,
 * 84 px, standing on the grass beside the round. The same heat (yellow,
 * orange, red; 6% bigger at red) and rest swell as the calm clock. Held ×:
 * it stops where it was.
 */
export function RoundClock({ seconds: liveSeconds, kind, heat, tone = 'ink', track, px = 84 }: RoundClockProps) {
  const ended = useContext(SessionEndedContext)
  const [stoppedAt, setStoppedAt] = useState<number | null>(null)
  if (ended && stoppedAt == null) setStoppedAt(liveSeconds)
  const seconds = ended && stoppedAt != null ? stoppedAt : liveSeconds
  const reduced = useReducedMotion()
  const clockRef = useRef<HTMLDivElement>(null)
  const noPhase = useRef<HTMLDivElement>(null)
  const live = useRef(track)
  useLayoutEffect(() => { live.current = track })
  const nearEnd = kind !== 'work' && track != null && seconds <= 6 && seconds > 0
  useClockSwell(clockRef, noPhase, nearEnd, kind, live, reduced)
  const text = roundClockText(seconds)
  // A rare 10:00+ clock steps down so the pair still fits a phone's width.
  const size = text.length > 4 ? Math.round(px * 0.8) : px
  const red = heat === 'hr'
  return (
    <div
      ref={clockRef}
      className={`tm-rclock${red ? ' is-red' : ''}`}
      data-no-cascade
      role="timer"
      aria-label={`${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`}
      style={{ fontSize: size, transform: red ? `scale(${HEAT_RED_SCALE})` : undefined }}
    >
      <FlapLabel text={text} size="xl" tone={heat ? 'ink' : tone} className={heat ? `is-${heat}` : ''} />
    </div>
  )
}

// ─── Page 84: every timer, the new way ────────────────────────
// Top to bottom: the phase word (md, 26 px), the clock as the hero in the
// phase colour (M:SS, no leading zero), the count in the bag round's language
// (ROUND gold / NEXT teal, the number on an xl flap sized to its digits, OF 6),
// then a small mono NEXT and time-left line. The grass stays at the bottom and
// nothing sits on it (TimerColumn keeps the column above it).

/** The clock's colour (page 84 `.tm` --clk): gold work, teal rest and holds, clay, the timer's orange, paused, the finisher's red (page 86). */
export type HeroTint = 'work' | 'rest' | 'clay' | 'warn' | 'pause' | 'red'


interface HeroClockProps {
  seconds: number
  kind: TimerKind
  /** Work timers, last 10 s: yellow, orange, red (red grows 6%). */
  heat?: Heat | null
  tint?: HeroTint
  /** For the 5 s swell of holds and rest. */
  track?: TimerTrack
  /** 120 (nothing else to read), 112 Run-Walk, 104 holds, 96 hard runs, 92 bag. */
  px?: number
}

/**
 * The hero clock (page 84): M:SS on xl flap tiles in the phase colour, the
 * colon between them. Heat, the rest / hold swell and the held-× freeze are
 * the calm clock's. Only the digit that changes flips.
 */
export function HeroClock({ seconds: liveSeconds, kind, heat, tint = 'work', track, px = 120 }: HeroClockProps) {
  const ended = useContext(SessionEndedContext)
  const [stoppedAt, setStoppedAt] = useState<number | null>(null)
  if (ended && stoppedAt == null) setStoppedAt(liveSeconds)
  const seconds = ended && stoppedAt != null ? stoppedAt : liveSeconds
  const reduced = useReducedMotion()
  const clockRef = useRef<HTMLDivElement>(null)
  const noPhase = useRef<HTMLDivElement>(null)
  const live = useRef(track)
  useLayoutEffect(() => { live.current = track })
  const nearEnd = kind !== 'work' && track != null && seconds <= 6 && seconds > 0
  useClockSwell(clockRef, noPhase, nearEnd, kind, live, reduced)
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const m = String(Math.floor(s / 60)), ss = String(s % 60).padStart(2, '0')
  const red = heat === 'hr'
  const digit = heat ? `is-${heat}` : ''
  return (
    <div
      ref={clockRef}
      className={`tm-hero t-${tint}${heat ? ' is-heat' : ''}${red ? ' is-red' : ''}`}
      data-no-cascade
      role="timer"
      aria-label={`${Math.floor(s / 60)} minutes ${s % 60} seconds`}
      style={{ '--px': `${heroPx(px, s)}px`, transform: red ? `scale(${HEAT_RED_SCALE})` : undefined } as CSSProperties}
    >
      <FlapLabel text={m} size="xl" className={digit} />
      <span className="tm-hero-colon" aria-hidden>:</span>
      <FlapLabel text={ss} size="xl" className={digit} />
    </div>
  )
}

/**
 * The phase word over the clock (page 84, md at 26 px): FIGHT, REST, HOLD...
 * Held through it reads ENDED (clay). A new word settles in (no letter flips).
 */
export function PhaseWord({ text, tone = 'gold', className = '' }: { text: string; tone?: FlapTone; className?: string }) {
  const ended = useContext(SessionEndedContext)
  const word = ended ? 'ENDED' : text
  return (
    <div className="tm-word">
      <span key={word + tone + className} className="tm-settle">
        <FlapLabel text={word} size="md" tone={ended ? 'clay' : className ? 'ink' : tone} className={ended ? '' : className} animate={false} />
      </span>
    </div>
  )
}

/**
 * The count in the bag round's language (page 84): ROUND (gold) while working,
 * NEXT (teal) while resting, the number on an xl flap sized to its digits,
 * then OF 6. `beside` is the bag's column next to its clock (the digit 58).
 */
export function CountRow({ label, n, of, tone = 'gold', beside = false, className = '' }: { label: string; n: number; of: number; tone?: 'gold' | 'teal'; beside?: boolean; className?: string }) {
  return (
    <div className={`tm-count${beside ? ' is-beside' : ''} is-${tone}`} role="img" aria-label={`${label === 'NEXT' ? 'Next' : 'Round'} ${n} of ${of}`}>
      <span className="tm-count-l">{label}</span>
      <span key={n} className="tm-settle"><FlapLabel text={String(n)} size="xl" tone={className ? 'ink' : tone} className={`tm-count-n ${className}`.trim()} animate={false} /></span>
      <small>OF {of}</small>
    </div>
  )
}

/** The small mono line under it all (page 84): "NEXT · REST 1:00 · 11:40 LEFT", resting just "9:12 LEFT". */
export function NextLine({ lead, next, left }: { /** A small word before it all (the treadmill's other unit, "7.8 mph"). */ lead?: string | null; next?: string | null; left?: string | null }) {
  const parts = [lead, next, left ? `${left} LEFT` : null].filter((p): p is string => !!p)
  if (parts.length === 0) return null
  return (
    <div className="tm-next">
      {parts.map((p, i) => <span key={i}>{i > 0 && <i aria-hidden>·</i>}{p}</span>)}
    </div>
  )
}


/**
 * The column above the grass (page 84): everything centred between the top
 * bar and the grass, with the grass's own room left empty under it, so
 * nothing ever sits on the grass. If a phone is too short for the column, the
 * clock steps down until it fits (the content above it keeps its size).
 */
export function TimerColumn({ grass = 0.44, children, className = '' }: { grass?: number; children: ReactNode; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  const kRef = useRef(1)
  useLayoutEffect(() => {
    const box = boxRef.current, inner = innerRef.current
    if (!box || !inner) return
    const fit = () => {
      const avail = box.clientHeight, need = inner.offsetHeight
      const clock = inner.querySelector<HTMLElement>('.tm-hero')
      const ch = clock?.offsetHeight ?? 0
      if (!clock || ch <= 0 || avail <= 0) return
      const excess = need - avail
      let next = kRef.current
      if (excess > 0.5) next = kRef.current * Math.max(0.5, (ch - excess) / ch)
      else if (excess < -6 && kRef.current < 1) next = Math.min(1, kRef.current * ((ch - excess - 4) / ch))
      next = Math.round(next * 1000) / 1000
      if (next !== kRef.current) { kRef.current = next; setK(next) }
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])
  return (
    <>
      <div ref={boxRef} className={`tm-gx ${className}`.trim()} style={{ '--hk': k } as CSSProperties}>
        <div ref={innerRef} className="tm-gx-in">{children}</div>
      </div>
      <div className="tm-gspace" style={{ '--gh': grass } as CSSProperties} aria-hidden />
    </>
  )
}

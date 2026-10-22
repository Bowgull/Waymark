import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { FlapLabel, useReducedMotion, type FlapTone } from '@/design'
import { SessionEndedContext } from './endedContext'
import { roundClockText } from '@/lib/timers/bagRound'
import { clockDigits, HEAT_RED_SCALE, swellBreath, swellK, swellStyle, trackRemainingMs, type Heat, type TimerKind, type TimerTrack } from '@/lib/timers/timerLook'

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

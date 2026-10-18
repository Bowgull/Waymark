import { useEffect, useLayoutEffect, useRef } from 'react'

import { FlapLabel, useReducedMotion, type FlapTone } from '@/design'
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
}

/**
 * The calm split-flap clock (page 19 #1): MM:SS on four xl flap tiles, the
 * colon on its own tile. Each second only the digit that changes flips once,
 * the short way, through digits. Work timers heat yellow, orange, red in the
 * last 10 s (digits and the phase word; the clock grows 6% at red); holds and
 * rest swell, brighten and breathe from 5 s out.
 */
export function TimerFace({ seconds, kind, heat, tone = 'ink', label, labelTone = 'gold', track, compact = false }: TimerFaceProps) {
  const reduced = useReducedMotion()
  const clockRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<HTMLDivElement>(null)
  const live = useRef(track)
  useLayoutEffect(() => { live.current = track })
  const calm = kind !== 'work'
  const nearEnd = calm && track != null && seconds <= 6 && seconds > 0

  // The swell needs every frame (it breathes), only near the end of a calm timer.
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
  }, [nearEnd, kind, reduced])

  const d = clockDigits(seconds)
  const digitClass = heat ? `is-${heat}` : ''
  const digitTone: FlapTone = heat ? 'ink' : tone
  const red = heat === 'hr'
  return (
    <>
      <div
        ref={clockRef}
        className={`tm-clock${compact ? ' is-compact' : ''}${red ? ' is-red' : ''}`}
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
        <div ref={phaseRef} className={`tm-phase${compact ? ' is-compact' : ''}`}>
          <FlapLabel text={label} size="md" tone={heat ? 'ink' : labelTone} className={heat ? `is-${heat}` : ''} />
        </div>
      )}
    </>
  )
}

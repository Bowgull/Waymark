import { useState } from 'react'
import { createPortal } from 'react-dom'

import { CloseWord, FlapLabel, useDismissLayer, prefersReducedMotion } from '@/design'
import { tapHaptic } from '@/lib/haptics'
import { padBack, padPush, padShow, padValue, stepDown, stepUp, totalLine, valueText, LIMITS, type IntervalSetup, type SetupKey } from '@/lib/timers/intervalTimer'
import { Cmd } from '@/features/plan/CommandWindow'
import { PixelCursor } from '@/features/plan/PixelCursor'
import { SessionButton } from '@/components/timers'

import '@/features/combos/combos.css'
import '@/features/plan/bagBuilder.css'
import './intervalTimer.css'

const ROWS: ReadonlyArray<{ key: SetupKey; label: string }> = [
  { key: 'rounds', label: 'ROUNDS' },
  { key: 'work', label: 'WORK' },
  { key: 'rest', label: 'REST' },
]

/**
 * The interval timer's window (page 81, with the approved fixes): the command
 * window (FFX frame, pixel cursor on the row last touched) over a dimmed
 * Settings. ROUNDS, WORK and REST on the bag builder's − value + steppers; tap
 * a value for the number pad. A plain total line, one START. A tap outside,
 * CLOSE, Escape or the edge swipe closes it.
 */
export function IntervalTimerWindow({ initial, onStart, onClose }: { initial: IntervalSetup; onStart: (s: IntervalSetup) => void; onClose: () => void }) {
  const [s, setS] = useState<IntervalSetup>(initial)
  const [closing, setClosing] = useState(false)
  const [cur, setCur] = useState<SetupKey>('rounds')
  const [pad, setPad] = useState<SetupKey | null>(null)
  const close = () => setClosing(true)
  const set = (key: SetupKey, v: number) => { setCur(key); setS(prev => ({ ...prev, [key]: v })) }
  return (
    <>
      <Cmd anchor={null} place="center" dim closing={closing} onLeft={onClose} onDismiss={close} label="Interval timer" className="it-win" stayOnScroll>
        <div className="pl-hdr it-hdr"><FlapLabel text="INTERVAL TIMER" size="sm" animate={false} /><CloseWord onClose={close} /></div>
        {ROWS.map(({ key, label }) => {
          const v = s[key]
          const name = label.charAt(0) + label.slice(1).toLowerCase()
          return (
            <div key={key} className={`bb-step it-step${cur === key ? ' is-on' : ''}`} data-k={key}>
              {cur === key && <PixelCursor />}
              <span className="lb">{label}</span>
              <button type="button" className="cmb-nudge" aria-label={`${name}: less`} disabled={v <= LIMITS[key][0]} onClick={() => set(key, stepDown(key, v))}>−</button>
              <button type="button" className="val it-val" aria-label={`${name}: ${valueText(key, v)}. Type it`} onClick={() => { setCur(key); setPad(key) }}>
                <span key={v} className="it-settle"><FlapLabel text={valueText(key, v)} size="sm" animate={false} /></span>
              </button>
              <button type="button" className="cmb-nudge" aria-label={`${name}: more`} disabled={v >= LIMITS[key][1]} onClick={() => set(key, stepUp(key, v))}>+</button>
            </div>
          )
        })}
        <p className="it-total" aria-live="polite">{totalLine(s)}</p>
        <div className="it-go">
          <SessionButton label="START" primary onClick={() => { if (!closing) { void tapHaptic(); onStart(s) } }} />
        </div>
      </Cmd>
      {pad && <NumberPad field={pad} onDone={v => { if (v != null) set(pad, v) }} onClose={() => setPad(null)} />}
    </>
  )
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bk', '0', 'ok'] as const

/**
 * The number pad (page 81): dark plates, JetBrains Mono digits, ⌫ and DONE.
 * Times type like a microwave (1 3 0 is 1:30). DONE sets it inside the limits;
 * a tap outside (or Escape, the edge swipe) leaves the number as it was.
 */
function NumberPad({ field, onDone, onClose }: { field: SetupKey; onDone: (v: number | null) => void; onClose: () => void }) {
  const [buf, setBuf] = useState('')
  const [leaving, setLeaving] = useState(false)
  const leave = (v: number | null) => {
    if (leaving) return
    onDone(v)
    setLeaving(true)
    window.setTimeout(onClose, prefersReducedMotion() ? 0 : 120)
  }
  useDismissLayer(!leaving, () => leave(null))
  const press = (k: (typeof KEYS)[number]) => {
    if (k === 'ok') { leave(padValue(field, buf)); return }
    setBuf(b => (k === 'bk' ? padBack(b) : padPush(field, b, k)))
  }
  const shown = padShow(field, buf)
  return createPortal(
    <>
      <div className="it-padv" onClick={() => leave(null)} aria-hidden />
      <div className={`it-pad${leaving ? ' is-out' : ''}`} role="dialog" aria-label={`Type ${field}`} data-pad={field}>
        <div className="it-ph">
          <FlapLabel text={field.toUpperCase()} size="xs" tone="dim" animate={false} />
          <span key={shown} className="it-settle" data-padv><FlapLabel text={shown} size="lg" animate={false} /></span>
        </div>
        <div className="it-keys">
          {KEYS.map(k => (
            <button key={k} type="button" className={`it-key${k === 'bk' ? ' is-bk' : k === 'ok' ? ' is-ok' : ''}`} aria-label={k === 'bk' ? 'Delete' : k === 'ok' ? 'Done' : k} onClick={() => press(k)}>
              {k === 'bk' ? '⌫' : k === 'ok' ? 'DONE' : k}
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}

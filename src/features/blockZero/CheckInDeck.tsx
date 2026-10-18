import { useEffect, useReducer, useRef, useState } from 'react'

import { Board, FlapButton, FlapChip, FlapLabel, TileChoice, useReducedMotion } from '@/design'
import { SORENESS_COLOURS } from '@/design/tokens'

import {
  CHECK_IN_QUESTIONS,
  checkInPayload,
  checkInReducer,
  initialCheckIn,
  type CheckInAnswers,
} from './checkInFlow'
import { readinessLine, type ReadinessIn } from './readinessLine'

export interface CheckInDeckProps {
  date: string
  existing?: CheckInAnswers | null
  /** Open on this card (editing one answer from the collapsed card). */
  startAt?: number
  /** Saves the body; resolves with today's readiness (or null when unknown). */
  onSubmit: (body: Record<string, unknown>) => Promise<ReadinessIn | null>
  /** Closed: saved true after a save, false when skipped. */
  onClose: (saved: boolean) => void
  /** Skip the whole thing for today (first-open cards only). */
  onSkipToday?: () => void
  /** Design gallery only: open on the closing line. */
  previewSettled?: ReadinessIn | null
}

const SETTLE_MS = 1800
const SWIPE_PX = 60

/**
 * The morning check-in: centred swipe cards, one question each. A tap answers
 * and moves on; swipe left passes a question, swipe right goes back. At the
 * end: one line (the readiness read), then Today.
 */
export function CheckInDeck({ date, existing, startAt = 0, onSubmit, onClose, onSkipToday, previewSettled }: CheckInDeckProps) {
  const [state, dispatch] = useReducer(checkInReducer, undefined, () => initialCheckIn(existing, startAt))
  const [phase, setPhase] = useState<'cards' | 'saving' | 'settled' | 'error'>(previewSettled !== undefined ? 'settled' : 'cards')
  const [line, setLine] = useState<ReturnType<typeof readinessLine>>(() => (previewSettled ? readinessLine(previewSettled) : null))
  const reduced = useReducedMotion()
  const touch = useRef<{ x: number; y: number } | null>(null)
  const submitted = useRef(false)

  // The last card answered: save once, then show the line for a moment.
  useEffect(() => {
    if (!state.done || submitted.current) return
    submitted.current = true
    let alive = true
    ;(async () => {
      setPhase('saving')
      try {
        const readiness = await onSubmit(checkInPayload(state, date))
        if (!alive) return
        setLine(readinessLine(readiness))
        setPhase('settled')
      } catch {
        if (!alive) return
        submitted.current = false
        setPhase('error')
      }
    })()
    return () => { alive = false }
  }, [state, date, onSubmit])

  // A calm moment on the line, then Today (tap skips the wait).
  useEffect(() => {
    if (phase !== 'settled' || previewSettled !== undefined) return
    const t = setTimeout(() => onClose(true), reduced ? 1200 : SETTLE_MS)
    return () => clearTimeout(t)
  }, [phase, onClose, reduced, previewSettled])

  const q = CHECK_IN_QUESTIONS[Math.min(state.index, CHECK_IN_QUESTIONS.length - 1)]
  const total = CHECK_IN_QUESTIONS.length

  function onPointerDown(e: React.PointerEvent) {
    touch.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerUp(e: React.PointerEvent) {
    const start = touch.current
    touch.current = null
    if (!start || phase !== 'cards' || state.askingBackNotes) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
    dispatch(dx < 0 ? { type: 'pass' } : { type: 'back' })
  }

  return (
    <div className="wm-scrim" style={{ background: 'rgba(2,8,6,.82)' }} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="wm-card" role="dialog" aria-modal="true" aria-label="Morning check-in" style={{ gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
          <span className="wm-board-head" style={{ margin: 0 }}>Morning check-in</span>
          {phase === 'cards' && (
            <button
              type="button"
              className="wm-label"
              style={{ minHeight: 44, padding: '0 4px', background: 'none', border: 0, cursor: 'pointer' }}
              onClick={() => { onSkipToday?.(); onClose(false) }}
            >
              {onSkipToday ? 'Skip today ›' : 'Close ›'}
            </button>
          )}
        </div>

        {phase === 'cards' && (
          <>
            <div className="wm-dots" aria-hidden>
              {CHECK_IN_QUESTIONS.map((x, i) => (
                <i key={x.key} className={i < state.index ? 'is-done' : i === state.index ? 'is-now' : ''} />
              ))}
            </div>

            {state.askingBackNotes ? (
              <Board solid head={`${state.index + 1} of ${total} · back today`}>
                <FlapLabel text="WHAT BOTHERS IT?" size="md" animate="mount" />
                <p className="wm-prose is-dim" style={{ margin: '8px 0 10px' }}>Which movements, where. The coach swaps in easier versions.</p>
                <textarea
                  className="wm-input"
                  rows={3}
                  maxLength={500}
                  value={state.backNotes}
                  placeholder="Bending forward, sitting long"
                  onChange={e => dispatch({ type: 'backNotes', text: e.target.value })}
                />
                <div className="wm-btns" style={{ marginTop: 10 }}>
                  <FlapButton label="BACK" onClick={() => dispatch({ type: 'back' })} />
                  <FlapButton label="NEXT" primary onClick={() => dispatch({ type: 'finishNotes' })} />
                </div>
              </Board>
            ) : (
              <Board solid key={q.key} head={`${state.index + 1} of ${total}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  <FlapLabel text={q.title} size="md" animate="mount" />
                  {q.sub && <p className="wm-prose is-dim">{q.sub}</p>}
                </div>
                <TileChoice
                  label={q.title}
                  columns={q.columns}
                  options={q.options.map((o, i) => ({
                    value: o.value,
                    label: o.label,
                    sub: o.sub,
                    // Soreness tiles carry the Ledger key colours.
                    ...(q.key === 'soreness' ? { swatch: SORENESS_COLOURS[i] } : {}),
                  }))}
                  selected={state.answers[q.key] ?? null}
                  onPick={v => dispatch({ type: 'answer', key: q.key, value: v })}
                />
              </Board>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
              <FlapChip label="‹ BACK" onClick={() => dispatch({ type: 'back' })} disabled={state.index === 0 && !state.askingBackNotes} />
              <span className="wm-prose is-dim" style={{ textAlign: 'center' }}>Tap one. It moves on.</span>
              <FlapChip label="PASS ›" onClick={() => dispatch({ type: 'pass' })} />
            </div>
          </>
        )}

        {phase === 'saving' && (
          <Board solid head="Checked in">
            <p className="wm-prose">Saving.</p>
          </Board>
        )}

        {phase === 'error' && (
          <Board solid edge="bad" head="Checked in">
            <FlapLabel text="COULDN'T SAVE" size="sm" tone="clay" />
            <p className="wm-prose" style={{ marginTop: 8 }}>Check your connection. Your answers are still here.</p>
            <div className="wm-btns" style={{ marginTop: 12 }}>
              <FlapButton label="CLOSE" onClick={() => onClose(false)} />
              <FlapButton label="TRY AGAIN" primary onClick={() => { dispatch({ type: 'jump', index: total - 1 }); setPhase('cards') }} />
            </div>
          </Board>
        )}

        {phase === 'settled' && (
          <Board solid edge={line?.tone === 'bad' ? 'bad' : 'good'} head="Checked in" onClick={() => onClose(true)}>
            <div style={{ animation: reduced ? undefined : 'wm-settle 700ms var(--ease-out) both' }}>
              <FlapLabel text={line ? (line.tone === 'bad' ? 'EASING TODAY' : 'GOOD TO GO') : 'LOGGED'} size="md" tone={line?.tone === 'bad' ? 'clay' : 'teal'} animate="mount" />
              {line && <p className="wm-prose" style={{ marginTop: 10 }}>{line.why}</p>}
              <p className="wm-prose is-dim" style={{ marginTop: 10 }}>Tap to go to Today.</p>
            </div>
          </Board>
        )}
      </div>
    </div>
  )
}

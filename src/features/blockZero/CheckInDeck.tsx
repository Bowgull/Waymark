import { useEffect, useReducer, useRef, useState } from 'react'

import { Board, FlapButton, FlapLabel, showPop } from '@/design'
import { SORENESS_COLOURS } from '@/design/tokens'
import { apiFetch, idempotencyHeaders } from '@/lib/api'

import { BzDots, BzOverlay, BzTiles } from './Bz'
import {
  CHECK_IN_QUESTIONS,
  checkInPayload,
  checkInReducer,
  initialCheckIn,
  noteDayLabel,
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
  /** Today's note on the daily log (+ ADD NOTE edits it). */
  note?: string | null
  /** The daily log after a note was saved. */
  onNoteSaved?: (log: unknown) => void
  /** Design gallery only: open on the verdict. */
  previewSettled?: ReadinessIn | null
}

const SWIPE_PX = 60

/**
 * The morning check-in (page 45, "Morning check-in cards"): a centred board
 * over the dimmed Today, one question each. A tap answers and moves on; swipe
 * left passes, swipe right goes back. The last board is the verdict (EASING
 * TODAY clay / GOOD TO GO teal) with its line, then + ADD NOTE (the daily
 * log's note) and TO TODAY.
 */
export function CheckInDeck({ date, existing, startAt = 0, onSubmit, onClose, onSkipToday, note, onNoteSaved, previewSettled }: CheckInDeckProps) {
  const [state, dispatch] = useReducer(checkInReducer, undefined, () => initialCheckIn(existing, startAt))
  const [phase, setPhase] = useState<'cards' | 'saving' | 'settled' | 'error'>(previewSettled !== undefined ? 'settled' : 'cards')
  const [line, setLine] = useState<ReturnType<typeof readinessLine>>(() => (previewSettled ? readinessLine(previewSettled) : null))
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState(note ?? '')
  const [noteSaving, setNoteSaving] = useState(false)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const submitted = useRef(false)

  // The last card answered: save once, then the verdict.
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

  // + ADD NOTE: the daily log's note field (POST /api/daily-logs only writes the keys it is sent).
  async function saveNote() {
    setNoteSaving(true)
    try {
      const log = await apiFetch('/api/daily-logs', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ date, notes: noteText.trim() || null }) })
      onNoteSaved?.(log)
      setNoteOpen(false)
      showPop('Saved.', 'good')
    } catch {
      showPop("Couldn't save. Check your connection.", 'bad')
    } finally {
      setNoteSaving(false)
    }
  }

  const tone = line?.tone === 'bad' ? 'clay' : 'teal'

  // + ADD NOTE opened (page 46): a centred board on the veil, MORNING NOTE and the day, the box,
  // CANCEL / SAVE. It saves to the day's log; the Waybook shows it with the MORNING tag.
  if (phase === 'settled' && noteOpen) {
    return (
      <div className="bz-deck">
        <BzOverlay label="Morning note">
          <Board className="bz-bd" head="Morning note" headRight={<span className="wm-label">{noteDayLabel(date)}</span>}>
            <textarea
              className="bz-note is-morning"
              rows={3}
              maxLength={1000}
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="How does the body feel..."
              aria-label="Morning note"
              autoFocus
            />
            <div className="wm-btns" style={{ marginTop: 10 }}>
              <FlapButton label="CANCEL" size="xs" onClick={() => { setNoteText(note ?? ''); setNoteOpen(false) }} disabled={noteSaving} />
              <FlapButton label={noteSaving ? 'SAVING' : 'SAVE'} primary size="sm" onClick={() => void saveNote()} disabled={noteSaving} />
            </div>
          </Board>
        </BzOverlay>
      </div>
    )
  }

  return (
    <div className="bz-deck" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <BzOverlay label="Morning check-in">
        <div className="bz-toprow">
          <FlapLabel text="MORNING CHECK-IN" size="xs" tone="gold" animate={false} />
          {(phase === 'cards' || phase === 'settled') && (
            <button type="button" className="bz-lnk" onClick={() => { if (phase === 'cards') onSkipToday?.(); onClose(phase === 'settled') }}>
              {onSkipToday ? 'Skip today ›' : 'Close ›'}
            </button>
          )}
        </div>

        {phase === 'cards' && (
          <>
            <BzDots n={total} now={state.index} done={i => i < state.index} />
            {state.askingBackNotes ? (
              <Board className="bz-bd" head={`${Math.min(state.index + 1, total)} of ${total} · back today`}>
                <FlapLabel text="WHAT BOTHERS IT?" size="md" animate="mount" />
                <p className="bz-q">Which movements, where. The coach swaps in easier versions.</p>
                <textarea
                  className="bz-note"
                  rows={3}
                  maxLength={500}
                  value={state.backNotes}
                  placeholder="Bending forward, sitting long"
                  onChange={e => dispatch({ type: 'backNotes', text: e.target.value })}
                />
                <div className="wm-btns" style={{ marginTop: 10 }}>
                  <FlapButton label="BACK" size="xs" onClick={() => dispatch({ type: 'back' })} />
                  <FlapButton label="NEXT" primary size="sm" onClick={() => dispatch({ type: 'finishNotes' })} />
                </div>
              </Board>
            ) : (
              <Board className="bz-bd" key={q.key} head={`${Math.min(state.index + 1, total)} of ${total}`}>
                <FlapLabel text={q.title.toUpperCase()} size="md" animate="mount" />
                {q.sub ? <p className="bz-q">{q.sub}</p> : <div style={{ height: 10 }} />}
                <BzTiles
                  label={q.title}
                  columns={q.columns}
                  options={q.options.map((o, i) => (q.key === 'soreness'
                    // Soreness: the Ledger's colours and words (page 45).
                    ? { value: o.value, label: o.label, sub: o.sub, swatch: SORENESS_COLOURS[i] }
                    : { value: o.value, label: o.label, sub: o.sub }))}
                  selected={state.answers[q.key] ?? null}
                  onPick={v => dispatch({ type: 'answer', key: q.key, value: v })}
                />
              </Board>
            )}
            <div className="wm-btns">
              <FlapButton label="‹ BACK" size="xs" onClick={() => dispatch({ type: 'back' })} />
              <FlapButton label="PASS ›" size="xs" onClick={() => dispatch({ type: 'pass' })} />
            </div>
          </>
        )}

        {phase === 'saving' && (
          <>
            <BzDots n={total} now={-1} done={() => true} />
            <Board className="bz-bd bz-verd">
              <p>Saving.</p>
            </Board>
          </>
        )}

        {phase === 'error' && (
          <Board className="bz-bd" edge="bad" head="Checked in">
            <FlapLabel text="COULDN'T SAVE" size="sm" />
            <p className="bz-q is-last">Check your connection. Your answers are still here.</p>
            <div className="wm-btns" style={{ marginTop: 12 }}>
              <FlapButton label="CLOSE" size="xs" onClick={() => onClose(false)} />
              <FlapButton label="TRY AGAIN" primary size="sm" onClick={() => { dispatch({ type: 'jump', index: total - 1 }); setPhase('cards') }} />
            </div>
          </Board>
        )}

        {phase === 'settled' && (
          <>
            <BzDots n={total} now={-1} done={() => true} />
            <Board className="bz-bd bz-verd">
              <FlapLabel text={line ? (line.tone === 'bad' ? 'EASING TODAY' : 'GOOD TO GO') : 'LOGGED'} size="md" tone={tone} animate="mount" />
              {line && <p>{line.why}</p>}
              <div className="wm-btns">
                <FlapButton label="+ ADD NOTE" size="sm" onClick={() => setNoteOpen(true)} />
                <FlapButton label="TO TODAY" primary size="sm" onClick={() => onClose(true)} />
              </div>
            </Board>
          </>
        )}
      </BzOverlay>
    </div>
  )
}

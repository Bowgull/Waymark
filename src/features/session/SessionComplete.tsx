import { useEffect, useRef, useState } from 'react'

import { FlapLabel } from '@/design'
import { SessionButton } from '@/components/timers'
import { EARLY_END_REASONS } from '@/components/ui/departures'
import { ReasonTiles } from '@/features/coach/ReasonTiles'
import { completeHaptic } from '@/lib/haptics'
import { endLiveActivity } from '@/lib/liveActivity'
import { effortWord } from '@/lib/timers/timerLook'
import { getItem, removeItem, setItem } from '@/lib/safeStorage'

import './session.css'

interface SessionCompleteProps {
  sessionType: string
  /** The pick it opens on: the session's own typical effort (an easy Zone 2 is 4, not 7). */
  startRpe?: number
  onFinish: (rpe: number, notes: string, endReason?: string | null) => void
  /** Ended before its last round (bag work, rope): the one-tap reason tiles show. */
  early?: boolean
  submitting: boolean
  /** The note is kept on the phone as it is typed (page 61): an app kill can't lose it. */
  sessionId?: string
}

/**
 * Closing, effort (page 19 #6 "Effort · ten flap tiles"): SESSION CLOSED and
 * "How was it?" on the dark, then a centred card: Effort with its word on a
 * gold flap (HARD), ten 64 px flap tiles (the pick gold), Very light … Max
 * effort, CLOSE SESSION. One tap, with wraps on. The moment follows the save.
 *
 * Notes (page 47): shut by default. A small teal + NOTE chip under the scale
 * opens the box in the card; the note saves with the session (sessions.notes),
 * where the coach reads it.
 */
export function SessionComplete({ startRpe = 7, onFinish, submitting, sessionId, early = false }: SessionCompleteProps) {
  const [endReason, setEndReason] = useState<string | null>(null)
  const [rpe, setRpe] = useState(() => Math.min(10, Math.max(1, Math.round(startRpe))))
  const draftKey = sessionId ? `waymark_close_note:${sessionId}` : null
  const [notes, setNotesState] = useState(() => (draftKey ? getItem(draftKey) : null) ?? '')
  const [noteOpen, setNoteOpen] = useState(() => notes.trim() !== '')
  const setNotes = (t: string) => { setNotesState(t); if (draftKey) { if (t) setItem(draftKey, t); else removeItem(draftKey) } }
  const noteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus()
  }, [noteOpen])

  useEffect(() => {
    const now = Date.now()
    void endLiveActivity(
      {
        phase: 'complete',
        label: 'Session complete',
        startedAt: now,
        endsAt: now,
        isPaused: false,
        completeMessage: 'Tap to rate',
      },
      10_000,
    )
  }, [])

  function handleFinish() {
    completeHaptic()
    onFinish(rpe, notes.trim(), early ? endReason : null)
  }

  return (
    <div className="tm-screen ss-close">
      <div className="tm-ground" aria-hidden />
      <div className="tm-ui">
        <div className="ss-close-top">
          <FlapLabel text="SESSION CLOSED" size="md" tone="gold" />
          <p className="wm-prose" style={{ marginTop: 10 }}>How was it?</p>
        </div>
      </div>
      <div className="ss-veil" aria-hidden />
      <div className="wm-board is-solid ss-ccard" role="dialog" aria-modal="true" aria-label="Effort">
        <div className="wm-board-head">
          <span>Effort</span>
          <FlapLabel text={effortWord(rpe)} size="xs" tone="gold" len={11} />
        </div>
        <div className="ss-etiles" role="radiogroup" aria-label="Effort, 1 to 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" role="radio" aria-checked={rpe === n} aria-label={`${n}, ${effortWord(n).toLowerCase()}`} className="ss-etile" onClick={() => setRpe(n)}>
              <FlapLabel text={String(n)} size="md" len={2} tone={rpe === n ? 'gold' : 'ink'} />
            </button>
          ))}
        </div>
        <div className="ss-row" style={{ marginTop: 10 }}>
          <span className="wm-label">Very light</span>
          <span className="ss-grow" />
          <span className="wm-label">Max effort</span>
        </div>
        {/* Ended early: one optional tap says why (NO TIME holds the next session; it never reads as too hard). */}
        {early && <ReasonTiles tiles={EARLY_END_REASONS} value={endReason} onChange={setEndReason} />}
        <div className="ss-chiprow">
          {!noteOpen && (
            <button type="button" className="ss-chipn" aria-label="Add a note" onClick={() => setNoteOpen(true)}>
              <FlapLabel text="+ NOTE" size="xs" tone="teal" />
            </button>
          )}
        </div>
        {noteOpen && (
          <div style={{ marginTop: 10 }}>
            <textarea
              ref={noteRef}
              className="ss-note"
              aria-label="Session note"
              placeholder="Anything the coach should know."
              value={notes}
              maxLength={2000}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <SessionButton label={submitting ? 'SAVING' : 'CLOSE SESSION'} primary disabled={submitting} onClick={handleFinish} />
        </div>
      </div>
    </div>
  )
}

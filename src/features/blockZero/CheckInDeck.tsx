import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'

import { Board, CloseWord, FlapButton, FlapLabel, showPop } from '@/design'
import { getItem as storageGet, removeItem as storageRemove, setItem as storageSet } from '@/lib/safeStorage'
import { SORENESS_COLOURS } from '@/design/tokens'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { selectHaptic } from '@/lib/haptics'

import { BzDots, BzOverlay, BzTiles } from './Bz'
import {
  checkInPayload,
  checkInQuestions,
  checkInReducer,
  firstUnanswered,
  initialCheckIn,
  noteDayLabel,
  type CheckInAction,
  type CheckInAnswers,
  type CheckInKey,
  type CheckInState,
} from './checkInFlow'
import { readinessLine, type ReadinessIn } from './readinessLine'

export interface CheckInDeckProps {
  date: string
  existing?: CheckInAnswers | null
  /** What bothers the back, if already written today. */
  existingBackNotes?: string | null
  /** Open on this card, or 'resume': the first card without an answer. */
  startAt?: number | 'resume'
  /** Cards passed earlier today (kept on this phone), so they stay passed. */
  existingPassed?: ReadonlyArray<CheckInKey>
  /** Saves the body; resolves with today's readiness (or null when unknown). `passed` is the cards passed without an answer. */
  onSubmit: (body: Record<string, unknown>, passed: CheckInKey[]) => Promise<ReadinessIn | null>
  /** Each answer or pass as it is given (the partial log), so a closed deck resumes where it stopped. */
  onPartial?: (body: Record<string, unknown>, answers: CheckInAnswers, backNotes: string, passed: CheckInKey[]) => void
  /** Closed: saved true after a save, false when closed before the end (it comes back next open). */
  onClose: (saved: boolean) => void
  /** Today's note on the daily log (+ ADD NOTE edits it). */
  note?: string | null
  /** The daily log after a note was saved. */
  onNoteSaved?: (log: unknown) => void
  /** Design gallery only: open on the verdict. */
  previewSettled?: ReadinessIn | null
  /** Places on watch (page 58): a "<Place> today" card after Back today. */
  regions?: ReadonlyArray<{ region: string; label: string }>
}

const SWIPE_PX = 60
/** A card ignores input this long after it appears, so a double tap can't answer the next one too. */
const CARD_SETTLE_MS = 300

/**
 * The morning check-in (page 45, "Morning check-in cards"): a centred board
 * over the dimmed Today, one question each. A tap answers and moves on; swipe
 * left passes, swipe right goes back. The last board is the verdict (EASING
 * TODAY clay / GOOD TO GO teal) with its line, then + ADD NOTE (the daily
 * log's note) and TO TODAY.
 */
export function CheckInDeck({ date, existing, existingBackNotes, existingPassed, startAt = 0, onSubmit, onPartial, onClose, note, onNoteSaved, previewSettled, regions }: CheckInDeckProps) {
  const [questions] = useState(() => checkInQuestions(regions ?? []))
  const [state, dispatch] = useReducer((s: CheckInState, a: CheckInAction) => checkInReducer(s, a, questions), undefined, () => ({
    ...initialCheckIn(existing, startAt === 'resume' ? firstUnanswered(existing ?? {}, questions) : startAt, questions, existingPassed ?? []),
    backNotes: existingBackNotes ?? '',
  }))
  const [phase, setPhase] = useState<'cards' | 'saving' | 'settled' | 'error'>(previewSettled !== undefined ? 'settled' : 'cards')
  const [line, setLine] = useState<ReturnType<typeof readinessLine>>(() => (previewSettled ? readinessLine(previewSettled) : null))
  const [noteOpen, setNoteOpen] = useState(false)
  // + ADD NOTE's words are kept as a draft until saved (page 61: CLOSE never throws them away)
  const noteDraftKey = `waymark_morning_note_draft:${date}`
  const [noteText, setNoteTextState] = useState(() => storageGet(noteDraftKey) ?? note ?? '')
  const setNoteText = (t: string) => { setNoteTextState(t); storageSet(noteDraftKey, t) }
  const [noteSaving, setNoteSaving] = useState(false)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const submitted = useRef(false)
  useDeckOpenClass()
  // which way the cards go (page 59 §5.3): the next card slides in from the right, Back from the left
  const [step, setStep] = useState<{ index: number; dir: 'next' | 'back' | null }>({ index: state.index, dir: null })
  if (step.index !== state.index) setStep({ index: state.index, dir: state.index > step.index ? 'next' : 'back' })
  // when the card on show appeared (a new card, the back-notes board, or the deck opening)
  const shownAt = useRef(0)
  useLayoutEffect(() => { shownAt.current = performance.now() }, [state.index, state.askingBackNotes, phase])
  /** A card's answer, pass or back: dropped while the card is still settling. */
  function act(a: CheckInAction): boolean {
    if (performance.now() - shownAt.current < CARD_SETTLE_MS) return false
    dispatch(a)
    return true
  }

  // Each answer is saved as it is given (the last one goes with the full save below).
  const lastPartial = useRef<string | null>(null)
  useEffect(() => {
    if (state.done || state.askingBackNotes || !onPartial) return
    const body = checkInPayload(state, date)
    const sig = JSON.stringify([body, state.passed])
    if (lastPartial.current == null) { lastPartial.current = sig; return }
    if (sig === lastPartial.current) return
    lastPartial.current = sig
    onPartial(body, state.answers, state.backNotes, state.passed)
  }, [state, date, onPartial])

  // The last card answered: save once, then the verdict.
  useEffect(() => {
    if (!state.done || submitted.current) return
    submitted.current = true
    let alive = true
    ;(async () => {
      setPhase('saving')
      try {
        const readiness = await onSubmit(checkInPayload(state, date), state.passed)
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

  const q = questions[Math.min(state.index, questions.length - 1)]
  const total = questions.length

  function onPointerDown(e: React.PointerEvent) {
    touch.current = { x: e.clientX, y: e.clientY }
  }
  // iOS took the touch (a scroll, the edge swipe): nothing fires on a later release
  function onPointerCancel() {
    touch.current = null
  }
  function onPointerUp(e: React.PointerEvent) {
    const start = touch.current
    touch.current = null
    if (!start || phase !== 'cards' || state.askingBackNotes) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
    act(dx < 0 ? { type: 'pass' } : { type: 'back' })
  }

  // + ADD NOTE: the daily log's note field (POST /api/daily-logs only writes the keys it is sent).
  async function saveNote() {
    setNoteSaving(true)
    try {
      const log = await apiFetch('/api/daily-logs', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ date, notes: noteText.trim() || null }) })
      onNoteSaved?.(log)
      storageRemove(noteDraftKey)
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
        <BzOverlay label="Morning note" onDismiss={() => setNoteOpen(false)}>
          <Board className="bz-bd" head="Morning note" headRight={<span className="wm-head-right"><span className="wm-label">{noteDayLabel(date)}</span><CloseWord onClose={() => setNoteOpen(false)} /></span>}>
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
              <FlapButton label={noteSaving ? 'SAVING' : 'SAVE'} primary size="sm" onClick={() => void saveNote()} disabled={noteSaving} />
            </div>
          </Board>
        </BzOverlay>
      </div>
    )
  }

  return (
    <div className="bz-deck" data-step={step.dir ?? undefined} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      {/* page 61: CLOSE (the answers given are kept), a tap on the veil, Escape, the edge swipe; it closes while saving too (the save carries on) */}
      <BzOverlay label="Morning check-in" onDismiss={() => onClose(phase === 'settled')}>
        <div className="bz-toprow">
          <FlapLabel text="MORNING CHECK-IN" size="xs" tone="gold" animate={false} />
          <CloseWord onClose={() => onClose(phase === 'settled')} />
        </div>

        {phase === 'cards' && (
          <>
            <BzDots n={total} now={state.index} done={i => i < state.index} />
            {state.askingBackNotes ? (
              <Board className="bz-bd is-step" head={`${Math.min(state.index + 1, total)} of ${total} · back today`}>
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
                  <FlapButton label="BACK" size="xs" onClick={() => act({ type: 'back' })} />
                  <FlapButton label="NEXT" primary size="sm" onClick={() => act({ type: 'finishNotes' })} />
                </div>
              </Board>
            ) : (
              <Board className="bz-bd is-step" key={q.key} head={`${Math.min(state.index + 1, total)} of ${total}`}>
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
                  onPick={v => { if (act({ type: 'answer', key: q.key, value: v })) void selectHaptic() }}
                />
              </Board>
            )}
            <div className="wm-btns">
              <FlapButton label="‹ BACK" size="xs" onClick={() => act({ type: 'back' })} />
              <FlapButton label="PASS ›" size="xs" onClick={() => act({ type: 'pass' })} />
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
              <FlapLabel text={line && !line.noBaseline ? (line.tone === 'bad' ? 'EASING TODAY' : 'GOOD TO GO') : 'LOGGED'} size="md" tone={tone} animate="mount" />
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

/** While the deck is open, <body> carries wm-deck-open: Today and the tab bar hide under it (blockZero.css). */
let decksOpen = 0
function useDeckOpenClass() {
  useLayoutEffect(() => {
    decksOpen++
    document.body.classList.add('wm-deck-open')
    return () => { if (--decksOpen <= 0) { decksOpen = 0; document.body.classList.remove('wm-deck-open') } }
  }, [])
}

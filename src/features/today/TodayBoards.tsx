import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, CloseWord, Crest, FlapButton, FlapLabel, SessionIcon, showPop, useOutsideClose, type SessionIconKey } from '@/design'
import { getItem as storageGet, removeItem as storageRemove, setItem as storageSet } from '@/lib/safeStorage'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { tapHaptic } from '@/lib/haptics'
import { logger } from '@/lib/logger'
import { markWaybookOpen, requireUnlock, setWaybookShown } from '@/lib/waybookGate'
import { dateFlap } from './weekStrip'

// The pieces of Today (pages 35, 36, 43), on the split-flap boards over the forest.

/** A finger that slides this far off the crest lets go of the hold. */
const CREST_SLOP_PX = 40

/** The header: the crest and WAYMARK on a flap; the date on a flap. Long-press the crest for Logs. */
export function TodayHeader({ date }: { date: Date }) {
  const navigate = useNavigate()
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const at = useRef<{ x: number; y: number } | null>(null)
  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    held.current = false
    // the finger stays the crest's until it lifts: a small drift never cancels the hold
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    at.current = { x: e.clientX, y: e.clientY }
    timer.current = window.setTimeout(() => { timer.current = null; held.current = true; void tapHaptic(); navigate('/settings/logs') }, 700)
  }
  const stop = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; at.current = null }
  const move = (e: React.PointerEvent) => { const a = at.current; if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) > CREST_SLOP_PX) stop() }
  useEffect(() => stop, [])
  return (
    <header className="td-hd wm-scene-hd">
      <button
        type="button"
        className="td-brand"
        aria-label="Waymark. Hold for logs."
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onContextMenu={e => e.preventDefault()}
        onClick={() => { if (!held.current) window.scrollTo({ top: 0 }) }}
      >
        <span className="td-crest"><Crest width={52} /></span>
        <FlapLabel text="WAYMARK" size="sm" animate={false} />
      </button>
      <FlapLabel text={dateFlap(date)} size="xs" animate={false} />
    </header>
  )
}

interface JournalEntryData { id: string; content: string }

/**
 * The Waybook (page 35, C, approved): one line with the leather journal; tap
 * it to open the box and SAVE, then "Saved to the Waybook." with + ADD MORE.
 * Same API as before (GET/POST /api/journal, PATCH to append).
 *
 * Page 61: tapping the line asks Face ID first; the box has CLOSE and folds
 * on a tap outside. Words not saved yet are kept on the phone as a draft
 * (choice A): the line then shows DRAFT, never the words.
 */
export function WaybookLine({ today, variant = 'day' }: { today: string; variant?: 'day' | 'home' }) {
  const isSunday = new Date(`${today}T12:00:00`).getDay() === 0
  const entryType = isSunday ? 'weekly' : 'daily'
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const draftKey = `waymark_waybook_draft:${today}:${entryType}`
  const [draft, setDraftState] = useState(() => storageGet(draftKey) ?? '')
  const [saving, setSaving] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const setDraft = (text: string) => {
    setDraftState(text)
    if (text.trim()) storageSet(draftKey, text)
    else storageRemove(draftKey)
  }
  const fold = () => { setOpen(false); setSaved(false) }
  useOutsideClose(boxRef, open, fold, { on: 'click' })

  // The 3 minutes without Face ID count from the last time the box was open.
  useEffect(() => {
    if (!open) return
    setWaybookShown(true)
    return () => { markWaybookOpen(); setWaybookShown(false) }
  }, [open])

  useEffect(() => {
    let cancelled = false
    apiFetch<JournalEntryData | null>(`/api/journal?date=${today}&type=${entryType}`)
      .then(d => { if (!cancelled && d) setEntryId(d.id) })
      .catch(e => logger.warn('system', 'journal load failed', { date: today, entryType, message: e instanceof Error ? e.message : String(e) }, 'GET /journal failed. Entry may exist server-side.'))
    return () => { cancelled = true }
  }, [today, entryType])

  async function save() {
    const text = draft.trim()
    if (!text) return
    setSaving(true)
    try {
      if (entryId) {
        const existing = await apiFetch<JournalEntryData | null>(`/api/journal?date=${today}&type=${entryType}`)
        await apiFetch(`/api/journal/${entryId}`, { method: 'PATCH', body: JSON.stringify({ content: existing ? `${existing.content}\n\n${text}` : text }) })
      } else {
        // append: the day's entry may exist and not have loaded yet; never write over it
        const created = await apiFetch<JournalEntryData>('/api/journal', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ date: today, type: entryType, content: text, append: true }) })
        setEntryId(created.id)
      }
      setDraft('')
      setSaved(true)
    } catch (e) {
      console.error('Failed to save journal:', e)
      showPop("Couldn't save. Check your connection.", 'bad')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className={`td-wline is-${variant}${draft.trim() ? ' is-draft' : ''}`} onClick={() => { void requireUnlock('Open the Waybook').then(ok => { if (ok) setOpen(true) }) }} aria-expanded={false}>
        <SessionIcon kind="waybook" size={variant === 'home' ? 34 : 44} />
        <span className="t">Waybook</span>
        {draft.trim() && <FlapLabel text="DRAFT" size="xs" tone="gold" animate={false} />}
        <span className="chev" aria-hidden>›</span>
      </button>
    )
  }
  return (
    <div ref={boxRef}>
    <Board className="td-wb" head="Waybook" headRight={<CloseWord onClose={fold} />}>
      {saved ? (
        <div className="td-saved">
          <p>Saved to the Waybook.</p>
          <FlapButton label="+ ADD MORE" size="xs" onClick={() => setSaved(false)} />
        </div>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={4}
            maxLength={4000}
            aria-label="Waybook entry"
            placeholder={isSunday ? 'Reflect on your week...' : "What's on your mind..."}
            autoFocus
          />
          <div className="wm-btns" style={{ marginTop: 10 }}>
            <FlapButton label={saving ? 'SAVING' : 'SAVE'} primary onClick={save} disabled={saving || !draft.trim()} />
          </div>
        </>
      )}
    </Board>
    </div>
  )
}

/** A day not prepared yet (page 35 #2 A, page 43): NOTHING TODAY, the app's line, PREPARE THE DAY. */
export function EmptyDayBoard({ onPrepare, preparing, onAdd }: { onPrepare: () => void; preparing: boolean; onAdd?: () => void }) {
  return (
    <Board className="td-empty">
      <FlapLabel text="NOTHING TODAY" size="md" tone="gold" />
      <p>No sessions planned for today.</p>
      <FlapButton label={preparing ? 'PREPARING' : 'PREPARE THE DAY'} primary onClick={onPrepare} disabled={preparing} />
      {/* page 56: the same quiet + add session line as the day's board */}
      {onAdd && <div className="td-addrow"><button type="button" className="td-addq" onClick={onAdd}>+ add session</button></div>}
    </Board>
  )
}

/** No active block: nothing is planned until Block Zero starts (owner decision). Same board as NOTHING TODAY. */
export function NoBlockBoard({ onStart }: { onStart: () => void }) {
  return (
    <Board className="td-empty">
      <FlapLabel text="NOTHING TODAY" size="md" tone="gold" />
      <p>No block running. Start Block Zero to begin.</p>
      <FlapButton label="START BLOCK ZERO" primary onClick={onStart} />
    </Board>
  )
}

/** A day planned as rest (page 43, layout B): REST DAY, one line, and tomorrow's sessions. */
export function RestDayBoards({ tomorrow, tomorrowLine, onAdd }: { tomorrow: SessionIconKey[]; tomorrowLine: string | null; onAdd?: () => void }) {
  return (
    <>
      <div className="td-restline">
        <FlapLabel text="REST DAY" size="md" tone="gold" animate="mount" />
        <p>The work is in the bank.</p>
        {/* page 56: the same quiet + add session line as the day's board */}
        {onAdd && <div className="td-addrow"><button type="button" className="td-addq" onClick={onAdd}>+ add session</button></div>}
      </div>
      {tomorrowLine && <NextDayBoard label="Tomorrow" icons={tomorrow} line={tomorrowLine} />}
    </>
  )
}

/** Page 43's "Tomorrow" row: the label, the day's icons, one line. Page 64 reuses it under the waiting board ("Starts Wed"). */
export function NextDayBoard({ label, icons, line }: { label: string; icons: SessionIconKey[]; line: string }) {
  return (
    <Board>
      <div className="td-next">
        <span className="lbl">{label}</span>
        <span style={{ flex: 1 }} />
        {icons.map((k, i) => <SessionIcon key={`${k}-${i}`} kind={k} size={32} />)}
      </div>
      <p className="td-nextline">{line}</p>
    </Board>
  )
}

/** Evening, the day done (page 43): ALL DONE, today's icons ticked, one line. Tap to see the day again. */
export function AllDoneBoard({ icons, onShowDay }: { icons: SessionIconKey[]; onShowDay: () => void }) {
  const n = icons.length
  const words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six']
  const line = n > 0 ? `${words[n] ?? n} for ${(words[n] ?? String(n)).toLowerCase()} today. Rest now.` : 'Done for today. Rest now.'
  return (
    <button type="button" className="td-restline" onClick={onShowDay} style={{ background: 'none', border: 0, cursor: 'pointer' }} aria-label={`All done. ${line} Tap to see the day's board.`}>
      <FlapLabel text="ALL DONE" size="md" tone="gold" animate="mount" />
      <span className="td-donerow">{icons.map((k, i) => <span key={`${k}-${i}`} className="ic"><SessionIcon kind={k} size={40} /></span>)}</span>
      <p>{line}</p>
    </button>
  )
}

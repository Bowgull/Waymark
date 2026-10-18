import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, Crest, FlapButton, FlapLabel, SessionIcon, showPop, type SessionIconKey } from '@/design'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { logger } from '@/lib/logger'
import { coachCount, dateFlap, type StripDay } from './weekStrip'

// The pieces of Today (pages 35, 36, 43), on the split-flap boards over the forest.

/** The header: the crest and WAYMARK on a flap; the date on a flap. Long-press the crest for Logs. */
export function TodayHeader({ date }: { date: Date }) {
  const navigate = useNavigate()
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const start = () => { held.current = false; timer.current = window.setTimeout(() => { held.current = true; navigate('/settings/logs') }, 700) }
  const stop = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null }
  useEffect(() => stop, [])
  return (
    <header className="td-hd">
      <button
        type="button"
        className="td-brand"
        aria-label="Waymark. Hold for logs."
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={e => e.preventDefault()}
        onClick={() => { if (!held.current) window.scrollTo({ top: 0 }) }}
      >
        <Crest width={40} />
        <FlapLabel text="WAYMARK" size="sm" animate={false} />
      </button>
      <FlapLabel text={dateFlap(date)} size="xs" animate={false} />
    </header>
  )
}

/** The week strip: seven small day tiles under the header. Tap a day to open it in Program. */
export function WeekStrip({ days }: { days: StripDay[] }) {
  const navigate = useNavigate()
  return (
    <Board className="td-strip">
      <div className="td-tiles7" role="list" aria-label="This week">
        {days.map(d => (
          <button
            key={d.epochDay}
            type="button"
            role="listitem"
            className={`td-t7${d.isToday ? ' is-today' : ''}`}
            onClick={() => navigate(`/program?day=${d.iso}`)}
            aria-label={`${d.iso}${d.isToday ? ', today' : ''}${d.rest ? ', rest' : ''}. ${d.icons.map(i => `${i.key} ${i.state}`).join(', ')}. Open in Program.`}
          >
            <span className="dn">{d.letter}</span>
            <span className="dd">{d.date}</span>
            {d.rest ? <span className="zz">REST</span> : d.icons.map(i => (
              <span key={i.id} className={`ic is-${i.state}`}><SessionIcon kind={i.key} size={18} label="" /></span>
            ))}
          </button>
        ))}
      </div>
    </Board>
  )
}

export interface CoachChangeLine { id: string; line: string; was?: string | null; icon: SessionIconKey | null }
export interface CoachQuestionLine { id: string; line: string; icon: SessionIconKey | null }

/** The Coach board (page 36): the why line first, each change with its reason, open questions with a gold dot. */
export function CoachBoard({ why, changes, questions, onOpen }: { why: string | null; changes: CoachChangeLine[]; questions: CoachQuestionLine[]; onOpen: (id: string) => void }) {
  if (!why && changes.length === 0 && questions.length === 0) return null
  // The first sentence of the why line is the kind of week (bold), the rest the reason.
  const cut = (why ?? '').indexOf('. ')
  const lead = cut > 0 ? (why ?? '').slice(0, cut + 1) : (why ?? '')
  const rest = cut > 0 ? (why ?? '').slice(cut + 2) : ''
  return (
    <Board className="td-coach" head="Coach" headRight={<span className="cnt">{coachCount(changes.length, questions.length)}</span>}>
      {why && (
        <div className="crow is-why" style={{ paddingTop: 0 }}>
          <p>{rest ? <><b>{lead}</b> {rest}</> : why}</p>
        </div>
      )}
      {changes.map(c => (
        <div key={c.id} className="crow">
          {c.icon && <SessionIcon kind={c.icon} size={30} />}
          <p>{c.line}{c.was && <span className="was">was {c.was}</span>}</p>
        </div>
      ))}
      {questions.map(q => (
        <button key={q.id} type="button" className="crow is-q" onClick={() => onOpen(q.id)} aria-label={`${q.line} Open the question.`}>
          {q.icon && <SessionIcon kind={q.icon} size={30} />}
          <p>{q.line}</p>
          <span className="td-qdot" aria-hidden />
          <span className="td-chev" aria-hidden>›</span>
        </button>
      ))}
    </Board>
  )
}

interface JournalEntryData { id: string; content: string }

/**
 * The Waybook (page 35, C, approved): one line with the leather journal; tap
 * it to open the box and SAVE, then "Saved to the Waybook." with + ADD MORE.
 * Same API as before (GET/POST /api/journal, PATCH to append).
 */
export function WaybookLine({ today }: { today: string }) {
  const isSunday = new Date(`${today}T12:00:00`).getDay() === 0
  const entryType = isSunday ? 'weekly' : 'daily'
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

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
        const created = await apiFetch<JournalEntryData>('/api/journal', { method: 'POST', headers: idempotencyHeaders(), body: JSON.stringify({ date: today, type: entryType, content: text }) })
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
      <button type="button" className="td-wline" onClick={() => setOpen(true)} aria-expanded={false}>
        <SessionIcon kind="waybook" size={40} />
        <span className="t">Write in the Waybook</span>
        <span className="chev" aria-hidden>›</span>
      </button>
    )
  }
  return (
    <Board className="td-wb" head="Waybook">
      {saved ? (
        <div className="td-saved">
          <p>Saved to the Waybook.</p>
          <div style={{ width: 150 }}><FlapButton label="+ ADD MORE" size="xs" onClick={() => setSaved(false)} /></div>
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
            <FlapButton label="CLOSE" onClick={() => setOpen(false)} disabled={saving} />
            <FlapButton label={saving ? 'SAVING' : 'SAVE'} primary onClick={save} disabled={saving || !draft.trim()} />
          </div>
        </>
      )}
    </Board>
  )
}

/** A day not prepared yet (page 35 #2, A): NOTHING TODAY, the app's line, PREPARE THE DAY. */
export function EmptyDayBoard({ onPrepare, preparing, onAdd }: { onPrepare: () => void; preparing: boolean; onAdd: () => void }) {
  return (
    <Board className="td-empty">
      <FlapLabel text="NOTHING TODAY" size="md" tone="gold" />
      <p>No sessions planned for today.</p>
      <FlapButton label={preparing ? 'PREPARING' : 'PREPARE THE DAY'} primary onClick={onPrepare} disabled={preparing} />
      <FlapButton label="+ ADD SESSION" quiet size="xs" onClick={onAdd} />
    </Board>
  )
}

/** A day planned as rest (page 43, layout B): REST DAY, one line, and tomorrow's sessions. */
export function RestDayBoards({ tomorrow, tomorrowLine }: { tomorrow: SessionIconKey[]; tomorrowLine: string | null }) {
  return (
    <>
      <div className="td-restline">
        <FlapLabel text="REST DAY" size="md" tone="gold" animate="mount" />
        <p>The work is in the bank.</p>
      </div>
      {tomorrowLine && (
        <Board>
          <div className="td-next">
            <span className="lbl">Tomorrow</span>
            <span style={{ flex: 1 }} />
            {tomorrow.map((k, i) => <SessionIcon key={`${k}-${i}`} kind={k} size={32} />)}
          </div>
          <p className="wm-prose is-dim" style={{ marginTop: 8 }}>{tomorrowLine}</p>
        </Board>
      )}
    </>
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

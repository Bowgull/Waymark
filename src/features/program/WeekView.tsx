import { useEffect, useRef, useState } from 'react'

import { FlapLabel, SessionIcon, glowRow, showPop } from '@/design'
import { CoachSignpost } from '@/components/ui/CoachSignpost'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { SkipReasonSheet, type SkipReasonCommit } from '@/features/session/SkipReasonSheet'
import { ReplaceReasonSheet } from '@/features/session/ReplaceReasonSheet'
import { DayBoardRow } from '@/features/dayboard/DayBoardRow'
import { askDay, askRequest, dowOfEpochDay, type AdjustmentLike, type AskChip, type DayBoardSession, type RowAsk, type WeekChangeLike } from '@/features/dayboard/rowState'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { parseRefusal, refusalMessage } from '@/lib/refusal'
import type { ReplaceSuggestion, ReplaceSuggestionsOutput } from '@/lib/prompts/tools'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import { getWeekLabel } from '@/lib/strengthTemplates'
import { estimatedMinutes } from '@/lib/coach/sessions'

import { dayStrip } from './weekModel'
import './program.css'

// The Program week below the week board (page 33, approved d1 / d2 / d3 /
// d6): the seven-day tile strip, then the open day as rows you tap (summary
// in place) or swipe (REPLACE / SKIP), "+ add session" as a quiet line under
// it. Replace runs Why swap, the coach's signpost, then (MORE OPTIONS, or
// no suggestions) the departures board; skip runs Why skip; all use the
// same endpoints as Today. A missed session's ask sits in a
// row with its chips (page 36). No approval step anywhere.

export interface WeekViewProps {
  sessions: DayBoardSession[]
  weekPlanId?: string
  /** The week's prepared changes (weekly pass v2). */
  changes: ReadonlyArray<WeekChangeLike>
  weekNumber: number
  /** Monday to Sunday, epoch days. */
  days: number[]
  todayEpochDay: number
  /** The open day (an epoch day in `days`). */
  openDay: number
  onOpenDay: (epochDay: number) => void
  onSessionUpdate: (id: string, patch: Partial<DayBoardSession>) => void
  onSessionAdded: (session: DayBoardSession) => void
}

const REPLACE_SUGGESTIONS_TIMEOUT_MS = 45_000

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

type PickerState =
  | { mode: 'add'; date: string }
  | { mode: 'replace'; date: string; session: DayBoardSession; reason: string }

function isoOfEpochDay(d: number): string {
  return new Date(d * 86400000).toISOString().slice(0, 10)
}

/** The plan line on a to-do row: the strength week ("2×8, RPE 6-7") or about how long. */
function planDetail(s: DayBoardSession, weekNumber: number): string | null {
  const blockType = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
  if (s.type === 'strength') return getWeekLabel(s.blockWeek ?? 1, blockType).replace(/^Block Zero · /, '')
  // page 33: a class reads by its type alone ("technical"); the rest by their planned minutes ("12 min")
  if (s.type === 'mt_class') return null
  return `${estimatedMinutes({ type: s.type, notes: s.notes ?? null, estimatedMin: null }, blockType, weekNumber)} min`
}

/** The row answers on the face (the glow is a box-shadow). */
function glow(el: HTMLElement | null | undefined, tone: 'good' | 'bad') {
  glowRow(el?.querySelector('.db-face') ?? el, tone)
}

function sortDay(list: DayBoardSession[]): DayBoardSession[] {
  return [...list].sort((a, b) => (a.timeSlot === 'pm' ? 1 : 0) - (b.timeSlot === 'pm' ? 1 : 0))
}

export function WeekView({ sessions, weekPlanId, changes, weekNumber, days, todayEpochDay, openDay, onOpenDay, onSessionUpdate, onSessionAdded }: WeekViewProps) {
  const [adjustments, setAdjustments] = useState<{ plan: string; rows: AdjustmentLike[] } | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [skipFor, setSkipFor] = useState<DayBoardSession | null>(null)
  const [replaceFor, setReplaceFor] = useState<DayBoardSession | null>(null)
  const [signpost, setSignpost] = useState<
    | { session: DayBoardSession; reason: string; loading: true }
    | { session: DayBoardSession; reason: string; loading: false; coachLine: string; suggestions: ReplaceSuggestion[] }
    | null
  >(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [pickerSuggestions, setPickerSuggestions] = useState<SuggestionsResponse | null>(null)
  const rowEls = useRef(new Map<string, HTMLElement | null>())

  // The week's coach changes and open questions.
  useEffect(() => {
    if (!weekPlanId) return
    let cancelled = false
    apiFetch<AdjustmentLike[]>(`/api/adjustments?weekPlanId=${weekPlanId}`)
      .then(rows => { if (!cancelled) setAdjustments({ plan: weekPlanId, rows: Array.isArray(rows) ? rows : [] }) })
      .catch(() => { if (!cancelled) setAdjustments({ plan: weekPlanId, rows: [] }) })
    return () => { cancelled = true }
  }, [weekPlanId])

  const adjRows = adjustments && adjustments.plan === weekPlanId ? adjustments.rows : []
  const context = { changes, adjustments: adjRows }
  const strip = dayStrip(days, sessions, todayEpochDay)
  const daySessions = sortDay(sessions.filter(s => s.scheduledDate === openDay))
  const openAsks = adjRows.filter(a => a.adjustmentType === 'missed_session' && a.status === 'proposed' && a.targetSessionId)
  // Asks for sessions missed on another day sit on today's board.
  const askRows = openAsks
    .map(a => sessions.find(s => s.id === a.targetSessionId))
    .filter((s): s is DayBoardSession => s != null && s.scheduledDate !== openDay && askDay(s, todayEpochDay, days) === openDay)
  const askHere = (s: DayBoardSession) => askDay(s, todayEpochDay, days) === s.scheduledDate

  function showRefusal(e: unknown, fallback: string, row?: HTMLElement | null) {
    const refusal = parseRefusal(e)
    showPop(refusal ? refusalMessage(refusal) : fallback, 'bad', refusal ? { durationMs: 7000 } : undefined)
    glow(row, 'bad')
  }

  function loadSuggestions(date: string) {
    setPickerSuggestions(null)
    apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${date}`)
      .then(setPickerSuggestions)
      .catch(() => setPickerSuggestions(null))
  }

  function openAdd() {
    const date = isoOfEpochDay(openDay)
    setPicker({ mode: 'add', date })
    loadSuggestions(date)
  }

  function openReplacePicker(s: DayBoardSession, reason: string) {
    const date = isoOfEpochDay(s.scheduledDate ?? openDay)
    setPicker({ mode: 'replace', date, session: s, reason })
    loadSuggestions(date)
  }

  // Replace, as Today: Why swap, then the coach's signpost (three roads),
  // else (no suggestions, or MORE OPTIONS) the departures board for that day.
  async function commitReplaceReason(reason: string) {
    const s = replaceFor
    setReplaceFor(null)
    if (!s) return
    setSignpost({ session: s, reason, loading: true })
    try {
      // The route wraps the coach output: { suggestions: { coachLine, suggestions[] } | null }.
      const result = await apiFetch<{ suggestions: ReplaceSuggestionsOutput | null }>(`/api/sessions/${s.id}/replace-suggestions`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        // The coach thinks before it answers.
        timeoutMs: REPLACE_SUGGESTIONS_TIMEOUT_MS,
      })
      const coach = result?.suggestions ?? null
      if (coach && Array.isArray(coach.suggestions) && coach.suggestions.length > 0) {
        setSignpost({ session: s, reason, loading: false, coachLine: coach.coachLine ?? '', suggestions: coach.suggestions })
        return
      }
    } catch (e) {
      console.warn('replace-suggestions failed, falling back to the picker', e)
    }
    setSignpost(null)
    openReplacePicker(s, reason)
  }

  async function replaceWith(s: DayBoardSession, reason: string, pick: { type: string; label: string; timeSlot: string; runCategory?: string | null }) {
    const row = rowEls.current.get(s.id)
    try {
      const result = await apiFetch<{ original: DayBoardSession; replacement: DayBoardSession }>(`/api/sessions/${s.id}/replace`, {
        method: 'POST',
        body: JSON.stringify({ reason, type: pick.type, label: pick.label, timeSlot: pick.timeSlot, runCategory: pick.runCategory, today: getTodayISO() }),
      })
      onSessionUpdate(result.original.id, result.original)
      onSessionAdded(result.replacement)
      setOpenRow(null)
      showPop('Replaced.', 'good')
    } catch (e) {
      console.error('Failed to replace session:', e)
      showRefusal(e, "Couldn't replace. Check your connection.", row)
    }
  }

  async function handlePick(option: SessionOption) {
    const p = picker
    setPicker(null)
    setPickerSuggestions(null)
    if (!p) return
    if (p.mode === 'replace') {
      await replaceWith(p.session, p.reason, option)
      return
    }
    try {
      const created = await apiFetch<DayBoardSession>('/api/sessions/insert-ad-hoc', {
        method: 'POST',
        headers: idempotencyHeaders(),
        body: JSON.stringify({ date: p.date, type: option.type, timeSlot: option.timeSlot, runCategory: option.runCategory, today: getTodayISO() }),
      })
      onSessionAdded(created)
      showPop('Added.', 'good')
    } catch (e) {
      console.error('Failed to add session:', e)
      showRefusal(e, "Couldn't add. Check your connection.")
    }
  }

  async function commitSkip(commit: SkipReasonCommit) {
    const s = skipFor
    setSkipFor(null)
    if (!s) return
    const row = rowEls.current.get(s.id)
    const prev = s.status
    onSessionUpdate(s.id, { status: 'skipped', skipReason: commit.reason })
    try {
      await apiFetch(`/api/sessions/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped', skipReason: commit.reason, skipReasonDetail: commit.detail }),
      })
      setOpenRow(null)
    } catch (e) {
      console.error('Failed to skip session:', e)
      onSessionUpdate(s.id, { status: prev, skipReason: s.skipReason ?? null })
      showRefusal(e, "Couldn't save. Check your connection.", row)
    }
  }

  async function answerAsk(ask: RowAsk, chip: AskChip, row: HTMLElement | null) {
    const req = askRequest(ask.adjustmentId, chip, getTodayISO())
    try {
      const result = await apiFetch<{ session?: DayBoardSession }>(req.path, { method: 'POST', ...(req.body ? { body: JSON.stringify(req.body) } : {}) })
      const status = chip.request.kind === 'accept' ? 'accepted' : 'rejected'
      setAdjustments(prev => prev && { ...prev, rows: prev.rows.map(a => (a.id === ask.adjustmentId ? { ...a, status } : a)) })
      if (result?.session) onSessionAdded(result.session)
      glow(row, 'good')
      showPop(chip.request.kind === 'accept' ? 'Done.' : 'Let go.', 'good')
    } catch (e) {
      console.error('Failed to answer the ask:', e)
      showRefusal(e, "Couldn't save. Check your connection.", row)
    }
  }

  const dayDate = new Date(openDay * 86400000)
  const isToday = openDay === todayEpochDay

  const rowProps = (s: DayBoardSession) => ({
    session: s,
    context: { ...context, planDetail: planDetail(s, weekNumber) },
    weekNumber,
    onReplace: (x: DayBoardSession) => setReplaceFor(x),
    onSkip: (x: DayBoardSession) => setSkipFor(x),
    onAnswer: answerAsk,
  })

  return (
    <>
      {/* the seven-day tile strip */}
      <div className="db-glass">
        <div className="pg-tiles7" role="tablist" aria-label="Days of the week">
          {strip.map(t => (
            <button
              key={t.epochDay}
              type="button"
              role="tab"
              aria-selected={t.epochDay === openDay}
              aria-label={`${DAY3[dowOfEpochDay(t.epochDay)]} ${t.date}${t.today ? ', today' : ''}, ${t.icons.length} ${t.icons.length === 1 ? 'session' : 'sessions'}`}
              className={`pg-t7${t.today ? ' is-today' : ''}${t.epochDay === openDay ? ' is-sel' : ''}`}
              onClick={() => { onOpenDay(t.epochDay); setOpenRow(null) }}
            >
              <span className="pg-dn">{t.letter}</span>
              <span className="pg-dd">{t.date}</span>
              {t.icons.map(i => (
                <span key={i.id} className={`pg-ic is-${i.state}`}><SessionIcon kind={i.icon} size={20} label="" /></span>
              ))}
            </button>
          ))}
        </div>
      </div>

      {/* the open day */}
      <div className="db-glass">
        <div className="db-glass-head">
          <FlapLabel text={`${DAY3[dayDate.getUTCDay()]} ${dayDate.getUTCDate()}`} size="sm" tone={isToday ? 'gold' : 'ink'} />
          {isToday && <span>today</span>}
        </div>
        {daySessions.length === 0 && askRows.length === 0 && <p className="wm-prose is-dim pg-empty">No sessions planned.</p>}
        {daySessions.map(s => (
          <div key={s.id} ref={el => { rowEls.current.set(s.id, el) }}>
            <DayBoardRow
              {...rowProps(s)}
              hideAsk={!askHere(s)}
              open={openRow === s.id}
              onToggle={() => setOpenRow(prev => (prev === s.id ? null : s.id))}
            />
          </div>
        ))}
        {askRows.map(s => (
          <div key={`ask-${s.id}`} ref={el => { rowEls.current.set(`ask-${s.id}`, el) }}>
            <DayBoardRow {...rowProps(s)} askOnly open={false} onToggle={() => {}} />
          </div>
        ))}
        {openDay >= todayEpochDay && (
          <button type="button" className="db-add" onClick={openAdd}>+ add session</button>
        )}
      </div>

      {skipFor && <SkipReasonSheet onCommit={commitSkip} onClose={() => setSkipFor(null)} />}
      {replaceFor && <ReplaceReasonSheet onCommit={reason => { void commitReplaceReason(reason) }} onClose={() => setReplaceFor(null)} />}
      {signpost && (signpost.loading ? (
        <CoachSignpost loading onClose={() => setSignpost(null)} />
      ) : (
        <CoachSignpost
          coachLine={signpost.coachLine}
          suggestions={signpost.suggestions}
          reason={signpost.reason}
          onAccept={sug => { const sp = signpost; setSignpost(null); void replaceWith(sp.session, sp.reason, sug) }}
          onShowMore={() => { const sp = signpost; setSignpost(null); openReplacePicker(sp.session, sp.reason) }}
          onClose={() => setSignpost(null)}
        />
      ))}
      {picker && (
        <SessionPicker
          onSelect={handlePick}
          onClose={() => { setPicker(null); setPickerSuggestions(null) }}
          suggestions={pickerSuggestions}
          title={picker.mode === 'replace' ? 'Replace' : undefined}
          subtitle={picker.mode === 'replace' ? `Reason: ${picker.reason}` : undefined}
          filter={picker.mode === 'replace' ? (opt => opt.type !== picker.session.type) : undefined}
        />
      )}
    </>
  )
}

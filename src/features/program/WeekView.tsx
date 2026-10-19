import { useRef, useState } from 'react'

import { FlapLabel, SessionIcon, glowRow, showPop } from '@/design'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { REPLACE_REASONS, SKIP_PLACES, SKIP_REASONS, pmOnlyFor, replaceKeeps } from '@/components/ui/departures'
import { submitBoardPick, submitReplace, submitSkip, submitSkipReason } from '@/lib/boardPick'
import { DayBoardRow } from '@/features/dayboard/DayBoardRow'
import { bodyPlanDetail, dowOfEpochDay, runWalkDetail, sessionDisplayName, strengthPlanDetail, withoutReplaced, type DayBoardSession } from '@/features/dayboard/rowState'
import { DayBack } from '@/features/coach/DayBack'
import { ReasonTiles } from '@/features/coach/ReasonTiles'
import { Rune } from '@/features/coach/Rune'
import { backChanges, runeForDay, runeForSession, type WeekChangesIn } from '@/features/coach/changeView'
import { pickToast } from '@/features/coach/pickToast'
import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import { getWeekLabel } from '@/lib/strengthTemplates'
import { estimatedMinutes } from '@/lib/coach/sessions'

import { dayStrip } from './weekModel'
import './program.css'

// The Program week below the week board (page 33, approved d1 / d2 / d3 /
// d6; page 56): the seven-day tile strip with its runes (tap a day with a
// rune and its back opens in place under the strip), then the open day as
// rows you tap (summary in place) or swipe (REPLACE / SKIP), "+ add session"
// as a quiet line under it. REPLACE opens the Add Session list with the
// optional reason tiles and swaps at once; SKIP is instant and the open row
// offers the reason tiles. Nothing is refused; the coach rebalances.

export interface WeekViewProps {
  sessions: DayBoardSession[]
  weekNumber: number
  /** Monday to Sunday, epoch days. */
  days: number[]
  todayEpochDay: number
  /** The open day (an epoch day in `days`). */
  openDay: number
  onOpenDay: (epochDay: number) => void
  onSessionUpdate: (id: string, patch: Partial<DayBoardSession>) => void
  onSessionAdded: (session: DayBoardSession) => void
  /** The week's changes and runes (page 56). */
  changes: WeekChangesIn | null
  markSeen: (ids: string[]) => void
  onUndo: (id: string) => Promise<boolean>
  /** His own change landed: the week's changes are read again. */
  onChanged: () => void
}

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function isoOfEpochDay(d: number): string {
  return new Date(d * 86400000).toISOString().slice(0, 10)
}

/** The plan line on a to-do row (page 56: "12 min · back and neck", "4 rounds · run 3:30, walk 1:00 · 23 min"). */
function planDetail(s: DayBoardSession, weekNumber: number): string | null {
  const plan = planDetailOf(s, weekNumber)
  // Page 56 6C: a session under way says so first ("under way · 4 rounds · ...").
  return s.status === 'in_progress' ? (plan ? `under way · ${plan}` : 'under way') : plan
}

function planDetailOf(s: DayBoardSession, weekNumber: number): string | null {
  const blockType = s.blockType === 'block_zero' ? 'block_zero' : 'fighter'
  // the raven's plan (page 58 4B): what it is now, and what it was
  const body = bodyPlanDetail(s, weekNumber)
  if (body) return body
  if (s.type === 'strength') return strengthPlanDetail(getWeekLabel(s.blockWeek ?? 1, blockType).replace(/^Block Zero · /, ''), s.contextJson)
  // page 33: a class reads by its type alone ("technical")
  if (s.type === 'mt_class') return null
  if (s.type === 'foundation_run' && blockType === 'block_zero') return runWalkDetail(s, weekNumber)
  const min = estimatedMinutes({ type: s.type, notes: s.notes ?? null, estimatedMin: null }, blockType, weekNumber)
  return s.type === 'mobility' ? `${min} min · back and neck` : `${min} min`
}

/** The row answers on the face (the glow is a box-shadow). */
function glow(el: HTMLElement | null | undefined, tone: 'good' | 'bad') {
  glowRow(el?.querySelector('.db-face') ?? el, tone)
}

function sortDay(list: DayBoardSession[]): DayBoardSession[] {
  return [...list].sort((a, b) => (a.timeSlot === 'pm' ? 1 : 0) - (b.timeSlot === 'pm' ? 1 : 0))
}

export function WeekView({ sessions, weekNumber, days, todayEpochDay, openDay, onOpenDay, onSessionUpdate, onSessionAdded, changes, markSeen, onUndo, onChanged }: WeekViewProps) {
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ mode: 'add'; date: string } | { mode: 'replace'; date: string; session: DayBoardSession; reason: string | null } | null>(null)
  const [pickerSuggestions, setPickerSuggestions] = useState<SuggestionsResponse | null>(null)
  const [skips, setSkips] = useState<Record<string, { changeId: string | null; reason: string | null; detail: string | null }>>({})
  const [backDay, setBackDay] = useState<number | null>(null)
  const rowEls = useRef(new Map<string, HTMLElement | null>())

  // Page 56 1C: a swapped-out session leaves the board; the swap shows.
  const shown = withoutReplaced(sessions)
  const strip = dayStrip(days, shown, todayEpochDay)
  const daySessions = sortDay(shown.filter(s => s.scheduledDate === openDay))
  const backList = backDay != null ? backChanges(changes, backDay) : []

  function loadSuggestions(date: string, mode: 'add' | 'replace', replacing?: string) {
    setPickerSuggestions(null)
    apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${date}&today=${getTodayISO()}${mode === 'replace' ? `&mode=replace&replacing=${replacing ?? ''}` : ''}`)
      .then(setPickerSuggestions)
      .catch(() => setPickerSuggestions(null))
  }

  function openAdd() {
    const date = isoOfEpochDay(openDay)
    setPicker({ mode: 'add', date })
    loadSuggestions(date, 'add')
  }

  function openReplace(s: DayBoardSession) {
    const date = isoOfEpochDay(s.scheduledDate ?? openDay)
    setPicker({ mode: 'replace', date, session: s, reason: null })
    loadSuggestions(date, 'replace', s.type)
  }

  async function handlePick(option: SessionOption) {
    const p = picker
    setPicker(null)
    setPickerSuggestions(null)
    if (!p) return
    try {
      if (p.mode === 'replace') {
        const result = await submitReplace<DayBoardSession>(p.session.id, option, p.reason, getTodayISO())
        onSessionUpdate(result.original.id, result.original)
        onSessionAdded(result.replacement)
        setOpenRow(null)
        const t = pickToast('SWAPPED', result.replacement, todayEpochDay)
        showPop(t.text, 'good', { title: t.title })
      } else {
        const out = await submitBoardPick<DayBoardSession>(option, p.date, getTodayISO())
        if (out.kind === 'added') {
          onSessionAdded(out.session)
        } else {
          onSessionUpdate(out.session.id, out.session)
          for (const d of out.displaced) onSessionUpdate(d.id, d)
        }
        const t = pickToast(out.kind === 'added' ? 'ADDED' : 'MOVED', out.session, todayEpochDay)
        showPop(t.text, 'good', { title: t.title })
      }
      onChanged()
    } catch (e) {
      console.error('Failed to change the day:', e)
      showPop("Couldn't save. Check your connection.", 'bad')
    }
  }

  // SKIP is instant (page 56 item 3): the row opens with the optional reason tiles.
  async function skip(s: DayBoardSession) {
    const prev = s.status
    onSessionUpdate(s.id, { status: 'skipped' })
    setSkips(p => ({ ...p, [s.id]: { changeId: null, reason: null, detail: null } }))
    setOpenRow(s.id)
    try {
      const out = await submitSkip<DayBoardSession>(s.id, getTodayISO())
      setSkips(p => ({ ...p, [s.id]: { ...(p[s.id] ?? { reason: null, detail: null }), changeId: out.changeId } }))
      onChanged()
    } catch (e) {
      console.error('Failed to skip session:', e)
      onSessionUpdate(s.id, { status: prev })
      glow(rowEls.current.get(s.id), 'bad')
      showPop("Couldn't save. Check your connection.", 'bad')
    }
  }

  async function skipReason(id: string, reason: string | null, detail: string | null) {
    const cur = skips[id]
    if (!cur) return
    setSkips(p => ({ ...p, [id]: { ...cur, reason, detail } }))
    if (!cur.changeId || (reason === 'injury' && !detail)) return
    try {
      await submitSkipReason(cur.changeId, reason, detail, getTodayISO())
      onSessionUpdate(id, { skipReason: reason })
      onChanged()
    } catch (e) {
      console.warn('Failed to save the skip reason:', e)
    }
  }

  const dayDate = new Date(openDay * 86400000)
  const isToday = openDay === todayEpochDay

  return (
    <>
      {/* the seven-day tile strip, with the runes (page 56 items 5, 6, 8) */}
      <div className="wm-backwrap">
        <div className="db-glass">
          <div className="pg-tiles7" role="tablist" aria-label="Days of the week">
            {strip.map(t => {
              const rune = runeForDay(changes, t.epochDay)
              return (
                <button
                  key={t.epochDay}
                  type="button"
                  role="tab"
                  data-day={t.epochDay}
                  aria-selected={t.epochDay === openDay}
                  aria-label={`${DAY3[dowOfEpochDay(t.epochDay)]} ${t.date}${t.today ? ', today' : ''}, ${t.icons.length} ${t.icons.length === 1 ? 'session' : 'sessions'}${rune ? (rune.startsWith('miss') ? ', a missed session' : ', the coach changed it') : ''}`}
                  className={`pg-t7${t.today ? ' is-today' : ''}${t.epochDay === openDay ? ' is-sel' : ''}${rune ? ' has-rn' : ''}`}
                  onClick={() => {
                    onOpenDay(t.epochDay)
                    setOpenRow(null)
                    if (rune) {
                      setBackDay(t.epochDay)
                      markSeen(backChanges(changes, t.epochDay).map(c => c.id))
                    }
                  }}
                >
                  <span className="pg-dn">{t.letter}</span>
                  <span className="pg-dd">{t.date}</span>
                  {t.icons.map(i => (
                    <span key={i.id} className={`pg-ic is-${i.state}`}><SessionIcon kind={i.icon} size={20} label="" /></span>
                  ))}
                  {rune && <Rune state={rune} size="tile" />}
                </button>
              )
            })}
          </div>
        </div>
        {backDay != null && backList.length > 0 && (
          <DayBack day={backDay} changes={backList} todayDay={todayEpochDay} onUndo={onUndo} onClose={() => setBackDay(null)} />
        )}
      </div>

      {/* the open day */}
      <div className="db-glass">
        <div className="db-glass-head">
          <FlapLabel text={`${DAY3[dayDate.getUTCDay()]} ${dayDate.getUTCDate()}`} size="sm" tone={isToday ? 'gold' : 'ink'} />
          <span>day board</span>
        </div>
        {daySessions.length === 0 && <p className="wm-prose is-dim pg-empty">No sessions planned.</p>}
        {daySessions.map(s => {
          const sk = s.status === 'skipped' ? skips[s.id] : undefined
          return (
            <div key={s.id} ref={el => { rowEls.current.set(s.id, el) }}>
              <DayBoardRow
                session={s}
                context={{ planDetail: planDetail(s, weekNumber), rune: runeForSession(changes, s.id) }}
                weekNumber={weekNumber}
                onReplace={x => openReplace(x)}
                onSkip={x => { void skip(x) }}
                open={openRow === s.id}
                onToggle={() => setOpenRow(prev => (prev === s.id ? null : s.id))}
                openContent={sk ? (
                  <div className="db-sum">
                    <ReasonTiles tiles={SKIP_REASONS} value={sk.reason} onChange={r => { void skipReason(s.id, r, null) }} />
                    {sk.reason === 'injury' && (
                      <ReasonTiles label={false} tiles={SKIP_PLACES.map(p => ({ value: p, label: p.toUpperCase() }))} value={sk.detail} onChange={d => { void skipReason(s.id, 'injury', d) }} />
                    )}
                  </div>
                ) : undefined}
              />
            </div>
          )
        })}
        {openDay >= todayEpochDay && (
          <button type="button" className="db-add" onClick={openAdd}>+ add session</button>
        )}
      </div>

      {picker && (
        <SessionPicker
          onSelect={option => { void handlePick(option) }}
          onClose={() => { setPicker(null); setPickerSuggestions(null) }}
          suggestions={pickerSuggestions}
          title={picker.mode === 'replace' ? `Replace ${sessionDisplayName(picker.session).toLowerCase()}` : undefined}
          filter={picker.mode === 'replace' ? (opt => replaceKeeps(picker.session, opt)) : undefined}
          pmOnly={pmOnlyFor(picker.date, getTodayISO(), new Date().getHours())}
          reasons={picker.mode === 'replace' ? { tiles: REPLACE_REASONS, value: picker.reason, onChange: reason => setPicker(p => (p && p.mode === 'replace' ? { ...p, reason } : p)) } : undefined}
        />
      )}
    </>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ApiError, apiFetch, idempotencyHeaders } from '@/lib/api'
import { getTodayISO, isoToEpochDay, mondayOf } from '@/lib/dates'
import { submitBoardPick, submitReplace, submitSkip, submitSkipReason } from '@/lib/boardPick'
import { clearResume, loadResume, resumeDecision } from '@/lib/sessionResume'
import { localActiveSession } from '@/lib/workoutCache'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'
import { logger } from '@/lib/logger'
import { endAllLiveActivities } from '@/lib/liveActivity'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { FlapLabel, glowRow, showPop } from '@/design'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { REPLACE_REASONS, pmOnlyFor, replaceKeeps } from '@/components/ui/departures'
import { useToast } from '@/components/ui/Toast'
import { PageErrorScreen } from '@/components/ui/ErrorScreens'
import { iconFor, sessionDisplayName, withoutReplaced } from '@/features/dayboard/rowState'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import { DayBack } from '@/features/coach/DayBack'
import { backChanges, runeForDay, runeForSession } from '@/features/coach/changeView'
import { useWeekChanges } from '@/features/coach/useWeekChanges'
import { pickToast } from '@/features/coach/pickToast'
import { CrestLoading } from '@/world/CrestLoading'
import { setWorldLantern, setWorldPlace } from '@/world/worldStore'

import { ReassignRunSheet } from './ReassignRunSheet'
import { AllDoneBoard, EmptyDayBoard, NoBlockBoard, RestDayBoards, TodayHeader, WaybookLine, WeekStrip } from './TodayBoards'
import { TodayDay, type TodaySession } from './TodayDay'
import { ALL_DONE_AFTER_CONFIRM_MS, fadesToAllDone, lanternFor, showsHome, todayMode, tomorrowLine, weekStripDays, type StripSession } from './weekStrip'
import { CheckInDeck } from '@/features/blockZero/CheckInDeck'
import { answersFromLog, isCheckInComplete, mergeAnswers, shouldOpenCheckIn, type CheckInAnswers } from '@/features/blockZero/checkInFlow'
import { CHECK_IN_EVENT, clearCheckInDraft, loadCheckInDraft, saveCheckInDraft, takeCheckInRequest } from '@/features/blockZero/checkInTrigger'
import { readinessLine, type ReadinessIn } from '@/features/blockZero/readinessLine'
import { MorningReportRow } from '@/features/blockZero/TodayPieces'
import { useBodyWatch } from '@/features/raven/bodyWatch'
import { useRavenOnToday } from '@/features/raven/useRaven'
import './today.css'

/** The day's fade out, and ALL DONE's fade in, after the last Strava confirm. */
const ALL_DONE_FADE_MS = 400

type Session = TodaySession & { startedAt: number | null; completedAt: number | null; durationSec: number | null; rpe: number | null; notes: string | null }

interface DailyLog {
  id: string
  sleepHours: number | null
  herbScale?: number | null
  alcoholScale?: number | null
  soreness?: number | null
  sleepQuality?: number | null
  energy?: number | null
  stress?: number | null
  mood?: number | null
  backToday?: number | null
  backNotes?: string | null
  notes?: string | null
  regionRatingsJson?: string | null
}

interface CurrentBlock {
  id: string
  blockType: string
  currentWeek?: number
  /** Today's training week; leadIn on a mid-week start's days before week 1. */
  trainingWeek?: { leadIn?: boolean }
}

interface WeekPlanRow { id: string; weekNumber: number; whyLine?: string | null }
interface WeekPayload { week: WeekPlanRow; sessions: Array<StripSession & { label?: string | null }> }

// Session types that have a dedicated workout engine
const WORKOUT_SESSION_TYPES = ['strength', 'mobility', 'bag_work', 'running', 'skip_rope', 'active_recovery', 'mt_class', 'foundation_run']

const MAX_HR_LS_KEY = 'waymark_last_seen_max_hr'

export function TodayPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { show: showToast, ToastContainer } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [dailyLog, setDailyLog] = useState<DailyLog | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  // The day couldn't be read (API unreachable): page 38's page error, not an empty day.
  const [loadFailed, setLoadFailed] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerSuggestions, setPickerSuggestions] = useState<SuggestionsResponse | null>(null)
  // REPLACE (page 56 item 1): the Add Session list with optional reason tiles; a pick swaps at once.
  const [replaceFor, setReplaceFor] = useState<{ sessionId: string; reason: string | null } | null>(null)
  // SKIP (page 56 item 3): instant; the open row then offers the reason tiles.
  const [skips, setSkips] = useState<Record<string, { changeId: string | null; reason: string | null; detail: string | null }>>({})
  const [openRow, setOpenRow] = useState<string | null>(null)
  // The day's back (page 56 item 8): the day open under the strip.
  const [backDay, setBackDay] = useState<number | null>(null)
  const [changesVersion, setChangesVersion] = useState(0)
  // The week strip read again when the raven's plan changes the week (page 58).
  const [weekVersion, setWeekVersion] = useState(0)
  const [reassignFor, setReassignFor] = useState<{ activityId: number; sessionId: string } | null>(null)
  const [readiness, setReadiness] = useState<ReadinessIn | null>(null)
  const [block, setBlock] = useState<CurrentBlock | null>(null)
  // True once /blocks/current answered (so null means "no active block", not "still loading").
  const [blockChecked, setBlockChecked] = useState(false)
  const [week, setWeek] = useState<WeekPayload | null | undefined>(undefined)
  const [nextWeek, setNextWeek] = useState<WeekPayload | null>(null)
  const [showDayAnyway, setShowDayAnyway] = useState(false)
  const [deck, setDeck] = useState<{ startAt: number; firstOpen: boolean } | null>(null)
  const autoResumeAttempted = useRef(false)
  const [slowLoad, setSlowLoad] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlowLoad(true), 400)
    return () => window.clearTimeout(t)
  }, [])

  const today = getTodayISO()
  const todayEpoch = isoToEpochDay(today)
  const todayDate = new Date(`${today}T12:00:00`)

  useEffect(() => {
    void endAllLiveActivities()
  }, [])

  const refreshSessions = useCallback(async (): Promise<Session[] | null> => {
    try {
      const next = await apiFetch<Session[]>(`/api/sessions/today?date=${today}`)
      setSessions(next)
      return next
    } catch (e) {
      console.error('Failed to refresh sessions:', e)
      return null
    }
  }, [today])

  // A Strava confirm of the evening's last session (page 46): LOGGED and the row glow, then about
  // 2 s later the day fades out and the evening ALL DONE (page 43) fades in.
  const [allDoneFade, setAllDoneFade] = useState<'leaving' | 'arriving' | null>(null)
  const fadeTimers = useRef<number[]>([])
  useEffect(() => () => { fadeTimers.current.forEach(t => window.clearTimeout(t)) }, [])
  const fadeToAllDone = useCallback(() => {
    const at = (ms: number, fn: () => void) => { fadeTimers.current.push(window.setTimeout(fn, ms)) }
    at(ALL_DONE_AFTER_CONFIRM_MS, () => setAllDoneFade('leaving'))
    at(ALL_DONE_AFTER_CONFIRM_MS + ALL_DONE_FADE_MS, () => {
      setShowDayAnyway(false)
      setAllDoneFade('arriving')
      // the home is drawn from the top (page 43), wherever the confirm left the scroll
      document.querySelector('main')?.scrollTo({ top: 0 })
    })
    at(ALL_DONE_AFTER_CONFIRM_MS + ALL_DONE_FADE_MS * 3, () => setAllDoneFade(null))
  }, [])

  const refreshReadiness = useCallback(async (): Promise<ReadinessIn | null> => {
    try {
      const r = await apiFetch<ReadinessIn>(`/api/readiness/today?date=${today}`)
      setReadiness(r)
      return r
    } catch {
      return null
    }
  }, [today])

  // The morning alarm's I'M UP while Today is already open.
  useEffect(() => {
    const open = () => {
      takeCheckInRequest()
      setDeck({ startAt: 'resume' })
    }
    window.addEventListener(CHECK_IN_EVENT, open)
    return () => window.removeEventListener(CHECK_IN_EVENT, open)
  }, [])

  useEffect(() => {
    // Today's auto-resume into a session is off when the route, the URL or a recent exit says so.
    function autoResumeSuppressed(): boolean {
      const suppressFromRoute = Boolean((location.state as { suppressAutoResume?: boolean } | null)?.suppressAutoResume)
      const suppressFromSearch = new URLSearchParams(location.search).get('resume') === '0'
      let suppressUntil = 0
      try {
        suppressUntil = Number(sessionStorage.getItem('waymark_suppress_auto_resume_until') ?? 0)
      } catch {
        suppressUntil = 0
      }
      return suppressFromRoute || suppressFromSearch || (Number.isFinite(suppressUntil) && Date.now() <= suppressUntil)
    }
    async function load() {
      try {
        const [sessionsData, logData] = await Promise.all([
          apiFetch<Session[]>(`/api/sessions/today?date=${today}`),
          apiFetch<DailyLog | null>(`/api/daily-logs/today?date=${today}`),
        ])
        setSessions(sessionsData)
        setDailyLog(logData)
        setLoadFailed(false)
        apiFetch<CurrentBlock | null>(`/api/blocks/current?date=${today}`).then(b => { setBlock(b); setBlockChecked(true) }).catch(() => { setBlock(null); setWeek(null) })
        void refreshReadiness()
        if (!autoResumeAttempted.current) {
          autoResumeAttempted.current = true
          // Reopened mid-session (app killed, reload): straight back into it.
          // Any engine with a fresh save on this phone, and strength as
          // before. An older save waits for a tap on Resume (the session
          // screen then asks: resume or end).
          let storage: Storage | null = null
          try { storage = window.localStorage } catch { storage = null }
          const activeSession = sessionsData.find(session =>
            session.status === 'in_progress' &&
            WORKOUT_SESSION_TYPES.includes(session.type) &&
            (() => {
              const saved = loadResume(storage, session.id)
              return saved ? resumeDecision(saved, Date.now()) === 'resume' : session.type === 'strength'
            })()
          )
          if (activeSession && !autoResumeSuppressed()) {
            navigate(`/session/${activeSession.id}`, { replace: true })
            return
          }
        }
        // Every open until all nine are in (or the alarm's I'M UP): the check-in cards, at the first unanswered one.
        if (shouldOpenCheckIn({ answers: checkInAnswersFor(logData, today), requested: takeCheckInRequest() })) {
          setDeck({ startAt: 'resume' })
        }
      } catch (e) {
        // Reopened offline mid-session: the session screen carries on from this
        // phone's own copy, so go straight back into it instead of an error.
        if (e instanceof ApiError && e.type === 'network' && !autoResumeAttempted.current) {
          autoResumeAttempted.current = true
          let storage: Storage | null = null
          try { storage = window.localStorage } catch { storage = null }
          const localId = autoResumeSuppressed()
            ? null
            : localActiveSession(storage, { types: WORKOUT_SESSION_TYPES, todayEpochDay: isoToEpochDay(today), nowMs: Date.now() })
          if (localId) {
            navigate(`/session/${localId}`, { replace: true })
            return
          }
        }
        console.error('Failed to load today data:', e)
        setDailyLog(null)
        setLoadFailed(true)
      } finally {
        setLoaded(true)
      }
    }
    load()
  }, [today, refreshReadiness, navigate, location.search, location.state])

  // This week's plan: the week strip, the why line, and whether an empty day is a planned rest.
  useEffect(() => {
    if (!block?.id || block.currentWeek == null) return
    let cancelled = false
    // A mid-week start: the lead-in and next Monday's week 1 are both week 1.
    const leadIn = block.trainingWeek?.leadIn === true
    apiFetch<WeekPayload | null>(`/api/weeks/current?blockId=${block.id}&weekNumber=${block.currentWeek}${leadIn ? '&leadIn=1' : ''}`)
      .then(w => {
        if (cancelled) return
        setWeek(w)
      })
      .catch(() => { if (!cancelled) setWeek(null) })
    // Sunday's rest points at Monday, which belongs to next week's plan.
    if (todayEpoch + 1 > mondayOf(todayEpoch) + 6) {
      apiFetch<WeekPayload | null>(`/api/weeks/current?blockId=${block.id}&weekNumber=${leadIn ? 1 : block.currentWeek + 1}`).then(w => { if (!cancelled) setNextWeek(w) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [block?.id, block?.currentWeek, block?.trainingWeek?.leadIn, todayEpoch, weekVersion])

  // Silent Strava poll on mount. Refreshes Today once ingestion completes so
  // new matches / orphans appear without a reload. Surfaces max-HR bumps as a
  // one-time pop-up.
  useEffect(() => {
    async function poll() {
      try {
        const result = await apiFetch<{ ingested: number; connected: boolean; error?: string }>('/api/strava/poll-recent', { method: 'POST' })
        if (result.connected && result.ingested > 0) {
          await refreshSessions()
        }
        if (result.connected) {
          await checkMaxHrBump()
        }
        if (result.connected && result.error) {
          logger.warn('system', 'strava poll returned error', { error: result.error }, 'Strava poll returned error. Activity match skipped this tick.')
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('system', 'strava poll threw', { message }, 'Strava poll threw. Network or auth issue.')
      }
    }
    async function checkMaxHrBump() {
      try {
        const profile = await apiFetch<{ maxHr: number | null } | null>('/api/user-profile')
        if (!profile || profile.maxHr == null) return
        const lastSeen = Number(storageGet(MAX_HR_LS_KEY) ?? '0')
        if (profile.maxHr > lastSeen) {
          storageSet(MAX_HR_LS_KEY, String(profile.maxHr))
          if (lastSeen > 0) {
            showToast(`Max HR now ${profile.maxHr}. Zones updated.`, 'info')
          }
        }
      } catch {
        // profile fetch failed; skip bump notice.
      }
    }
    poll()
  }, [refreshSessions, showToast])

  // ── what Today shows, and the world behind it ──
  const weekSessions = week === undefined ? null : (week?.sessions ?? null)
  const mode = !loaded ? 'loading' : todayMode({ today: sessions, weekSessions, hour: new Date().getHours(), showDayAnyway })
  useEffect(() => {
    if (mode === 'loading') return
    setWorldPlace(showsHome(mode) ? 'home' : 'clearing')
  }, [mode])
  useEffect(() => () => setWorldPlace('clearing'), [])
  useEffect(() => { setWorldLantern(lanternFor(readiness)) }, [readiness])

  // The week's changes and runes (page 56): Dagaz where the coach changed a day, Algiz where a session was missed.
  const { week: changes, markSeen, undo } = useWeekChanges(block ? mondayOf(todayEpoch) : null, changesVersion)
  const strip = useMemo(() => (week?.sessions ? weekStripDays(withoutReplaced(week.sessions), mondayOf(todayEpoch), todayEpoch, d => runeForDay(changes, d)) : null), [week, todayEpoch, changes])
  const rowRunes = useMemo(() => Object.fromEntries(sessions.map(s => [s.id, runeForSession(changes, s.id)])), [sessions, changes])
  const backList = useMemo(() => (backDay != null ? backChanges(changes, backDay) : []), [changes, backDay])
  // The raven (page 58): on the Morning Report, its boards, and the return's question on top.
  const bodyWatch = useBodyWatch()
  const { raven, overlay: ravenOverlay } = useRavenOnToday(() => { void refreshSessions(); setChangesVersion(v => v + 1); setWeekVersion(v => v + 1) })
  const tomorrow = useMemo(() => {
    const pool = [...(week?.sessions ?? []), ...(nextWeek?.sessions ?? [])].filter(s => s.scheduledDate === todayEpoch + 1)
    return pool
  }, [week, nextWeek, todayEpoch])

  async function handleGenerate() {
    setGenerating(true)
    try {
      const created = await apiFetch<Session[]>('/api/sessions/generate-today', {
        method: 'POST',
        body: JSON.stringify({ date: today }),
      })
      setSessions(created)
    } catch (e) {
      console.error('Failed to generate plan:', e)
      showToast("Couldn't prepare the day. Check your connection.", 'warning')
    } finally {
      setGenerating(false)
    }
  }

  async function handleStart(id: string) {
    const session = sessions.find((s) => s.id === id)
    if (!session) {
      logger.warn('session', 'Enter pressed for unknown session', { id }, 'Enter tapped but session id not in today list. Stale UI state.')
      showToast("Session not found. Refresh and try again.", 'warning')
      return
    }

    logger.sessionEvent('Enter pressed', { sessionId: id, type: session.type, status: session.status })

    // Sessions with dedicated workout engines
    if (WORKOUT_SESSION_TYPES.includes(session.type)) {
      // Resume: the session screen loads its rows and saved step itself.
      if (session.status === 'in_progress') {
        navigate(`/session/${id}`)
        return
      }
      try {
        const typeEndpoints: Record<string, string> = {
          foundation_run: `/api/sessions/${id}/start-foundation-run`,
          mobility: `/api/sessions/${id}/start-mobility`,
          strength: `/api/sessions/${id}/start-strength`,
          bag_work: `/api/sessions/${id}/start-bag-work`,
          running: `/api/sessions/${id}/start-run`,
          skip_rope: `/api/sessions/${id}/start-skip-rope`,
          active_recovery: `/api/sessions/${id}/start-recovery`,
          mt_class: `/api/sessions/${id}/start-mt-class`,
        }
        const startEndpoint = typeEndpoints[session.type] ?? `/api/sessions/${id}/start-strength`
        await apiFetch(startEndpoint, { method: 'POST' })
        navigate(`/session/${id}`)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('Failed to start session:', e)
        logger.error('session', 'start-session failed', { sessionId: id, type: session.type, message }, 'POST /sessions/:id/start failed. Session not entered.')
        showToast("Couldn't start. Check logs in Settings.", 'warning')
      }
      return
    }

    // Other session types: just update status
    const nowSec = Math.floor(Date.now() / 1000)
    const prevSessions = sessions
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: 'in_progress', startedAt: nowSec } : s
      )
    )
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress', startedAt: nowSec }),
      })
    } catch (e) {
      setSessions(prevSessions)
      const message = e instanceof Error ? e.message : String(e)
      console.error('Failed to start session:', e)
      logger.error('session', 'patch start-session failed', { sessionId: id, message }, 'PATCH /sessions/:id status=in_progress failed. Session state inconsistent.')
      showToast("Couldn't start. Check logs in Settings.", 'warning')
    }
  }

  // SKIP is instant (page 56 item 3): the row stays open with the optional reason tiles.
  async function handleSkip(id: string) {
    const prevSessions = sessions
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, status: 'skipped' } : s)))
    setSkips(prev => ({ ...prev, [id]: { changeId: null, reason: null, detail: null } }))
    setOpenRow(id)
    try {
      const out = await submitSkip<Session>(id, getTodayISO())
      setSkips(prev => ({ ...prev, [id]: { ...(prev[id] ?? { reason: null, detail: null }), changeId: out.changeId } }))
      setChangesVersion(v => v + 1)
    } catch (e) {
      setSessions(prevSessions)
      setSkips(prev => { const next = { ...prev }; delete next[id]; return next })
      console.error('Failed to skip session:', e)
      showToast("Couldn't save. Check your connection.", 'warning')
    }
  }

  async function handleSkipReason(id: string, reason: string | null, detail: string | null) {
    const cur = skips[id]
    if (!cur) return
    setSkips(prev => ({ ...prev, [id]: { ...cur, reason, detail } }))
    // INJURY / PAIN waits for its place.
    if (!cur.changeId || (reason === 'injury' && !detail)) return
    try {
      await submitSkipReason(cur.changeId, reason, detail, getTodayISO())
      setSessions(prev => prev.map(s => (s.id === id ? { ...s, skipReason: reason } : s)))
      setChangesVersion(v => v + 1)
    } catch (e) {
      console.warn('Failed to save the skip reason:', e)
    }
  }

  async function handleEndEarly(id: string, action: 'completed' | 'reset') {
    const nowSec = Math.floor(Date.now() / 1000)
    // Ended on purpose (held x, then a choice): the saved step goes with it.
    try { clearResume(window.localStorage, id) } catch { /* storage unavailable */ }
    const prevSessions = sessions
    if (action === 'completed') {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'completed', completedAt: nowSec } : s)),
      )
      try {
        await apiFetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed', completedAt: nowSec }),
        })
      } catch (e) {
        setSessions(prevSessions)
        console.error('Failed to end session early (completed):', e)
        showToast("Couldn't save. Check your connection.", 'warning')
      }
    } else {
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'planned', startedAt: null, completedAt: null } : s)),
      )
      try {
        await apiFetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'planned', startedAt: null, completedAt: null }),
        })
      } catch (e) {
        setSessions(prevSessions)
        console.error('Failed to end session early (reset):', e)
        showToast("Couldn't save. Check your connection.", 'warning')
      }
    }
  }

  // REPLACE (page 56 item 1): the same list as + add session, with the reason tiles on top.
  function handleReplaceStart(id: string) {
    setReplaceFor({ sessionId: id, reason: null })
    setPickerSuggestions(null)
    apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}&today=${getTodayISO()}&mode=replace&replacing=${sessions.find(s => s.id === id)?.type ?? ''}`)
      .then(setPickerSuggestions)
      .catch(() => setPickerSuggestions(null))
  }

  async function handleReplaceSelect(option: SessionOption) {
    const r = replaceFor
    setReplaceFor(null)
    setPickerSuggestions(null)
    if (!r) return
    try {
      const result = await submitReplace<Session>(r.sessionId, option, r.reason, getTodayISO())
      setSessions(prev => [...prev.map(s => (s.id === result.original.id ? result.original : s)), result.replacement]
        .sort((a, b) => (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)))
      setOpenRow(null)
      // The approved pop-up and the row glow; his own change gets no rune.
      const t = pickToast('SWAPPED', result.replacement, todayEpoch)
      showPop(t.text, 'good', { title: t.title })
      requestAnimationFrame(() => glowRow(document.querySelector(`.td-row[data-sid="${CSS.escape(result.replacement.id)}"]`), 'good'))
      setChangesVersion(v => v + 1)
    } catch (e) {
      console.error('Failed to replace session:', e)
      showToast("Couldn't replace. Check your connection.", 'warning')
    }
  }

  function openAddPicker() {
    setShowPicker(true)
    apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}&today=${getTodayISO()}`)
      .then(setPickerSuggestions)
      .catch(() => setPickerSuggestions(null))
  }

  // + Add session always adds (page 56 item 4); the coach rebalances the rest.
  async function handleAddSession(option: SessionOption) {
    setShowPicker(false)
    try {
      const out = await submitBoardPick<Session>(option, getTodayISO(), getTodayISO())
      const created = out.session
      if (out.kind === 'added') {
        setSessions(prev => [...prev, created].sort((a, b) =>
          (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)
        ))
      } else {
        await refreshSessions()
      }
      const t = pickToast(out.kind === 'added' ? 'ADDED' : 'MOVED', created, todayEpoch)
      showPop(t.text, 'good', { title: t.title })
      requestAnimationFrame(() => glowRow(document.querySelector(`.td-row[data-sid="${CSS.escape(created.id)}"]`), 'good'))
      setChangesVersion(v => v + 1)
      // MT Class tonight moves things around the day: read the day again.
      if (option.type === 'mt_class') void refreshSessions()
    } catch (e) {
      console.error('Failed to add session:', e)
      showToast("Couldn't add. Check your connection.", 'warning')
    }
  }

  async function handleConfirmMatch(activityId: number, sessionId: string, card: HTMLElement | null) {
    try {
      await apiFetch(`/api/strava/activity/${activityId}/confirm`, { method: 'POST' })
      // The confirmed row stays on screen to answer the tap (page 40), even when it was the
      // evening's last session; ALL DONE (page 43) shows the next time Today opens.
      setShowDayAnyway(true)
      const next = await refreshSessions()
      // Page 40 phone 2: LOGGED drops in and the run's row, now done, glows teal.
      showToast('Logged.', 'success')
      requestAnimationFrame(() => glowRow(document.querySelector(`.td-row[data-sid="${CSS.escape(sessionId)}"]`), 'good'))
      // The day's last session in the evening: then it fades to ALL DONE (page 46).
      if (next && fadesToAllDone(next, new Date().getHours())) fadeToAllDone()
    } catch (e) {
      console.error('Failed to confirm match:', e)
      glowRow(card, 'bad')
      showToast("Couldn't save. Check your connection.", 'warning')
    }
  }

  function handleReassignStart(activityId: number) {
    const target = sessions.find(s => s.runSession?.stravaActivityId === activityId)
    if (!target) return
    setReassignFor({ activityId, sessionId: target.id })
  }

  async function handleReassignPick(newSessionId: string) {
    if (!reassignFor) return
    const { activityId } = reassignFor
    setReassignFor(null)
    try {
      await apiFetch(`/api/strava/activity/${activityId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ newSessionId }),
      })
      await refreshSessions()
      showToast('Reassigned.', 'success')
    } catch (e) {
      console.error('Failed to reassign match:', e)
    }
  }

  async function handleDismissMatch(activityId: number) {
    try {
      await apiFetch(`/api/strava/activity/${activityId}/dismiss`, { method: 'POST' })
      await refreshSessions()
    } catch (e) {
      console.error('Failed to dismiss match:', e)
    }
  }

  // The check-in cards save here; the readiness read comes back for the closing line.
  const handleCheckInSubmit = useCallback(async (body: Record<string, unknown>): Promise<ReadinessIn | null> => {
    const log = await apiFetch<DailyLog>('/api/daily-logs', {
      method: 'POST',
      headers: idempotencyHeaders(),
      body: JSON.stringify(body),
    })
    setDailyLog(log)
    clearCheckInDraft()
    return refreshReadiness()
  }, [refreshReadiness])

  // Each answer as it is given: kept on this phone at once, then sent as a partial log
  // (the server holds back the coach's check-in rules until the full save).
  const handleCheckInPartial = useCallback((body: Record<string, unknown>, answers: CheckInAnswers, backNotes: string) => {
    saveCheckInDraft(today, answers, backNotes)
    apiFetch<DailyLog>('/api/daily-logs', { method: 'POST', body: JSON.stringify({ ...body, partial: true }) })
      .then(log => setDailyLog(log))
      .catch(e => logger.warn('system', 'partial check-in not sent', { message: e instanceof Error ? e.message : String(e) }, 'Kept on this phone; sent with the next answer.'))
  }, [today])

  // Today back in the foreground (the app reopened from the background): the cards again while any of the nine is missing.
  useEffect(() => {
    let last = 0
    const onForeground = () => {
      if (Date.now() - last < 1500) return
      last = Date.now()
      if (deckOpenRef.current) return
      apiFetch<DailyLog | null>(`/api/daily-logs/today?date=${today}`)
        .then(log => {
          setDailyLog(log)
          if (!deckOpenRef.current && shouldOpenCheckIn({ answers: checkInAnswersFor(log, today), requested: takeCheckInRequest() })) setDeck({ startAt: 'resume' })
        })
        .catch(() => {
          // offline: what this phone holds decides
          if (!deckOpenRef.current && shouldOpenCheckIn({ answers: checkInAnswersFor(null, today), requested: false })) setDeck({ startAt: 'resume' })
        })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') onForeground() }
    document.addEventListener('visibilitychange', onVisible)
    let removeNative: (() => void) | null = null
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('resume', onForeground).then(h => { removeNative = () => { void h.remove() } })
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      removeNative?.()
    }
  }, [today])

  const handleCheckInClose = useCallback(() => setDeck(null), [])

  if (loading) {
    // A quick load shows the world alone; only a slow one brings the crest apart (it snaps together when done).
    if (!slowLoad) return loaded ? <LoadedNow onReady={() => setLoading(false)} /> : null
    return <CrestLoading message="Reading your profile." done={loaded} onDone={() => setLoading(false)} />
  }

  // E2E minor 10: an unreachable API showed NOTHING TODAY. Page 38 "A page": what didn't load, nothing lost, RELOAD.
  if (loadFailed) return <PageErrorScreen pathname="/today" onReload={() => window.location.reload()} />

  const replaceTarget = replaceFor ? sessions.find(s => s.id === replaceFor.sessionId) : null
  const doneIcons = sessions.filter(s => s.status === 'completed').map(s => iconFor(s))
  const tomorrowIcons = tomorrow.map(s => iconFor({ type: s.type, notes: s.notes ?? null }))
  const newWeekTomorrow = todayEpoch + 1 > mondayOf(todayEpoch) + 6 ? nextWeek?.week?.weekNumber ?? null : null
  const tomorrowText = tomorrowLine(tomorrow, s => sessionDisplayName({ type: s.type, label: s.label ?? null, notes: s.notes ?? null }), newWeekTomorrow)
  const home = showsHome(mode)
  // CHECK IN until all nine are in; partial answers don't count as logged.
  const morningAnswers = checkInAnswersFor(dailyLog ?? null, today)
  const morningLogged = isCheckInComplete(morningAnswers)

  return (
    <div className="td-page">
      <div className={`td-fill${allDoneFade ? ` is-${allDoneFade}` : ''}`}>
      <TodayHeader date={todayDate} />
      {strip && (
        <div className="wm-backwrap">
          <WeekStrip
            days={strip}
            home={showsHome(mode)}
            openDay={backDay}
            onRune={d => {
              setBackDay(d)
              markSeen(backChanges(changes, d).map(c => c.id))
            }}
          />
          {backDay != null && backList.length > 0 && (
            <DayBack
              day={backDay}
              changes={backList}
              todayDay={todayEpoch}
              onUndo={async id => {
                const ok = await undo(id)
                if (ok) await refreshSessions()
                else showPop("Couldn't put it back. It may have started.", 'bad')
                return ok
              }}
              onClose={() => setBackDay(null)}
            />
          )}
        </div>
      )}

      {mode === 'day' && (
        <>
          {/* page 56 item 14: the Morning Report row: CHECK IN, then LOGGED and the readiness line; tap for the why */}
          <MorningReportRow logged={morningLogged} readiness={readinessLine(readiness)} onOpen={() => setDeck({ startAt: morningLogged ? 0 : 'resume' })} raven={raven} />
          {/* the clearing and its lantern show between the top and the boards (pages 17, 35, 56) */}
          <div className="td-spacer" style={{ minHeight: strip ? '16dvh' : '24dvh' }} />
          <TodayDay
            sessions={withoutReplaced(sessions)}
            weekNumber={block?.currentWeek ?? null}
            onStart={handleStart}
            onSkip={id => { void handleSkip(id) }}
            onReplace={handleReplaceStart}
            onEndEarly={handleEndEarly}
            onConfirmMatch={handleConfirmMatch}
            onReassignMatch={handleReassignStart}
            onDismissMatch={handleDismissMatch}
            onAdd={openAddPicker}
            runes={rowRunes}
            skipReasons={skips}
            onSkipReason={(id, reason, detail) => { void handleSkipReason(id, reason, detail) }}
            openId={openRow}
            onOpenChange={setOpenRow}
          />
          <WaybookLine today={today} />
        </>
      )}

      {home && (
        <>
          {/* page 43: the hobbit home fills the screen behind; the boards sit low, the Waybook last */}
          <div className="td-spacer" />
          {mode === 'rest' && <RestDayBoards tomorrow={tomorrowIcons} tomorrowLine={tomorrowText} />}
          {mode === 'unprepared' && (blockChecked && !block
            ? <NoBlockBoard onStart={() => navigate('/program')} />
            : <EmptyDayBoard onPrepare={handleGenerate} preparing={generating} />)}
          {mode === 'allDone' && <AllDoneBoard icons={doneIcons} onShowDay={() => setShowDayAnyway(true)} />}
          <WaybookLine today={today} variant="home" />
        </>
      )}
      </div>

      <button type="button" onClick={() => navigate('/settings')} aria-label="Settings" className="td-settings">
        <FlapLabel text="SETTINGS" size="xs" tone="dim" animate={false} />
      </button>

      {showPicker && (
        <SessionPicker
          onSelect={handleAddSession}
          onClose={() => { setShowPicker(false); setPickerSuggestions(null) }}
          suggestions={pickerSuggestions}
          pmOnly={pmOnlyFor(today, getTodayISO(), new Date().getHours())}
        />
      )}

      {replaceFor && (
        <SessionPicker
          onSelect={option => { void handleReplaceSelect(option) }}
          onClose={() => { setReplaceFor(null); setPickerSuggestions(null) }}
          suggestions={pickerSuggestions}
          title={replaceTarget ? `Replace ${sessionDisplayName(replaceTarget).toLowerCase()}` : 'Replace'}
          filter={opt => !replaceTarget || replaceKeeps(replaceTarget, opt)}
          pmOnly={pmOnlyFor(today, getTodayISO(), new Date().getHours())}
          reasons={{ tiles: REPLACE_REASONS, value: replaceFor.reason, onChange: reason => setReplaceFor(r => (r ? { ...r, reason } : r)) }}
        />
      )}

      {reassignFor && (
        <ReassignRunSheet
          open
          onClose={() => setReassignFor(null)}
          onSelect={handleReassignPick}
          excludeSessionId={reassignFor.sessionId}
        />
      )}

      {deck && (
        <CheckInDeck
          // a place on watch adds its card (page 58): the deck starts over if the watch answers after it opened
          key={(bodyWatch?.checkIn ?? []).map(c => c.region).join(',')}
          date={today}
          existing={morningAnswers}
          existingBackNotes={dailyLog?.backNotes ?? loadCheckInDraft(today)?.backNotes ?? null}
          startAt={deck.startAt}
          onSubmit={handleCheckInSubmit}
          onPartial={handleCheckInPartial}
          onClose={handleCheckInClose}
          note={dailyLog?.notes ?? null}
          onNoteSaved={log => setDailyLog(log as DailyLog)}
          regions={bodyWatch?.checkIn ?? []}
        />
      )}

      {ravenOverlay}


      <ToastContainer />
    </div>
  )
}

/** Today's answers: the server's log with this phone's unsent ones laid over it. */
function checkInAnswersFor(log: DailyLog | null | undefined, today: string): CheckInAnswers {
  return mergeAnswers(answersFromLog(log ?? null), loadCheckInDraft(today)?.answers)
}

/** Loaded before the crest was needed: show the page on the next tick. */
function LoadedNow({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady() }, [onReady])
  return null
}

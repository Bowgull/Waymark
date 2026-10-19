import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { getTodayISO, isoToEpochDay, mondayOf } from '@/lib/dates'
import { parseRefusal, refusalMessage } from '@/lib/refusal'
import { submitBoardPick } from '@/lib/boardPick'
import { clearResume, loadResume, resumeDecision } from '@/lib/sessionResume'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'
import { logger } from '@/lib/logger'
import { endAllLiveActivities } from '@/lib/liveActivity'

import { FlapLabel, glowRow, sessionIconFor, type SessionIconKey } from '@/design'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { CoachSignpost } from '@/components/ui/CoachSignpost'
import { useToast } from '@/components/ui/Toast'
import { SkipReasonSheet, type SkipReasonCommit } from '@/features/session/SkipReasonSheet'
import { ReplaceReasonSheet } from '@/features/session/ReplaceReasonSheet'
import { iconFor, sessionDisplayName } from '@/features/dayboard/rowState'
import type { ReplaceSuggestion, ReplaceSuggestionsOutput } from '@/lib/prompts/tools'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import type { CoachSummary } from '@/lib/coach/summary'
import { CrestLoading } from '@/world/CrestLoading'
import { setWorldLantern, setWorldPlace } from '@/world/worldStore'

import { ReassignRunSheet } from './ReassignRunSheet'
import { AskBoard } from './AskBoard'
import { askView, isAsk, type AskRow, type AskView } from './askView'
import { AllDoneBoard, CoachBoard, EmptyDayBoard, NoBlockBoard, RestDayBoards, TodayHeader, WaybookLine, WeekStrip, type CoachChangeLine, type CoachQuestionLine } from './TodayBoards'
import { TodayDay, type TodaySession } from './TodayDay'
import { ALL_DONE_AFTER_CONFIRM_MS, fadesToAllDone, lanternFor, shortWhy, showsHome, todayMode, tomorrowLine, weekStripDays, type StripSession } from './weekStrip'
import { CheckInDeck } from '@/features/blockZero/CheckInDeck'
import { answersFromLog, answeredCount, shouldOpenCheckIn } from '@/features/blockZero/checkInFlow'
import { CHECK_IN_EVENT, checkInSkippedOn, markCheckInSkipped, takeCheckInRequest } from '@/features/blockZero/checkInTrigger'
import { readinessLine, type ReadinessIn } from '@/features/blockZero/readinessLine'
import { MorningReportRow, type ClassTonightView } from '@/features/blockZero/TodayPieces'
import { classTonightFrom } from '@/lib/blockZero/classTonight'
import './today.css'

/** The day's fade out, and ALL DONE's fade in, after the last Strava confirm. */
const ALL_DONE_FADE_MS = 400

type Session = TodaySession & { startedAt: number | null; completedAt: number | null; durationSec: number | null; rpe: number | null; notes: string | null }

interface DailyLog {
  id: string
  sleepHours: number | null
  weedGrams?: number | null
  alcoholScale?: number | null
  soreness?: number | null
  sleepQuality?: number | null
  energy?: number | null
  stress?: number | null
  mood?: number | null
  backToday?: number | null
  backNotes?: string | null
  notes?: string | null
}

interface CurrentBlock {
  id: string
  blockType: string
  currentWeek?: number
}

interface WeekPlanRow { id: string; weekNumber: number; whyLine?: string | null }
interface WeekPayload { week: WeekPlanRow; sessions: Array<StripSession & { label?: string | null }> }
interface AdjustmentRow extends AskRow { sessionType?: string | null; createdAt?: number }

// Session types that have a dedicated workout engine
const WORKOUT_SESSION_TYPES = ['strength', 'mobility', 'bag_work', 'running', 'skip_rope', 'active_recovery', 'mt_class', 'foundation_run']

const MAX_HR_LS_KEY = 'waymark_last_seen_max_hr'
const REPLACE_SUGGESTIONS_TIMEOUT_MS = 45_000

// An ask shows itself as a centred board once per app open; "later" leaves it on the Coach board.
const asksShownThisOpen = new Set<string>()

export function TodayPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { show: showToast, ToastContainer } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [dailyLog, setDailyLog] = useState<DailyLog | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerSuggestions, setPickerSuggestions] = useState<SuggestionsResponse | null>(null)
  const [skipReasonFor, setSkipReasonFor] = useState<string | null>(null)
  const [reactiveNotes, setReactiveNotes] = useState<Array<{ id: string; note: string; createdAt: number }>>([])
  const [replaceState, setReplaceState] = useState<
    | { sessionId: string; stage: 'reason' }
    | { sessionId: string; stage: 'loading'; reason: string }
    | { sessionId: string; stage: 'coach'; reason: string; coachLine: string; suggestions: ReplaceSuggestion[] }
    | { sessionId: string; stage: 'picker'; reason: string }
    | null
  >(null)
  const [reassignFor, setReassignFor] = useState<{ activityId: number; sessionId: string } | null>(null)
  const [readiness, setReadiness] = useState<ReadinessIn | null>(null)
  const [block, setBlock] = useState<CurrentBlock | null>(null)
  // True once /blocks/current answered (so null means "no active block", not "still loading").
  const [blockChecked, setBlockChecked] = useState(false)
  const [week, setWeek] = useState<WeekPayload | null | undefined>(undefined)
  const [nextWeek, setNextWeek] = useState<WeekPayload | null>(null)
  const [summary, setSummary] = useState<CoachSummary | null>(null)
  const [asks, setAsks] = useState<AdjustmentRow[]>([])
  const [weekAdjustments, setWeekAdjustments] = useState<AdjustmentRow[]>([])
  const [askOpen, setAskOpen] = useState<AskView | null>(null)
  const [askBusy, setAskBusy] = useState(false)
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

  // The coach: what changed and the open questions since the last open, then mark this open.
  const refreshCoach = useCallback(async () => {
    try {
      const [s, open] = await Promise.all([
        apiFetch<CoachSummary | null>(`/api/coach/summary?date=${today}`),
        apiFetch<AdjustmentRow[]>('/api/adjustments').catch(() => [] as AdjustmentRow[]),
      ])
      setSummary(s)
      setAsks((open ?? []).filter(isAsk).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)))
      apiFetch('/api/coach/seen', { method: 'POST' }).catch(() => null)
    } catch (e) {
      logger.warn('system', 'coach summary failed', { message: e instanceof Error ? e.message : String(e) }, 'GET /coach/summary failed. Coach board hidden.')
    }
  }, [today])

  // The morning alarm's I'M UP while Today is already open.
  useEffect(() => {
    const open = () => {
      takeCheckInRequest()
      setDeck({ startAt: 0, firstOpen: false })
    }
    window.addEventListener(CHECK_IN_EVENT, open)
    return () => window.removeEventListener(CHECK_IN_EVENT, open)
  }, [])

  const refreshReactive = useCallback(async () => {
    try {
      const rows = await apiFetch<Array<{ id: string; sourceData: string | null; createdAt: number }>>(`/api/reactive/active?date=${today}`)
      const notes = rows
        .map(r => {
          try {
            const parsed = JSON.parse(r.sourceData ?? '{}') as { note?: string }
            return parsed.note ? { id: r.id, note: parsed.note, createdAt: r.createdAt } : null
          } catch {
            return null
          }
        })
        .filter((n): n is { id: string; note: string; createdAt: number } => n !== null)
      setReactiveNotes(notes.sort((a, b) => b.createdAt - a.createdAt))
    } catch (e) {
      console.warn('Reactive adjustments fetch failed:', e)
    }
  }, [today])

  useEffect(() => {
    async function load() {
      try {
        const [sessionsData, logData] = await Promise.all([
          apiFetch<Session[]>(`/api/sessions/today?date=${today}`),
          apiFetch<DailyLog | null>(`/api/daily-logs/today?date=${today}`),
        ])
        setSessions(sessionsData)
        setDailyLog(logData)
        apiFetch<CurrentBlock | null>(`/api/blocks/current?date=${today}`).then(b => { setBlock(b); setBlockChecked(true) }).catch(() => { setBlock(null); setWeek(null) })
        void refreshReadiness()
        void refreshCoach()
        if (!autoResumeAttempted.current) {
          autoResumeAttempted.current = true
          const suppressFromRoute = Boolean((location.state as { suppressAutoResume?: boolean } | null)?.suppressAutoResume)
          const suppressFromSearch = new URLSearchParams(location.search).get('resume') === '0'
          let suppressUntil = 0
          try {
            suppressUntil = Number(sessionStorage.getItem('waymark_suppress_auto_resume_until') ?? 0)
          } catch {
            suppressUntil = 0
          }
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
          if (activeSession && !suppressFromRoute && !suppressFromSearch && (!Number.isFinite(suppressUntil) || Date.now() > suppressUntil)) {
            navigate(`/session/${activeSession.id}`, { replace: true })
            return
          }
        }
        refreshReactive()
        // First open of the day (or the alarm's I'M UP): the check-in cards.
        if (shouldOpenCheckIn({ today, hasLogToday: logData != null, skippedOn: checkInSkippedOn(), requested: takeCheckInRequest() })) {
          setDeck({ startAt: 0, firstOpen: logData == null })
        }
      } catch (e) {
        console.error('Failed to load today data:', e)
        setDailyLog(null)
      } finally {
        setLoaded(true)
      }
    }
    load()
  }, [today, refreshReactive, refreshReadiness, refreshCoach, navigate, location.search, location.state])

  // This week's plan: the week strip, the why line, and whether an empty day is a planned rest.
  useEffect(() => {
    if (!block?.id || block.currentWeek == null) return
    let cancelled = false
    apiFetch<WeekPayload | null>(`/api/weeks/current?blockId=${block.id}&weekNumber=${block.currentWeek}`)
      .then(w => {
        if (cancelled) return
        setWeek(w)
        if (w?.week?.id) apiFetch<AdjustmentRow[]>(`/api/adjustments?weekPlanId=${w.week.id}`).then(r => { if (!cancelled) setWeekAdjustments(r ?? []) }).catch(() => {})
      })
      .catch(() => { if (!cancelled) setWeek(null) })
    // Sunday's rest points at Monday, which belongs to next week's plan.
    if (todayEpoch + 1 > mondayOf(todayEpoch) + 6) {
      apiFetch<WeekPayload | null>(`/api/weeks/current?blockId=${block.id}&weekNumber=${block.currentWeek + 1}`).then(w => { if (!cancelled) setNextWeek(w) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [block?.id, block?.currentWeek, todayEpoch])

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

  const strip = useMemo(() => (week?.sessions ? weekStripDays(week.sessions, mondayOf(todayEpoch), todayEpoch) : null), [week, todayEpoch])
  const tomorrow = useMemo(() => {
    const pool = [...(week?.sessions ?? []), ...(nextWeek?.sessions ?? [])].filter(s => s.scheduledDate === todayEpoch + 1)
    return pool
  }, [week, nextWeek, todayEpoch])

  // ── the coach ──
  const askViews = useMemo(() => asks.map(askView).filter((v): v is AskView => v != null), [asks])
  useEffect(() => {
    if (!loaded || deck || askOpen) return
    // Page 36: an ask shows first as a centred board. A missed session asks in its row on the
    // Program day board instead (page 36 #4), so it waits on the Coach board.
    const first = askViews.find(v => v.kind !== 'missed_session' && !asksShownThisOpen.has(v.id))
    if (!first) return
    const t = window.setTimeout(() => { asksShownThisOpen.add(first.id); setAskOpen(first) }, 0)
    return () => window.clearTimeout(t)
  }, [askViews, loaded, deck, askOpen])

  const typeById = useMemo(() => new Map([...weekAdjustments, ...asks].map(a => [a.id, a.sessionType ?? null])), [weekAdjustments, asks])
  const iconOf = (type: string | null | undefined): SessionIconKey | null => (type ? sessionIconFor(type) : null)
  const coachChanges: CoachChangeLine[] = [
    ...(summary?.changeLines ?? []).filter(c => c.kind !== 'week_prepared').map(c => ({ id: c.id, line: c.line, lead: c.lead ?? null, body: c.body ?? null, icon: iconOf(typeById.get(c.id)) })),
    ...reactiveNotes.slice(0, 2).map(n => ({ id: n.id, line: n.note, icon: null })),
  ]
  const coachQuestions: CoachQuestionLine[] = askViews.map(v => ({ id: v.id, line: v.rowLine, icon: v.hero ?? iconOf(typeById.get(v.id)) }))
  // On Today the why line is the Coach board's first line, shorter (page 36 #3).
  const whyLine = shortWhy(week?.week?.whyLine ?? (summary?.changeLines ?? []).find(c => c.kind === 'week_prepared')?.line ?? null)
  const openQuestion = (id: string) => {
    const v = askViews.find(a => a.id === id) ?? null
    // A missed session is answered in its row on the Program day board (page 36 #4).
    if (v?.kind === 'missed_session') { navigate(`/program?day=${today}`); return }
    setAskOpen(v)
  }

  async function answerAsk(view: AskView, body: Record<string, unknown> | null) {
    setAskBusy(true)
    try {
      if (body) {
        await apiFetch(`/api/adjustments/${view.id}/accept`, { method: 'POST', body: JSON.stringify({ ...body, today }) })
        showToast('Done.', 'success')
      } else {
        await apiFetch(`/api/adjustments/${view.id}/reject`, { method: 'POST' })
      }
      setAskOpen(null)
      setAsks(prev => prev.filter(a => a.id !== view.id))
      await Promise.all([refreshSessions(), refreshCoach()])
    } catch (e) {
      showRefusal(e, "Couldn't save. Check your connection.")
    } finally {
      setAskBusy(false)
    }
  }

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
        showRefusal(e, "Couldn't start. Check logs in Settings.")
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

  function handleSkip(id: string) {
    setSkipReasonFor(id)
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

  async function commitSkip(id: string, commit: SkipReasonCommit) {
    setSkipReasonFor(null)
    const prevSessions = sessions
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'skipped' } : s))
    )
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'skipped',
          skipReason: commit.reason,
          skipReasonDetail: commit.detail,
        }),
      })
    } catch (e) {
      setSessions(prevSessions)
      console.error('Failed to skip session:', e)
      showToast("Couldn't save. Check your connection.", 'warning')
    }
  }

  // A 409 from the placement rules carries the reason and safe options: show them.
  function showRefusal(e: unknown, fallback: string) {
    const refusal = parseRefusal(e)
    if (refusal) showToast(refusalMessage(refusal), 'warning', { durationMs: 7000 })
    else showToast(fallback, 'warning')
  }

  function handleReplaceStart(id: string) {
    setReplaceState({ sessionId: id, stage: 'reason' })
  }

  async function handleReplaceReasonCommit(reason: string, fastPath: boolean) {
    if (!replaceState) return
    const sessionId = replaceState.sessionId
    // "Changing it up" goes straight to the full board; the coach has nothing to read.
    if (fastPath) { await loadPickerFallback(sessionId, reason); return }
    setReplaceState({ sessionId, stage: 'loading', reason })
    try {
      // The route wraps the coach output: { suggestions: { coachLine, suggestions[] } | null }.
      const result = await apiFetch<{ suggestions: ReplaceSuggestionsOutput | null }>(
        `/api/sessions/${sessionId}/replace-suggestions`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
          // The coach thinks before it answers: 10 s cut it off every time.
          timeoutMs: REPLACE_SUGGESTIONS_TIMEOUT_MS,
        }
      )
      const coach = result?.suggestions ?? null
      if (coach && Array.isArray(coach.suggestions) && coach.suggestions.length > 0) {
        setReplaceState({
          sessionId,
          stage: 'coach',
          reason,
          coachLine: coach.coachLine ?? '',
          suggestions: coach.suggestions,
        })
      } else {
        await loadPickerFallback(sessionId, reason)
      }
    } catch (e) {
      console.warn('replace-suggestions failed, falling back to picker', e)
      await loadPickerFallback(sessionId, reason)
    }
  }

  async function loadPickerFallback(sessionId: string, reason: string) {
    setReplaceState({ sessionId, stage: 'picker', reason })
    try {
      const s = await apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}&today=${getTodayISO()}&mode=replace`)
      setPickerSuggestions(s)
    } catch {
      setPickerSuggestions(null)
    }
  }

  async function replaceWith(sessionId: string, reason: string, pick: { type: string; label?: string | null; timeSlot?: string | null; runCategory?: string | null }) {
    try {
      const result = await apiFetch<{ original: Session; replacement: Session }>(`/api/sessions/${sessionId}/replace`, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          type: pick.type,
          label: pick.label,
          timeSlot: pick.timeSlot,
          runCategory: pick.runCategory,
          today: getTodayISO(),
        }),
      })
      setSessions(prev => {
        const withOriginal = prev.map(s => (s.id === result.original.id ? result.original : s))
        const next = [...withOriginal, result.replacement]
        return next.sort((a, b) =>
          (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0)
          || ((a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1))
        )
      })
    } catch (e) {
      console.error('Failed to replace session:', e)
      showRefusal(e, "Couldn't replace. Check your connection.")
    }
  }

  async function handleReplaceAcceptSuggestion(suggestion: ReplaceSuggestion) {
    if (!replaceState || replaceState.stage !== 'coach') return
    const { sessionId, reason } = replaceState
    setReplaceState(null)
    await replaceWith(sessionId, reason, suggestion)
  }

  async function handleReplaceShowMore() {
    if (!replaceState || replaceState.stage !== 'coach') return
    await loadPickerFallback(replaceState.sessionId, replaceState.reason)
  }

  async function handleReplaceSelect(option: SessionOption) {
    if (!replaceState || replaceState.stage !== 'picker') return
    const { sessionId, reason } = replaceState
    setReplaceState(null)
    setPickerSuggestions(null)
    await replaceWith(sessionId, reason, option)
  }

  function openAddPicker() {
    setShowPicker(true)
    apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}&today=${getTodayISO()}`)
      .then(setPickerSuggestions)
      .catch(() => setPickerSuggestions(null))
  }

  async function handleAddSession(option: SessionOption) {
    setShowPicker(false)
    try {
      // The board decided the form (Part C): add, pull the next strength forward, or swap.
      const out = await submitBoardPick<Session>(option, getTodayISO(), getTodayISO())
      if (out.kind === 'added') {
        const created = out.session
        setSessions(prev => [...prev, created].sort((a, b) =>
          (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)
        ))
      } else {
        await refreshSessions()
      }
    } catch (e) {
      console.error('Failed to add session:', e)
      showRefusal(e, "Couldn't add. Check your connection.")
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
    return refreshReadiness()
  }, [refreshReadiness])

  const handleCheckInClose = useCallback(() => setDeck(null), [])

  // "Class tonight": one tap adds an MT class this evening; the type is asked
  // when it's logged. Returns the refusal line, or null when added.
  async function handleAddClassTonight(): Promise<string | null> {
    try {
      const created = await apiFetch<Session & { coach?: { notes?: string[] } }>('/api/sessions/insert-ad-hoc', {
        method: 'POST',
        headers: idempotencyHeaders(),
        body: JSON.stringify({
          date: today,
          type: 'mt_class',
          // Block Zero ramps in through technique; the real type is asked at log time.
          label: block?.blockType === 'block_zero' ? 'MT Technique' : 'MT Class',
          timeSlot: 'pm',
          today,
        }),
      })
      setSessions(prev => [...prev, created].sort((a, b) => (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)))
      // The day rebalances around the class (page 45); its line shows on the Coach board.
      try {
        await apiFetch(`/api/sessions/${created.id}/class-tonight`, { method: 'POST', body: JSON.stringify({ today }) })
      } catch (e) {
        logger.warn('system', 'class tonight rebalance failed', { sessionId: created.id, message: e instanceof Error ? e.message : String(e) }, 'The class is added; the day was not rebalanced.')
      }
      await refreshSessions()
      return null
    } catch (e) {
      const refusal = parseRefusal(e)
      if (refusal) {
        showToast(refusalMessage(refusal), 'warning', { durationMs: 7000 })
        return refusal.reason
      }
      showToast("Couldn't add. Check your connection.", 'warning')
      return "Couldn't add. Check your connection."
    }
  }

  if (loading) {
    // A quick load shows the world alone; only a slow one brings the crest apart (it snaps together when done).
    if (!slowLoad) return loaded ? <LoadedNow onReady={() => setLoading(false)} /> : null
    return <CrestLoading message="Reading your profile." done={loaded} onDone={() => setLoading(false)} />
  }

  const replaceTarget = replaceState ? sessions.find(s => s.id === replaceState.sessionId) : null
  const skipTarget = skipReasonFor ? sessions.find(s => s.id === skipReasonFor) : null
  const doneIcons = sessions.filter(s => s.status === 'completed').map(s => iconFor(s))
  const tomorrowIcons = tomorrow.map(s => iconFor({ type: s.type, notes: s.notes ?? null }))
  const newWeekTomorrow = todayEpoch + 1 > mondayOf(todayEpoch) + 6 ? nextWeek?.week?.weekNumber ?? null : null
  const tomorrowText = tomorrowLine(tomorrow, s => sessionDisplayName({ type: s.type, label: s.label ?? null, notes: s.notes ?? null }), newWeekTomorrow)
  const home = showsHome(mode)
  const morningLogged = dailyLog != null && answeredCount(answersFromLog(dailyLog)) > 0

  return (
    <div className="td-page">
      <div className={`td-fill${allDoneFade ? ` is-${allDoneFade}` : ''}`}>
      <TodayHeader date={todayDate} />
      {strip && <WeekStrip days={strip} home={showsHome(mode)} />}

      {mode === 'day' && (
        <>
          {/* page 17: the Morning Report, collapsed to one row at the top of the day; tap to edit */}
          <MorningReportRow logged={morningLogged} onOpen={() => setDeck({ startAt: 0, firstOpen: false })} />
          {/* the clearing and its lantern show between the top and the boards (pages 17, 35, 36) */}
          <div className="td-spacer" style={{ minHeight: strip ? '16dvh' : '24dvh' }} />
          <CoachBoard why={whyLine} readiness={readinessLine(readiness)} classTonight={block != null ? classTonightView(sessions, handleAddClassTonight) : null} changes={coachChanges} questions={coachQuestions} onOpen={openQuestion} />
          <TodayDay
            sessions={sessions}
            onStart={handleStart}
            onSkip={handleSkip}
            onReplace={handleReplaceStart}
            onEndEarly={handleEndEarly}
            onConfirmMatch={handleConfirmMatch}
            onReassignMatch={handleReassignStart}
            onDismissMatch={handleDismissMatch}
            onAdd={openAddPicker}
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
        />
      )}

      {skipReasonFor && (
        <SkipReasonSheet
          sessionName={skipTarget ? sessionDisplayName(skipTarget).toUpperCase() : undefined}
          onCommit={(commit) => commitSkip(skipReasonFor, commit)}
          onClose={() => setSkipReasonFor(null)}
        />
      )}

      {replaceState?.stage === 'reason' && (
        <ReplaceReasonSheet
          onCommit={(reason, fastPath) => handleReplaceReasonCommit(reason, fastPath)}
          onClose={() => setReplaceState(null)}
        />
      )}

      {replaceState?.stage === 'loading' && <CoachSignpost loading reason={replaceState.reason} onClose={() => setReplaceState(null)} />}

      {replaceState?.stage === 'coach' && (
        <CoachSignpost
          coachLine={replaceState.coachLine}
          suggestions={replaceState.suggestions}
          reason={replaceState.reason}
          onAccept={handleReplaceAcceptSuggestion}
          onShowMore={handleReplaceShowMore}
          onClose={() => setReplaceState(null)}
        />
      )}

      {replaceState?.stage === 'picker' && (
        <SessionPicker
          onSelect={handleReplaceSelect}
          onClose={() => { setReplaceState(null); setPickerSuggestions(null) }}
          suggestions={pickerSuggestions}
          title="Replace"
          subtitle={replaceState.reason ? `Reason: ${replaceState.reason}` : replaceTarget ? sessionDisplayName(replaceTarget) : undefined}
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

      {askOpen && !deck && (
        <AskBoard
          view={askOpen}
          busy={askBusy}
          onAccept={body => answerAsk(askOpen, body)}
          onDecline={() => answerAsk(askOpen, null)}
          onLater={() => setAskOpen(null)}
        />
      )}

      {deck && (
        <CheckInDeck
          date={today}
          existing={dailyLog ? answersFromLog(dailyLog) : null}
          startAt={deck.startAt}
          onSubmit={handleCheckInSubmit}
          onClose={handleCheckInClose}
          onSkipToday={deck.firstOpen ? markCheckInSkipped : undefined}
          note={dailyLog?.notes ?? null}
          onNoteSaved={log => setDailyLog(log as DailyLog)}
        />
      )}


      <ToastContainer />
    </div>
  )
}

/** + CLASS TONIGHT on the Coach board: added once tonight's class is on the day; the line is the one the server stored when the day rebalanced. */
function classTonightView(sessions: Session[], onAdd: () => Promise<string | null>): ClassTonightView {
  const cls = sessions.find(s => s.type === 'mt_class' && s.status !== 'skipped')
  return { added: cls != null, line: classTonightFrom(cls?.contextJson), onAdd }
}

/** Loaded before the crest was needed: show the page on the next tick. */
function LoadedNow({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady() }, [onReady])
  return null
}

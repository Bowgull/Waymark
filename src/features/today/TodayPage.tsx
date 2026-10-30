import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ApiError, apiFetch, idempotencyHeaders } from '@/lib/api'
import { getTodayISO, isoToEpochDay, mondayOf } from '@/lib/dates'
import { clearResume, loadResume } from '@/lib/sessionResume'
import { clearLiveSession, readLiveSession, takeLaunch } from '@/lib/liveSession'
import { localActiveSession } from '@/lib/workoutCache'
import { logger } from '@/lib/logger'
import { START_TIMEOUT_MS } from '@/lib/startSession'
import { endAllLiveActivities } from '@/lib/liveActivity'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { AutoHeight, FlapLabel, glowRow, SCENE, SceneWindow, showPop } from '@/design'
import { pmOnlyFor } from '@/components/ui/departures'
import { useToast } from '@/components/ui/Toast'
import { PageErrorScreen } from '@/components/ui/ErrorScreens'
import { iconFor, sessionDisplayName, withoutReplaced, type DayBoardSession } from '@/features/dayboard/rowState'
import { useWeekChanges } from '@/features/coach/useWeekChanges'
import { rowChange } from '@/features/plan/changeLines'
import { usePlanMenu } from '@/features/plan/usePlanMenu'
import { WeatherStrip } from '@/features/weather/WeatherStrip'
import { useWeather } from '@/features/weather/useWeather'
import { coachLine, degText, hourWord } from '@/features/weather/weatherData'
import { plannedMinute, plannedRuns, plannedWord, type CoachHours } from '@/features/weather/plannedHours'
import { temperatureUnit } from '@/lib/units'
import { CrestLoading } from '@/world/CrestLoading'
import { setWorldLantern, setWorldPlace } from '@/world/worldStore'

import { ClassLearnedFlow } from '@/features/session/ClassLearnedFlow'
import { useStripSessionId } from '@/app/useStripSession'
import { endHandoff, hasHandoff } from '@/app/liveHandoff'
import { ReassignRunSheet } from './ReassignRunSheet'
import { AllDoneBoard, EmptyDayBoard, NextDayBoard, NoBlockBoard, RestDayBoards, TodayHeader, WaybookLine } from './TodayBoards'
import { TodayDay, type TodaySession } from './TodayDay'
import { ALL_DONE_AFTER_CONFIRM_MS, fadesToAllDone, lanternFor, showsHome, todayMode, tomorrowLine, type StripSession } from './weekStrip'
import { CheckInDeck } from '@/features/blockZero/CheckInDeck'
import { answeredCount, answersFromLog, isCheckInComplete, mergeAnswers, shouldOpenCheckIn, type CheckInAnswers, type CheckInKey } from '@/features/blockZero/checkInFlow'
import { CHECK_IN_EVENT, clearCheckInDraft, loadCheckInDraft, saveCheckInDraft, takeCheckInRequest } from '@/features/blockZero/checkInTrigger'
import { readinessLine, type ReadinessIn } from '@/features/blockZero/readinessLine'
import { MorningReportRow } from '@/features/blockZero/TodayPieces'
import { useBodyWatch } from '@/features/raven/bodyWatch'
import { useRavenOnToday } from '@/features/raven/useRaven'
import { StartDayBoard, StartWaitBoard } from '@/features/program/StartDay'
import { moveStartDay } from '@/features/program/startDayApi'
import { dayOneLine, isPendingStart, startDayOf, startHasLeadIn, startPreviewLabel } from '@/lib/coach/startDay'
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
  /** The start (noon UTC of the local day); a Block Zero's may be up to six days ahead (page 64). */
  startedAt?: number | null
  currentWeek?: number
  /** Today's training week; leadIn on a mid-week start's days before week 1. */
  trainingWeek?: { leadIn?: boolean }
}

interface WeekPlanRow { id: string; weekNumber: number; whyLine?: string | null }
interface WeekPayload { week: WeekPlanRow; sessions: Array<StripSession & { label?: string | null }> }

// Session types that have a dedicated workout engine
const WORKOUT_SESSION_TYPES = ['strength', 'mobility', 'bag_work', 'bag_conditioning', 'running', 'skip_rope', 'active_recovery', 'mt_class', 'foundation_run']

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
  const [openRow, setOpenRow] = useState<string | null>(null)
  // Page 73: the pixel cursor on a row (it follows the row opened or held).
  const [cursorRow, setCursorRow] = useState<string | null>(null)
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
  const [deck, setDeck] = useState<{ startAt: number | 'resume' } | null>(null)
  // Page 64: CHANGE DAY on the waiting board.
  const [changeStart, setChangeStart] = useState(false)
  const [savingStart, setSavingStart] = useState(false)
  // + What you learned on tonight's class row (page 49, if skipped): the same box.
  const [learned, setLearned] = useState<{ sessionId: string; mtLogId: string } | null>(null)
  const [learnedDone, setLearnedDone] = useState<ReadonlySet<string>>(() => new Set())
  // Read by the foreground listener: never stack a second deck on an open one.
  const deckOpenRef = useRef(false)
  useEffect(() => { deckOpenRef.current = deck != null }, [deck])
  const autoResumeAttempted = useRef(false)
  const [slowLoad, setSlowLoad] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlowLoad(true), 400)
    return () => window.clearTimeout(t)
  }, [])

  // Bumped when the app comes back to the front on a new day: today is read again and the day reloads.
  const [, setDayTick] = useState(0)
  const today = getTodayISO()
  // Page 71: a running session shows once, as the live strip; it leaves the day's list until it is done.
  const stripId = useStripSessionId()
  // Page 71 item 6: the row that is flying (down into the strip, or back up into the list).
  const [flying, setFlying] = useState<{ id: string; kind: 'lift' | 'land' } | null>(null)
  // Today has its day and the stepped-out session is not in it: nothing to lift, the strip shows now.
  useEffect(() => {
    if (loading || flying || !stripId || !hasHandoff('lift', stripId)) return
    if (!sessions.some(s => s.id === stripId)) endHandoff('lift', stripId)
  }, [loading, flying, stripId, sessions])
  if (!flying && sessions.length > 0) {
    if (stripId && hasHandoff('lift', stripId) && sessions.some(s => s.id === stripId)) setFlying({ id: stripId, kind: 'lift' })
    else {
      const landed = sessions.find(s => s.status === 'completed' && hasHandoff('land', s.id))
      if (landed) setFlying({ id: landed.id, kind: 'land' })
    }
  }
  useEffect(() => {
    // Page 98: Today loads clean, nothing opens by itself. The open row went live (ENTER, then back out): it closes.
    if (openRow != null && openRow === stripId) setOpenRow(null)
  }, [stripId, openRow])
  const todayEpoch = isoToEpochDay(today)
  const todayDate = new Date(`${today}T12:00:00`)


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
          // Page 61: only a launch (iOS closed the app, a reload, a restart) goes
          // back into an open session by itself, and lands paused on BACK IN
          // YOUR SESSION. Any other visit to Today stays on Today: the live
          // strip is the way back.
          const launch = takeLaunch()
          let storage: Storage | null = null
          try { storage = window.localStorage } catch { storage = null }
          const activeSession = sessionsData.find(session =>
            session.status === 'in_progress' &&
            WORKOUT_SESSION_TYPES.includes(session.type) &&
            (loadResume(storage, session.id) != null || session.type === 'strength')
          )
          if (launch && activeSession && !autoResumeSuppressed()) {
            navigate(`/session/${activeSession.id}`, { replace: true, state: { relaunch: true } })
            return
          }
          // The lock-screen card stays while a session is open (page 61, M5); a stale one goes.
          if (!sessionsData.some(x => x.status === 'in_progress') && !readLiveSession(storage)) void endAllLiveActivities()
        }
        // Every open until all nine are in (or the alarm's I'M UP): the check-in cards, at the first unanswered one.
        if (shouldOpenCheckIn({ answers: checkInAnswersFor(logData, today), passed: loadCheckInDraft(today)?.passed, requested: takeCheckInRequest() })) {
          setDeck({ startAt: 'resume' })
        }
      } catch (e) {
        // Reopened offline mid-session: the session screen carries on from this
        // phone's own copy, so go straight back into it instead of an error.
        if (e instanceof ApiError && e.type === 'network' && !autoResumeAttempted.current) {
          autoResumeAttempted.current = true
          let storage: Storage | null = null
          try { storage = window.localStorage } catch { storage = null }
          const localId = autoResumeSuppressed() || !takeLaunch()
            ? null
            : localActiveSession(storage, { types: WORKOUT_SESSION_TYPES, todayEpochDay: isoToEpochDay(today), nowMs: Date.now() })
          if (localId) {
            navigate(`/session/${localId}`, { replace: true, state: { relaunch: true } })
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
    // Page 64: a Block Zero start still ahead reads its start's week (the lead-in, or week 1 from a Monday).
    const start = block.blockType === 'block_zero' ? startDayOf(block.startedAt) : null
    const pending = start != null && isPendingStart(start, todayEpoch)
    // A mid-week start: the lead-in and next Monday's week 1 are both week 1.
    const leadIn = pending ? startHasLeadIn(start) : block.trainingWeek?.leadIn === true
    const weekNumber = pending ? 1 : block.currentWeek
    apiFetch<WeekPayload | null>(`/api/weeks/current?blockId=${block.id}&weekNumber=${weekNumber}${leadIn ? '&leadIn=1' : ''}`)
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
  }, [block?.id, block?.currentWeek, block?.trainingWeek?.leadIn, block?.blockType, block?.startedAt, todayEpoch, weekVersion])

  // ── what Today shows, and the world behind it ──
  const weekSessions = week === undefined ? null : (week?.sessions ?? null)
  // Page 64: a Block Zero waiting for its start day: nothing planned, the waiting board instead of the day.
  const blockStart = block?.blockType === 'block_zero' ? startDayOf(block.startedAt) : null
  const waitingFor = isPendingStart(blockStart, todayEpoch) && sessions.length === 0 ? blockStart : null
  const mode = !loaded ? 'loading' : waitingFor != null ? 'unprepared' : todayMode({ today: sessions, weekSessions, hour: new Date().getHours(), showDayAnyway })
  useEffect(() => {
    if (mode === 'loading') return
    setWorldPlace(showsHome(mode) ? 'home' : 'clearing')
  }, [mode])
  useEffect(() => () => setWorldPlace('clearing'), [])
  useEffect(() => { setWorldLantern(lanternFor(readiness)) }, [readiness])

  // The week's changes and runes (page 56): Dagaz where the coach changed a day, Algiz where a session was missed.
  const { week: changes, markSeen, undo } = useWeekChanges(block ? mondayOf(todayEpoch) : null, changesVersion)
  // Page 72: the weather in the week strip's place (no location or no signal: it hides).
  const weather = useWeather(true)
  const unit = temperatureUnit()
  const [coachHours, setCoachHours] = useState<CoachHours | null>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch<CoachHours>(`/api/coach/hours?today=${today}`).then(h => { if (!cancelled) setCoachHours(h) }).catch(() => {})
    return () => { cancelled = true }
  }, [today])
  const midnight = useMemo(() => new Date(`${today}T00:00:00`).getTime(), [today])
  const runs = useMemo(() => plannedRuns(sessions, coachHours, midnight), [sessions, coachHours, midnight])
  const wxLine = weather ? coachLine(weather, runs, Date.now(), unit) : null
  // Page 76: inside or outside for each run at its hour (its WHERE line).
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

  // One start at a time: a second ENTER while a start is in flight does nothing (no workout made twice).
  const startingRef = useRef(false)
  async function handleStart(id: string) {
    if (startingRef.current) return
    startingRef.current = true
    try { await startOnce(id) } finally { startingRef.current = false }
  }

  async function startOnce(id: string) {
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
          bag_conditioning: `/api/sessions/${id}/start-bag-conditioning`,
          running: `/api/sessions/${id}/start-run`,
          skip_rope: `/api/sessions/${id}/start-skip-rope`,
          active_recovery: `/api/sessions/${id}/start-recovery`,
          mt_class: `/api/sessions/${id}/start-mt-class`,
        }
        const startEndpoint = typeEndpoints[session.type] ?? `/api/sessions/${id}/start-strength`
        await apiFetch(startEndpoint, { method: 'POST', timeoutMs: START_TIMEOUT_MS })
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

  async function handleEndEarly(id: string, action: 'completed' | 'reset') {
    // MARK COMPLETED on a session with a runner: its own close (effort, notes), not a status-only save (dead end #16).
    const ending = sessions.find(s => s.id === id)
    if (action === 'completed' && ending && WORKOUT_SESSION_TYPES.includes(ending.type)) {
      navigate(`/session/${id}?close=1`)
      return
    }
    const nowSec = Math.floor(Date.now() / 1000)
    // Ended on purpose (held x, then a choice): the saved step goes with it.
    try { clearResume(window.localStorage, id); clearLiveSession(window.localStorage, id) } catch { /* storage unavailable */ }
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
  const handleCheckInSubmit = useCallback(async (body: Record<string, unknown>, passed: CheckInKey[]): Promise<ReadinessIn | null> => {
    const log = await apiFetch<DailyLog>('/api/daily-logs', {
      method: 'POST',
      headers: idempotencyHeaders(),
      body: JSON.stringify(body),
    })
    setDailyLog(log)
    clearCheckInDraft()
    // The passed cards stay on this phone for today, so the deck doesn't come back for them.
    if (passed.length > 0) saveCheckInDraft(today, {}, '', passed)
    return refreshReadiness()
  }, [refreshReadiness, today])

  // Each answer as it is given: kept on this phone at once, then sent as a partial log
  // (the server holds back the coach's check-in rules until the full save).
  const lastPartialSent = useRef<string | null>(null)
  const handleCheckInPartial = useCallback((body: Record<string, unknown>, answers: CheckInAnswers, backNotes: string, passed: CheckInKey[]) => {
    saveCheckInDraft(today, answers, backNotes, passed)
    // a PASS changes only this phone's draft: nothing new to send
    const sig = JSON.stringify(body)
    if (sig === lastPartialSent.current) return
    lastPartialSent.current = sig
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
      // A new day since Today was read (the phone slept past midnight): read the whole day again (dead end #11).
      if (getTodayISO() !== today) { setDayTick(t => t + 1); return }
      if (deckOpenRef.current) return
      apiFetch<DailyLog | null>(`/api/daily-logs/today?date=${today}`)
        .then(log => {
          setDailyLog(log)
          if (!deckOpenRef.current && shouldOpenCheckIn({ answers: checkInAnswersFor(log, today), passed: loadCheckInDraft(today)?.passed, requested: takeCheckInRequest() })) setDeck({ startAt: 'resume' })
        })
        .catch(() => {
          // offline: what this phone holds decides
          if (!deckOpenRef.current && shouldOpenCheckIn({ answers: checkInAnswersFor(null, today), passed: loadCheckInDraft(today)?.passed, requested: false })) setDeck({ startAt: 'resume' })
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

  // Page 73: the hold's command window, COACH PICKS and the WHY? tiles (the same as Program's).
  const menu = usePlanMenu({
    onSessionUpdate: (id, patch) => setSessions(prev => prev.map(x => (x.id === id ? { ...x, ...patch } as Session : x))),
    onSessionAdded: s => {
      if (s.scheduledDate !== todayEpoch) return
      setSessions(prev => [...prev.filter(x => x.id !== s.id), s as Session].sort((a, b) => (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)))
      requestAnimationFrame(() => glowRow(document.querySelector(`.td-row[data-sid="${CSS.escape(s.id)}"]`), 'good'))
    },
    onChanged: () => setChangesVersion(v => v + 1),
    reload: () => { void refreshSessions() },
    undo,
    markSeen,
    skipChangeFor: id => changes?.changes.find(c => c.actor === 'you' && c.kind === 'skip' && c.session.id === id && c.lock === 'open')?.id ?? null,
    focus: id => { setOpenRow(id); setCursorRow(id) },
    weatherFor: s => {
      if (!weather || s.scheduledDate !== todayEpoch || (s.type !== 'running' && s.type !== 'foundation_run')) return null
      const word = plannedWord(s, coachHours)
      const line = coachLine(weather, [{ name: 'Run', at: midnight + plannedMinute(s, coachHours) * 60000, when: word }], Date.now(), unit)
      return line ? { kind: line.kind, hour: word ? `this ${word.toLowerCase()}` : hourWord(midnight + plannedMinute(s, coachHours) * 60000) } : null
    },
    pmOnly: date => pmOnlyFor(date, getTodayISO(), new Date().getHours()),
  })
  const openAdd = () => menu.openAdd(today)

  // CHANGE DAY → SAVE (page 64): the waiting block moves; TODAY starts it now.
  async function saveStartDay(day: number) {
    if (!block) return
    setSavingStart(true)
    try {
      await moveStartDay(block.id, day, today)
      setChangeStart(false)
      const [b] = await Promise.all([apiFetch<CurrentBlock | null>(`/api/blocks/current?date=${today}`), refreshSessions()])
      setBlock(b)
      setWeekVersion(v => v + 1)
    } catch (e) {
      console.error('Failed to change the start day:', e)
      showPop("Couldn't save. Check your connection.", 'bad', { title: "COULDN'T SAVE", durationMs: 4000 })
    } finally {
      setSavingStart(false)
    }
  }

  if (loading) {
    // A quick load shows the world alone; only a slow one brings the crest apart (it snaps together when done).
    if (!slowLoad) return loaded ? <LoadedNow onReady={() => setLoading(false)} /> : null
    return <CrestLoading message="Reading your profile." done={loaded} onDone={() => setLoading(false)} />
  }

  // E2E minor 10: an unreachable API showed NOTHING TODAY. Page 38 "A page": what didn't load, nothing lost, RELOAD.
  if (loadFailed) return <PageErrorScreen pathname="/today" onReload={() => window.location.reload()} />

  const doneIcons = sessions.filter(s => s.status === 'completed').map(s => iconFor(s))
  const tomorrowIcons = tomorrow.map(s => iconFor({ type: s.type, notes: s.notes ?? null }))
  const newWeekTomorrow = todayEpoch + 1 > mondayOf(todayEpoch) + 6 ? nextWeek?.week?.weekNumber ?? null : null
  const tomorrowText = tomorrowLine(tomorrow, s => sessionDisplayName({ type: s.type, label: s.label ?? null, notes: s.notes ?? null }), newWeekTomorrow)
  const home = showsHome(mode)
  // Page 64: under the waiting board, the start day's planned sessions (page 43's Tomorrow row).
  const startSessions = waitingFor != null ? withoutReplaced(week?.sessions ?? []).filter(s => s.scheduledDate === waitingFor) : []
  const startLineText = tomorrowLine(startSessions, s => sessionDisplayName({ type: s.type, label: s.label ?? null, notes: s.notes ?? null }))
  const dayOne = mode === 'day' && block?.blockType === 'block_zero' ? dayOneLine(blockStart, todayEpoch, withoutReplaced(sessions).length) : null
  // CHECK IN until all nine are in; partial answers don't count as logged.
  const morningAnswers = checkInAnswersFor(dailyLog ?? null, today)
  const morningLogged = isCheckInComplete(morningAnswers)

  return (
    <div className="td-page">
      <div className={`td-fill${mode === 'day' ? ' is-window' : ''}${allDoneFade ? ` is-${allDoneFade}` : ''}`}>
      <TodayHeader date={todayDate} />
      {/* page 67: the clearing in the top 40%, the boards start under it and scroll up over it */}
      {mode === 'day' && <SceneWindow at={SCENE.boardsAtToday} />}
      {/* page 72: the weather in the week strip's place; it hides with no location or no signal */}
      {weather && waitingFor == null && <WeatherStrip weather={weather} unit={unit} line={wxLine} marks={runs.map(r => ({ at: r.at, icon: r.icon }))} />}

      {mode === 'day' && (
        <>
          {/* page 56 item 14: the Morning Report row: CHECK IN, then LOGGED and the readiness line; tap for the why */}
          <MorningReportRow logged={morningLogged} answered={answeredCount(morningAnswers)} readiness={readinessLine(readiness)} onOpen={() => setDeck({ startAt: morningLogged ? 0 : 'resume' })} raven={raven} dayOne={dayOne != null} />
          <TodayDay
            sessions={withoutReplaced(sessions).filter(s => s.id !== stripId || (flying?.kind === 'lift' && flying.id === s.id))}
            flying={flying}
            onFlown={() => { if (flying) endHandoff(flying.kind, flying.id); setFlying(null) }}
            weekNumber={block?.currentWeek ?? null}
            onStart={handleStart}
            onHold={(s, el) => { setCursorRow(s.id); menu.openAct(s as DayBoardSession, el) }}
            onEndEarly={handleEndEarly}
            onLearned={(sessionId, mtLogId) => setLearned({ sessionId, mtLogId })}
            learnedSaved={learnedDone}
            onConfirmMatch={handleConfirmMatch}
            onReassignMatch={handleReassignStart}
            onDismissMatch={handleDismissMatch}
            onAdd={openAdd}
            changeFor={s => rowChange(changes, s, todayEpoch)}
            weatherFor={s => {
              if (!weather || (s.type !== 'running' && s.type !== 'foundation_run') || s.status === 'completed') return null
              const at = midnight + plannedMinute(s, coachHours) * 60000
              const h = weather.hours.find(x => at >= x.at && at < x.at + 3600000)
              return h ? `${plannedWord(s, coachHours) ?? hourWord(at)}: ${degText(h.t, unit)}° ${h.pop >= 60 || h.mm >= 1 ? 'and rain' : `· ${h.sky === 'sun' || h.sky === 'moon' ? 'clear' : h.sky === 'part' || h.sky === 'partn' ? 'some cloud' : h.sky === 'cloud' ? 'cloudy' : h.sky}`}` : null
            }}
            cursorId={cursorRow ?? openRow}
            openId={openRow}
            onOpenChange={id => { setOpenRow(id); if (id) setCursorRow(id) }}
            onCursor={setCursorRow}
          />
          {/* the line grows into its box (page 59 §5.3 Expand) */}
          <AutoHeight><WaybookLine today={today} /></AutoHeight>
        </>
      )}

      {home && (
        <>
          {/* page 43: the hobbit home fills the screen behind; the boards sit low, the Waybook last */}
          <div className="td-spacer" />
          {mode === 'rest' && <RestDayBoards tomorrow={tomorrowIcons} tomorrowLine={tomorrowText} onAdd={openAdd} />}
          {mode === 'unprepared' && (waitingFor != null
            ? (
              <>
                <StartWaitBoard startDay={waitingFor} todayDay={todayEpoch} onChange={() => setChangeStart(true)} />
                {startLineText && (
                  <NextDayBoard
                    label={startPreviewLabel(waitingFor, todayEpoch)}
                    icons={startSessions.map(s => iconFor({ type: s.type, notes: s.notes ?? null }))}
                    line={startLineText}
                  />
                )}
                <div className="td-spacer" />
              </>
            )
            : blockChecked && !block
            ? <NoBlockBoard onStart={() => navigate('/program')} />
            : <EmptyDayBoard onPrepare={handleGenerate} preparing={generating} onAdd={openAdd} />)}
          {mode === 'allDone' && <AllDoneBoard icons={doneIcons} onShowDay={() => setShowDayAnyway(true)} />}
          <AutoHeight><WaybookLine today={today} variant="home" /></AutoHeight>
        </>
      )}
      </div>

      <button type="button" onClick={() => navigate('/settings')} aria-label="Settings" className="td-settings">
        <FlapLabel text="SETTINGS" size="xs" tone="dim" animate={false} />
      </button>

      {changeStart && block && waitingFor != null && (
        <StartDayBoard
          todayDay={todayEpoch}
          selected={waitingFor}
          change
          busy={savingStart}
          onPick={day => { void saveStartDay(day) }}
          onDismiss={() => setChangeStart(false)}
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
          existingPassed={loadCheckInDraft(today)?.passed ?? []}
          startAt={deck.startAt}
          onSubmit={handleCheckInSubmit}
          onPartial={handleCheckInPartial}
          onClose={handleCheckInClose}
          note={dailyLog?.notes ?? null}
          onNoteSaved={log => setDailyLog(log as DailyLog)}
          regions={bodyWatch?.checkIn ?? []}
        />
      )}

      {learned && (
        <ClassLearnedFlow
          sessionId={learned.sessionId}
          mtLogId={learned.mtLogId}
          backdrop={false}
          onDone={outcome => {
            if (outcome === 'saved') setLearnedDone(d => new Set(d).add(learned.sessionId))
            setLearned(null)
          }}
        />
      )}

      {menu.node}

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

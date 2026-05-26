import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'
import { logger } from '@/lib/logger'
import { endAllLiveActivities } from '@/lib/liveActivity'

import { TodayTexture } from '@/components/backgrounds/TodayTexture'
import { SettingsIcon } from '@/components/icons/NavIcons'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { TodaySkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { SkipReasonSheet, type SkipReasonCommit } from '@/features/session/SkipReasonSheet'
import { ReplaceReasonSheet } from '@/features/session/ReplaceReasonSheet'
import type { ReplaceSuggestion, ReplaceSuggestionsOutput } from '@/lib/prompts/tools'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'

import { DateHeader } from './DateHeader'
import { DayTimeline } from './DayTimeline'
import { GeneratePlanButton } from './GeneratePlanButton'
import { JournalCard } from './JournalCard'
import { ReassignRunSheet } from './ReassignRunSheet'
import type { RunSessionSummary } from './TimelineRow'
import { WellnessPromptCard, type WellnessData } from './WellnessPromptCard'

interface Session {
  id: string
  type: string
  timeSlot: string | null
  status: string
  startedAt: number | null
  completedAt: number | null
  durationSec: number | null
  rpe: number | null
  scheduledDate?: number | null
  notes: string | null
  blockType?: string | null
  runSession?: RunSessionSummary | null
}

interface RoadBootcampPreviewOption {
  equipment: 'no_gym' | 'hotel_gym' | 'full_gym'
  label: string
  note: string
  exercises: string[]
}

interface DailyLog {
  id: string
  sleepHours: number | null
  weedGrams?: number | null
  alcoholScale?: number | null
  soreness?: number | null
}

// Session types that have a dedicated workout engine
const WORKOUT_SESSION_TYPES = ['strength', 'mobility', 'bag_work', 'running', 'skip_rope', 'active_recovery', 'mt_class', 'foundation_run']

const MAX_HR_LS_KEY = 'waymark_last_seen_max_hr'

function addDaysISO(dateISO: string, days: number) {
  const date = new Date(`${dateISO}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function TodayPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { show: showToast, ToastContainer } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [dailyLog, setDailyLog] = useState<DailyLog | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerSuggestions, setPickerSuggestions] = useState<SuggestionsResponse | null>(null)
  const [skipReasonFor, setSkipReasonFor] = useState<string | null>(null)
  const [reactiveNotes, setReactiveNotes] = useState<Array<{ id: string; note: string; createdAt: number }>>([])
  const [tomorrowStrength, setTomorrowStrength] = useState<Session | null>(null)
  const [replaceState, setReplaceState] = useState<
    | { sessionId: string; stage: 'reason' }
    | { sessionId: string; stage: 'loading'; reason: string }
    | { sessionId: string; stage: 'coach'; reason: string; coachLine: string; suggestions: ReplaceSuggestion[] }
    | { sessionId: string; stage: 'picker'; reason: string }
    | null
  >(null)
  const [reassignFor, setReassignFor] = useState<{ activityId: number; sessionId: string } | null>(null)
  const [maxHr, setMaxHr] = useState<number | null>(null)
  const autoResumeAttempted = useRef(false)

  const today = getTodayISO()
  const tomorrow = addDaysISO(today, 1)
  const todayDate = new Date(`${today}T12:00:00`)

  useEffect(() => {
    void endAllLiveActivities()
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const next = await apiFetch<Session[]>(`/api/sessions/today?date=${today}`)
      setSessions(next)
    } catch (e) {
      console.error('Failed to refresh sessions:', e)
    }
  }, [today])

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
        const [sessionsData, tomorrowSessions, logData, profile] = await Promise.all([
          apiFetch<Session[]>(`/api/sessions/today?date=${today}`),
          apiFetch<Session[]>(`/api/sessions/today?date=${tomorrow}`).catch(() => []),
          apiFetch<DailyLog | null>(`/api/daily-logs/today?date=${today}`),
          apiFetch<{ maxHr: number | null } | null>('/api/user-profile').catch(() => null),
        ])
        setSessions(sessionsData)
        setTomorrowStrength(
          tomorrowSessions.find(session =>
            session.type === 'strength' &&
            session.status !== 'skipped' &&
            session.status !== 'completed'
          ) ?? null,
        )
        setDailyLog(logData)
        setMaxHr(profile?.maxHr ?? null)
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
          const activeStrength = sessionsData.find(session =>
            session.type === 'strength' &&
            session.status === 'in_progress'
          )
          if (activeStrength && !suppressFromRoute && !suppressFromSearch && (!Number.isFinite(suppressUntil) || Date.now() > suppressUntil)) {
            navigate(`/session/${activeStrength.id}`, { replace: true })
            return
          }
        }
        refreshReactive()
      } catch (e) {
        console.error('Failed to load today data:', e)
        setDailyLog(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [today, tomorrow, refreshReactive, navigate, location.search, location.state])

  // Silent Strava poll on mount. Refreshes Today once ingestion completes so
  // new matches / orphans appear without a reload. Surfaces max-HR bumps as a
  // one-time toast.
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
        setMaxHr(profile.maxHr)
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
      try {
        if (session.type === 'strength' && session.blockType === 'road_bootcamp') {
          navigate(`/session/${id}`)
          return
        }
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
        console.error('Failed to end session early (completed):', e)
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
        console.error('Failed to end session early (reset):', e)
      }
    }
  }

  async function commitSkip(id: string, commit: SkipReasonCommit) {
    setSkipReasonFor(null)
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
      console.error('Failed to skip session:', e)
    }
  }

  function handleReplaceStart(id: string) {
    setReplaceState({ sessionId: id, stage: 'reason' })
  }

  async function handleReplaceReasonCommit(reason: string) {
    if (!replaceState) return
    const sessionId = replaceState.sessionId
    setReplaceState({ sessionId, stage: 'loading', reason })
    try {
      const result = await apiFetch<ReplaceSuggestionsOutput>(
        `/api/sessions/${sessionId}/replace-suggestions`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }
      )
      if (result.suggestions && result.suggestions.length > 0) {
        setReplaceState({
          sessionId,
          stage: 'coach',
          reason,
          coachLine: result.coachLine ?? '',
          suggestions: result.suggestions,
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
      const s = await apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}`)
      setPickerSuggestions(s)
    } catch {
      setPickerSuggestions(null)
    }
  }

  async function handleReplaceAcceptSuggestion(suggestion: ReplaceSuggestion) {
    if (!replaceState || replaceState.stage !== 'coach') return
    const sessionId = replaceState.sessionId
    const reason = replaceState.reason
    setReplaceState(null)
    try {
      const result = await apiFetch<{ original: Session; replacement: Session }>(`/api/sessions/${sessionId}/replace`, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          type: suggestion.type,
          label: suggestion.label,
          timeSlot: suggestion.timeSlot,
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
    }
  }

  async function handleReplaceShowMore() {
    if (!replaceState || replaceState.stage !== 'coach') return
    await loadPickerFallback(replaceState.sessionId, replaceState.reason)
  }

  async function handleReplaceSelect(option: SessionOption) {
    if (!replaceState || replaceState.stage !== 'picker') return
    const sessionId = replaceState.sessionId
    const reason = replaceState.reason
    setReplaceState(null)
    setPickerSuggestions(null)
    try {
      const result = await apiFetch<{ original: Session; replacement: Session }>(`/api/sessions/${sessionId}/replace`, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          type: option.type,
          label: option.label,
          timeSlot: option.timeSlot,
          runCategory: option.runCategory,
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
    }
  }

  async function handleAddSession(option: SessionOption) {
    setShowPicker(false)
    try {
      const created = await apiFetch<Session>('/api/sessions/insert-ad-hoc', {
        method: 'POST',
        body: JSON.stringify({
          date: getTodayISO(),
          type: option.type,
          timeSlot: option.timeSlot,
          runCategory: option.runCategory,
        }),
      })
      setSessions(prev => [...prev, created].sort((a, b) =>
        (a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)
      ))
    } catch (e) {
      console.error('Failed to add session:', e)
    }
  }

  async function handleConfirmMatch(activityId: number) {
    try {
      await apiFetch(`/api/strava/activity/${activityId}/confirm`, { method: 'POST' })
      await refreshSessions()
      showToast('Logged.', 'success')
    } catch (e) {
      console.error('Failed to confirm match:', e)
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

  async function handleWellnessSubmit(data: WellnessData) {
    try {
      const log = await apiFetch<DailyLog>('/api/daily-logs', {
        method: 'POST',
        body: JSON.stringify({ date: today, ...data }),
      })
      setDailyLog(log)
    } catch (e) {
      console.error('Failed to save daily log:', e)
    }
  }

  if (loading) {
    return <TodaySkeleton />
  }

  return (
    <div className="relative flex flex-col gap-5 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <TodayTexture />
      <DateHeader date={todayDate} />

      {reactiveNotes.length > 0 && (
        <div className="rounded-xl border border-gold/10 bg-card/40 p-3">
          <p className="mb-1 font-cinzel text-[10px] uppercase tracking-[0.25em] text-gold/40">Coach</p>
          <ul className="space-y-1">
            {reactiveNotes.slice(0, 2).map(n => (
              <li key={n.id} className="text-[13px] leading-relaxed text-foreground/80">
                {n.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div data-tour="wellness-card">
        <WellnessPromptCard
          onSubmit={handleWellnessSubmit}
          isLogged={dailyLog !== null && dailyLog !== undefined}
          existing={dailyLog ?? null}
        />
      </div>

      <JournalCard />

      {sessions.length === 0 ? (
        <GeneratePlanButton
          onGenerate={handleGenerate}
          loading={generating}
          onAddSession={() => {
            setShowPicker(true)
            apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}`)
              .then(setPickerSuggestions)
              .catch(() => setPickerSuggestions(null))
          }}
        />
      ) : (
        <>
          <DayTimeline
            sessions={sessions}
            maxHr={maxHr}
            onStart={handleStart}
            onSkip={handleSkip}
            onReplace={handleReplaceStart}
            onEndEarly={handleEndEarly}
            onConfirmMatch={handleConfirmMatch}
            onReassignMatch={handleReassignStart}
            onDismissMatch={handleDismissMatch}
          />
          {tomorrowStrength && (
            <TomorrowStrengthCard session={tomorrowStrength} />
          )}
          <button
            onClick={() => {
              setShowPicker(true)
              apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}`)
                .then(setPickerSuggestions)
                .catch(() => setPickerSuggestions(null))
            }}
            aria-label="Add session"
            className="mx-auto mt-4 flex min-h-[44px] items-center gap-2 font-cinzel text-[13px] uppercase tracking-widest text-gold/40 active:text-gold/70 transition-colors"
          >
            <span className="text-gold/25">+</span>
            Add Session
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => navigate('/settings')}
        aria-label="Settings"
        className="mx-auto mt-8 mb-2 flex min-h-[44px] items-center gap-2 font-cinzel text-[13px] uppercase tracking-widest text-gold/40 active:text-gold/70 transition-colors"
      >
        <span className="size-3.5"><SettingsIcon /></span>
        Settings
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
          onCommit={(commit) => commitSkip(skipReasonFor, commit)}
          onClose={() => setSkipReasonFor(null)}
        />
      )}

      {replaceState?.stage === 'reason' && (
        <ReplaceReasonSheet
          onCommit={(reason) => handleReplaceReasonCommit(reason)}
          onClose={() => setReplaceState(null)}
        />
      )}

      {replaceState?.stage === 'loading' && (
        <ReplaceCoachCard
          loading
          onClose={() => setReplaceState(null)}
        />
      )}

      {replaceState?.stage === 'coach' && (
        <ReplaceCoachCard
          coachLine={replaceState.coachLine}
          suggestions={replaceState.suggestions}
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
          subtitle={replaceState.reason ? `Reason: ${replaceState.reason}` : undefined}
        />
      )}

      <ReassignRunSheet
        open={reassignFor != null}
        onClose={() => setReassignFor(null)}
        onSelect={handleReassignPick}
        excludeSessionId={reassignFor?.sessionId}
      />

      <ToastContainer />
    </div>
  )
}

function TomorrowStrengthCard({ session }: { session: Session }) {
  const [previews, setPreviews] = useState<RoadBootcampPreviewOption[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch<{ roadBootcampPreviews?: RoadBootcampPreviewOption[] }>(`/api/sessions/${session.id}/strength-preview`)
      .then(res => {
        if (cancelled) return
        setPreviews(res.roadBootcampPreviews ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
    return () => { cancelled = true }
  }, [session.id])

  if (error || previews.length === 0) return null

  return (
    <section className="rounded-xl border border-gold/10 bg-card/35 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="font-cinzel text-[10px] uppercase tracking-[0.25em] text-gold/45">Tomorrow</p>
          <h2 className="mt-1 font-cinzel text-[17px] uppercase tracking-[0.08em] text-gold">
            Strength
          </h2>
        </div>
        <p className="text-right text-[11px] uppercase tracking-[0.14em] text-muted-foreground/45">
          Preview
        </p>
      </div>
      <div className="space-y-3">
        {previews.map(option => (
          <div key={option.equipment} className="border-t border-border/25 pt-3 first:border-t-0 first:pt-0">
            <div className="mb-1">
              <p className="font-cinzel text-[12px] uppercase tracking-[0.16em] text-foreground/85">
                {option.label}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/50">
                {option.note}
              </p>
            </div>
            <p className="text-[12px] leading-relaxed text-muted-foreground/85">
              {option.exercises.join(' · ')}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

type ReplaceCoachCardProps =
  | { loading: true; onClose: () => void }
  | {
      loading?: false
      coachLine: string
      suggestions: ReplaceSuggestion[]
      onAccept: (suggestion: ReplaceSuggestion) => void
      onShowMore: () => void
      onClose: () => void
    }

function ReplaceCoachCard(props: ReplaceCoachCardProps) {
  return (
    <div className="fixed inset-x-0 z-40 flex justify-center px-4 animate-fade-in-up" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md rounded-lg border border-gold/10 bg-surface p-4 shadow-lg">
        <p className="mb-1 font-cinzel text-[11px] uppercase tracking-[0.2em] text-gold/50">Coach</p>
        {props.loading ? (
          <p className="mb-1 text-sm text-muted-foreground/70">Reading the signal.</p>
        ) : (
          <>
            {props.coachLine && (
              <p className="mb-3 text-sm text-foreground">{props.coachLine}</p>
            )}
            <ul className="mb-3 space-y-1.5">
              {props.suggestions.map((s, idx) => (
                <li key={`${s.type}-${s.timeSlot}-${idx}`}>
                  <button
                    onClick={() => props.onAccept(s)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      idx === 0
                        ? 'border-gold/20 bg-gold/10 text-gold active:bg-gold/20'
                        : 'border-gold/10 bg-card/40 text-foreground active:bg-card/70'
                    }`}
                  >
                    <span className="font-medium">{s.label}</span>
                    <span className="font-cinzel text-[10px] uppercase tracking-[0.2em] text-gold/40">
                      {s.timeSlot}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={props.onShowMore}
                className="flex-1 rounded-md bg-secondary px-3 py-2 text-sm text-foreground active:bg-secondary/70"
              >
                More options
              </button>
              <button
                onClick={props.onClose}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground/60 active:text-foreground"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

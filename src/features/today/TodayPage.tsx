import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'

import { PageBackground } from '@/components/backgrounds/PageBackground'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { SkipReasonSheet } from '@/features/session/SkipReasonSheet'
import { ReplaceReasonSheet } from '@/features/session/ReplaceReasonSheet'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'

import { DateHeader } from './DateHeader'
import { DaySummary } from './DaySummary'
import { DayTimeline } from './DayTimeline'
import { GeneratePlanButton } from './GeneratePlanButton'
import { JournalCard } from './JournalCard'
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
}

interface DailyLog {
  id: string
  sleepHours: number | null
}

// Session types that have a dedicated workout engine
const WORKOUT_SESSION_TYPES = ['strength', 'posture_corrective', 'bag_work', 'running', 'skip_rope', 'active_recovery', 'mt_class', 'foundation_run']

export function TodayPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [dailyLog, setDailyLog] = useState<DailyLog | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerSuggestions, setPickerSuggestions] = useState<SuggestionsResponse | null>(null)
  const [reschedulePrompt, setReschedulePrompt] = useState<{
    adjustmentId: string | null
    line: string
    action: 'hold' | 'move' | 'swap' | 'recover'
    weekImpact: string | null
    targetDayOfWeek: number | null
    targetTimeSlot: 'am' | 'pm' | null
    swapToLabel: string | null
  } | null>(null)
  const [skipReasonFor, setSkipReasonFor] = useState<string | null>(null)
  const [replaceState, setReplaceState] = useState<
    | { sessionId: string; stage: 'reason' }
    | { sessionId: string; stage: 'picker'; reason: string }
    | null
  >(null)

  const today = getTodayISO()
  const todayDate = new Date(`${today}T12:00:00`)

  useEffect(() => {
    async function load() {
      try {
        const [sessionsData, logData] = await Promise.all([
          apiFetch<Session[]>(`/api/sessions/today?date=${today}`),
          apiFetch<DailyLog | null>(`/api/daily-logs/today?date=${today}`),
        ])
        setSessions(sessionsData)
        setDailyLog(logData)
      } catch (e) {
        console.error('Failed to load today data:', e)
        setDailyLog(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [today])

  useEffect(() => {
    apiFetch('/api/strava/poll-recent', { method: 'POST' }).catch(() => {
      // Silent: Strava can be offline or disconnected; not fatal.
    })
  }, [])

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
    if (!session) return

    // Sessions with dedicated workout engines
    if (WORKOUT_SESSION_TYPES.includes(session.type)) {
      try {
        const typeEndpoints: Record<string, string> = {
          foundation_run: `/api/sessions/${id}/start-foundation-run`,
          posture_corrective: `/api/sessions/${id}/start-posture`,
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
        console.error('Failed to start session:', e)
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
      console.error('Failed to start session:', e)
    }
  }

  function handleSkip(id: string) {
    setSkipReasonFor(id)
  }

  async function commitSkip(id: string, reason: string) {
    setSkipReasonFor(null)
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'skipped' } : s))
    )
    try {
      type CoachResp = {
        line: string
        action: 'hold' | 'move' | 'swap' | 'recover'
        weekImpact: string | null
        targetDayOfWeek: number | null
        targetTimeSlot: 'am' | 'pm' | null
        swapToType: string | null
        swapToLabel: string | null
        adjustmentId: string | null
      }
      const result = await apiFetch<{ session?: Session; coach?: CoachResp | null }>(`/api/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped', skipReason: reason }),
      })
      if (result.coach) {
        setReschedulePrompt({
          adjustmentId: result.coach.adjustmentId,
          line: result.coach.line,
          action: result.coach.action,
          weekImpact: result.coach.weekImpact,
          targetDayOfWeek: result.coach.targetDayOfWeek,
          targetTimeSlot: result.coach.targetTimeSlot,
          swapToLabel: result.coach.swapToLabel,
        })
      }
    } catch (e) {
      console.error('Failed to skip session:', e)
    }
  }

  async function handleAcceptReschedule() {
    if (!reschedulePrompt?.adjustmentId) {
      setReschedulePrompt(null)
      return
    }
    try {
      const r = await apiFetch<{ session?: Session }>(`/api/adjustments/${reschedulePrompt.adjustmentId}/accept`, { method: 'POST' })
      if (r.session) {
        setSessions(prev => {
          const next = [...prev, r.session!]
          return next.sort((a, b) => (a.scheduledDate ?? 0) - (b.scheduledDate ?? 0) || ((a.timeSlot === 'am' ? 0 : 1) - (b.timeSlot === 'am' ? 0 : 1)))
        })
      }
    } catch (e) {
      console.error('Failed to accept reschedule:', e)
    }
    setReschedulePrompt(null)
  }

  function handleDismissReschedule() {
    if (!reschedulePrompt) return
    if (reschedulePrompt.adjustmentId) {
      apiFetch(`/api/adjustments/${reschedulePrompt.adjustmentId}/reject`, { method: 'POST' }).catch(() => {})
    }
    setReschedulePrompt(null)
  }

  function handleReplaceStart(id: string) {
    setReplaceState({ sessionId: id, stage: 'reason' })
  }

  async function handleReplaceReasonCommit(reason: string) {
    if (!replaceState) return
    setReplaceState({ sessionId: replaceState.sessionId, stage: 'picker', reason })
    try {
      const s = await apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${today}`)
      setPickerSuggestions(s)
    } catch {
      setPickerSuggestions(null)
    }
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
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  const allDone = sessions.length > 0 && sessions.every(s => s.status === 'completed' || s.status === 'skipped')

  return (
    <div className="relative flex flex-col gap-5 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <PageBackground />
      <DateHeader date={todayDate} />

      <WellnessPromptCard onSubmit={handleWellnessSubmit} isLogged={dailyLog !== null && dailyLog !== undefined} />

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
      ) : allDone ? (
        <div className="flex flex-1 items-center justify-center" style={{ minHeight: 'calc(100vh - 220px)' }}>
          <DaySummary sessions={sessions} todayDate={todayDate} />
        </div>
      ) : (
        <>
          <DayTimeline sessions={sessions} onStart={handleStart} onSkip={handleSkip} onReplace={handleReplaceStart} />
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

      {showPicker && (
        <SessionPicker
          onSelect={handleAddSession}
          onClose={() => { setShowPicker(false); setPickerSuggestions(null) }}
          suggestions={pickerSuggestions}
        />
      )}

      {skipReasonFor && (
        <SkipReasonSheet
          onCommit={(reason) => commitSkip(skipReasonFor, reason)}
          onClose={() => setSkipReasonFor(null)}
        />
      )}

      {replaceState?.stage === 'reason' && (
        <ReplaceReasonSheet
          onCommit={(reason) => handleReplaceReasonCommit(reason)}
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

      {reschedulePrompt && (
        <RescheduleCoachCard
          prompt={reschedulePrompt}
          onAccept={handleAcceptReschedule}
          onDismiss={handleDismissReschedule}
        />
      )}
    </div>
  )
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function RescheduleCoachCard({ prompt, onAccept, onDismiss }: {
  prompt: {
    adjustmentId: string | null
    line: string
    action: 'hold' | 'move' | 'swap' | 'recover'
    weekImpact: string | null
    targetDayOfWeek: number | null
    targetTimeSlot: 'am' | 'pm' | null
    swapToLabel: string | null
  }
  onAccept: () => void
  onDismiss: () => void
}) {
  const hasAction = prompt.adjustmentId != null && (prompt.action === 'move' || prompt.action === 'swap')

  let primaryLabel = 'OK'
  if (prompt.action === 'move' && prompt.targetDayOfWeek != null && prompt.targetTimeSlot) {
    primaryLabel = `Move to ${DAY_SHORT[prompt.targetDayOfWeek]} ${prompt.targetTimeSlot.toUpperCase()}`
  } else if (prompt.action === 'swap' && prompt.swapToLabel && prompt.targetTimeSlot) {
    primaryLabel = `Swap for ${prompt.swapToLabel}`
  }

  return (
    <div className="fixed inset-x-0 z-40 flex justify-center px-4 animate-fade-in-up" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md rounded-lg border border-gold/10 bg-surface p-4 shadow-lg">
        <p className="mb-1 font-cinzel text-[11px] uppercase tracking-[0.2em] text-gold/50">Coach</p>
        <p className="mb-2 text-sm text-foreground">{prompt.line}</p>
        {prompt.weekImpact && (
          <p className="mb-3 text-xs text-muted-foreground/60">{prompt.weekImpact}</p>
        )}
        <div className="flex gap-2">
          {hasAction ? (
            <>
              <button
                onClick={onAccept}
                className="flex-1 rounded-md bg-gold/15 px-3 py-2 text-sm text-gold active:bg-gold/25"
              >
                {primaryLabel}
              </button>
              <button
                onClick={onDismiss}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground/60 active:text-foreground"
              >
                Not now
              </button>
            </>
          ) : (
            <button
              onClick={onDismiss}
              className="flex-1 rounded-md bg-secondary px-3 py-2 text-sm text-foreground active:bg-secondary/70"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

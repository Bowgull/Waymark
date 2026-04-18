import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'

import { PageBackground } from '@/components/backgrounds/PageBackground'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { SkipReasonSheet } from '@/features/session/SkipReasonSheet'
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
    adjustmentId: string
    reason: string
    skipContext: string | null
  } | null>(null)
  const [skipReasonFor, setSkipReasonFor] = useState<string | null>(null)

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
      const result = await apiFetch<{ session?: Session; skipContext?: string | null; reschedule?: { adjustmentId: string; reason: string } }>(`/api/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped', skipReason: reason }),
      })
      if (result.reschedule) {
        setReschedulePrompt({
          adjustmentId: result.reschedule.adjustmentId,
          reason: result.reschedule.reason,
          skipContext: result.skipContext ?? null,
        })
      }
    } catch (e) {
      console.error('Failed to skip session:', e)
    }
  }

  async function handleAcceptReschedule() {
    if (!reschedulePrompt) return
    try {
      await apiFetch(`/api/adjustments/${reschedulePrompt.adjustmentId}/accept`, { method: 'POST' })
    } catch (e) {
      console.error('Failed to accept reschedule:', e)
    }
    setReschedulePrompt(null)
  }

  function handleDismissReschedule() {
    if (!reschedulePrompt) return
    apiFetch(`/api/adjustments/${reschedulePrompt.adjustmentId}/reject`, { method: 'POST' }).catch(() => {})
    setReschedulePrompt(null)
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
    <div className="relative flex flex-col gap-5 pb-4">
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
          <DayTimeline sessions={sessions} onStart={handleStart} onSkip={handleSkip} />
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

      {/* Reschedule prompt after skip */}
      {reschedulePrompt && (
        <div className="fixed inset-x-0 z-40 flex justify-center px-4 animate-fade-in-up" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
          <div className="w-full max-w-md rounded-lg border border-gold/10 bg-surface p-4 shadow-lg">
            {reschedulePrompt.skipContext && (
              <p className="mb-1 text-xs text-muted-foreground/50">{reschedulePrompt.skipContext}</p>
            )}
            <p className="mb-3 text-sm text-foreground">{reschedulePrompt.reason}</p>
            <div className="flex gap-2">
              <button
                onClick={handleAcceptReschedule}
                className="flex-1 rounded-md bg-gold/15 px-3 py-2 text-sm text-gold active:bg-gold/25"
              >
                Reschedule
              </button>
              <button
                onClick={handleDismissReschedule}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground/60 active:text-foreground"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

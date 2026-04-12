import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'

import { PageBackground } from '@/components/backgrounds/PageBackground'

import { DateHeader } from './DateHeader'
import { DaySummary } from './DaySummary'
import { DayTimeline } from './DayTimeline'
import { GeneratePlanButton } from './GeneratePlanButton'
import { WeeklyJournalCard } from './WeeklyJournalCard'
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
const WORKOUT_SESSION_TYPES = ['strength', 'posture_corrective', 'bag_work', 'running', 'skip_rope', 'active_recovery', 'mt_class']

export function TodayPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [dailyLog, setDailyLog] = useState<DailyLog | null | undefined>(undefined)
  const [journal, setJournal] = useState<{ reflection: string | null } | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const today = getTodayISO()
  const todayDate = new Date(`${today}T12:00:00`)
  const isSunday = todayDate.getDay() === 0

  useEffect(() => {
    async function load() {
      try {
        const fetches: Promise<unknown>[] = [
          apiFetch<Session[]>(`/api/sessions/today?date=${today}`),
          apiFetch<DailyLog | null>(`/api/daily-logs/today?date=${today}`),
        ]
        if (isSunday) {
          fetches.push(apiFetch<{ reflection: string | null } | null>(`/api/weekly-journals/current?date=${today}`))
        }

        const results = await Promise.all(fetches)
        setSessions(results[0] as Session[])
        setDailyLog(results[1] as DailyLog | null)
        if (isSunday) {
          setJournal(results[2] as { reflection: string | null } | null)
        }
      } catch (e) {
        console.error('Failed to load today data:', e)
        setDailyLog(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [today, isSunday])

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

  async function handleSkip(id: string) {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'skipped' } : s))
    )
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped' }),
      })
    } catch (e) {
      console.error('Failed to skip session:', e)
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

  async function handleJournalSubmit(reflection: string) {
    try {
      await apiFetch('/api/weekly-journals', {
        method: 'POST',
        body: JSON.stringify({ date: today, reflection }),
      })
      setJournal({ reflection })
    } catch (e) {
      console.error('Failed to save journal:', e)
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

      {dailyLog === null && (
        <WellnessPromptCard onSubmit={handleWellnessSubmit} />
      )}

      {isSunday && journal !== undefined && (
        <WeeklyJournalCard
          onSubmit={handleJournalSubmit}
          existingReflection={journal?.reflection}
        />
      )}

      {sessions.length === 0 ? (
        <GeneratePlanButton onGenerate={handleGenerate} loading={generating} />
      ) : allDone ? (
        <div className="flex flex-1 items-center justify-center" style={{ minHeight: 'calc(100vh - 220px)' }}>
          <DaySummary sessions={sessions} todayDate={todayDate} />
        </div>
      ) : (
        <DayTimeline sessions={sessions} onStart={handleStart} onSkip={handleSkip} />
      )}
    </div>
  )
}

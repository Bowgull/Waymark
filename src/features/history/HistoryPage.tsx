import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

import { LifestyleSnapshot } from './LifestyleSnapshot'
import { SessionList } from './SessionList'
import { StatsSummary } from './StatsSummary'

interface Stats {
  completed: number
  planned: number
  totalDurationMin: number
  avgRpe: number | null
  streak: number
}

interface WellnessData {
  entries: number
  avgSleep: number | null
  avgSoreness: number | null
  avgWeed: number | null
  avgAlcohol: number | null
}

interface Session {
  id: string
  type: string
  status: string
  completedAt: number | null
  durationSec: number | null
  rpe: number | null
  scheduledDate: number | null
}

export function HistoryPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [wellness, setWellness] = useState<WellnessData | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [statsData, wellnessData, sessionsData] = await Promise.all([
          apiFetch<Stats>('/api/history/stats?days=7'),
          apiFetch<WellnessData | null>('/api/history/wellness?days=7'),
          apiFetch<Session[]>('/api/history/sessions?limit=30'),
        ])
        setStats(statsData)
        setWellness(wellnessData)
        setSessions(sessionsData)
      } catch (e) {
        console.error('Failed to load history:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-zinc-100">History</h2>

      {stats && <StatsSummary stats={stats} />}

      {wellness && <LifestyleSnapshot wellness={wellness} />}

      <SessionList sessions={sessions} />
    </div>
  )
}

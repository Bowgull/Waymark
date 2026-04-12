import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

import { ConsistencyChart } from './ConsistencyChart'
import { LifestyleSnapshot } from './LifestyleSnapshot'
import { PRList } from './PRList'
import { SessionList } from './SessionList'
import { StatsSummary } from './StatsSummary'
import { VolumeChart } from './VolumeChart'
import { WeightProgressionChart } from './WeightProgressionChart'

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

interface ConsistencyData {
  weeks: { weekStart: string; sessionsPlanned: number; sessionsCompleted: number; totalMinutes: number }[]
  currentStreak: number
  longestStreak: number
}

interface VolumePoint {
  date: string
  totalSets: number
  totalVolume: number
  sessionCount: number
}

interface PR {
  exerciseId: string
  exerciseName: string
  maxWeightKg: number
  date: string
  previousMaxKg: number | null
}

interface Exercise {
  id: string
  name: string
}

type Period = 7 | 30 | 90

export function HistoryPage() {
  const [period, setPeriod] = useState<Period>(30)
  const [stats, setStats] = useState<Stats | null>(null)
  const [wellness, setWellness] = useState<WellnessData | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [consistency, setConsistency] = useState<ConsistencyData | null>(null)
  const [volumeData, setVolumeData] = useState<VolumePoint[]>([])
  const [prs, setPrs] = useState<PR[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const weeks = period === 7 ? 4 : period === 30 ? 8 : 12
        const [statsData, wellnessData, sessionsData, consistencyData, volumeRes, prsData, exercisesData] = await Promise.all([
          apiFetch<Stats>(`/api/history/stats?days=${period}`),
          apiFetch<WellnessData | null>(`/api/history/wellness?days=${period}`),
          apiFetch<Session[]>('/api/history/sessions?limit=30'),
          apiFetch<ConsistencyData>(`/api/history/consistency?weeks=${weeks}`),
          apiFetch<{ dataPoints: VolumePoint[] }>(`/api/history/volume-trends?days=${period}`),
          apiFetch<{ prs: PR[] }>('/api/history/prs'),
          apiFetch<Exercise[]>('/api/exercises'),
        ])
        setStats(statsData)
        setWellness(wellnessData)
        setSessions(sessionsData)
        setConsistency(consistencyData)
        setVolumeData(volumeRes.dataPoints)
        setPrs(prsData.prs)
        // Filter to exercises that have strength data (appear in PRs)
        const prExIds = new Set(prsData.prs.map(p => p.exerciseId))
        setExercises(exercisesData.filter(e => prExIds.has(e.id)))
      } catch (e) {
        console.error('Failed to load history:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [period])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-display-lg text-foreground">Ledger</h2>
        <div className="flex gap-1">
          {([7, 30, 90] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium ${
                period === p
                  ? 'bg-gold text-near-black'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {stats && <StatsSummary stats={stats} />}

      {consistency && (
        <ConsistencyChart
          weeks={consistency.weeks}
          currentStreak={consistency.currentStreak}
          longestStreak={consistency.longestStreak}
        />
      )}

      {exercises.length > 0 && (
        <WeightProgressionChart exercises={exercises} days={period} />
      )}

      <VolumeChart data={volumeData} />

      <PRList prs={prs} />

      {wellness && <LifestyleSnapshot wellness={wellness} />}

      <SessionList sessions={sessions} />
    </div>
  )
}

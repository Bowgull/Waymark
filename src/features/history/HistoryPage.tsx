import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/PageHeader'

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="mb-5">
      <button
        onClick={onToggle}
        className="mb-3 flex w-full items-center gap-2"
      >
        <ChevronIcon open={open} />
        <span className="text-display-sm text-gold">{title}</span>
      </button>
      {open && children}
    </div>
  )
}

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

  // Collapsible section state — all open by default
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(['stats', 'consistency', 'weight', 'volume', 'prs', 'lifestyle', 'sessions'])
  )

  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
      <PageHeader title="Ledger">
        <div className="flex gap-1">
          {([7, 30, 90] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                period === p
                  ? 'bg-gold text-near-black'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Stats — always visible, no collapsible wrapper needed */}
      {stats && <StatsSummary stats={stats} />}

      {consistency && (
        <Section title="Consistency" open={openSections.has('consistency')} onToggle={() => toggleSection('consistency')}>
          <ConsistencyChart
            weeks={consistency.weeks}
            currentStreak={consistency.currentStreak}
            longestStreak={consistency.longestStreak}
          />
        </Section>
      )}

      {exercises.length > 0 && (
        <Section title="Weight Progression" open={openSections.has('weight')} onToggle={() => toggleSection('weight')}>
          <WeightProgressionChart exercises={exercises} days={period} />
        </Section>
      )}

      {volumeData.length > 0 && (
        <Section title="Volume Trend" open={openSections.has('volume')} onToggle={() => toggleSection('volume')}>
          <VolumeChart data={volumeData} />
        </Section>
      )}

      {prs.length > 0 && (
        <Section title="Personal Records" open={openSections.has('prs')} onToggle={() => toggleSection('prs')}>
          <PRList prs={prs} />
        </Section>
      )}

      {wellness && (
        <Section title="Lifestyle" open={openSections.has('lifestyle')} onToggle={() => toggleSection('lifestyle')}>
          <LifestyleSnapshot wellness={wellness} />
        </Section>
      )}

      <Section title="Recent Sessions" open={openSections.has('sessions')} onToggle={() => toggleSection('sessions')}>
        <SessionList sessions={sessions} />
      </Section>
    </div>
  )
}

import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/PageHeader'

import { ConsistencyChart } from './ConsistencyChart'
import { LifestyleCorrelations } from './LifestyleCorrelations'
import { PRList } from './PRList'
import { RunningProgressChart } from './RunningProgressChart'
import { SessionList } from './SessionList'
import { StatsSummary } from './StatsSummary'
import { VolumeChart } from './VolumeChart'
import { WeightProgressionChart } from './WeightProgressionChart'

interface DashboardData {
  currentStreak: number
  prsThisMonth: number
  completionRate: number
  topLift: { name: string; weightLbs: number } | null
  totalRuns: number
  thisWeek: { volume: number; sessions: number; avgRpe: number | null; avgSleep: number | null }
  lastWeek: { volume: number; sessions: number; avgRpe: number | null; avgSleep: number | null }
}

interface CorrelationDataPoint {
  date: string
  sleepHours: number | null
  soreness: number | null
  weedGrams: number | null
  alcoholScale: number | null
  avgRpe: number | null
  sessionCount: number
}

interface RunDataPoint {
  date: string
  distanceKm: number
  paceSecKm: number
  type: string
}

interface RunSummary {
  totalRuns: number
  totalDistanceKm: number
  avgPaceSecKm: number | null
  bestPaceSecKm: number | null
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
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [correlations, setCorrelations] = useState<CorrelationDataPoint[]>([])
  const [runData, setRunData] = useState<RunDataPoint[]>([])
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [consistency, setConsistency] = useState<ConsistencyData | null>(null)
  const [volumeData, setVolumeData] = useState<VolumePoint[]>([])
  const [prs, setPrs] = useState<PR[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)

  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(['consistency', 'weight', 'volume', 'running', 'prs', 'lifestyle', 'sessions'])
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
        const [
          dashboardData,
          correlationData,
          runProgressData,
          sessionsData,
          consistencyData,
          volumeRes,
          prsData,
          exercisesData,
        ] = await Promise.all([
          apiFetch<DashboardData>('/api/history/dashboard'),
          apiFetch<{ dataPoints: CorrelationDataPoint[] }>(`/api/history/correlations?days=${period}`),
          apiFetch<{ dataPoints: RunDataPoint[]; summary: RunSummary }>(`/api/history/running-progress?days=${period}`),
          apiFetch<Session[]>('/api/history/sessions?limit=30'),
          apiFetch<ConsistencyData>(`/api/history/consistency?weeks=${weeks}`),
          apiFetch<{ dataPoints: VolumePoint[] }>(`/api/history/volume-trends?days=${period}`),
          apiFetch<{ prs: PR[] }>('/api/history/prs'),
          apiFetch<Exercise[]>('/api/exercises'),
        ])
        setDashboard(dashboardData)
        setCorrelations(correlationData.dataPoints)
        setRunData(runProgressData.dataPoints)
        setRunSummary(runProgressData.summary)
        setSessions(sessionsData)
        setConsistency(consistencyData)
        setVolumeData(volumeRes.dataPoints)
        setPrs(prsData.prs)
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

      <StatsSummary dashboard={dashboard} />

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
        <Section title="Volume" open={openSections.has('volume')} onToggle={() => toggleSection('volume')}>
          <VolumeChart data={volumeData} />
        </Section>
      )}

      {runSummary && runSummary.totalRuns > 0 && (
        <Section title="Running" open={openSections.has('running')} onToggle={() => toggleSection('running')}>
          <RunningProgressChart data={runData} summary={runSummary} />
        </Section>
      )}

      {prs.length > 0 && (
        <Section title="Personal Records" open={openSections.has('prs')} onToggle={() => toggleSection('prs')}>
          <PRList prs={prs} />
        </Section>
      )}

      <Section title="Lifestyle" open={openSections.has('lifestyle')} onToggle={() => toggleSection('lifestyle')}>
        <LifestyleCorrelations data={correlations} />
      </Section>

      <Section title="Recent Sessions" open={openSections.has('sessions')} onToggle={() => toggleSection('sessions')}>
        <SessionList sessions={sessions} />
      </Section>
    </div>
  )
}

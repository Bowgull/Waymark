import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { paceToMinSec } from '@/lib/chartTheme'
import { generateInsights } from '@/lib/insightEngine'
import { PageHeader } from '@/components/PageHeader'
import { HistorySkeleton } from '@/components/ui/Skeleton'

import { ChartCard } from './ChartCard'
import { CompletionRings } from './CompletionRings'
import { ConsistencyChart } from './ConsistencyChart'
import { InsightCallout } from './InsightCallout'
import { LifestyleCorrelations } from './LifestyleCorrelations'
import { MomentumGrid } from './MomentumGrid'
import { PRList } from './PRList'
import { RunningProgressChart } from './RunningProgressChart'
import { SessionList } from './SessionList'
import { VolumeChart } from './VolumeChart'
import { WeightProgressionChart } from './WeightProgressionChart'

interface DashboardData {
  currentStreak: number
  prsThisMonth: number
  completionRate: number
  topLift: { name: string; weightLbs: number } | null
  totalRuns: number
  thisWeek: { durationMin: number; sessions: number; avgRpe: number | null; avgSleep: number | null; distanceKm: number }
  lastWeek: { durationMin: number; sessions: number; avgRpe: number | null; avgSleep: number | null; distanceKm: number }
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
  totalDurationMin: number
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

interface CategoryCompletion {
  [key: string]: { completed: number; target: number }
}

type Period = 7 | 30 | 90

export function HistoryPage() {
  const [period, setPeriod] = useState<Period>(7)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [correlations, setCorrelations] = useState<CorrelationDataPoint[]>([])
  const [runData, setRunData] = useState<RunDataPoint[]>([])
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [consistency, setConsistency] = useState<ConsistencyData | null>(null)
  const [volumeData, setVolumeData] = useState<VolumePoint[]>([])
  const [prs, setPrs] = useState<PR[]>([])
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [categoryCompletion, setCategoryCompletion] = useState<CategoryCompletion | null>(null)
  const [loading, setLoading] = useState(true)
  const [aiInsights, setAiInsights] = useState<string[] | null>(null)

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
          categoryData,
        ] = await Promise.all([
          apiFetch<DashboardData>(`/api/history/dashboard?days=${period}`),
          apiFetch<{ dataPoints: CorrelationDataPoint[] }>(`/api/history/correlations?days=${period}`),
          apiFetch<{ dataPoints: RunDataPoint[]; summary: RunSummary }>(`/api/history/running-progress?days=${period}`),
          apiFetch<Session[]>('/api/history/sessions?limit=30'),
          apiFetch<ConsistencyData>(`/api/history/consistency?weeks=${weeks}`),
          apiFetch<{ dataPoints: VolumePoint[] }>(`/api/history/volume-trends?days=${period}`),
          apiFetch<{ prs: PR[] }>('/api/history/prs'),
          apiFetch<Exercise[]>('/api/exercises'),
          apiFetch<CategoryCompletion>(`/api/history/category-completion?days=${period}`),
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
        setCategoryCompletion(categoryData)
      } catch (e) {
        console.error('Failed to load history:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [period])

  // Local rule-based insights, used as offline fallback.
  const localInsights = useMemo(() => {
    if (!dashboard) return []
    return generateInsights({
      dashboard,
      consistency,
      prs,
      correlations,
      runSummary,
      categoryCompletion,
    })
  }, [dashboard, consistency, prs, correlations, runSummary, categoryCompletion])

  useEffect(() => {
    if (!dashboard) return
    let cancelled = false
    const payload = { dashboard, consistency, prs, correlations, runSummary, categoryCompletion }
    apiFetch<{ insights: string[] | null }>('/api/ai/ledger-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => {
        if (cancelled) return
        setAiInsights(res.insights && res.insights.length > 0 ? res.insights : null)
      })
      .catch(() => {
        if (!cancelled) setAiInsights(null)
      })
    return () => { cancelled = true }
  }, [dashboard, consistency, prs, correlations, runSummary, categoryCompletion])

  const insights = aiInsights ?? localInsights

  // Sparkline data derivations
  const consistencySparkline = consistency
    ? consistency.weeks.map(w => w.sessionsCompleted)
    : []

  const volumeSparkline = volumeData.map(v => v.totalDurationMin)

  const runSparkline = runData.map(r => r.paceSecKm)

  if (loading) {
    return <HistorySkeleton />
  }

  // Headline stats for chart cards
  const streakHeadline = consistency
    ? `${consistency.currentStreak}d streak`
    : undefined

  const volumeHeadline = dashboard && dashboard.thisWeek.durationMin > 0
    ? (() => {
        const min = dashboard.thisWeek.durationMin
        return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
      })()
    : undefined

  const runHeadline = runSummary?.avgPaceSecKm
    ? `${paceToMinSec(runSummary.avgPaceSecKm)}/km avg`
    : undefined

  const prHeadline = prs.length > 0
    ? `${prs.length} mark${prs.length === 1 ? '' : 's'}`
    : undefined

  const sleepAvg = correlations.length > 0
    ? correlations.filter(c => c.sleepHours != null).reduce((s, c) => s + c.sleepHours!, 0) /
      (correlations.filter(c => c.sleepHours != null).length || 1)
    : null
  const lifestyleHeadline = sleepAvg
    ? `${sleepAvg.toFixed(1)}h avg sleep`
    : undefined

  return (
    <div className="pb-4">
      <PageHeader title="Ledger">
        <div className="flex gap-1">
          {([7, 30, 90] as Period[]).map((p) => {
            const label = { 7: 'Week', 30: 'Month', 90: 'Season' }[p]
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1 text-xs font-display uppercase tracking-wider ${
                  period === p
                    ? 'bg-gold text-near-black'
                    : 'bg-secondary text-muted-foreground'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </PageHeader>

      {/* ZONE A: Hero */}
      <CompletionRings data={categoryCompletion} />
      <InsightCallout insights={insights} />

      {/* ZONE B: Momentum */}
      {dashboard && (
        <MomentumGrid
          thisWeek={dashboard.thisWeek}
          lastWeek={dashboard.lastWeek}
          period={period}
        />
      )}

      {/* ZONE C: Detail Cards */}
      <div className="space-y-3 px-4">
        {consistency && (
          <ChartCard
            title="Consistency"
            headline={streakHeadline}
            sparklineData={consistencySparkline}
            sparklineColor="#E8C860"
          >
            <ConsistencyChart
              weeks={consistency.weeks}
              currentStreak={consistency.currentStreak}
              longestStreak={consistency.longestStreak}
              period={period}
            />
          </ChartCard>
        )}

        {exercises.length > 0 && (
          <ChartCard
            title="Iron Log"
            headline={dashboard?.topLift ? `${dashboard.topLift.name} ${dashboard.topLift.weightLbs} lb` : undefined}
          >
            <WeightProgressionChart exercises={exercises} days={period} />
          </ChartCard>
        )}

        {volumeData.length > 0 && (
          <ChartCard
            title="Time Training"
            headline={volumeHeadline}
            sparklineData={volumeSparkline}
            sparklineColor="#1E8A68"
          >
            <VolumeChart data={volumeData} />
          </ChartCard>
        )}

        {runSummary && runSummary.totalRuns > 0 && (
          <ChartCard
            title="Running"
            headline={runHeadline}
            sparklineData={runSparkline}
            sparklineColor="#C45A3C"
          >
            <RunningProgressChart data={runData} summary={runSummary} />
          </ChartCard>
        )}

        <ChartCard
          title="Body & Mind"
          headline={lifestyleHeadline}
          sparklineColor="#4ABA8A"
        >
          <LifestyleCorrelations data={correlations} />
        </ChartCard>

        {prs.length > 0 && (
          <ChartCard
            title="Marks Earned"
            headline={prHeadline}
          >
            <PRList prs={prs} />
          </ChartCard>
        )}

        <ChartCard title="Recent Sessions">
          <SessionList sessions={sessions} />
        </ChartCard>
      </div>
    </div>
  )
}

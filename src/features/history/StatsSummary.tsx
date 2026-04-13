interface WeekStats {
  volume: number
  sessions: number
  avgRpe: number | null
  avgSleep: number | null
}

interface DashboardData {
  currentStreak: number
  prsThisMonth: number
  completionRate: number
  topLift: { name: string; weightLbs: number } | null
  totalRuns: number
  thisWeek: WeekStats
  lastWeek: WeekStats
}

interface StatsSummaryProps {
  dashboard: DashboardData | null
  /** Fallback for when dashboard hasn't loaded yet */
  stats?: {
    completed: number
    planned: number
    totalDurationMin: number
    avgRpe: number | null
    streak: number
  }
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-label text-muted-foreground">{label}</p>
      <p className="text-stat text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function DeltaItem({ label, current, previous, unit, invert }: {
  label: string
  current: number | null
  previous: number | null
  unit?: string
  invert?: boolean // true means lower is better (e.g. RPE)
}) {
  const curr = current ?? 0
  const prev = previous ?? 0
  const diff = curr - prev
  const improved = invert ? diff < 0 : diff > 0
  const changed = Math.abs(diff) > 0.01

  const formatVal = (v: number | null) => {
    if (v == null) return '-'
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }

  return (
    <div>
      <p className="text-label text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">
        {formatVal(current)}{unit ? ` ${unit}` : ''}
        {changed && (
          <span className={improved ? 'text-teal ml-1' : 'text-muted-foreground ml-1'}>
            {diff > 0 ? '+' : ''}{formatVal(diff)}
          </span>
        )}
      </p>
    </div>
  )
}

export function StatsSummary({ dashboard, stats }: StatsSummaryProps) {
  if (!dashboard && stats) {
    // Fallback to old display while dashboard loads
    const adherence = stats.planned > 0 ? Math.round((stats.completed / stats.planned) * 100) : 0
    const hours = Math.floor(stats.totalDurationMin / 60)
    const mins = stats.totalDurationMin % 60
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`

    return (
      <div className="mb-6 grid grid-cols-2 gap-3">
        <StatCard label="Sessions" value={`${stats.completed}/${stats.planned}`} sub={`${adherence}% adherence`} />
        <StatCard label="Training Time" value={timeStr} />
        <StatCard label="Avg RPE" value={stats.avgRpe != null ? String(stats.avgRpe) : '-'} sub="Effort level" />
        <StatCard label="Streak" value={`${stats.streak}`} sub={stats.streak === 1 ? 'day' : 'days'} />
      </div>
    )
  }

  if (!dashboard) return null

  return (
    <div className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Streak"
          value={`${dashboard.currentStreak}`}
          sub={dashboard.currentStreak === 1 ? 'day' : 'days'}
        />
        <StatCard
          label="PRs"
          value={`${dashboard.prsThisMonth}`}
          sub="this month"
        />
        <StatCard
          label="Adherence"
          value={`${dashboard.completionRate}%`}
          sub="completion"
        />
        <StatCard
          label="Top Lift"
          value={dashboard.topLift ? `${dashboard.topLift.weightLbs} lb` : '-'}
          sub={dashboard.topLift?.name ?? ''}
        />
      </div>

      {/* Week-over-week comparison */}
      <div className="rounded-md border border-border bg-card p-3">
        <p className="text-label text-muted-foreground mb-2">This week vs last</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <DeltaItem label="Volume" current={dashboard.thisWeek.volume} previous={dashboard.lastWeek.volume} unit="lb" />
          <DeltaItem label="Sessions" current={dashboard.thisWeek.sessions} previous={dashboard.lastWeek.sessions} />
          <DeltaItem label="Avg RPE" current={dashboard.thisWeek.avgRpe} previous={dashboard.lastWeek.avgRpe} invert />
          <DeltaItem label="Avg Sleep" current={dashboard.thisWeek.avgSleep} previous={dashboard.lastWeek.avgSleep} unit="hrs" />
        </div>
      </div>
    </div>
  )
}

interface Stats {
  completed: number
  planned: number
  totalDurationMin: number
  avgRpe: number | null
  streak: number
}

interface StatsSummaryProps {
  stats: Stats
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-bold text-zinc-100">{value}</p>
      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

export function StatsSummary({ stats }: StatsSummaryProps) {
  const adherence = stats.planned > 0
    ? Math.round((stats.completed / stats.planned) * 100)
    : 0

  const hours = Math.floor(stats.totalDurationMin / 60)
  const mins = stats.totalDurationMin % 60
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`

  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      <StatCard
        label="Sessions"
        value={`${stats.completed}/${stats.planned}`}
        sub={`${adherence}% adherence`}
      />
      <StatCard
        label="Training Time"
        value={timeStr}
        sub="This week"
      />
      <StatCard
        label="Avg RPE"
        value={stats.avgRpe != null ? String(stats.avgRpe) : '—'}
        sub="Effort level"
      />
      <StatCard
        label="Streak"
        value={`${stats.streak}`}
        sub={stats.streak === 1 ? 'day' : 'days'}
      />
    </div>
  )
}

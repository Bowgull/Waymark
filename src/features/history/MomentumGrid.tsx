interface WeekStats {
  volume: number
  sessions: number
  avgRpe: number | null
  avgSleep: number | null
  distanceKm: number
}

interface MomentumGridProps {
  thisWeek: WeekStats
  lastWeek: WeekStats
  period: 7 | 30 | 90
}

function Arrow({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  if (direction === 'flat') {
    return (
      <svg className="inline h-3 w-3 text-muted-foreground" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M2 6h8" />
      </svg>
    )
  }
  return (
    <svg
      className={`inline h-3 w-3 ${direction === 'up' ? 'text-teal' : 'text-muted-foreground'}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      {direction === 'up'
        ? <path d="M6 10V2M3 5l3-3 3 3" />
        : <path d="M6 2v8M3 7l3 3 3-3" />
      }
    </svg>
  )
}

function MomentumCard({
  label,
  value,
  unit,
  delta,
  improved,
  className,
}: {
  label: string
  value: string
  unit?: string
  delta: string
  improved: 'up' | 'down' | 'flat'
  className?: string
}) {
  return (
    <div className={`rounded-md border border-border bg-card p-3 animate-fade-in-up ${className ?? ''}`}>
      <p className="text-label text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-stat text-foreground">{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs">
        <Arrow direction={improved} />
        <span className={improved === 'up' ? 'text-teal' : 'text-muted-foreground'}>{delta}</span>
      </div>
    </div>
  )
}

function getDelta(current: number | null, previous: number | null, invert = false): { delta: string; direction: 'up' | 'down' | 'flat' } {
  const curr = current ?? 0
  const prev = previous ?? 0
  const diff = curr - prev

  if (Math.abs(diff) < 0.01) return { delta: 'same', direction: 'flat' }

  const improved = invert ? diff < 0 : diff > 0
  const formatted = Number.isInteger(diff) ? Math.abs(diff).toString() : Math.abs(diff).toFixed(1)
  const sign = diff > 0 ? '+' : '-'

  return {
    delta: `${sign}${formatted}`,
    direction: improved ? 'up' : 'down',
  }
}

export function MomentumGrid({ thisWeek, lastWeek, period }: MomentumGridProps) {
  const periodLabel = period === 7 ? { current: 'This Week', prior: 'vs last week' }
    : period === 30 ? { current: 'Last 30 Days', prior: 'vs prior 30' }
    : { current: 'Last 90 Days', prior: 'vs prior 90' }
  const vol = getDelta(thisWeek.volume, lastWeek.volume)
  const sess = getDelta(thisWeek.sessions, lastWeek.sessions)
  const effort = getDelta(thisWeek.avgRpe, lastWeek.avgRpe, true) // lower RPE = better
  const sleep = getDelta(thisWeek.avgSleep, lastWeek.avgSleep)
  const dist = getDelta(thisWeek.distanceKm, lastWeek.distanceKm)

  const formatVal = (v: number | null) => {
    if (v == null) return '-'
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }

  return (
    <div className="px-4 mb-5">
      <p className="text-label text-muted-foreground mb-2">{periodLabel.current} <span className="text-muted-foreground/60">· {periodLabel.prior}</span></p>
      <div className="grid grid-cols-2 gap-3">
      <MomentumCard
        label="Volume"
        value={thisWeek.volume > 0 ? `${Math.round(thisWeek.volume).toLocaleString()}` : '0'}
        unit="lb"
        delta={vol.delta}
        improved={vol.direction}
      />
      <MomentumCard
        label="Workouts"
        value={String(thisWeek.sessions)}
        delta={sess.delta}
        improved={sess.direction}
      />
      <MomentumCard
        label="Effort"
        value={formatVal(thisWeek.avgRpe)}
        delta={effort.delta}
        improved={effort.direction}
      />
      <MomentumCard
        label="Sleep"
        value={formatVal(thisWeek.avgSleep)}
        unit="hrs"
        delta={sleep.delta}
        improved={sleep.direction}
      />
      <MomentumCard
        label="Distance"
        value={thisWeek.distanceKm > 0 ? thisWeek.distanceKm.toFixed(1) : '0'}
        unit="km"
        delta={dist.delta}
        improved={dist.direction}
        className="col-span-2"
      />
      </div>
    </div>
  )
}

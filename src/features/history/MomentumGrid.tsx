interface WeekStats {
  volume: number
  sessions: number
  avgRpe: number | null
  avgSleep: number | null
}

interface MomentumGridProps {
  thisWeek: WeekStats
  lastWeek: WeekStats
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
}: {
  label: string
  value: string
  unit?: string
  delta: string
  improved: 'up' | 'down' | 'flat'
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3 animate-fade-in-up">
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

export function MomentumGrid({ thisWeek, lastWeek }: MomentumGridProps) {
  const vol = getDelta(thisWeek.volume, lastWeek.volume)
  const sess = getDelta(thisWeek.sessions, lastWeek.sessions)
  const effort = getDelta(thisWeek.avgRpe, lastWeek.avgRpe, true) // lower RPE = better
  const sleep = getDelta(thisWeek.avgSleep, lastWeek.avgSleep)

  const formatVal = (v: number | null) => {
    if (v == null) return '-'
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }

  return (
    <div className="grid grid-cols-2 gap-3 px-4 mb-5">
      <MomentumCard
        label="Volume"
        value={thisWeek.volume > 0 ? `${Math.round(thisWeek.volume).toLocaleString()}` : '0'}
        unit="lb"
        delta={vol.delta}
        improved={vol.direction}
      />
      <MomentumCard
        label="Sessions"
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
    </div>
  )
}

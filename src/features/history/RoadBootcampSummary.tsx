interface RoadBootcampMetrics {
  runMinutes: number
  easyRunMinutes: number
  qualityRunMinutes: number
  strengthCompleted: number
  strengthTimeDistribution: Record<string, number>
  equipmentDistribution: Record<string, number>
  ropeCompleted: number
  avgSleep: number | null
  avgSoreness: number | null
  completionRate: number
}

function labelKey(value: string): string {
  if (value === '15') return '15 min'
  if (value === '30') return '30 min'
  if (value === '45_plus') return '45+'
  if (value === 'no_gym') return 'No gym'
  if (value === 'hotel_gym') return 'Hotel gym'
  if (value === 'full_gym') return 'Full gym'
  return value.replaceAll('_', ' ')
}

function topEntry(record: Record<string, number>): string {
  const [key, value] = Object.entries(record).sort((a, b) => b[1] - a[1])[0] ?? []
  return key ? `${labelKey(key)} x${value}` : 'None yet'
}

function MetricLine({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        {detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/70">{detail}</p>}
      </div>
      <p className="max-w-[48%] shrink-0 text-right text-sm tabular-nums text-foreground">{value}</p>
    </div>
  )
}

export function RoadBootcampSummary({ metrics }: { metrics: RoadBootcampMetrics }) {
  const completion = Math.max(0, Math.min(metrics.completionRate, 100))
  const easyQuality = `${metrics.easyRunMinutes}m easy / ${metrics.qualityRunMinutes}m quality`
  const readiness = [
    metrics.avgSleep != null ? `${metrics.avgSleep}h sleep` : 'No sleep logs',
    metrics.avgSoreness != null ? `soreness ${metrics.avgSoreness}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div>
      <div className="mb-3">
        <div className="mb-2 flex items-end justify-between gap-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Completion</p>
          <p className="text-sm tabular-nums text-foreground">{completion}%</p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
          <div className="h-full rounded-full bg-teal" style={{ width: `${completion}%` }} />
        </div>
      </div>

      <div className="divide-y divide-border/60">
        <MetricLine label="Running" value={`${metrics.runMinutes}m`} detail={easyQuality} />
        <MetricLine label="Strength" value={`${metrics.strengthCompleted}`} detail={`Time: ${topEntry(metrics.strengthTimeDistribution)}`} />
        <MetricLine label="Equipment" value={topEntry(metrics.equipmentDistribution)} />
        <MetricLine label="Rope" value={`${metrics.ropeCompleted}`} />
        <MetricLine label="Readiness" value={readiness} />
      </div>
    </div>
  )
}

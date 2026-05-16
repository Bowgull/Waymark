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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-near-black/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  )
}

export function RoadBootcampSummary({ metrics }: { metrics: RoadBootcampMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Stat label="Run time" value={`${metrics.runMinutes}m`} />
      <Stat label="Easy / quality" value={`${metrics.easyRunMinutes}m / ${metrics.qualityRunMinutes}m`} />
      <Stat label="Strength days" value={`${metrics.strengthCompleted}`} />
      <Stat label="Rope primers" value={`${metrics.ropeCompleted}`} />
      <Stat label="Time picked" value={topEntry(metrics.strengthTimeDistribution)} />
      <Stat label="Equipment" value={topEntry(metrics.equipmentDistribution)} />
      <Stat label="Sleep" value={metrics.avgSleep != null ? `${metrics.avgSleep}h` : 'No logs'} />
      <Stat label="Completion" value={`${metrics.completionRate}%`} />
    </div>
  )
}

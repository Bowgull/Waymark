interface WellnessData {
  entries: number
  avgSleep: number | null
  avgSoreness: number | null
  avgWeed: number | null
  avgAlcohol: number | null
}

interface LifestyleSnapshotProps {
  wellness: WellnessData
}

const SORENESS_LABELS: Record<number, string> = {
  1: 'Fresh', 2: 'Loose', 3: 'Normal', 4: 'Sore', 5: 'Cooked',
}

function getSorenessLabel(avg: number): string {
  const rounded = Math.round(avg)
  return SORENESS_LABELS[rounded] ?? String(avg)
}

export function LifestyleSnapshot({ wellness }: LifestyleSnapshotProps) {
  return (
    <div className="mb-6 border border-border border-l-4 border-l-teal bg-card p-4">
      <p className="text-display-sm mb-3 text-foreground">Lifestyle This Week</p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {wellness.avgSleep != null && (
          <>
            <span className="text-muted-foreground">Avg Sleep</span>
            <span className="text-foreground">{wellness.avgSleep} hrs</span>
          </>
        )}
        {wellness.avgSoreness != null && (
          <>
            <span className="text-muted-foreground">Avg Soreness</span>
            <span className="text-foreground">{getSorenessLabel(wellness.avgSoreness)}</span>
          </>
        )}
        {wellness.avgWeed != null && (
          <>
            <span className="text-muted-foreground">Avg Weed</span>
            <span className="text-foreground">{wellness.avgWeed}g</span>
          </>
        )}
        {wellness.avgAlcohol != null && (
          <>
            <span className="text-muted-foreground">Avg Alcohol</span>
            <span className="text-foreground">{wellness.avgAlcohol}/10</span>
          </>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {wellness.entries} {wellness.entries === 1 ? 'entry' : 'entries'} logged
      </p>
    </div>
  )
}

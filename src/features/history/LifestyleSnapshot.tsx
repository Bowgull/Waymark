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
    <div className="mb-6 rounded-xl border border-zinc-800 border-l-4 border-l-[#4ACAAA] bg-zinc-900 p-4">
      <p className="mb-3 text-sm font-medium text-zinc-300">Lifestyle This Week</p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {wellness.avgSleep != null && (
          <>
            <span className="text-zinc-500">Avg Sleep</span>
            <span className="text-zinc-100">{wellness.avgSleep} hrs</span>
          </>
        )}
        {wellness.avgSoreness != null && (
          <>
            <span className="text-zinc-500">Avg Soreness</span>
            <span className="text-zinc-100">{getSorenessLabel(wellness.avgSoreness)}</span>
          </>
        )}
        {wellness.avgWeed != null && (
          <>
            <span className="text-zinc-500">Avg Weed</span>
            <span className="text-zinc-100">{wellness.avgWeed}g</span>
          </>
        )}
        {wellness.avgAlcohol != null && (
          <>
            <span className="text-zinc-500">Avg Alcohol</span>
            <span className="text-zinc-100">{wellness.avgAlcohol}/10</span>
          </>
        )}
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        {wellness.entries} {wellness.entries === 1 ? 'entry' : 'entries'} logged
      </p>
    </div>
  )
}

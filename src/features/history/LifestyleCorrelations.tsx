import { CorrelationChart } from './CorrelationChart'

interface CorrelationDataPoint {
  date: string
  sleepHours: number | null
  soreness: number | null
  weedGrams: number | null
  alcoholScale: number | null
  avgRpe: number | null
  sessionCount: number
}

interface LifestyleCorrelationsProps {
  data: CorrelationDataPoint[]
  insights?: string[]
}

function toScatter(
  data: CorrelationDataPoint[],
  getX: (d: CorrelationDataPoint) => number | null,
) {
  return data
    .filter(d => d.avgRpe != null && getX(d) != null)
    .map(d => ({ x: getX(d)!, y: d.avgRpe!, date: d.date }))
}

function deriveInsights(data: CorrelationDataPoint[]): string[] {
  const notes: string[] = []
  const withSleep = data.filter(d => d.sleepHours != null && d.avgRpe != null)

  if (withSleep.length >= 5) {
    const good = withSleep.filter(d => d.sleepHours! >= 7)
    const poor = withSleep.filter(d => d.sleepHours! < 6)
    if (good.length >= 3 && poor.length >= 2) {
      const goodRpe = good.reduce((s, d) => s + d.avgRpe!, 0) / good.length
      const poorRpe = poor.reduce((s, d) => s + d.avgRpe!, 0) / poor.length
      if (poorRpe - goodRpe > 0.5) {
        notes.push('Your strongest sessions follow 7+ hours of sleep.')
      }
    }

    const avgSleep = withSleep.reduce((s, d) => s + d.sleepHours!, 0) / withSleep.length
    if (avgSleep < 6.5) {
      notes.push(`Averaging ${avgSleep.toFixed(1)}h sleep. The body recovers best with more.`)
    }
  }

  const withSoreness = data.filter(d => d.soreness != null && d.avgRpe != null)
  if (withSoreness.length >= 5) {
    const highSore = withSoreness.filter(d => d.soreness! >= 4)
    if (highSore.length >= 3) {
      const highRpe = highSore.reduce((s, d) => s + d.avgRpe!, 0) / highSore.length
      if (highRpe > 7) {
        notes.push('High soreness days tend to push effort higher. Listen when the body speaks.')
      }
    }
  }

  return notes
}

export function LifestyleCorrelations({ data, insights }: LifestyleCorrelationsProps) {
  const sleepData = toScatter(data, d => d.sleepHours)
  const sorenessData = toScatter(data, d => d.soreness)
  const weedData = toScatter(data, d => d.weedGrams)
  const alcoholData = toScatter(data, d => d.alcoholScale)

  const localInsights = insights && insights.length > 0 ? insights : deriveInsights(data)

  return (
    <div className="space-y-4">
      {localInsights.length > 0 && (
        <div className="rounded-md border-l-2 border-teal/30 bg-card/40 px-3 py-2">
          {localInsights.slice(0, 2).map((note, i) => (
            <p key={i} className={`text-xs leading-relaxed ${i > 0 ? 'mt-1.5 text-muted-foreground' : 'text-foreground/80'}`}>
              {note}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1.5 text-label text-muted-foreground">Sleep vs Effort</p>
          <CorrelationChart data={sleepData} xLabel="Sleep" yLabel="Effort" xDomain={[4, 10]} />
        </div>
        <div>
          <p className="mb-1.5 text-label text-muted-foreground">Soreness vs Effort</p>
          <CorrelationChart data={sorenessData} xLabel="Soreness" yLabel="Effort" xDomain={[1, 5]} jitter />
        </div>
        <div>
          <p className="mb-1.5 text-label text-muted-foreground">Herb vs Effort</p>
          <CorrelationChart data={weedData} xLabel="Herb (g)" yLabel="Effort" />
        </div>
        <div>
          <p className="mb-1.5 text-label text-muted-foreground">Alcohol vs Effort</p>
          <CorrelationChart data={alcoholData} xLabel="Alcohol" yLabel="Effort" xDomain={[0, 10]} jitter />
        </div>
      </div>
    </div>
  )
}

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
}

function toScatter(
  data: CorrelationDataPoint[],
  getX: (d: CorrelationDataPoint) => number | null,
) {
  return data
    .filter(d => d.avgRpe != null && getX(d) != null)
    .map(d => ({ x: getX(d)!, y: d.avgRpe!, date: d.date }))
}

export function LifestyleCorrelations({ data }: LifestyleCorrelationsProps) {
  const sleepData = toScatter(data, d => d.sleepHours)
  const sorenessData = toScatter(data, d => d.soreness)
  const weedData = toScatter(data, d => d.weedGrams)
  const alcoholData = toScatter(data, d => d.alcoholScale)

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Sleep (hrs) vs RPE</p>
        <CorrelationChart data={sleepData} xLabel="Sleep (hrs)" yLabel="RPE" xDomain={[4, 10]} />
      </div>
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Soreness vs RPE</p>
        <CorrelationChart data={sorenessData} xLabel="Soreness" yLabel="RPE" xDomain={[1, 5]} jitter />
      </div>
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Weed (g) vs RPE</p>
        <CorrelationChart data={weedData} xLabel="Weed (g)" yLabel="RPE" />
      </div>
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Alcohol vs RPE</p>
        <CorrelationChart data={alcoholData} xLabel="Alcohol" yLabel="RPE" xDomain={[0, 10]} jitter />
      </div>
    </div>
  )
}

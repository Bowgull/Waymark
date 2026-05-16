import { useState } from 'react'

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

type MetricKey = 'sleep' | 'soreness' | 'herb' | 'alcohol'

interface MetricConfig {
  key: MetricKey
  label: string
  get: (d: CorrelationDataPoint) => number | null
  xLabel: string
  xDomain?: [number, number]
  jitter?: boolean
}

const METRICS: MetricConfig[] = [
  { key: 'sleep', label: 'Sleep', get: d => d.sleepHours, xLabel: 'Sleep', xDomain: [4, 10] },
  { key: 'soreness', label: 'Soreness', get: d => d.soreness, xLabel: 'Soreness', xDomain: [1, 5], jitter: true },
  { key: 'herb', label: 'Herb', get: d => d.weedGrams, xLabel: 'Herb (g)' },
  { key: 'alcohol', label: 'Alcohol', get: d => d.alcoholScale, xLabel: 'Alcohol', xDomain: [0, 10], jitter: true },
]

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
        notes.push('Strongest sessions follow 7+ hours of sleep.')
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
        notes.push('High soreness days push effort higher. Cut volume first.')
      }
    }
  }

  return notes
}

export function LifestyleCorrelations({ data, insights }: LifestyleCorrelationsProps) {
  const [active, setActive] = useState<MetricKey>('sleep')

  const localInsights = insights && insights.length > 0 ? insights : deriveInsights(data)
  const activeMetric = METRICS.find(m => m.key === active) ?? METRICS[0]
  const scatterData = toScatter(data, activeMetric.get)

  return (
    <div className="space-y-3">
      {localInsights.length > 0 && (
        <div className="rounded-md border-l-2 border-teal/30 bg-card/40 px-3 py-2">
          {localInsights.slice(0, 2).map((note, i) => (
            <p key={i} className={`text-xs leading-relaxed ${i > 0 ? 'mt-1.5 text-muted-foreground' : 'text-foreground/80'}`}>
              {note}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setActive(m.key)}
            className={`rounded-md px-3 py-1 text-[11px] font-display uppercase tracking-wider transition-colors ${
              active === m.key
                ? 'bg-gold text-near-black'
                : 'bg-secondary text-muted-foreground active:bg-surface-light/50'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1.5 text-label text-muted-foreground">
          {activeMetric.label} vs Effort
        </p>
        <CorrelationChart
          data={scatterData}
          xLabel={activeMetric.xLabel}
          yLabel="Effort"
          xDomain={activeMetric.xDomain}
          jitter={activeMetric.jitter}
        />
      </div>
    </div>
  )
}

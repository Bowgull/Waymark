import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE } from '@/lib/chartTheme'
import { paceToMinSec } from '@/lib/chartTheme'

interface RunDataPoint {
  date: string
  distanceKm: number
  paceSecKm: number
  type: string
}

interface RunSummary {
  totalRuns: number
  totalDistanceKm: number
  avgPaceSecKm: number | null
  bestPaceSecKm: number | null
}

interface RunningProgressChartProps {
  data: RunDataPoint[]
  summary: RunSummary
}

export function RunningProgressChart({ data, summary }: RunningProgressChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-border bg-deep-forest p-3 flex items-center justify-center h-[160px]">
        <p className="text-xs text-muted-foreground">No runs logged yet</p>
      </div>
    )
  }

  const chartData = data.map(d => ({
    date: d.date.slice(5),
    pace: d.paceSecKm,
    distance: d.distanceKm,
  }))

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Runs: <span className="text-foreground">{summary.totalRuns}</span></span>
        <span>Total: <span className="text-foreground">{summary.totalDistanceKm} km</span></span>
        {summary.avgPaceSecKm != null && (
          <span>Avg: <span className="text-foreground">{paceToMinSec(summary.avgPaceSecKm)}/km</span></span>
        )}
        {summary.bestPaceSecKm != null && (
          <span>Best: <span className="text-foreground">{paceToMinSec(summary.bestPaceSecKm)}/km</span></span>
        )}
      </div>

      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData}>
            <XAxis dataKey="date" {...AXIS_STYLE} />
            <YAxis
              {...AXIS_STYLE}
              reversed
              tickFormatter={(v: number) => paceToMinSec(v)}
              domain={['auto', 'auto']}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value: number, name: string) => {
                if (name === 'pace') return [paceToMinSec(value) + '/km', 'Pace']
                return [value + ' km', 'Distance']
              }}
            />
            <Line
              type="monotone"
              dataKey="pace"
              stroke={CHART_COLORS.teal}
              strokeWidth={2}
              dot={{ fill: CHART_COLORS.teal, r: 3 }}
              name="pace"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

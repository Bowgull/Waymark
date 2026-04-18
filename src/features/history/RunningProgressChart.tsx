import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

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

const DISTANCE_FILL = 'rgba(74, 202, 170, 0.22)'

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

      <div className="mb-2 flex items-center gap-4 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3" style={{ backgroundColor: CHART_COLORS.clay }} />
          Pace (lower = faster)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2" style={{ backgroundColor: DISTANCE_FILL }} />
          Distance (km)
        </span>
      </div>

      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={chartData}>
            <XAxis dataKey="date" {...AXIS_STYLE} minTickGap={32} interval="preserveStartEnd" />
            <YAxis
              yAxisId="pace"
              {...AXIS_STYLE}
              reversed
              tickFormatter={(v: number) => paceToMinSec(v)}
              domain={['auto', 'auto']}
              width={40}
            />
            <YAxis
              yAxisId="distance"
              orientation="right"
              {...AXIS_STYLE}
              domain={[0, 'auto']}
              width={28}
              tickFormatter={(v: number) => `${v}`}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value, name) => {
                const v = Number(value)
                if (name === 'pace') return [paceToMinSec(v) + '/km', 'Pace']
                return [v + ' km', 'Distance']
              }}
            />
            <Bar
              yAxisId="distance"
              dataKey="distance"
              fill={DISTANCE_FILL}
              name="distance"
              barSize={16}
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="pace"
              type="monotone"
              dataKey="pace"
              stroke={CHART_COLORS.clay}
              strokeWidth={2}
              dot={{ fill: CHART_COLORS.clay, r: 3 }}
              name="pace"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AXIS_STYLE, CHART_COLORS, paceToMinSec, TOOLTIP_STYLE } from '@/lib/chartTheme'

interface AerobicFitnessPoint {
  sessionId: string
  date: string
  distanceKm: number
  paceSecKm: number
  avgHr: number
  runType: string | null
}

interface AerobicFitnessSummary {
  sampleCount: number
  avgPaceSecKm: number | null
  bestPaceSecKm: number | null
  avgHr: number | null
}

interface AerobicFitnessChartProps {
  data: AerobicFitnessPoint[]
  summary: AerobicFitnessSummary
}

export function AerobicFitnessChart({ data, summary }: AerobicFitnessChartProps) {
  if (data.length < 3) {
    return (
      <div className="rounded-md border border-border bg-deep-forest p-3 flex items-center justify-center h-[136px]">
        <p className="text-xs text-muted-foreground">Needs 3 runs near the same heart rate.</p>
      </div>
    )
  }

  const chartData = data.map(point => ({
    date: point.date.slice(5),
    pace: point.paceSecKm,
    avgHr: point.avgHr,
    distance: point.distanceKm,
  }))

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Samples: <span className="text-foreground">{summary.sampleCount}</span></span>
        {summary.avgPaceSecKm != null && (
          <span>Avg: <span className="text-foreground">{paceToMinSec(summary.avgPaceSecKm)}/km</span></span>
        )}
        {summary.bestPaceSecKm != null && (
          <span>Best: <span className="text-foreground">{paceToMinSec(summary.bestPaceSecKm)}/km</span></span>
        )}
        {summary.avgHr != null && (
          <span>HR: <span className="text-foreground">{summary.avgHr}</span></span>
        )}
      </div>

      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={chartData}>
            <XAxis dataKey="date" {...AXIS_STYLE} minTickGap={32} interval="preserveStartEnd" />
            <YAxis
              {...AXIS_STYLE}
              reversed
              tickFormatter={(v: number) => paceToMinSec(v)}
              domain={['auto', 'auto']}
              width={40}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value, name) => {
                if (name === 'pace') return [paceToMinSec(Number(value)) + '/km', 'Pace']
                return [String(value), String(name)]
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

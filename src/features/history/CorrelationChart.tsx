import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'

import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE } from '@/lib/chartTheme'

interface DataPoint {
  x: number
  y: number
  date: string
}

interface CorrelationChartProps {
  data: DataPoint[]
  xLabel: string
  yLabel: string
  xDomain?: [number, number]
  jitter?: boolean
}

export function CorrelationChart({ data, xLabel, yLabel, xDomain, jitter }: CorrelationChartProps) {
  if (data.length < 5) {
    return (
      <div className="rounded-md border border-border bg-deep-forest p-3 flex items-center justify-center h-[160px]">
        <p className="text-xs text-muted-foreground">Not enough data yet</p>
      </div>
    )
  }

  const meanY = Math.round(data.reduce((sum, d) => sum + d.y, 0) / data.length * 10) / 10

  // Apply slight jitter to integer x values to prevent dot stacking
  const chartData = jitter
    ? data.map(d => ({ ...d, x: d.x + (Math.random() - 0.5) * 0.3 }))
    : data

  return (
    <div className="rounded-md border border-border bg-deep-forest p-3">
      <ResponsiveContainer width="100%" height={160}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
          <XAxis
            dataKey="x"
            name={xLabel}
            type="number"
            domain={xDomain ?? ['auto', 'auto']}
            {...AXIS_STYLE}
          />
          <YAxis
            dataKey="y"
            name={yLabel}
            type="number"
            domain={[1, 10]}
            {...AXIS_STYLE}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value: number, name: string) => [
              Math.round(value * 10) / 10,
              name === 'x' ? xLabel : yLabel,
            ]}
            labelFormatter={() => ''}
          />
          <ReferenceLine
            y={meanY}
            stroke={CHART_COLORS.teal}
            strokeDasharray="4 4"
            strokeOpacity={0.6}
          />
          <Scatter
            data={chartData}
            fill={CHART_COLORS.gold}
            fillOpacity={0.7}
            r={4}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

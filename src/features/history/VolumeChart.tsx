import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE } from '@/lib/chartTheme'

interface TrainingTimePoint {
  date: string
  totalDurationMin: number
  sessionCount: number
}

interface VolumeChartProps {
  data: TrainingTimePoint[]
}

export function VolumeChart({ data }: VolumeChartProps) {
  if (data.length === 0) return null

  const chartData = data.map(d => ({
    date: d.date.slice(5),
    minutes: d.totalDurationMin,
  }))

  return (
    <div>
      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.tealDark} stopOpacity={0.45} />
                <stop offset="95%" stopColor={CHART_COLORS.tealDark} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" {...AXIS_STYLE} minTickGap={32} interval="preserveStartEnd" />
            <YAxis {...AXIS_STYLE} unit="m" />
            <Tooltip {...TOOLTIP_STYLE} />
            <Area
              type="monotone"
              dataKey="minutes"
              stroke={CHART_COLORS.tealDark}
              fill="url(#volumeGradient)"
              strokeWidth={2}
              name="Training Time (min)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

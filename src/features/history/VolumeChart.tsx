import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE } from '@/lib/chartTheme'

interface VolumePoint {
  date: string
  totalSets: number
  totalVolume: number
  sessionCount: number
}

interface VolumeChartProps {
  data: VolumePoint[]
}

export function VolumeChart({ data }: VolumeChartProps) {
  if (data.length === 0) return null

  const chartData = data.map(d => ({
    date: d.date.slice(5),
    volume: Math.round(d.totalVolume * 2.20462), // kg→lb
  }))

  return (
    <div>
      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.gold} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLORS.gold} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} unit=" lb" />
            <Tooltip {...TOOLTIP_STYLE} />
            <Area
              type="monotone"
              dataKey="volume"
              stroke={CHART_COLORS.gold}
              fill="url(#volumeGradient)"
              strokeWidth={2}
              name="Total Volume (lb)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

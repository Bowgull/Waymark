import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE } from '@/lib/chartTheme'

interface WeekData {
  weekStart: string
  sessionsPlanned: number
  sessionsCompleted: number
  totalMinutes: number
}

interface ConsistencyChartProps {
  weeks: WeekData[]
  currentStreak: number
  longestStreak: number
}

export function ConsistencyChart({ weeks, currentStreak, longestStreak }: ConsistencyChartProps) {
  const chartData = weeks.map(w => ({
    week: w.weekStart.slice(5),
    completed: w.sessionsCompleted,
    missed: Math.max(0, w.sessionsPlanned - w.sessionsCompleted),
  }))

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
        <span>Streak: <span className="text-foreground">{currentStreak}d</span></span>
        <span>Best: <span className="text-foreground">{longestStreak}d</span></span>
      </div>

      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData}>
            <XAxis dataKey="week" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} allowDecimals={false} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="completed" stackId="a" fill={CHART_COLORS.gold} name="Completed" />
            <Bar dataKey="missed" stackId="a" fill={CHART_COLORS.grid} name="Missed" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

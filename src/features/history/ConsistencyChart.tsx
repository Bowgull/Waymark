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
  period?: 7 | 30 | 90
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const MISSED_FILL = 'rgba(232, 200, 96, 0.18)'

export function ConsistencyChart({ weeks, currentStreak, longestStreak }: ConsistencyChartProps) {
  const chartData = weeks.map((w, i) => {
    const date = new Date(w.weekStart + 'T00:00:00')
    const month = date.getMonth()
    const prevMonth = i > 0 ? new Date(weeks[i - 1].weekStart + 'T00:00:00').getMonth() : -1
    const isFirstInMonth = month !== prevMonth

    return {
      key: w.weekStart,
      monthLabel: isFirstInMonth ? MONTH_NAMES[month].toUpperCase() : '',
      completed: w.sessionsCompleted,
      missed: Math.max(0, w.sessionsPlanned - w.sessionsCompleted),
    }
  })

  const renderMonthTick = (props: { x?: string | number; y?: string | number; index?: number }) => {
    const { x, y, index } = props
    if (index == null) return <g />
    const entry = chartData[index]
    if (!entry?.monthLabel) return <g />
    const yNum = typeof y === 'number' ? y : Number(y ?? 0)
    return (
      <text
        x={x}
        y={yNum + 14}
        textAnchor="middle"
        fill={CHART_COLORS.text}
        fontSize={10}
        fontFamily="'Cinzel Variable', serif"
        fontWeight={600}
        letterSpacing="0.08em"
      >
        {entry.monthLabel}
      </text>
    )
  }

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
        <span>Streak: <span className="text-foreground">{currentStreak}d</span></span>
        <span>Best: <span className="text-foreground">{longestStreak}d</span></span>
      </div>

      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData}>
            <XAxis
              dataKey="key"
              tick={renderMonthTick}
              tickLine={false}
              axisLine={false}
            />
            <YAxis {...AXIS_STYLE} allowDecimals={false} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="completed" stackId="a" fill={CHART_COLORS.gold} name="Completed" />
            <Bar dataKey="missed" stackId="a" fill={MISSED_FILL} name="Missed" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

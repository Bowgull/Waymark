import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

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
  period: 7 | 30 | 90
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const WEEK_COLORS = [
  CHART_COLORS.gold,     // Week 1
  CHART_COLORS.teal,     // Week 2
  CHART_COLORS.goldDark, // Week 3
  CHART_COLORS.muted,    // Week 4
]

const WEEK_LABELS = ['Week 1', 'Week 2', 'Week 3', 'Week 4']

const PERIOD_CONTEXT: Record<number, { label: string; description: string }> = {
  7: { label: 'Week', description: '4 weeks of sessions' },
  30: { label: 'Month', description: '8 weeks of sessions' },
  90: { label: 'Season', description: '12 weeks of sessions' },
}

export function ConsistencyChart({ weeks, currentStreak, longestStreak, period }: ConsistencyChartProps) {
  const [showLegend, setShowLegend] = useState(false)

  const chartData = weeks.map((w, i) => {
    const date = new Date(w.weekStart + 'T00:00:00')
    const month = date.getMonth()
    const weekOfMonth = Math.ceil(date.getDate() / 7)
    const prevMonth = i > 0 ? new Date(weeks[i - 1].weekStart + 'T00:00:00').getMonth() : -1
    const isFirstInMonth = month !== prevMonth

    return {
      key: w.weekStart,
      monthLabel: isFirstInMonth ? MONTH_NAMES[month].toUpperCase() : '',
      weekOfMonth,
      completed: w.sessionsCompleted,
      missed: Math.max(0, w.sessionsPlanned - w.sessionsCompleted),
    }
  })

  const ctx = PERIOD_CONTEXT[period]

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

      <div
        className="relative cursor-pointer rounded-md border border-border bg-deep-forest p-3"
        onClick={(e) => {
          e.stopPropagation()
          setShowLegend(prev => !prev)
        }}
      >
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
            <Bar dataKey="completed" stackId="a" name="Completed">
              {chartData.map((entry, index) => (
                <Cell key={index} fill={WEEK_COLORS[(entry.weekOfMonth - 1) % 4]} />
              ))}
            </Bar>
            <Bar dataKey="missed" stackId="a" fill={CHART_COLORS.grid} name="Missed" />
          </BarChart>
        </ResponsiveContainer>

        {/* Legend overlay */}
        {showLegend && (
          <div
            className="absolute inset-0 z-10 flex flex-col justify-center rounded-md px-5 py-4"
            style={{ backgroundColor: 'rgba(8, 26, 20, 0.92)' }}
            onClick={(e) => {
              e.stopPropagation()
              setShowLegend(false)
            }}
          >
            <p className="text-label text-gold mb-3">
              {ctx.label} view: {ctx.description}
            </p>

            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {WEEK_COLORS.map((color, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-muted-foreground">{WEEK_LABELS[i]}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: CHART_COLORS.grid }}
              />
              <span className="text-xs text-muted-foreground">Missed sessions</span>
            </div>

            <p className="mt-3 text-xs text-muted-foreground opacity-60">
              Tap to dismiss
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

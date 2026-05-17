import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AXIS_STYLE, TOOLTIP_STYLE } from '@/lib/chartTheme'

interface WeeklyZonePoint {
  weekStart: string
  z1: number
  z2: number
  z3: number
  z4: number
  z5: number
  totalSec: number
}

interface WeeklyZonesChartProps {
  weeks: WeeklyZonePoint[]
}

const ZONE_COLORS = {
  z1: '#4A7A6A',
  z2: '#4ACAAA',
  z3: '#E8C860',
  z4: '#C45A3C',
  z5: '#8A3A2E',
}

function minutes(seconds: number): number {
  return Math.round(seconds / 60)
}

export function WeeklyZonesChart({ weeks }: WeeklyZonesChartProps) {
  const chartData = weeks.map(week => ({
    week: week.weekStart.slice(5),
    z1: minutes(week.z1),
    z2: minutes(week.z2),
    z3: minutes(week.z3),
    z4: minutes(week.z4),
    z5: minutes(week.z5),
    total: minutes(week.totalSec),
  }))

  if (chartData.length === 0) {
    return (
      <div className="rounded-md border border-border bg-deep-forest p-3 flex items-center justify-center h-[136px]">
        <p className="text-xs text-muted-foreground">No heart-rate zones recorded.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {(['z1', 'z2', 'z3', 'z4', 'z5'] as const).map(zone => (
          <span key={zone} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: ZONE_COLORS[zone] }} />
            {zone.toUpperCase()}
          </span>
        ))}
      </div>

      <div className="rounded-md border border-border bg-deep-forest p-3">
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chartData}>
            <XAxis dataKey="week" {...AXIS_STYLE} minTickGap={18} interval="preserveStartEnd" />
            <YAxis {...AXIS_STYLE} width={30} tickFormatter={(v: number) => `${v}m`} />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value, name) => [`${Number(value)} min`, String(name).toUpperCase()]}
              labelFormatter={(label) => `Week ${label}`}
            />
            <Bar dataKey="z1" stackId="zones" fill={ZONE_COLORS.z1} radius={[0, 0, 2, 2]} />
            <Bar dataKey="z2" stackId="zones" fill={ZONE_COLORS.z2} />
            <Bar dataKey="z3" stackId="zones" fill={ZONE_COLORS.z3} />
            <Bar dataKey="z4" stackId="zones" fill={ZONE_COLORS.z4} />
            <Bar dataKey="z5" stackId="zones" fill={ZONE_COLORS.z5} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

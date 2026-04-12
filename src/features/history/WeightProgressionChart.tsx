import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

import { apiFetch } from '@/lib/api'
import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE, kgToLbsDisplay } from '@/lib/chartTheme'

interface DataPoint {
  date: string
  maxWeightKg: number
  totalVolume: number
  sets: number
}

interface Exercise {
  id: string
  name: string
}

interface WeightProgressionChartProps {
  exercises: Exercise[]
  days: number
}

export function WeightProgressionChart({ exercises, days }: WeightProgressionChartProps) {
  const [selectedExercise, setSelectedExercise] = useState(exercises[0]?.id ?? '')
  const [data, setData] = useState<DataPoint[]>([])
  const [exerciseName, setExerciseName] = useState('')

  useEffect(() => {
    if (!selectedExercise) return
    apiFetch<{ exerciseName: string; dataPoints: DataPoint[] }>(
      `/api/history/weight-progression?exerciseId=${selectedExercise}&days=${days}`
    ).then((res) => {
      setData(res.dataPoints)
      setExerciseName(res.exerciseName)
    }).catch(console.error)
  }, [selectedExercise, days])

  const chartData = data.map(d => ({
    date: d.date.slice(5), // MM-DD
    weight: kgToLbsDisplay(d.maxWeightKg),
    volume: Math.round(d.totalVolume * 2.20462),
  }))

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-display-sm text-gold">Weight Progression</p>
        <select
          value={selectedExercise}
          onChange={(e) => setSelectedExercise(e.target.value)}
          className="border border-border bg-surface px-2 py-1 text-xs text-foreground focus:outline-none"
        >
          {exercises.map(ex => (
            <option key={ex.id} value={ex.id}>{ex.name}</option>
          ))}
        </select>
      </div>

      {chartData.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No data for {exerciseName}</p>
      ) : (
        <div className="border border-border bg-deep-forest p-3">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} unit=" lb" />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="weight"
                stroke={CHART_COLORS.gold}
                strokeWidth={2}
                dot={{ fill: CHART_COLORS.gold, r: 3 }}
                name="Max Weight (lb)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

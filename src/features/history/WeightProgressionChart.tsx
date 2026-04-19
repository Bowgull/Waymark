import { useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

import { apiFetch } from '@/lib/api'
import { CHART_COLORS, AXIS_STYLE, TOOLTIP_STYLE, kgToLbsDisplay } from '@/lib/chartTheme'
import { logger } from '@/lib/logger'

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

function ExercisePicker({
  exercises,
  selected,
  onSelect,
}: {
  exercises: Exercise[]
  selected: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = exercises.find(e => e.id === selected)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-sm font-display tracking-wide text-foreground active:bg-surface-light/40 transition-all ${
          open ? 'border-gold/30 shadow-[0_0_8px_rgba(232,200,96,0.08)]' : 'border-border'
        }`}
      >
        <span>{current?.name ?? 'Select'}</span>
        <svg className={`h-3 w-3 text-gold/50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2}>
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-56 w-52 overflow-y-auto scrollbar-none rounded-md border border-gold/15 border-t-2 border-t-gold/20 bg-deep-forest shadow-[0_4px_20px_rgba(0,0,0,0.5)] animate-fade-in" style={{ scrollbarWidth: 'none' }}>
          {exercises.map(ex => (
            <button
              key={ex.id}
              onClick={() => { onSelect(ex.id); setOpen(false) }}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 font-display text-sm tracking-wide transition-colors border-b border-border/20 last:border-b-0 ${
                ex.id === selected
                  ? 'text-gold bg-surface-light/30'
                  : 'text-foreground/70 hover:bg-surface-light/20 active:bg-surface-light/30'
              }`}
            >
              {ex.id === selected && <span className="h-1.5 w-1.5 rounded-full bg-gold shrink-0" />}
              {ex.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
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
    }).catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      logger.warn('system', 'weight-progression load failed', { exerciseId: selectedExercise, days, message })
    })
  }, [selectedExercise, days])

  const chartData = data.map(d => ({
    date: d.date.slice(5),
    weight: kgToLbsDisplay(d.maxWeightKg),
    volume: Math.round(d.totalVolume * 2.20462),
  }))

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <ExercisePicker
          exercises={exercises}
          selected={selectedExercise}
          onSelect={setSelectedExercise}
        />
      </div>

      {chartData.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No data for {exerciseName}</p>
      ) : (
        <div className="rounded-md border border-border bg-deep-forest p-3">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" {...AXIS_STYLE} minTickGap={32} interval="preserveStartEnd" />
              <YAxis {...AXIS_STYLE} unit=" lb" />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="weight"
                stroke={CHART_COLORS.goldDark}
                strokeWidth={2}
                dot={{ fill: CHART_COLORS.goldDark, r: 3 }}
                name="Max Weight (lb)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

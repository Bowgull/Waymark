import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { getMarkAsset, logoPng } from '@/lib/markAssets'
import { WEEKLY_TEMPLATE } from '@/lib/weeklyTemplate'
import { getStrengthTemplate } from '@/lib/strengthTemplates'

interface Session {
  id: string
  type: string
  timeSlot: string | null
  status: string
  startedAt: number | null
  completedAt: number | null
  durationSec: number | null
  rpe: number | null
}

interface DaySummaryProps {
  sessions: Session[]
  todayDate: Date
}

interface WellnessData {
  entries: number
  avgSleep: number | null
  avgSoreness: number | null
  avgWeed: number | null
  avgAlcohol: number | null
}

interface PR {
  exerciseId: string
  exerciseName: string
  maxWeightKg: number
  date: string
  previousMaxKg: number | null
}

function formatMinutes(totalSec: number): string {
  const min = Math.round(totalSec / 60)
  if (min >= 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  return `${min}m`
}

function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462)
}

/** Get exercise names for a strength session based on the day of week */
function getStrengthExercises(dow: number): string[] {
  const template = getStrengthTemplate(dow)
  return template.exercises
    .filter(e => !e.sets.every(s => s.isWarmup)) // skip warmup-only exercises
    .map(e => e.label)
}

export function DaySummary({ sessions, todayDate }: DaySummaryProps) {
  const [wellness, setWellness] = useState<WellnessData | null>(null)
  const [prs, setPrs] = useState<PR[]>([])
  const [expandedTomorrow, setExpandedTomorrow] = useState<string | null>(null)

  const completed = sessions.filter(s => s.status === 'completed')
  const totalSec = completed.reduce((acc, s) => acc + (s.durationSec ?? 0), 0)
  const rpeSessions = completed.filter(s => s.rpe != null)
  const avgRpe = rpeSessions.length > 0
    ? (rpeSessions.reduce((acc, s) => acc + (s.rpe ?? 0), 0) / rpeSessions.length).toFixed(1)
    : null

  // Tomorrow data
  const tomorrowDow = (todayDate.getDay() + 1) % 7
  const tomorrowSessions = WEEKLY_TEMPLATE[tomorrowDow] ?? []

  // Fetch wellness trends and recent PRs
  useEffect(() => {
    async function load() {
      try {
        const [w, prData] = await Promise.all([
          apiFetch<WellnessData>('/api/history/wellness?days=7'),
          apiFetch<{ prs: PR[] }>('/api/history/prs'),
        ])
        setWellness(w)
        // Only show PRs from last 14 days
        const p = prData.prs ?? []
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 14)
        const cutoffStr = cutoff.toISOString().slice(0, 10)
        setPrs(p.filter(pr => pr.date >= cutoffStr && pr.previousMaxKg != null))
      } catch (e) {
        console.error('Failed to load debrief data:', e)
      }
    }
    load()
  }, [])

  return (
    <div className="relative animate-fade-in-up overflow-hidden">
      {/* Watermark */}
      <img
        src={logoPng}
        alt=""
        className="pointer-events-none absolute left-1/2 top-1/3 h-40 w-40 -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.03]"
      />

      {/* ─── Day Closed + Stats ─── */}
      <div className="rounded-md border border-border bg-surface/30 p-5">
        <h3 className="text-display-sm text-gold mb-4">Day Closed</h3>

        <div className="relative flex gap-6 text-center">
          <div>
            <p className="text-stat text-foreground">{completed.length}</p>
            <p className="text-label text-muted-foreground mt-1">Sessions</p>
          </div>
          <div>
            <p className="text-stat text-foreground">{formatMinutes(totalSec)}</p>
            <p className="text-label text-muted-foreground mt-1">Total</p>
          </div>
          {avgRpe && (
            <div>
              <p className="text-stat text-foreground">{avgRpe}</p>
              <p className="text-label text-muted-foreground mt-1">Avg RPE</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Tomorrow ─── */}
      {tomorrowSessions.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface/20 p-4">
          <p className="text-label text-muted-foreground mb-3">Tomorrow</p>
          <div className="flex flex-col gap-2">
            {tomorrowSessions.map((s, i) => {
              const mark = getMarkAsset(s.type)
              const isStrength = s.type === 'strength'
              const isExpanded = expandedTomorrow === `${i}`
              const exercises = isStrength ? getStrengthExercises(tomorrowDow) : null

              return (
                <div key={i}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 text-left active:opacity-70"
                    onClick={() => {
                      if (exercises) setExpandedTomorrow(isExpanded ? null : `${i}`)
                    }}
                  >
                    <img src={mark.png} alt="" className="h-4 w-4 object-contain opacity-50" />
                    <span className="text-label text-gold/60 w-5">{s.timeSlot.toUpperCase()}</span>
                    <span className="flex-1 text-sm text-foreground/80">
                      {isStrength
                        ? exercises!.slice(0, 3).join(' / ') + (exercises!.length > 3 ? ` +${exercises!.length - 3}` : '')
                        : s.label
                      }
                    </span>
                    <span className="text-xs text-muted-foreground">~{s.estimatedMin}m</span>
                    {exercises && (
                      <svg
                        className={`h-3 w-3 text-muted-foreground/40 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    )}
                  </button>
                  {isExpanded && exercises && (
                    <div className="animate-fade-in ml-[3.25rem] mt-1 flex flex-col gap-0.5">
                      {exercises.map((ex, j) => (
                        <span key={j} className="text-xs text-muted-foreground">{ex}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Body This Week ─── */}
      {wellness && wellness.entries > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface/20 p-4">
          <p className="text-label text-muted-foreground mb-3">Body This Week</p>
          <div className="flex gap-6">
            {wellness.avgSleep != null && (
              <div>
                <p className="text-sm font-semibold text-foreground">{wellness.avgSleep.toFixed(1)}h</p>
                <p className="text-label text-muted-foreground mt-0.5">Sleep</p>
              </div>
            )}
            {wellness.avgSoreness != null && (
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {wellness.avgSoreness <= 2 ? 'Low' : wellness.avgSoreness <= 3 ? 'Moderate' : 'High'}
                </p>
                <p className="text-label text-muted-foreground mt-0.5">Soreness</p>
              </div>
            )}
            {wellness.avgWeed != null && (
              <div>
                <p className="text-sm font-semibold text-foreground">{wellness.avgWeed.toFixed(1)}g</p>
                <p className="text-label text-muted-foreground mt-0.5">Weed</p>
              </div>
            )}
            {wellness.avgAlcohol != null && (
              <div>
                <p className="text-sm font-semibold text-foreground">{wellness.avgAlcohol.toFixed(1)}</p>
                <p className="text-label text-muted-foreground mt-0.5">Alcohol</p>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground/60">{wellness.entries} {wellness.entries === 1 ? 'log' : 'logs'} this week</p>
        </div>
      )}

      {/* ─── Recent Progress ─── */}
      {prs.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface/20 p-4">
          <p className="text-label text-muted-foreground mb-3">Recent Progress</p>
          <div className="flex flex-col gap-2">
            {prs.slice(0, 5).map((pr, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-foreground/80">{pr.exerciseName}</span>
                <span className="text-sm font-semibold text-gold">
                  {kgToLbs(pr.maxWeightKg)}lb
                  {pr.previousMaxKg != null && (
                    <span className="ml-1.5 text-xs text-teal">
                      ↑{kgToLbs(pr.maxWeightKg) - kgToLbs(pr.previousMaxKg)}lb
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

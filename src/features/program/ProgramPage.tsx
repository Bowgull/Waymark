import { useEffect, useState } from 'react'

import { Link } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { GoldDivider } from '@/components/ui/GoldDivider'
import { PageBackground } from '@/components/backgrounds/PageBackground'
import { getWeekLabel } from '@/lib/strengthTemplates'
import logoPng from '@/assets/brand/Logo.png'

import { WeekView } from './WeekView'

interface Block {
  id: string
  name: string
  totalWeeks: number
  startedAt: number | null
  status: string
}

interface Session {
  id: string
  type: string
  timeSlot: string | null
  status: string
  scheduledDate: number | null
  blockWeek?: number | null
}

interface WeekPlan {
  id: string
  blockId: string
  weekNumber: number
  status: string
  analysisJson?: string | null
}

interface WeekData {
  week: WeekPlan
  sessions: Session[]
}

function getMonday(weekOffset = 0): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff + weekOffset * 7)
  return monday.toLocaleDateString('en-CA')
}

export function ProgramPage() {
  const [block, setBlock] = useState<Block | null | undefined>(undefined)
  const [weekData, setWeekData] = useState<WeekData | null>(null)
  const [weekNumber, setWeekNumber] = useState(1)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  function getCurrentWeekNumber(b: Block): number {
    if (!b.startedAt) return 1
    const weeksSinceStart = Math.floor((Date.now() / 1000 - b.startedAt) / (7 * 86400))
    return Math.min(Math.max(weeksSinceStart + 1, 1), b.totalWeeks)
  }

  function getBlockWeek(wn: number): number {
    return ((wn - 1) % 6) + 1
  }

  async function loadWeek(b: Block, wn: number) {
    let wd = await apiFetch<WeekData | null>(`/api/weeks/current?blockId=${b.id}&weekNumber=${wn}`)

    // Auto-generate current/next week if no plan exists
    const currentWn = getCurrentWeekNumber(b)
    if (!wd && (wn === currentWn || wn === currentWn + 1)) {
      const weekOffset = wn - currentWn
      const monday = getMonday(weekOffset)
      wd = await apiFetch<WeekData>('/api/weeks/generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: b.id, weekNumber: wn, startDate: monday }),
      })
    }

    setWeekData(wd)
    setWeekNumber(wn)
  }

  useEffect(() => {
    async function load() {
      try {
        let b = await apiFetch<Block | null>('/api/blocks/current')

        // Auto-create block if none exists
        if (!b) {
          b = await apiFetch<Block>('/api/blocks', {
            method: 'POST',
            body: JSON.stringify({ name: '6-Week Fighter Block', totalWeeks: 12 }),
          })
        }

        setBlock(b)
        const wn = getCurrentWeekNumber(b)
        setWeekNumber(wn)
        await loadWeek(b, wn)
      } catch (e) {
        console.error('Failed to load program:', e)
        setBlock(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleGenerateWeek() {
    if (!block) return
    setGenerating(true)
    try {
      const weekOffset = weekNumber - getCurrentWeekNumber(block)
      const monday = getMonday(weekOffset)
      const wd = await apiFetch<WeekData>('/api/weeks/generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: block.id, weekNumber, startDate: monday }),
      })
      setWeekData(wd)
    } catch (e) {
      console.error('Failed to generate week:', e)
    } finally {
      setGenerating(false)
    }
  }

  async function handleApprove() {
    if (!weekData) return
    try {
      await apiFetch(`/api/weeks/${weekData.week.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved' }),
      })
      setWeekData({
        ...weekData,
        week: { ...weekData.week, status: 'approved' },
      })
    } catch (e) {
      console.error('Failed to approve week:', e)
    }
  }

  function handlePrevWeek() {
    if (!block || weekNumber <= 1) return
    loadWeek(block, weekNumber - 1)
  }

  function handleNextWeek() {
    if (!block || weekNumber >= block.totalWeeks) return
    loadWeek(block, weekNumber + 1)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!block) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Failed to load program.</p>
      </div>
    )
  }

  const currentWeek = getCurrentWeekNumber(block)
  const blockWeek = getBlockWeek(weekNumber)
  const weekInfo = getWeekLabel(blockWeek)
  const isCurrentWeek = weekNumber === currentWeek

  return (
    <div className="space-y-4">
      <PageBackground />

      {/* Logo mark */}
      <Link to="/today" className="inline-block mb-1">
        <img src={logoPng} alt="Waymark" className="h-8 w-8 object-contain opacity-60 active:opacity-80" style={{ mixBlendMode: 'screen' }} />
      </Link>

      {/* Week Navigator */}
      <div className="mb-2">
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrevWeek}
            disabled={weekNumber <= 1}
            className="px-3 py-2 text-sm font-medium text-muted-foreground disabled:opacity-30 active:text-foreground"
          >
            Prev
          </button>
          <div className="text-center">
            <h2 className="font-cinzel text-lg font-semibold text-foreground">
              Week {weekNumber}
              {isCurrentWeek && <span className="ml-2 text-xs text-teal">(current)</span>}
            </h2>
            <p className="mt-0.5 text-sm text-gold">{weekInfo}</p>
            <p className="text-xs text-muted-foreground">
              Block week {blockWeek} of 6
            </p>
          </div>
          <button
            onClick={handleNextWeek}
            disabled={weekNumber >= block.totalWeeks}
            className="px-3 py-2 text-sm font-medium text-muted-foreground disabled:opacity-30 active:text-foreground"
          >
            Next
          </button>
        </div>

        {/* Block progress bar */}
        <div className="mt-3 h-1.5 rounded-full bg-border">
          <div
            className="h-full rounded-full bg-gold transition-all"
            style={{ width: `${(weekNumber / block.totalWeeks) * 100}%` }}
          />
        </div>
        <GoldDivider className="mt-3" />
      </div>

      {/* Week Content */}
      {!weekData ? (
        <div className="flex flex-col items-center py-12">
          <p className="mb-4 text-sm text-muted-foreground">No plan for week {weekNumber} yet.</p>
          <Button onClick={handleGenerateWeek} disabled={generating}>
            {generating ? 'Generating...' : `Prepare Week ${weekNumber}`}
          </Button>
        </div>
      ) : (
        <WeekView
          sessions={weekData.sessions}
          weekStatus={weekData.week.status}
          weekPlanId={weekData.week.id}
          analysisJson={weekData.week.analysisJson}
          weekNumber={weekNumber}
          onApprove={handleApprove}
          onSessionUpdate={(id, status) => {
            setWeekData(prev => prev ? {
              ...prev,
              sessions: prev.sessions.map(s => s.id === id ? { ...s, status } : s),
            } : null)
          }}
          onSessionAdded={(session) => {
            setWeekData(prev => prev ? {
              ...prev,
              sessions: [...prev.sessions, session],
            } : null)
          }}
        />
      )}
    </div>
  )
}

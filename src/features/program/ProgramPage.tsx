import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

import { BlockHeader } from './BlockHeader'
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
}

interface WeekPlan {
  id: string
  blockId: string
  weekNumber: number
  status: string
}

interface WeekData {
  week: WeekPlan
  sessions: Session[]
}

function getMonday(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return monday.toLocaleDateString('en-CA')
}

export function ProgramPage() {
  const [block, setBlock] = useState<Block | null | undefined>(undefined)
  const [weekData, setWeekData] = useState<WeekData | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [generating, setGenerating] = useState(false)

  // Determine current week number (weeks since block started)
  function getCurrentWeekNumber(b: Block): number {
    if (!b.startedAt) return 1
    const weeksSinceStart = Math.floor((Date.now() / 1000 - b.startedAt) / (7 * 86400))
    return Math.min(Math.max(weeksSinceStart + 1, 1), b.totalWeeks)
  }

  useEffect(() => {
    async function load() {
      try {
        const b = await apiFetch<Block | null>('/api/blocks/current')
        setBlock(b)

        if (b) {
          const weekNum = getCurrentWeekNumber(b)
          const wd = await apiFetch<WeekData | null>(`/api/weeks/current?blockId=${b.id}&weekNumber=${weekNum}`)
          setWeekData(wd)
        }
      } catch (e) {
        console.error('Failed to load program:', e)
        setBlock(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleCreateBlock() {
    setCreating(true)
    try {
      const b = await apiFetch<Block>('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ name: '12-Week Base Build', totalWeeks: 12 }),
      })
      setBlock(b)

      // Auto-generate week 1
      const monday = getMonday()
      const wd = await apiFetch<WeekData>('/api/weeks/generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: b.id, weekNumber: 1, startDate: monday }),
      })
      setWeekData(wd)
    } catch (e) {
      console.error('Failed to create block:', e)
    } finally {
      setCreating(false)
    }
  }

  async function handleGenerateWeek() {
    if (!block) return
    setGenerating(true)
    try {
      const weekNum = getCurrentWeekNumber(block)
      const monday = getMonday()
      const wd = await apiFetch<WeekData>('/api/weeks/generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: block.id, weekNumber: weekNum, startDate: monday }),
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  // No block yet — first time
  if (!block) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="mb-2 text-display-lg text-foreground">Start Your Program</p>
        <p className="mb-6 text-sm text-muted-foreground">Begin a 12-week training block.</p>
        <Button
          onClick={handleCreateBlock}
          disabled={creating}
        >
          {creating ? 'Creating...' : 'Start 12-Week Base Build'}
        </Button>
      </div>
    )
  }

  const currentWeek = getCurrentWeekNumber(block)

  return (
    <div className="space-y-4">
      <BlockHeader block={block} currentWeek={currentWeek} />

      {!weekData ? (
        <div className="flex flex-col items-center py-12">
          <p className="mb-4 text-sm text-muted-foreground">No plan for week {currentWeek} yet.</p>
          <Button onClick={handleGenerateWeek} disabled={generating}>
            {generating ? 'Generating...' : `Generate Week ${currentWeek}`}
          </Button>
        </div>
      ) : (
        <WeekView
          sessions={weekData.sessions}
          weekStatus={weekData.week.status}
          onApprove={handleApprove}
        />
      )}
    </div>
  )
}

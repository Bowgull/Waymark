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
  blockType: string
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
  completedAt?: number | null
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

type BlockZeroPrompt = 'first_launch' | 'return_from_break' | null

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
  const [blockZeroPrompt, setBlockZeroPrompt] = useState<BlockZeroPrompt>(null)
  const [startingBlockZero, setStartingBlockZero] = useState(false)

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
        const existingBlock = await apiFetch<Block | null>('/api/blocks/current')

        if (!existingBlock) {
          // First launch — no block has ever been created. Recommend Block Zero.
          setBlockZeroPrompt('first_launch')
          setBlock(null)
          setLoading(false)
          return
        }

        // Check for return-from-break: last completed session > 10 days ago
        const lastSession = await apiFetch<Session | null>('/api/sessions/last-completed')
        if (lastSession?.completedAt) {
          const daysSince = (Date.now() / 1000 - lastSession.completedAt) / 86400
          if (daysSince >= 10 && existingBlock.blockType !== 'block_zero') {
            setBlockZeroPrompt('return_from_break')
          }
        }

        setBlock(existingBlock)
        const wn = getCurrentWeekNumber(existingBlock)
        setWeekNumber(wn)
        await loadWeek(existingBlock, wn)
      } catch (e) {
        console.error('Failed to load program:', e)
        setBlock(null)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleStartBlockZero() {
    setStartingBlockZero(true)
    try {
      const newBlock = await apiFetch<Block>('/api/blocks/block-zero', { method: 'POST' })
      setBlock(newBlock)
      setBlockZeroPrompt(null)
      setWeekNumber(1)
      const monday = getMonday(0)
      const wd = await apiFetch<WeekData>('/api/weeks/generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: newBlock.id, weekNumber: 1, startDate: monday }),
      })
      setWeekData(wd)
    } catch (e) {
      console.error('Failed to start Block Zero:', e)
    } finally {
      setStartingBlockZero(false)
    }
  }

  async function handleContinueExisting() {
    setBlockZeroPrompt(null)
    // If no block yet (first launch and dismissed), create a Fighter block
    if (!block) {
      const newBlock = await apiFetch<Block>('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Fighter Block', totalWeeks: 12 }),
      })
      setBlock(newBlock)
      const wn = getCurrentWeekNumber(newBlock)
      setWeekNumber(wn)
      await loadWeek(newBlock, wn)
    }
  }

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

  // ─── Block Zero Prompt ────────────────────────────────────────

  if (blockZeroPrompt) {
    const isFirstLaunch = blockZeroPrompt === 'first_launch'
    return (
      <div className="space-y-4">
        <PageBackground />
        <Link to="/today" className="inline-block mb-1">
          <img src={logoPng} alt="Waymark" className="h-8 w-8 object-contain opacity-60 active:opacity-80" style={{ mixBlendMode: 'screen' }} />
        </Link>
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <p className="text-label text-gold mb-1">
              {isFirstLaunch ? 'BEFORE YOU BEGIN' : 'WELCOME BACK'}
            </p>
            <h2 className="text-display-sm text-foreground">
              {isFirstLaunch ? 'Start with Block Zero' : 'Time for a Reset'}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {isFirstLaunch
              ? 'After time away from training, jumping straight into heavy weights risks tendon injury — muscle memory returns faster than connective tissue adapts. Block Zero is a 6-week ramp-up that gets your body ready to train hard without breaking down.'
              : "It's been a while since your last session. Tendons and ligaments detrain faster than muscle. Block Zero resets your starting weights and volume so you can build back up safely."}
          </p>
          <ul className="space-y-1.5">
            {[
              'Weeks 1–2: Foundation + light strength (40% weights). No MT class.',
              'Weeks 3–4: MT class returns. Weights climb to 50–55%.',
              'Weeks 5–6: Full schedule. Ready for Block 1.',
            ].map(item => (
              <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                <span className="text-teal mt-0.5">→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-2 pt-1">
            <Button
              className="w-full"
              onClick={handleStartBlockZero}
              disabled={startingBlockZero}
            >
              {startingBlockZero ? 'Setting up...' : 'Start Block Zero'}
            </Button>
            <button
              onClick={handleContinueExisting}
              className="w-full py-2 text-sm text-muted-foreground active:text-foreground"
            >
              {isFirstLaunch ? 'Skip — go straight to Fighter block' : 'Continue current block'}
            </button>
          </div>
        </div>
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
  const blockType = block.blockType === 'block_zero' ? 'block_zero' : 'fighter'
  const weekInfo = getWeekLabel(blockWeek, blockType)
  const isCurrentWeek = weekNumber === currentWeek
  const isBlockZero = block.blockType === 'block_zero'

  return (
    <div className="space-y-4">
      <PageBackground />

      {/* Logo mark */}
      <Link to="/today" className="inline-block mb-1">
        <img src={logoPng} alt="Waymark" className="h-8 w-8 object-contain opacity-60 active:opacity-80" style={{ mixBlendMode: 'screen' }} />
      </Link>

      {/* Block Zero badge */}
      {isBlockZero && (
        <div className="rounded-lg border border-teal/30 bg-teal/5 px-3 py-2">
          <p className="text-label text-teal">BLOCK ZERO — RETURN TO TRAINING</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Building your foundation. Weights are intentionally light.</p>
        </div>
      )}

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
              {isBlockZero ? `Block Zero week ${blockWeek} of 6` : `Block week ${blockWeek} of 6`}
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
            className={`h-full rounded-full transition-all ${isBlockZero ? 'bg-teal' : 'bg-gold'}`}
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

      {/* Manual Block Zero reset — always available */}
      {!isBlockZero && (
        <div className="pt-2 pb-4">
          <button
            onClick={() => setBlockZeroPrompt('return_from_break')}
            className="w-full py-2 text-xs text-muted-foreground/60 active:text-muted-foreground"
          >
            Reset with Block Zero
          </button>
        </div>
      )}
    </div>
  )
}

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

interface BlockZeroWeekTheme {
  weekNumber: number
  focus: string
}

interface BlockZeroCalibrationStart {
  exerciseName: string
  startingWeightKg: number
  rationale: string
}

interface BlockZeroAssessmentOutput {
  narrative: string
  weekThemes: BlockZeroWeekTheme[]
  calibrationStarts: BlockZeroCalibrationStart[]
  mtCapPerWeek: number
  coachNote?: string
}

interface TransitionResult {
  decision: 'proceed' | 'hold' | 'adjust'
  rationale: string
  nextBlockNotes?: string
}

function getBlockZeroNarrative(blockWeek: number): string {
  if (blockWeek <= 2) {
    return 'Foundation. Corrective work, light loading, habit building. Skip this stretch and the next one breaks you.'
  }
  if (blockWeek <= 4) {
    return 'MT returns. Weights climb past 50%. Tendons catch up to muscle.'
  }
  return 'Full schedule live. Six weeks of runway ends with the body ready for real load.'
}

function getFighterBlockNarrative(blockWeek: number): string {
  if (blockWeek <= 2) {
    return 'Fighter block opens. Strength base first. Volume is honest, not heroic.'
  }
  if (blockWeek <= 4) {
    return 'Middle weeks. Loads sit at working weight. This is where the body adapts or quits.'
  }
  return 'Closing weeks. Peak intensity. Next block expects more.'
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
  const [blockZeroPrompt, setBlockZeroPrompt] = useState<BlockZeroPrompt>(null)
  const [startingBlockZero, setStartingBlockZero] = useState(false)
  const [assessment, setAssessment] = useState<BlockZeroAssessmentOutput | null>(null)
  const [assessmentLoading, setAssessmentLoading] = useState(false)
  const [transitionResult, setTransitionResult] = useState<TransitionResult | null>(null)
  const [checkingTransition, setCheckingTransition] = useState(false)

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

        // Resume-after-crash: block_zero exists but week 1 was never generated.
        // Show the stored assessment if available so the user can click Begin.
        if (existingBlock.blockType === 'block_zero') {
          const week1 = await apiFetch<WeekData | null>(
            `/api/weeks/current?blockId=${existingBlock.id}&weekNumber=1`,
          )
          if (!week1) {
            setBlock(existingBlock)
            const stored = await apiFetch<BlockZeroAssessmentOutput | null>(
              '/api/ai/block-zero-assessment',
            )
            if (stored) {
              setAssessment(stored)
            } else {
              // Assessment missing, re-run it.
              setAssessmentLoading(true)
              setLoading(false)
              const result = await apiFetch<BlockZeroAssessmentOutput | null>(
                '/api/ai/block-zero-assessment',
                { method: 'POST' },
              ).catch(() => null)
              setAssessmentLoading(false)
              if (result) setAssessment(result)
              return
            }
            setLoading(false)
            return
          }
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

        if (existingBlock.blockType === 'block_zero') {
          const stored = await apiFetch<TransitionResult | null>('/api/ai/block-zero-transition')
          if (stored) setTransitionResult(stored)
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

  async function handleStartBlockZero() {
    setStartingBlockZero(true)
    try {
      const newBlock = await apiFetch<Block>('/api/blocks/block-zero', { method: 'POST' })
      setBlock(newBlock)
      setBlockZeroPrompt(null)
      setStartingBlockZero(false)
      setAssessmentLoading(true)
      const result = await apiFetch<BlockZeroAssessmentOutput | null>(
        '/api/ai/block-zero-assessment',
        { method: 'POST' },
      ).catch(() => null)
      setAssessmentLoading(false)
      setAssessment(result)
    } catch (e) {
      console.error('Failed to start Block Zero:', e)
      setStartingBlockZero(false)
      setAssessmentLoading(false)
    }
  }

  async function handleBeginBlockZero() {
    if (!block) return
    setGenerating(true)
    try {
      const monday = getMonday(0)
      const wd = await apiFetch<WeekData>('/api/weeks/generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: block.id, weekNumber: 1, startDate: monday }),
      })
      setAssessment(null)
      setWeekData(wd)
      setWeekNumber(1)
    } catch (e) {
      console.error('Failed to generate week 1:', e)
    } finally {
      setGenerating(false)
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

  async function handleCheckTransition() {
    setCheckingTransition(true)
    try {
      const result = await apiFetch<TransitionResult>('/api/ai/block-zero-transition', { method: 'POST' })
      setTransitionResult(result)
    } catch (e) {
      console.error('Transition check failed:', e)
    } finally {
      setCheckingTransition(false)
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

  // ─── Block Zero Assessment Loading ───────────────────────────

  if (assessmentLoading) {
    return (
      <div className="space-y-4">
        <PageBackground />
        <Link to="/today" className="inline-block mb-1">
          <img src={logoPng} alt="Waymark" className="h-8 w-8 object-contain opacity-60 active:opacity-80" style={{ mixBlendMode: 'screen' }} />
        </Link>
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-label text-teal">BLOCK ZERO</p>
          <p className="text-sm text-muted-foreground">Reading your profile.</p>
          <p className="text-xs text-muted-foreground/60">This takes about 20 seconds.</p>
        </div>
      </div>
    )
  }

  // ─── Block Zero Assessment Result ────────────────────────────

  if (assessment) {
    return (
      <div className="space-y-4">
        <PageBackground />
        <Link to="/today" className="inline-block mb-1">
          <img src={logoPng} alt="Waymark" className="h-8 w-8 object-contain opacity-60 active:opacity-80" style={{ mixBlendMode: 'screen' }} />
        </Link>
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-label text-teal">BLOCK ZERO</p>
          <p className="text-sm text-foreground leading-relaxed">{assessment.narrative}</p>

          {assessment.coachNote && (
            <p className="text-xs text-amber-400/80 border border-amber-400/20 rounded px-3 py-2 bg-amber-400/5">
              {assessment.coachNote}
            </p>
          )}

          <div className="space-y-1.5">
            {assessment.weekThemes.map(wt => (
              <div key={wt.weekNumber} className="flex gap-3 text-sm">
                <span className="text-muted-foreground/60 w-14 shrink-0 font-mono text-xs pt-0.5">
                  WK {wt.weekNumber}
                </span>
                <span className="text-muted-foreground">{wt.focus}</span>
              </div>
            ))}
          </div>

          {assessment.calibrationStarts.length > 0 && (
            <div className="pt-1 space-y-1.5">
              <p className="text-label text-muted-foreground/60">STARTING WEIGHTS</p>
              {assessment.calibrationStarts.map(cs => (
                <div key={cs.exerciseName} className="flex items-start justify-between gap-2 text-sm">
                  <span className="text-foreground">{cs.exerciseName}</span>
                  <span className="text-muted-foreground shrink-0">{cs.startingWeightKg}kg</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground/50 pt-0.5">
                Block Zero loads at 40-55% of these numbers.
              </p>
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleBeginBlockZero}
            disabled={generating}
          >
            {generating ? 'Setting up...' : 'Begin'}
          </Button>
        </div>
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
              ? 'After time away from training, jumping straight into heavy weights risks tendon injury. Muscle memory returns faster than connective tissue adapts. Block Zero is a 6-week ramp-up that gets your body ready to train hard without breaking down.'
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
              {isFirstLaunch ? 'Skip. Go straight to Fighter block' : 'Continue current block'}
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
    <div className="space-y-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <PageBackground />

      {/* Logo mark */}
      <Link to="/today" className="inline-block mb-1">
        <img src={logoPng} alt="Waymark" className="h-8 w-8 object-contain opacity-60 active:opacity-80" style={{ mixBlendMode: 'screen' }} />
      </Link>

      {/* Block narrative */}
      {isBlockZero ? (
        <div className="rounded-lg border border-teal/30 bg-teal/5 px-3 py-2.5 space-y-1">
          <p className="text-label text-teal">BLOCK ZERO</p>
          <p className="text-sm text-foreground leading-relaxed">
            {getBlockZeroNarrative(blockWeek)}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gold/20 bg-gold/5 px-3 py-2.5 space-y-1">
          <p className="text-label text-gold">FIGHTER BLOCK</p>
          <p className="text-sm text-foreground leading-relaxed">
            {getFighterBlockNarrative(blockWeek)}
          </p>
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

      {/* Block Zero transition readiness — available from week 4 onward */}
      {isBlockZero && weekNumber >= 4 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-label text-gold">TRANSITION CHECK</p>
            <p className="mt-0.5 text-sm text-foreground">
              {transitionResult ? 'Result from last check.' : 'Block Zero nearing completion. Check readiness to advance.'}
            </p>
          </div>

          {transitionResult ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded ${
                  transitionResult.decision === 'proceed'
                    ? 'bg-teal/15 text-teal'
                    : transitionResult.decision === 'hold'
                    ? 'bg-clay/15 text-clay'
                    : 'bg-gold/15 text-gold'
                }`}>
                  {transitionResult.decision}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{transitionResult.rationale}</p>
              {transitionResult.nextBlockNotes && (
                <p className="text-xs text-muted-foreground/70 leading-relaxed">{transitionResult.nextBlockNotes}</p>
              )}
              <button
                onClick={handleCheckTransition}
                disabled={checkingTransition}
                className="text-xs text-muted-foreground/60 active:text-muted-foreground pt-1"
              >
                {checkingTransition ? 'Checking...' : 'Re-check'}
              </button>
            </div>
          ) : (
            <Button
              onClick={handleCheckTransition}
              disabled={checkingTransition}
              className="w-full"
            >
              {checkingTransition ? 'Checking readiness...' : 'Check readiness'}
            </Button>
          )}
        </div>
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

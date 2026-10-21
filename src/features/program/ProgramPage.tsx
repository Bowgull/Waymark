import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Board, CloseWord, Crest, FlapButton, FlapLabel, SceneWindow, showPop } from '@/design'
import type { DayBoardSession } from '@/features/dayboard/rowState'
import { apiFetch } from '@/lib/api'
import { lbText } from '@/lib/units'
import { epochDayToISO, getTodayISO, isoToEpochDay, mondayOf } from '@/lib/dates'
import { getWeekLabel } from '@/lib/strengthTemplates'
import { strengthBlockWeek } from '@/lib/weeklyTemplate'
import { setWorldWeeks } from '@/world/worldStore'
import { isPendingStart, startDayOf } from '@/lib/coach/startDay'

import { BlockZeroExtras } from './BlockZeroExtras'
import { StartDayBoard, StartWaitBoard } from './StartDay'
import { moveStartDay, prepareStartWeek } from './startDayApi'
import { WeekView } from './WeekView'
import { programPath } from '@/lib/programWeeks'
import { cycleWeeks, readWeekAnalysis, weekDays, weekForDay, weekState, worldWeekPosts } from './weekModel'
import { WeekLog } from '@/features/coach/WeekLog'
import { weekChangesLine } from '@/features/coach/changeView'
import { useWeekChanges } from '@/features/coach/useWeekChanges'
import { useBodyWatch } from '@/features/raven/bodyWatch'
import './program.css'
import '@/features/raven/raven.css'
import '@/features/dayboard/dayboard.css'
import '@/features/coach/coach.css'

// Program (page 33, approved): the road with the week wayposts is the world
// behind this page (top band left clear), then boards on glass: the week
// nav with six week flap tiles, the week line in plain words and one quiet
// "N changes ›" line that opens the week log (page 56), the seven-day strip
// with its runes and the open day board (WeekView). Weeks are prepared and
// simply shown: no draft, no approval step.

interface Block {
  id: string
  name: string
  blockType: string
  totalWeeks: number
  startedAt: number | null
  status: string
  /** Training week from the server, paused through gaps. */
  currentWeek?: number
  /** Today's training week: leadIn on a mid-week start's days before week 1. */
  trainingWeek?: { leadIn?: boolean }
  /** Return plan after a gap; offerBlockZero after 4+ weeks off in a Fighter block. */
  returnPlan?: { offerBlockZero: boolean; reason: string | null } | null
}

interface WeekPlan {
  id: string
  blockId: string
  weekNumber: number
  status: string
  analysisJson?: string | null
  whyLine?: string | null
}

interface WeekData {
  week: WeekPlan
  sessions: DayBoardSession[]
}

type BlockZeroPrompt = 'first_launch' | 'return_from_break' | 'restart' | null

interface BlockZeroAssessmentOutput {
  narrative: string
  weekThemes: Array<{ weekNumber: number; focus: string }>
  calibrationStarts: Array<{ exerciseName: string; startingWeightKg: number; rationale: string }>
  mtCapPerWeek: number
  coachNote?: string
}

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function getMonday(weekOffset = 0): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff + weekOffset * 7)
  return monday.toLocaleDateString('en-CA')
}

/**
 * A Block Zero started on any day but Monday leads in to week 1. The lead-in
 * and week 1 are both plan week 1 on the server; here the lead-in is week 0.
 */
const LEAD_IN_WEEK = 0

function hasLeadIn(b: Block): boolean {
  if (b.blockType !== 'block_zero' || !b.startedAt) return false
  const startDay = Math.floor(b.startedAt / 86400)
  return new Date(startDay * 86400000).getUTCDay() !== 1
}

/** Page 64: a Block Zero whose start day is still ahead (nothing planned yet): its start day, else null. */
function waitingStart(b: Block): number | null {
  if (b.blockType !== 'block_zero') return null
  const day = startDayOf(b.startedAt)
  return isPendingStart(day, isoToEpochDay(getTodayISO())) ? day : null
}

function firstWeekOf(b: Block): number {
  return hasLeadIn(b) ? LEAD_IN_WEEK : 1
}

function currentWeekOf(b: Block): number {
  if (b.trainingWeek?.leadIn) return LEAD_IN_WEEK
  // The server's training week pauses through gaps; the calendar is only a fallback.
  if (b.currentWeek != null) return b.currentWeek
  if (!b.startedAt) return 1
  const weeksSinceStart = Math.floor((Date.now() / 1000 - b.startedAt) / (7 * 86400))
  return Math.min(Math.max(weeksSinceStart + 1, 1), b.totalWeeks)
}

/** /api/program's answer: everything Program opens on, in one request. */
interface ProgramPayload {
  block: Block | null
  /** The week it opens on (today's training week; 0 = the lead-in). */
  weekNumber: number | null
  week: WeekData | null
  /** A Block Zero has its week 1 prepared. */
  week1: boolean
  /** Sessions done per past week of the road's window. */
  pastDone: Record<string, number>
}

/** The road's window, named by the block, the current week and the six weeks it shows. */
function pastKeyFor(b: Block, currentWeek: number, viewWeek: number): string {
  return `${b.id}:${currentWeek}:${cycleWeeks(Math.max(1, viewWeek), b.totalWeeks, b.blockType).join(',')}`
}

function parseDayParam(v: string | null): number | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? isoToEpochDay(v) : null
}

/** The header: the small crest (to Today), PROGRAM on a flap, today's date. */
function ProgramHeader() {
  const now = new Date()
  return (
    <header className="pg-head wm-scene-hd">
      <Link to="/today" className="pg-brand" aria-label="Today">
        <span className="pg-crest"><Crest width={52} /></span>
        <FlapLabel text="PROGRAM" size="sm" />
      </Link>
      <FlapLabel text={`${DAY3[now.getDay()]} ${now.getDate()} ${MON3[now.getMonth()]}`} size="xs" />
    </header>
  )
}

/**
 * The page frame: no background (the world and its road show through behind
 * the glass). Page 67 (Scroll reveals): the road in the top 46%, page 33's
 * road band, and the boards start under it and scroll up over it.
 */
function Frame({ children }: { children: ReactNode; road?: boolean }) {
  return (
    <div className="pg-root">
      <ProgramHeader />
      <SceneWindow />
      <div className="pg-body">{children}</div>
    </div>
  )
}

export function ProgramPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const dayParam = parseDayParam(searchParams.get('day'))
  const [block, setBlock] = useState<Block | null | undefined>(undefined)
  // The raven's plan (page 58): its line leads the weeks it covers.
  const bodyWatch = useBodyWatch()
  const [weekData, setWeekData] = useState<WeekData | null>(null)
  const [weekNumber, setWeekNumber] = useState(1)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [blockZeroPrompt, setBlockZeroPrompt] = useState<BlockZeroPrompt>(null)
  const [startingBlockZero, setStartingBlockZero] = useState(false)
  const [assessment, setAssessment] = useState<BlockZeroAssessmentOutput | null>(null)
  const [assessmentLoading, setAssessmentLoading] = useState(false)
  const [confirmFreshStart, setConfirmFreshStart] = useState(false)
  const [openDay, setOpenDay] = useState<number | null>(dayParam)
  const [pastDone, setPastDone] = useState<{ key: string; counts: Map<number, number> } | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [changesVersion, setChangesVersion] = useState(0)
  // Page 64: START WHEN? from the prompt (fresh: clears history), and CHANGE DAY while it waits.
  const [startPick, setStartPick] = useState<{ fresh: boolean } | null>(null)
  const [changeOpen, setChangeOpen] = useState(false)
  const [savingStart, setSavingStart] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const todayEpochDay = isoToEpochDay(getTodayISO())
  // The viewed week's changes and runes (page 56): its Monday from its sessions, else the calendar.
  const weekFirstDay = (weekData?.sessions ?? []).reduce<number | null>((m, s) => (s.scheduledDate != null && (m == null || s.scheduledDate < m) ? s.scheduledDate : m), null)
  const changesMonday = block && weekData ? (weekFirstDay != null ? mondayOf(weekFirstDay) : mondayOf(todayEpochDay) + (weekNumber - currentWeekOf(block)) * 7) : null
  const { week: changes, markSeen, undo, refresh: refreshChanges } = useWeekChanges(changesMonday, changesVersion)

  const loadWeek = useCallback(async (b: Block, wn: number, given?: WeekData | null) => {
    let wd = given !== undefined ? given : await apiFetch<WeekData | null>(wn === LEAD_IN_WEEK
      ? `/api/weeks/current?blockId=${b.id}&weekNumber=1&leadIn=1`
      : `/api/weeks/current?blockId=${b.id}&weekNumber=${wn}`)
    // The current week is prepared on open if it has no plan (the same path
    // as the Sunday weekly pass). Later weeks say "Not prepared yet".
    if (!wd && wn === currentWeekOf(b)) {
      wd = await apiFetch<WeekData>('/api/weeks/auto-generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: b.id, startDate: getMonday(0), today: getTodayISO() }),
      })
    }
    setWeekData(wd)
    setWeekNumber(wn)
  }, [])

  useEffect(() => {
    async function load() {
      try {
        // One request (page 59 §6 item 5): the block, the week it opens on, and the past weeks' done counts.
        const program = await apiFetch<ProgramPayload>(programPath(getTodayISO()))
        const existingBlock = program.block

        if (!existingBlock) {
          // First launch: no block has ever been created. Recommend Block Zero.
          setBlockZeroPrompt('first_launch')
          setBlock(null)
          setLoading(false)
          return
        }

        // Resume-after-crash: block_zero exists but week 1 was never generated.
        if (existingBlock.blockType === 'block_zero') {
          if (!program.week1) {
            setBlock(existingBlock)
            const stored = await apiFetch<BlockZeroAssessmentOutput | null>('/api/ai/block-zero-assessment')
            if (stored) {
              setAssessment(stored)
            } else {
              setAssessmentLoading(true)
              setLoading(false)
              const result = await apiFetch<BlockZeroAssessmentOutput | null>('/api/ai/block-zero-assessment', { method: 'POST' }).catch(() => null)
              setAssessmentLoading(false)
              if (result) setAssessment(result)
              // No assessment (AI offline): prepare the current week as any open does, no tap needed
              // (a start still ahead: its own week, page 64).
              else if (waitingStart(existingBlock) != null) await prepareStartWeek(existingBlock.id, waitingStart(existingBlock)!, getTodayISO()).catch(() => {})
              else await loadWeek(existingBlock, currentWeekOf(existingBlock)).catch(() => {})
              return
            }
            setLoading(false)
            return
          }
        }

        // Return from a break: the server decides (4+ weeks off in a Fighter block).
        if (existingBlock.returnPlan?.offerBlockZero) setBlockZeroPrompt('return_from_break')

        setBlock(existingBlock)
        // Page 64: a Block Zero waiting for its start: the waiting board, and its start's week under it
        // (the lead-in, or week 1 from a Monday), as the server sends it.
        if (waitingStart(existingBlock) != null) {
          setWeekData(program.week)
          setWeekNumber(program.weekNumber ?? 1)
          return
        }
        const cw = currentWeekOf(existingBlock)
        // A deep link (/program?day=YYYY-MM-DD) opens the week holding that day.
        const day = parseDayParam(new URLSearchParams(window.location.search).get('day'))
        const wn = day != null ? weekForDay(day, isoToEpochDay(getTodayISO()), cw, existingBlock.totalWeeks, firstWeekOf(existingBlock)) : cw
        if (wn === cw && program.weekNumber === cw) {
          setPastDone({ key: pastKeyFor(existingBlock, cw, cw), counts: new Map(Object.entries(program.pastDone).map(([w, n]) => [Number(w), n])) })
          await loadWeek(existingBlock, wn, program.week)
        } else await loadWeek(existingBlock, wn)
      } catch (e) {
        console.error('Failed to load program:', e)
        setBlock(null)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [loadWeek, reloadKey])

  // A deep link while Program is open (Today's week strip): go to that day.
  useEffect(() => {
    if (dayParam == null || !block) return
    let cancelled = false
    const wn = weekForDay(dayParam, todayEpochDay, currentWeekOf(block), block.totalWeeks, firstWeekOf(block))
    void (async () => {
      // a start still ahead shows only its own week
      if (wn !== weekNumber && waitingStart(block) == null) await loadWeek(block, wn).catch(() => {})
      if (!cancelled) setOpenDay(dayParam)
    })()
    return () => { cancelled = true }
    // Only a new link moves the page; paging weeks by hand must not snap back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayParam, block?.id])

  // The road's wayposts: sessions done in past weeks (fetched once per block window).
  const currentWeek = block ? currentWeekOf(block) : 1
  const windowWeeks = block ? cycleWeeks(Math.max(1, weekNumber), block.totalWeeks, block.blockType) : []
  const pastKey = block ? pastKeyFor(block, currentWeek, weekNumber) : ''
  useEffect(() => {
    if (!block || !pastKey || pastDone?.key === pastKey) return
    const past = windowWeeks.filter(w => w < currentWeek)
    let cancelled = false
    void Promise.all(past.map(w =>
      apiFetch<WeekData | null>(`/api/weeks/current?blockId=${block.id}&weekNumber=${w}`)
        .then(wd => [w, wd ? wd.sessions.filter(s => s.status === 'completed').length : 0] as const)
        .catch(() => [w, 0] as const),
    )).then(rows => { if (!cancelled) setPastDone({ key: pastKey, counts: new Map(rows) }) })
    return () => { cancelled = true }
    // The key names the block, the current week and the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastKey])

  const viewedSessions = weekData?.sessions ?? []
  const currentDone = weekNumber === currentWeek && weekData ? viewedSessions.filter(s => s.status === 'completed').length : null
  const doneCounts = pastDone?.key === pastKey ? pastDone.counts : null
  useEffect(() => {
    if (!block || windowWeeks.length === 0) return
    const counts = new Map(doneCounts ?? [])
    if (currentDone != null) counts.set(currentWeek, currentDone)
    setWorldWeeks(worldWeekPosts(windowWeeks, currentWeek, counts))
    // windowWeeks is derived from the key fields below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.id, pastKey, doneCounts, currentDone, currentWeek])

  /** Reads Program again from the server (one request, as on open). */
  function reload() {
    setLoading(true)
    setReloadKey(k => k + 1)
  }

  async function handleStartBlockZero(freshStart = false, startDay?: number) {
    // Fresh start clears all history, so it takes a second tap to confirm.
    if (freshStart && !confirmFreshStart) {
      setConfirmFreshStart(true)
      return
    }
    // Page 64: START BLOCK ZERO first asks which day (START WHEN?).
    if (startDay == null) {
      setStartPick({ fresh: freshStart })
      return
    }
    setStartingBlockZero(true)
    try {
      // The start is the athlete's local day (an evening start stays that day), today or up to six days on.
      const today = getTodayISO()
      const startDate = epochDayToISO(startDay)
      const newBlock = await apiFetch<Block>('/api/blocks/block-zero', {
        method: 'POST',
        body: JSON.stringify(freshStart ? { freshStart: true, confirmReset: true, today, startDate } : { today, startDate }),
      })
      setBlock(newBlock)
      setStartPick(null)
      setBlockZeroPrompt(null)
      setStartingBlockZero(false)
      setConfirmFreshStart(false)
      setAssessmentLoading(true)
      const result = await apiFetch<BlockZeroAssessmentOutput | null>('/api/ai/block-zero-assessment', { method: 'POST' }).catch(() => null)
      setAssessmentLoading(false)
      setAssessment(result)
      // No assessment (AI offline): prepare the current week now, as any open does (a start ahead: its own week).
      if (!result && waitingStart(newBlock) != null) { await prepareStartWeek(newBlock.id, startDay, getTodayISO()).catch(() => {}); reload() }
      else if (!result) await loadWeek(newBlock, currentWeekOf(newBlock)).catch(() => {})
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
      // Page 64: a start still ahead prepares its own week; the waiting board shows until the day.
      const ahead = waitingStart(block)
      if (ahead != null) {
        await prepareStartWeek(block.id, ahead, getTodayISO())
        setAssessment(null)
        reload()
        return
      }
      const wd = await apiFetch<WeekData>('/api/weeks/generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: block.id, weekNumber: 1, startDate: getMonday(0), today: getTodayISO() }),
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
    setConfirmFreshStart(false)
    // No block yet (first launch, dismissed): create a Fighter block.
    if (!block) {
      const newBlock = await apiFetch<Block>('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Fighter Block', totalWeeks: 12, today: getTodayISO() }),
      })
      setBlock(newBlock)
      await loadWeek(newBlock, currentWeekOf(newBlock))
    }
  }

  async function handleGenerateWeek() {
    if (!block) return
    setGenerating(true)
    try {
      const weekOffset = weekNumber - currentWeekOf(block)
      const wd = await apiFetch<WeekData>('/api/weeks/auto-generate', {
        method: 'POST',
        body: JSON.stringify({ blockId: block.id, startDate: getMonday(weekOffset), today: getTodayISO() }),
      })
      setWeekData(wd)
    } catch (e) {
      console.error('Failed to prepare week:', e)
    } finally {
      setGenerating(false)
    }
  }

  function goToWeek(w: number) {
    if (!block || w < firstWeekOf(block) || w > block.totalWeeks || w === weekNumber) return
    setOpenDay(null)
    void loadWeek(block, w).catch(e => console.error('Failed to load week:', e))
  }

  if (loading) {
    return (
      <Frame>
        <div className="db-glass" aria-busy="true"><p className="wm-prose is-dim">Reading the plan.</p></div>
      </Frame>
    )
  }

  // ─── Block Zero: the assessment ───────────────────────────────

  if (assessmentLoading) {
    return (
      <Frame road={false}>
        <Board head="Block Zero" solid>
          <p className="wm-prose">Reading your profile.</p>
          <p className="wm-prose is-dim" style={{ marginTop: 4 }}>This takes about 20 seconds.</p>
        </Board>
      </Frame>
    )
  }

  if (assessment) {
    // page 61: CLOSE back to the week (the plan is prepared as any open does)
    const closeAssessment = () => {
      setAssessment(null)
      if (!block) return
      // a start still ahead: its week is prepared and the waiting board shows (page 64)
      const ahead = waitingStart(block)
      if (ahead != null) void prepareStartWeek(block.id, ahead, getTodayISO()).catch(() => {}).then(reload)
      else void loadWeek(block, currentWeekOf(block)).catch(() => {})
    }
    return (
      <Frame road={false}>
        <Board head="Block Zero" solid headRight={<CloseWord onClose={closeAssessment} />}>
          <p className="wm-prose">{assessment.narrative}</p>
          {assessment.coachNote && <p className="pg-why" style={{ marginTop: 10 }}>{assessment.coachNote}</p>}
          <div className="pg-themes">
            {assessment.weekThemes.map(wt => (
              <div key={wt.weekNumber} className="pg-theme">
                <FlapLabel text={`WK ${wt.weekNumber}`} size="xs" tone="gold" />
                <span className="wm-prose is-dim">{wt.focus}</span>
              </div>
            ))}
          </div>
          {assessment.calibrationStarts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="wm-label">Starting weights</p>
              <div className="db-lifts">
                {assessment.calibrationStarts.map(cs => (
                  <div key={cs.exerciseName} className="db-lift"><span>{cs.exerciseName.toUpperCase()}</span><span>{lbText(cs.startingWeightKg)}</span></div>
                ))}
              </div>
              <p className="wm-prose is-dim" style={{ marginTop: 6 }}>Block Zero loads at 55-65% of these numbers.</p>
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <FlapButton label={generating ? 'SETTING UP' : 'BEGIN'} primary disabled={generating} onClick={handleBeginBlockZero} />
          </div>
        </Board>
      </Frame>
    )
  }

  // ─── Block Zero: the prompt ───────────────────────────────────

  if (blockZeroPrompt) {
    const isFirstLaunch = blockZeroPrompt === 'first_launch'
    // m15: a restart by hand isn't a return from a break, so it says nothing about one.
    const isRestart = blockZeroPrompt === 'restart'
    return (
      <Frame road={false}>
        <Board head={isFirstLaunch ? 'Before you begin' : isRestart ? (block?.blockType === 'block_zero' ? 'Restart Block Zero' : 'Reset with Block Zero') : 'Welcome back'} solid>
          <FlapLabel text={isFirstLaunch ? 'START WITH BLOCK ZERO' : 'TIME FOR A RESET'} size="sm" tone="gold" fit />
          <p className="wm-prose" style={{ marginTop: 10 }}>
            {isFirstLaunch
              ? 'After time away from training, jumping straight into heavy weights risks tendon injury. Muscle memory returns faster than connective tissue adapts. Block Zero is a 6-week ramp-up that gets your body ready to train hard without breaking down.'
              : isRestart
                ? 'Block Zero resets your starting weights and volume so you can build back up safely.'
                : "It's been a while since your last session. Tendons and ligaments detrain faster than muscle. Block Zero resets your starting weights and volume so you can build back up safely."}
          </p>
          <ul className="pg-list">
            {['Weeks 1–2: Foundation, run-walks and light strength (55–57.5% of your maxes).', 'Weeks 3–5: Weights climb to 60–65%. MT class is yours to add.', 'Week 6: Volume down, then the gate to Fighter Block 1.'].map(item => (
              <li key={item} className="wm-prose is-dim">{item}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <FlapButton label={startingBlockZero && !confirmFreshStart ? 'SETTING UP' : 'START BLOCK ZERO'} primary disabled={startingBlockZero} onClick={() => handleStartBlockZero()} />
            <button type="button" className="db-add" disabled={startingBlockZero} onClick={() => handleStartBlockZero(true)}>
              {startingBlockZero && confirmFreshStart ? 'Clearing history...' : confirmFreshStart ? 'Tap again to clear history and start' : 'Start Block Zero fresh (clears history)'}
            </button>
            <button type="button" className="db-add" onClick={handleContinueExisting}>
              {isFirstLaunch ? 'Skip. Go straight to Fighter block' : 'Continue current block'}
            </button>
          </div>
        </Board>
        {startPick && (
          <StartDayBoard
            todayDay={todayEpochDay}
            selected={todayEpochDay}
            busy={startingBlockZero}
            onPick={day => { void handleStartBlockZero(startPick.fresh, day) }}
            onDismiss={() => { setStartPick(null); setConfirmFreshStart(false) }}
          />
        )}
      </Frame>
    )
  }

  if (!block) {
    return (
      <Frame>
        <div className="db-glass"><p className="wm-prose">Failed to load program.</p></div>
      </Frame>
    )
  }

  // ─── Block Zero: waiting for its start day (page 64) ───────────

  const ahead = waitingStart(block)
  if (ahead != null) {
    const saveStart = async (day: number) => {
      setSavingStart(true)
      try {
        await moveStartDay<Block>(block.id, day, getTodayISO())
        setChangeOpen(false)
        // TODAY starts now: Program opens on the week as usual; a day still ahead shows its own week.
        setOpenDay(null)
        reload()
      } catch (e) {
        console.error('Failed to change the start day:', e)
        showPop("Couldn't save. Check your connection.", 'bad', { title: "COULDN'T SAVE", durationMs: 4000 })
      } finally {
        setSavingStart(false)
      }
    }
    // Below the board, the start's planned week as usual: the days before the start are empty and dim.
    const startDays = weekDays(mondayOf(ahead))
    const startOpen = openDay != null && startDays.includes(openDay) ? openDay : ahead
    return (
      <Frame>
        <div className="sd-gap" />
        <StartWaitBoard startDay={ahead} todayDay={todayEpochDay} onChange={() => setChangeOpen(true)} />
        {weekData && (
          <WeekView
            key={weekData.week.id}
            sessions={viewedSessions}
            changes={changes}
            markSeen={markSeen}
            onUndo={async id => {
              const ok = await undo(id)
              if (ok) reload()
              return ok
            }}
            onChanged={() => setChangesVersion(v => v + 1)}
            weekNumber={Math.max(1, weekNumber)}
            days={startDays}
            todayEpochDay={todayEpochDay}
            openDay={startOpen}
            onOpenDay={setOpenDay}
            startsOn={ahead}
            onSessionUpdate={(id, patch) => {
              setWeekData(prev => prev ? { ...prev, sessions: prev.sessions.map(s => (s.id === id ? { ...s, ...patch } : s)) } : null)
            }}
            onSessionAdded={session => {
              setWeekData(prev => prev ? { ...prev, sessions: [...prev.sessions.filter(s => s.id !== session.id), session] } : null)
            }}
          />
        )}
        {changeOpen && (
          <StartDayBoard todayDay={todayEpochDay} selected={ahead} change busy={savingStart} onPick={day => { void saveStart(day) }} onDismiss={() => setChangeOpen(false)} />
        )}
      </Frame>
    )
  }

  const isBlockZero = block.blockType === 'block_zero'
  // Block Zero extension weeks hold week-5 levels; Fighter cycles every 6 weeks.
  const leadInView = weekNumber === LEAD_IN_WEEK
  const blockWeek = strengthBlockWeek(block.blockType, Math.max(1, weekNumber))
  const weekInfo = getWeekLabel(blockWeek, isBlockZero ? 'block_zero' : 'fighter')
  const blkLine = leadInView
    ? `Lead-in · week 1 starts Monday`
    : isBlockZero
    ? `${weekInfo} · week ${weekNumber} of ${block.totalWeeks}`
    : `Fighter · ${weekInfo} · block week ${blockWeek} of 6`
  const read = readWeekAnalysis(weekData?.week.analysisJson, weekData?.week.whyLine)
  const changesLine = weekChangesLine(changes)

  // Monday to Sunday of the viewed week: from its sessions, else the calendar.
  const firstDay = viewedSessions.reduce<number | null>((m, s) => (s.scheduledDate != null && (m == null || s.scheduledDate < m) ? s.scheduledDate : m), null)
  const monday = firstDay != null ? mondayOf(firstDay) : mondayOf(todayEpochDay) + (weekNumber - currentWeek) * 7
  const plan = bodyWatch?.alert?.planDays ?? null
  const ravenLine = plan && bodyWatch?.alert?.programLine && monday <= plan[1] && monday + 6 >= plan[0] ? bodyWatch.alert.programLine : null
  const days = weekDays(monday)
  const shownDay = openDay != null && days.includes(openDay)
    ? openDay
    : days.includes(todayEpochDay) ? todayEpochDay : days.find(d => viewedSessions.some(s => s.scheduledDate === d)) ?? days[0]

  return (
    <Frame>
      {/* the week: nav, six week flap tiles, why this week */}
      <div className="db-glass">
        <div className="pg-nav">
          <button type="button" className="pg-lnk" onClick={() => goToWeek(weekNumber - 1)} disabled={weekNumber <= firstWeekOf(block)} aria-label="Previous week">‹ Prev</button>
          <FlapLabel text={leadInView ? 'LEAD-IN' : `WEEK ${weekNumber}`} size="md" tone={weekNumber === currentWeek ? 'gold' : 'ink'} />
          <button type="button" className="pg-lnk" onClick={() => goToWeek(weekNumber + 1)} disabled={weekNumber >= block.totalWeeks} aria-label="Next week">Next ›</button>
        </div>
        <p className="pg-blk">{blkLine}</p>
        <div className="pg-six" role="group" aria-label="Weeks of the block">
          {windowWeeks.map(w => {
            const st = weekState(w, currentWeek)
            return (
              <button
                key={w}
                type="button"
                className={`pg-wk${w === weekNumber ? ' is-viewed' : ''}${st === 'now' ? ' is-now' : ''}`}
                aria-label={`Week ${w}${st === 'now' ? ', this week' : st === 'done' ? ', done' : ''}`}
                aria-current={w === weekNumber ? 'true' : undefined}
                onClick={() => goToWeek(w)}
              >
                <FlapLabel text={String(w)} size="md" tone={st === 'done' ? 'teal' : st === 'now' ? 'gold' : 'ink'} />
              </button>
            )
          })}
        </div>
        {/* page 56 item 16: the week line, plain text, no frame; then one quiet line that opens the week log */}
        {/* page 58 4B: while the raven's plan is on, its line (brass) is the week's line */}
        {ravenLine ? <p className="pg-weekl is-w">{ravenLine}</p> : read.why && <p className="pg-weekl">{read.why}</p>}
        {changesLine && <button type="button" className="pg-loglink" onClick={() => setLogOpen(true)}>{changesLine}</button>}
      </div>

      {isBlockZero && (
        <BlockZeroExtras
          blockId={block.id}
          viewWeek={weekNumber}
          currentWeek={currentWeek}
          totalWeeks={block.totalWeeks}
          onOpenGate={() => navigate('/block-zero/gate')}
        />
      )}

      {!weekData ? (
        <div className="db-glass">
          <p className="wm-prose">Not prepared yet.</p>
          <button type="button" className="db-add" onClick={handleGenerateWeek} disabled={generating}>
            {generating ? 'Preparing...' : `Prepare week ${weekNumber} now`}
          </button>
        </div>
      ) : (
        <WeekView
          key={weekData.week.id}
          sessions={viewedSessions}
          changes={changes}
          markSeen={markSeen}
          onUndo={async id => {
            const ok = await undo(id)
            if (ok && block) await loadWeek(block, weekNumber).catch(() => {})
            return ok
          }}
          onChanged={() => setChangesVersion(v => v + 1)}
          weekNumber={Math.max(1, weekNumber)}
          days={days}
          todayEpochDay={todayEpochDay}
          openDay={shownDay}
          onOpenDay={setOpenDay}
          onSessionUpdate={(id, patch) => {
            setWeekData(prev => prev ? { ...prev, sessions: prev.sessions.map(s => (s.id === id ? { ...s, ...patch } : s)) } : null)
          }}
          onSessionAdded={session => {
            setWeekData(prev => prev ? { ...prev, sessions: [...prev.sessions.filter(s => s.id !== session.id), session] } : null)
          }}
        />
      )}

      {logOpen && (
        <WeekLog
          week={changes}
          weekNumber={weekNumber}
          onUndo={async id => {
            const ok = await undo(id)
            if (ok && block) await loadWeek(block, weekNumber).catch(() => {})
            refreshChanges()
            return ok
          }}
          onClose={() => setLogOpen(false)}
        />
      )}

      {/* Manual block starts */}
      <button type="button" className="db-add pg-reset" onClick={() => setBlockZeroPrompt('restart')}>
        {isBlockZero ? 'Restart Block Zero' : 'Reset with Block Zero'}
      </button>
    </Frame>
  )
}

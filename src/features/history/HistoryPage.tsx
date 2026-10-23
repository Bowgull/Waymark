import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Crest, FlapLabel, SceneWindow } from '@/design'
import { apiFetch } from '@/lib/api'
import { PageErrorScreen } from '@/components/ui/ErrorScreens'
import { getTodayISO } from '@/lib/dates'
import { logger } from '@/lib/logger'
import { pondReaction, type LedgerRange, type LedgerRing, type SleepDay, type HerbDay, type HerbSleepLine } from '@/lib/ledger'
import type { ConsistencyView } from '@/lib/ledgerConsistency'
import type { EasyRunsView, FightView, FiveKView, NextBlockView, StrengthSinceView } from '@/lib/ledgerBoards'
import { setWorldPond } from '@/world/worldStore'

import {
  ConsistencyBoard, FightBoard, FightFlap, HerbBoard, HerbFlap, NextBlockBoard, NextBlockFlap, RingBoard,
  RunningBoard, RunningFlap, SleepBoard, SleepFlap, StrengthFlap, StrengthSinceBoard,
} from './LedgerBoards'
import { LedgerLines, type LedgerLineItem } from './LedgerLines'
import { PondRings } from './PondRings'
import './ledger.css'

// The Ledger (page 32, "The Ledger · together"; page 77 A, page 79): the pond fills the screen.
// On top, WEEK / MONTH / SEASON and the week's flap-segment rings (the same rings float on the
// pond); under them one closed line per board, in the order of what's next, his goals, then
// recovery: Next block, Running, Fight, Strength, Sleep + soreness, Herb. A line opens its
// board in place (LedgerLines).

export interface LedgerData {
  range: LedgerRange
  weeks: number
  rings: LedgerRing[]
  /** Page 79 (older servers leave these out): the 5K first, then easy runs at his own heart line. */
  running?: { fiveK: FiveKView; easy: EasyRunsView & { empty: string | null } }
  fight?: FightView
  /** Strength since he started. */
  lifts?: StrengthSinceView
  /** In Block Zero: page 69 §5's meter in plain words. */
  nextBlock?: NextBlockView | null
  /** mornings: how many the average is from (older servers leave it out). */
  sleep: { days: SleepDay[]; avg: number | null; mornings?: number }
  /** Page 62 B: the last 28 mornings' herb; older servers leave it out. */
  herb?: { days: HerbDay[]; avg7: number | null; avg28: number | null; line: HerbSleepLine | null; n7?: number; n28?: number }
  /** Page 63: the Consistency board (the last weeks after Block Zero). */
  consistencyBoard?: ConsistencyView
  /** The pond's reaction (the range's sessions); older servers leave it out. */
  pond?: number | null
}

const RANGES: { key: LedgerRange; label: string; title: string }[] = [
  { key: 'week', label: 'WEEK', title: 'This week' },
  { key: 'month', label: 'MONTH', title: 'This month' },
  { key: 'season', label: 'SEASON', title: 'This season' },
]

function LedgerHeader({ week }: { week: number | null }) {
  return (
    <header className="lg-hd wm-scene-hd">
      <Link to="/today" className="lg-brand" aria-label="Today">
        <span className="lg-crest"><Crest width={52} /></span>
        <FlapLabel text="LEDGER" size="sm" />
      </Link>
      {week != null && <FlapLabel text={`WEEK ${week}`} size="xs" />}
    </header>
  )
}

/** Page 79's order: what's next, then his goals (5K, fighting, lifting), then recovery. */
function lineItems(d: LedgerData): LedgerLineItem[] {
  const items: LedgerLineItem[] = []
  if (d.nextBlock) items.push({ key: 'next', name: 'Next block', flap: <NextBlockFlap view={d.nextBlock} />, board: <NextBlockBoard view={d.nextBlock} /> })
  else if (d.consistencyBoard) items.push({ key: 'consistency', name: 'Consistency', flap: <FlapLabel text={d.consistencyBoard.flap} size="xs" tone={d.consistencyBoard.tone} animate={false} />, board: <ConsistencyBoard view={d.consistencyBoard} /> })
  if (d.running) items.push({ key: 'running', name: 'Running', flap: <RunningFlap fiveK={d.running.fiveK} />, board: <RunningBoard fiveK={d.running.fiveK} easy={d.running.easy} /> })
  if (d.fight) items.push({ key: 'fight', name: 'Fight', flap: <FightFlap view={d.fight} />, board: <FightBoard view={d.fight} /> })
  if (d.lifts) items.push({ key: 'strength', name: 'Strength', flap: <StrengthFlap view={d.lifts} />, board: <StrengthSinceBoard view={d.lifts} /> })
  items.push({ key: 'sleep', name: 'Sleep + soreness', flap: <SleepFlap avg={d.sleep.avg} mornings={d.sleep.mornings} />, board: <SleepBoard days={d.sleep.days} avg={d.sleep.avg} mornings={d.sleep.mornings} /> })
  // page 62 B: right after Sleep + soreness
  if (d.herb) items.push({ key: 'herb', name: 'Herb', flap: <HerbFlap avg7={d.herb.avg7} n7={d.herb.n7} />, board: <HerbBoard days={d.herb.days} avg7={d.herb.avg7} avg28={d.herb.avg28} line={d.herb.line} n7={d.herb.n7} n28={d.herb.n28} /> })
  return items
}

export function HistoryPage() {
  const [range, setRange] = useState<LedgerRange>('week')
  const [data, setData] = useState<LedgerData | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  // The Ledger couldn't be read: the page error with RELOAD, not a blank page (dead end #18).
  const [failed, setFailed] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    apiFetch<LedgerData>(`/api/history/ledger?range=${range}&today=${getTodayISO()}&tz=${new Date().getTimezoneOffset()}`)
      .then(d => { if (!cancelled) { setData(d); setFailed(false) } })
      .catch(e => {
        logger.error('api', 'Ledger failed to load', { error: String(e) })
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [range])

  useEffect(() => {
    apiFetch<{ currentWeek?: number | null } | null>(`/api/blocks/current?date=${getTodayISO()}`)
      .then(b => setWeek(b?.currentWeek ?? null))
      .catch(() => setWeek(null))
  }, [])

  // the water reacts to the week (page 32): brighter and more fireflies when it has gone well
  useEffect(() => {
    if (data) setWorldPond(data.pond !== undefined ? data.pond : pondReaction(data.rings))
  }, [data])
  useEffect(() => () => setWorldPond(null), [])

  const title = RANGES.find(r => r.key === range)!.title
  // page 46: MONTH and SEASON count done / planned and say how far the charts reach
  const spanLine = data && range !== 'week' ? `Charts show the last ${data.weeks} weeks.` : null

  if (failed) return <PageErrorScreen pathname="/history" onReload={() => window.location.reload()} onBack={() => navigate('/today')} />

  return (
    <div className="lg-root">
      {data && <PondRings rings={data.rings} />}
      <LedgerHeader week={week} />
      {/* page 67 (Scroll reveals): the pond in the top 46%; the boards start under it, one column,
          and scroll up over it (page 32's screens are one page now) */}
      <SceneWindow />
      <div className="lg-body">
        <div className="lg-segl" role="tablist" aria-label="Range">
          {RANGES.map(r => (
            <button key={r.key} type="button" role="tab" aria-selected={range === r.key} className="lg-segb" onClick={() => setRange(r.key)}>
              <FlapLabel text={r.label} size="xs" tone={range === r.key ? 'gold' : 'ink'} />
            </button>
          ))}
        </div>
        {data && (
          <>
            <RingBoard rings={data.rings} title={title} sub={range === 'week' ? undefined : 'done / planned'} />
            {spanLine && <p className="lg-span">{spanLine}</p>}
            <LedgerLines items={lineItems(data)} />
          </>
        )}
      </div>
    </div>
  )
}

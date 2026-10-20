import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Crest, FlapLabel } from '@/design'
import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { logger } from '@/lib/logger'
import { pondReaction, type LedgerRange, type LedgerRing, type LiftSeries, type SleepDay, type WeeklyPoint, type HerbDay, type HerbSleepLine } from '@/lib/ledger'
import type { ConsistencyView } from '@/lib/ledgerConsistency'
import { setWorldPond } from '@/world/worldStore'

import { AerobicBoard, ConsistencyBoard, HerbBoard, RingBoard, SleepBoard, StrengthBoard } from './LedgerBoards'
import { PondRings } from './PondRings'
import './ledger.css'

// The Ledger (page 32, "The Ledger · together"): the pond fills the screen, the boards sit on glass
// up top. WEEK / MONTH / SEASON, the week's flap-segment rings (the same rings rest on the pond),
// Aerobic Base, Strength, Sleep + soreness, Body weight, Consistency. The app's older Ledger cards
// (time training, running, weekly zones, marks earned, recent sessions) are dropped from this
// screen; their endpoints stay for the coach.

export interface LedgerData {
  range: LedgerRange
  weeks: number
  rings: LedgerRing[]
  aerobic: { points: WeeklyPoint[]; runs: number }
  strength: { lifts: LiftSeries[]; sets: number }
  sleep: { days: SleepDay[]; avg: number | null }
  /** Page 62 B: the last 28 mornings' herb; older servers leave it out. */
  herb?: { days: HerbDay[]; avg7: number | null; avg28: number | null; line: HerbSleepLine | null }
  weight: { points: WeeklyPoint[]; weighIns: number }
  /** Page 63: the Consistency board (the block bar, or the last weeks after Block Zero). */
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
    <header className="lg-hd">
      <Link to="/today" className="lg-brand" aria-label="Today">
        <span className="lg-crest"><Crest width={52} /></span>
        <FlapLabel text="LEDGER" size="sm" />
      </Link>
      {week != null && <FlapLabel text={`WEEK ${week}`} size="xs" />}
    </header>
  )
}

export function HistoryPage() {
  const [range, setRange] = useState<LedgerRange>('week')
  const [data, setData] = useState<LedgerData | null>(null)
  const [week, setWeek] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch<LedgerData>(`/api/history/ledger?range=${range}&today=${getTodayISO()}&tz=${new Date().getTimezoneOffset()}`)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => logger.error('api', 'Ledger failed to load', { error: String(e) }))
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

  return (
    <div className="lg-root">
      {data && <PondRings rings={data.rings} />}
      <LedgerHeader week={week} />
      {/* page 32: the boards scroll under the header in screens (the top of the Ledger, then
          "scrolled down"), each leaving the still water open below it */}
      <div className="lg-body">
        <div className="lg-page">
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
              {/* page 63: between the week rings and Aerobic base */}
              {data.consistencyBoard && <ConsistencyBoard view={data.consistencyBoard} />}
              <AerobicBoard points={data.aerobic.points} runs={data.aerobic.runs} />
            </>
          )}
        </div>
        {data && (
          <>
            <div className="lg-page">
              <StrengthBoard lifts={data.strength.lifts} sets={data.strength.sets} />
              <SleepBoard days={data.sleep.days} avg={data.sleep.avg} />
            </div>
            <div className="lg-page">
              {/* page 62 B: right after Sleep + soreness, at the top of the third screen */}
              {data.herb && <HerbBoard days={data.herb.days} avg7={data.herb.avg7} avg28={data.herb.avg28} line={data.herb.line} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

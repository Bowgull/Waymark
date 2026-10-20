import { useState } from 'react'

import { Board, CentredCard, FlapButton, FlapLabel } from '@/design'
import { countdownFlap, startLine, startTiles, startsFlap, waitLine } from '@/lib/coach/startDay'
import './startDay.css'

// Page 64 (approved 2026-10-20): choosing the Block Zero start day.
// START BLOCK ZERO opens START WHEN? (seven day tiles, one plain line, START);
// until that day Today and Program show the waiting board with CHANGE DAY,
// which opens the same board with SAVE. The way out is page 61's.

/** The START WHEN? board. `selected`: the day lit first (today, or the chosen start on CHANGE DAY). */
export function StartDayBoard({ todayDay, selected, change = false, busy = false, onPick, onDismiss }: {
  todayDay: number
  selected: number
  /** CHANGE DAY: head "Change start day", SAVE. */
  change?: boolean
  busy?: boolean
  onPick: (startDay: number) => void
  onDismiss: () => void
}) {
  const tiles = startTiles(todayDay)
  const [day, setDay] = useState(() => (tiles.some(t => t.day === selected) ? selected : todayDay))
  const line = startLine(day, todayDay)
  const tile = (t: (typeof tiles)[number], size: 'sm' | 'xs') => {
    const on = t.day === day
    return (
      <button key={t.day} type="button" className={`sd-dt${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={`${t.key === 'TODAY' || t.key === 'TOMORROW' ? t.key.toLowerCase() : t.key}, ${t.date}`} onClick={() => setDay(t.day)}>
        <FlapLabel text={t.key} size={size} tone={on ? 'gold' : 'ink'} />
        <span className="sd-dd">{t.date}</span>
      </button>
    )
  }
  return (
    <CentredCard label={change ? 'Change start day' : 'Start Block Zero'} head={change ? 'Change start day' : 'Start Block Zero'} onDismiss={busy ? undefined : onDismiss} className="sd-card">
      <div className="sd-when"><FlapLabel text="START WHEN?" size="md" tone="gold" /></div>
      <div className="sd-pick" role="group" aria-label="Start day">
        <div className="sd-row is-two">{tiles.slice(0, 2).map(t => tile(t, 'sm'))}</div>
        <div className="sd-row is-five">{tiles.slice(2).map(t => tile(t, 'xs'))}</div>
      </div>
      <p className="sd-what">{line.lead}<b>{line.day}</b>{line.rest}</p>
      <FlapButton label={busy ? (change ? 'SAVING' : 'SETTING UP') : change ? 'SAVE' : 'START'} primary disabled={busy} onClick={() => onPick(day)} />
    </CentredCard>
  )
}

/** The waiting board (page 64 §2): BLOCK ZERO, STARTS THU, the countdown, the line, CHANGE DAY. */
export function StartWaitBoard({ startDay, todayDay, onChange }: { startDay: number; todayDay: number; onChange: () => void }) {
  return (
    <Board className="sd-wait">
      <span className="sd-lab">BLOCK ZERO</span>
      <FlapLabel text={startsFlap(startDay)} size="md" tone="gold" />
      <div className="sd-cnt"><FlapLabel text={countdownFlap(startDay, todayDay)} size="sm" /></div>
      <p>{waitLine(startDay)}</p>
      <button type="button" className="sd-lnk" onClick={onChange}>CHANGE DAY</button>
    </Board>
  )
}

/** The start day's morning (page 64 §3): one line on top of the day, day 1 only. */
export function DayOneLine({ flap, line }: { flap: string; line: string }) {
  return (
    <div className="sd-dayone">
      <FlapLabel text={flap} size="sm" tone="gold" />
      <p>{line}</p>
    </div>
  )
}

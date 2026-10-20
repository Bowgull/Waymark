import { useState } from 'react'

import { Board, FlapLabel } from '@/design'
import { Raven, type RavenState } from '@/features/raven/Raven'
import type { ReadinessLineView } from './readinessLine'

import './blockZero.css'
import '@/features/coach/coach.css'

/** The raven on the row (page 58): its pose, its one brass line, and what a tap opens. */
export interface MorningRaven {
  state: RavenState | null
  line: { text: string; settled: boolean } | null
  place: string
  onOpen: () => void
}

/**
 * The Morning Report on Today (page 17; page 56 item 14): one row,
 * "Morning Report" and a flap. Before today's check-in it reads CHECK IN
 * (gold) and a tap opens the cards. After it: LOGGED (teal) and the app's
 * own readiness line under the row ("Good to go." / "Easing today. Sleep off
 * trend."); a tap shows the why. The LOGGED flap itself opens the cards to edit.
 *
 * Page 58: the raven lands on the row's top edge (the row drops 34 px to make
 * room) with one brass line under the readiness line ("Knee: 4 times in 17
 * days."); a tap on the raven or its line opens what it brought.
 */
export function MorningReportRow({ logged, readiness, onOpen, raven, answered = 0 }: { logged: boolean; readiness: ReadinessLineView | null; onOpen: () => void; raven?: MorningRaven | null; /** Cards answered so far today (page 61: CHECK IN · 4 OF 9). */ answered?: number }) {
  const partly = !logged && answered > 0
  const [why, setWhy] = useState(false)
  const line = logged ? readiness : null
  const perched = raven?.state != null
  return (
    <Board className={`td-mr${perched ? ' has-raven' : ''}`} onClick={line ? () => setWhy(w => !w) : onOpen}>
      {perched && raven && <Raven state={raven.state as RavenState} onTap={raven.onOpen} label={`The raven, about the ${raven.place.toLowerCase()}. Tap to read.`} />}
      <div className="td-mr-row" aria-label={logged ? `Morning Report, logged. ${line?.text ?? ''} Tap for why.` : partly ? `Morning Report, not logged yet, ${answered} of 9. Tap to carry on.` : 'Morning Report, not logged yet. Tap to check in.'}>
        <span className="wm-label td-mr-grow">Morning Report</span>
        {logged ? (
          <button type="button" className="td-mr-flap" aria-label="Edit the Morning Report" onClick={e => { e.stopPropagation(); onOpen() }}>
            <FlapLabel text="LOGGED" size="xs" tone="teal" animate={false} />
          </button>
        ) : <FlapLabel text={partly ? `CHECK IN · ${answered} OF 9` : 'CHECK IN'} size="xs" tone="gold" animate={false} />}
      </div>
      {partly && <p className="rd is-kept">Your answers so far are kept. Tap to carry on.</p>}
      {line && <p className={`rd${line.tone === 'bad' ? ' is-bad' : ''}`}>{line.text}</p>}
      {line && why && <p className="rwhy">{line.why}</p>}
      {raven?.line && (
        <p
          className={`wl${raven.line.settled ? ' is-settled' : ''}`}
          role="button"
          tabIndex={0}
          onClick={e => { e.stopPropagation(); raven.onOpen() }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); raven.onOpen() } }}
        >{raven.line.text}</p>
      )}
    </Board>
  )
}

import { useState } from 'react'

import { Board, FlapLabel } from '@/design'
import type { ReadinessLineView } from './readinessLine'

import './blockZero.css'
import '@/features/coach/coach.css'

/**
 * The Morning Report on Today (page 17; page 56 item 14): one row,
 * "Morning Report" and a flap. Before today's check-in it reads CHECK IN
 * (gold) and a tap opens the cards. After it: LOGGED (teal) and the app's
 * own readiness line under the row ("Good to go." / "Easing today. Sleep off
 * trend."); a tap shows the why. The LOGGED flap itself opens the cards to edit.
 */
export function MorningReportRow({ logged, readiness, onOpen }: { logged: boolean; readiness: ReadinessLineView | null; onOpen: () => void }) {
  const [why, setWhy] = useState(false)
  const line = logged ? readiness : null
  return (
    <Board className="td-mr" onClick={line ? () => setWhy(w => !w) : onOpen}>
      <div className="td-mr-row" aria-label={logged ? `Morning Report, logged. ${line?.text ?? ''} Tap for why.` : 'Morning Report, not logged yet. Tap to check in.'}>
        <span className="wm-label td-mr-grow">Morning Report</span>
        {logged ? (
          <button type="button" className="td-mr-flap" aria-label="Edit the Morning Report" onClick={e => { e.stopPropagation(); onOpen() }}>
            <FlapLabel text="LOGGED" size="xs" tone="teal" animate={false} />
          </button>
        ) : <FlapLabel text="CHECK IN" size="xs" tone="gold" animate={false} />}
      </div>
      {line && <p className={`rd${line.tone === 'bad' ? ' is-bad' : ''}`}>{line.text}</p>}
      {line && why && <p className="rwhy">{line.why}</p>}
    </Board>
  )
}

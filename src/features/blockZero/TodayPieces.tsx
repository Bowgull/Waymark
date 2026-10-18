import { useRef, useState } from 'react'

import { Board, FlapLabel, glowRow } from '@/design'

import './blockZero.css'

/**
 * The Morning Report, collapsed on Today (page 17, "Today · the day"): one
 * row, "Morning Report" and a LOGGED flap. Tap it to edit (the cards open on
 * the first question). Before today's check-in the same row reads CHECK IN
 * on a gold flap (page 45).
 */
export function MorningReportRow({ logged, onOpen }: { logged: boolean; onOpen: () => void }) {
  return (
    <Board className="td-mr" onClick={onOpen}>
      <div className="td-mr-row" aria-label={logged ? 'Morning Report, logged. Tap to edit.' : 'Morning Report, not logged yet. Tap to check in.'}>
        <span className="wm-label td-mr-grow">Morning Report</span>
        <FlapLabel text={logged ? 'LOGGED' : 'CHECK IN'} size="xs" tone={logged ? 'teal' : 'gold'} animate={false} />
      </div>
    </Board>
  )
}

export interface ClassTonightView {
  added: boolean
  /** How the day rebalanced (the server's line, stored on the class). */
  line: { lead: string; rest: string } | null
  /** Adds the class and rebalances the day. Resolves with the refusal line, or null when added. */
  onAdd: () => Promise<string | null>
}

/**
 * + CLASS TONIGHT on the Coach board (page 45, at page 13's place): a small
 * chip by the readiness line. Tapped, it turns ✓ CLASS TONIGHT (teal) and the
 * Coach line above it says how the day rebalanced. A refusal glows the chip
 * clay with its line under it.
 */
export function ClassTonightChip({ added, onAdd }: Pick<ClassTonightView, 'added' | 'onAdd'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  return (
    <div ref={ref} className="bz-class">
      <button
        type="button"
        className="bz-chip"
        aria-label={added ? 'Class tonight, added.' : 'Add a class tonight.'}
        disabled={added || busy}
        onClick={async () => {
          setBusy(true)
          setRefusal(null)
          const refused = await onAdd()
          setBusy(false)
          setRefusal(refused)
          glowRow(ref.current, refused ? 'bad' : 'good')
        }}
      >
        <FlapLabel text={added ? '✓ CLASS TONIGHT' : '+ CLASS TONIGHT'} size="xs" tone={added ? 'teal' : 'gold'} />
      </button>
      {refusal && <p className="wm-row-note" role="alert">{refusal}</p>}
    </div>
  )
}

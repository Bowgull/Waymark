import { Board, FlapLabel } from '@/design'

/**
 * The Morning Report, collapsed on Today (page 17, "Today · the day"): one
 * row, "Morning Report" and a LOGGED flap. Tap it to edit (the cards open on
 * the first question). Before today's check-in the same row offers CHECK IN
 * (page 17 draws only the logged row).
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

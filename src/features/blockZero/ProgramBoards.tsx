import { Board, FlapButton, FlapLabel } from '@/design'
import { isTestWeek } from '@/lib/blockZero/tests'

import { gateOpen } from './gate'
import { stripWeeks, weekLine, weekName } from './program'

/**
 * The Block Zero program view: the six-week strip (Test · Build x4 · Retest)
 * with "you are here", the week's line, and the test / gate entries. The
 * glade above it is the world (step 2).
 */
export function BlockZeroProgramBoards({
  currentWeek,
  viewWeek,
  totalWeeks,
  onPickWeek,
  onOpenTests,
  onOpenGate,
}: {
  currentWeek: number
  viewWeek: number
  totalWeeks: number
  onPickWeek: (week: number) => void
  onOpenTests: (week: number, sheet: boolean) => void
  onOpenGate: () => void
}) {
  const weeks = stripWeeks(currentWeek, totalWeeks)
  // Week 3's check has no board (owner, 2026-10-18): its guidance is on the test-week screens.
  const testWeek = isTestWeek(viewWeek, totalWeeks) && viewWeek !== 3
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Board head="Block Zero" headRight={<FlapLabel text={`WEEK ${currentWeek}/${totalWeeks}`} size="xs" tone="gold" />}>
        <div className="wm-strip" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
          {weeks.map(w => (
            <button
              key={w.week}
              type="button"
              onClick={() => onPickWeek(w.week)}
              aria-label={`Week ${w.week}, ${w.name.toLowerCase()}${w.state === 'now' ? ', you are here' : w.state === 'done' ? ', done' : ''}`}
              aria-current={w.state === 'now' ? 'step' : undefined}
              className={`wm-strip-cell${w.state === 'now' ? ' is-now' : ''}`}
              style={{ border: 0, cursor: 'pointer', outline: w.week === viewWeek && w.state !== 'now' ? '1px solid rgba(232,200,96,.45)' : undefined }}
            >
              <FlapLabel text={w.letter} size="sm" tone={w.state === 'done' ? 'teal' : w.state === 'now' ? 'gold' : 'ink'} />
              <span className="wm-label">WK {w.week}</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
          <FlapLabel text={weekName(viewWeek)} size="xs" tone={viewWeek === currentWeek ? 'gold' : 'ink'} />
          {viewWeek === currentWeek && <span className="wm-label" style={{ color: '#e8c878' }}>you are here</span>}
        </div>
        <p className="wm-prose" style={{ marginTop: 6 }}>{weekLine(viewWeek)}</p>
      </Board>

      {testWeek && (
        <Board head={viewWeek === 1 ? 'Test week' : 'Retest'}>
          <p className="wm-prose" style={{ marginBottom: 10 }}>
            {viewWeek === 1 ? 'One test at a time. The numbers become your baseline.' : 'The week-1 tests again. Then the gate.'}
          </p>
          <div className="wm-btns">
            <FlapButton label="RESULTS" onClick={() => onOpenTests(viewWeek, true)} />
            <FlapButton label="START TESTS" primary onClick={() => onOpenTests(viewWeek, false)} />
          </div>
        </Board>
      )}

      {gateOpen(currentWeek, totalWeeks) && viewWeek === currentWeek && (
        <Board edge="brass" head="The gate">
          <p className="wm-prose" style={{ marginBottom: 10 }}>Retest against week 1, then the verdict: move on, or extend 1–2 weeks.</p>
          <FlapButton label="SEE THE VERDICT" primary onClick={onOpenGate} />
        </Board>
      )}
    </div>
  )
}

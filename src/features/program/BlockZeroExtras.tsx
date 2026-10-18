import { FlapButton } from '@/design'
import { gateOpen } from '@/features/blockZero/gate'
import { isTestWeek } from '@/lib/blockZero/tests'

// Block Zero's test and gate boards under the Program week (the step-1
// boards from blockZero/ProgramBoards.tsx, without its week strip: the six
// week flap tiles on the week board replace it). Same words, same routes.
// Week 3's e1RM check has no board here (owner, 2026-10-18): its guidance
// lives on the test-week screens (/block-zero/tests?week=3).

export function BlockZeroExtras({
  viewWeek,
  currentWeek,
  totalWeeks,
  onOpenTests,
  onOpenGate,
}: {
  viewWeek: number
  currentWeek: number
  totalWeeks: number
  onOpenTests: (week: number, sheet: boolean) => void
  onOpenGate: () => void
}) {
  const testWeek = isTestWeek(viewWeek, totalWeeks) && viewWeek !== 3
  const gate = gateOpen(currentWeek, totalWeeks) && viewWeek === currentWeek
  if (!testWeek && !gate) return null
  return (
    <>
      {testWeek && (
        <div className="db-glass">
          <div className="db-glass-head"><span>{viewWeek === 1 ? 'Test week' : 'Retest'}</span></div>
          <p className="wm-prose" style={{ marginBottom: 10 }}>
            {viewWeek === 1 ? 'One test at a time. The numbers become your baseline.' : 'The week-1 tests again. Then the gate.'}
          </p>
          <div className="wm-btns">
            <FlapButton label="RESULTS" onClick={() => onOpenTests(viewWeek, true)} />
            <FlapButton label="START TESTS" primary onClick={() => onOpenTests(viewWeek, false)} />
          </div>
        </div>
      )}
      {gate && (
        <div className="db-glass pg-brass">
          <div className="db-glass-head"><span>The gate</span></div>
          <p className="wm-prose" style={{ marginBottom: 10 }}>Retest against week 1, then the verdict: move on, or extend 1–2 weeks.</p>
          <FlapButton label="SEE THE VERDICT" primary onClick={onOpenGate} />
        </div>
      )}
    </>
  )
}

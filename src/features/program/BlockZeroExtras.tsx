import { FlapButton } from '@/design'
import { gateOpen } from '@/features/blockZero/gate'
import { isTestWeek } from '@/lib/blockZero/tests'

// Block Zero's test and gate boards under the Program week (the step-1
// boards from blockZero/ProgramBoards.tsx, without its week strip: the six
// week flap tiles on the week board replace it). Same words, same routes.

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
  const testWeek = isTestWeek(viewWeek, totalWeeks)
  const gate = gateOpen(currentWeek, totalWeeks) && viewWeek === currentWeek
  if (!testWeek && !gate) return null
  return (
    <>
      {testWeek && (
        <div className="db-glass">
          <div className="db-glass-head"><span>{viewWeek === 1 ? 'Test week' : viewWeek === 3 ? 'The check' : 'Retest'}</span></div>
          {viewWeek === 3 ? (
            <>
              <p className="wm-prose">One set of 3 to 5 on each main lift. Tap the reps left after it; that sets the estimated max.</p>
              <div style={{ marginTop: 10 }}>
                <FlapButton label="RESULTS" onClick={() => onOpenTests(viewWeek, true)} />
              </div>
            </>
          ) : (
            <>
              <p className="wm-prose" style={{ marginBottom: 10 }}>
                {viewWeek === 1 ? 'One test at a time. The numbers become your baseline.' : 'The week-1 tests again. Then the gate.'}
              </p>
              <div className="wm-btns">
                <FlapButton label="RESULTS" onClick={() => onOpenTests(viewWeek, true)} />
                <FlapButton label="START TESTS" primary onClick={() => onOpenTests(viewWeek, false)} />
              </div>
            </>
          )}
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

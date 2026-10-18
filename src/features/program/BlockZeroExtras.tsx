import { useEffect, useState } from 'react'

import { Board, FlapButton } from '@/design'
import { gateBoardShows, gateOpen } from '@/features/blockZero/gate'
import type { TestRowIn } from '@/features/blockZero/testWeek'
import { apiFetch } from '@/lib/api'
import '@/features/blockZero/blockZero.css'

// Block Zero's one board under the Program week (page 45, "Program: the gate
// board"): THE GATE · SEE THE VERDICT, in week 6 once a week-6 number is in.
// No test-week or retest boards (design-decisions "Block Zero tests").

export function BlockZeroExtras({
  blockId,
  viewWeek,
  currentWeek,
  totalWeeks,
  onOpenGate,
}: {
  /** The block's results tell the board a week-6 number is in. */
  blockId?: string
  viewWeek: number
  currentWeek: number
  totalWeeks: number
  onOpenGate: () => void
}) {
  const atGate = gateOpen(currentWeek, totalWeeks) && viewWeek === currentWeek
  // undefined while loading (no board yet), null when it couldn't load (the board shows by the week)
  const [rows, setRows] = useState<TestRowIn[] | null | undefined>(undefined)
  useEffect(() => {
    if (!atGate || !blockId) return
    let alive = true
    apiFetch<TestRowIn[]>(`/api/blocks/${blockId}/tests`).then(r => { if (alive) setRows(r) }).catch(() => { if (alive) setRows(null) })
    return () => { alive = false }
  }, [atGate, blockId])
  if (!gateBoardShows(viewWeek, currentWeek, totalWeeks, blockId ? (rows === undefined ? [] : rows) : null)) return null
  return (
    <Board className="bz-bd bz-pb" head="The gate">
      <p className="bz-q">Block Zero is done. See whether you move on or build one more week.</p>
      <div className="wm-btns">
        <FlapButton label="SEE THE VERDICT" primary size="sm" onClick={onOpenGate} />
      </div>
    </Board>
  )
}

import { useState } from 'react'

import { NO_ROW_SLOTS, slotRows, type RowSlots } from '@/features/dayboard/rowState'

const same = (a: RowSlots, b: RowSlots) =>
  a.keyOf.size === b.keyOf.size && a.order.length === b.order.length && a.order.every((k, i) => k === b.order[i])

/**
 * The session rows' keys and order (page 73, the same on Program and Today):
 * a swap, its UNDO or REDO keeps the row, so its name flaps flip to the new
 * session (FlapLabel's change flip) instead of a new row arriving.
 */
export function useRowSlots<T extends { id: string; contextJson?: string | null }>(list: ReadonlyArray<T>): { list: T[]; keyOf: (s: T) => string } {
  const [drawn, setDrawn] = useState<RowSlots>(NO_ROW_SLOTS)
  const out = slotRows(list, drawn)
  // derived state (as useSwapList): only when the rows' keys or order changed
  if (!same(drawn, out.next)) setDrawn(out.next)
  return out
}

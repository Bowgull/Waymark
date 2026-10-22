import type { ReactNode } from 'react'

import { backWhy, type WeekChangesIn, type ChangeViewIn } from '@/features/coach/changeView'
import type { DayBoardSession } from '@/features/dayboard/rowState'
import type { RuneState } from '@/lib/coach/changes'

import type { RowChange } from './PlanRow'

// A coach change in the planner's words (page 73): the Dagaz rune, the why,
// and the old value struck where the change has one.

const STRUCK = new Set(['ease', 'shorten', 'push'])

/** The why-line on a row the coach changed: the rune, the old value struck, the why. */
export function rowChange(changes: WeekChangesIn | null, s: DayBoardSession, todayDay: number): RowChange | null {
  const c = (changes?.changes ?? []).filter(x => x.session.id === s.id && x.actor !== 'you' && x.rune != null && x.lock !== 'undone').sort((a, b) => a.createdAt - b.createdAt).pop()
  if (!c || !c.rune) return null
  const struck = STRUCK.has(c.kind) && c.before && c.after && c.before !== c.after
  return { rune: c.rune as RuneState, why: backWhy(c, todayDay), ...(struck ? { was: c.before.toLowerCase(), now: c.after.toLowerCase() } : {}) }
}

/** The say line in the rune's window. */
export function runeSay(c: ChangeViewIn, todayDay: number): ReactNode {
  const struck = STRUCK.has(c.kind) && c.before && c.after && c.before !== c.after
  return struck ? <><s>{c.before.toLowerCase()}</s> {c.after.toLowerCase()}: {backWhy(c, todayDay)}</> : backWhy(c, todayDay)
}


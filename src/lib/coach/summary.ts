// One quiet line off the app (page 56 §7, approved 2026-10-19). No new
// notification: the morning alarm and the Live Activity's finish card already
// carry one line, and it names what moved ("Strength B is 2×8 today. Tap to
// see."). With no push and no background run on a free account, the alarm can
// only name changes known when the app was last open. Pure: the server passes
// the week's change records.

import { isCoachActor, midName, nameOnDay, type ChangeRowLike } from './changes'

export type LineChange = Pick<ChangeRowLike, 'actor' | 'kind' | 'undoneAt' | 'seenAt' | 'after' | 'createdAt'> & {
  /** The changed session's name ("Strength B", "Run-Walk"). */
  name: string
  /** Its day. */
  day: number
  /** Still undoable (the session hasn't started). */
  open: boolean
}

/** The coach's changes still worth a line: unseen, not undone, not started, today or later. */
function pending(changes: ReadonlyArray<LineChange>, fromDay: number): LineChange[] {
  return changes
    .filter(c => isCoachActor(c.actor) && c.kind !== 'missed' && c.undoneAt == null && c.seenAt == null && c.open && c.day >= fromDay)
    .sort((a, b) => a.day - b.day || a.createdAt - b.createdAt)
}

function sentence(c: LineChange, refDay: number): string {
  const after = c.after.show.toLowerCase()
  const own = midName(c.name)
  return c.day === refDay ? `${own.charAt(0).toUpperCase()}${own.slice(1)} is ${after} today.` : `${nameOnDay(c.name, c.day, refDay)}: ${after}.`
}

/** The alarm's line on `alarmDay`: the first unseen coach change from that day on. Null when none. */
export function morningLine(changes: ReadonlyArray<LineChange>, alarmDay: number): string | null {
  const first = pending(changes, alarmDay)[0]
  return first ? `${sentence(first, alarmDay)} Tap to see.` : null
}

/**
 * The finish card's line when a session ends on `day`: the coach change made
 * most recently (around tonight's session), else none.
 */
export function finishLine(changes: ReadonlyArray<LineChange>, day: number): string | null {
  const list = pending(changes, day).sort((a, b) => b.createdAt - a.createdAt)
  const first = list[0]
  return first ? `${sentence(first, day)} Tap to see.` : null
}

// One quiet line off the app (page 56 §7, approved 2026-10-19). No new
// notification: the morning alarm and the Live Activity's finish card already
// carry one line, and it names what moved ("Strength B is 2×8 today. Tap to
// see."). With no push and no background run on a free account, the alarm can
// only name changes known when the app was last open. Pure: the server passes
// the week's change records.

import { isCoachActor, midName, nameOnDay, relativeDay, type ChangeRowLike } from './changes'

export type LineChange = Pick<ChangeRowLike, 'actor' | 'kind' | 'undoneAt' | 'seenAt' | 'after' | 'createdAt'> & {
  /** The changed session's name ("Strength B", "Run-Walk"). */
  name: string
  /** Its day. */
  day: number
  /** Still undoable (the session hasn't started). */
  open: boolean
  /** A missed session's fix: the session that takes its lifts, and its day (m18). */
  into?: { day: number; name: string } | null
}

/** The day a line is about: a missed session's fix day, else the changed day. */
const lineDay = (c: LineChange) => (c.kind === 'missed' ? c.into?.day ?? c.day : c.day)

/** The coach's changes still worth a line: unseen, not undone, not started, today or later. */
function pending(changes: ReadonlyArray<LineChange>, fromDay: number): LineChange[] {
  return changes
    .filter(c => isCoachActor(c.actor) && (c.kind !== 'missed' || c.into != null) && c.undoneAt == null && c.seenAt == null && c.open && lineDay(c) >= fromDay)
    .sort((a, b) => lineDay(a) - lineDay(b) || a.createdAt - b.createdAt)
}

function sentence(c: LineChange, refDay: number): string {
  if (c.kind === 'missed' && c.into) {
    // m18: "Strength C's main lifts are in Strength A today."
    const own = midName(c.name)
    const lead = `${own.charAt(0).toUpperCase()}${own.slice(1)}'s main lifts are in`
    return c.into.day === refDay ? `${lead} ${midName(c.into.name)} today.` : `${lead} ${nameOnDay(c.into.name, c.into.day, refDay)}.`
  }
  // The move to the next block (coach-brain §8): "Fighter Block 1 starts Monday."
  if (c.kind === 'block') return `Fighter Block 1 starts ${relativeDay(c.day, refDay)}.`
  const after = c.after.show.toLowerCase()
  const own = midName(c.name)
  return c.day === refDay ? `${own.charAt(0).toUpperCase()}${own.slice(1)} is ${after} today.` : `${nameOnDay(c.name, c.day, refDay)}: ${after}.`
}

/**
 * The alarm's line on `alarmDay`: the raven's when it has one (page 58 item
 * 14: "The raven's back: how's the knee?" on a return morning, or its unread
 * note once; it matters more than a change), else the first unseen coach
 * change from that day on. Null when none.
 */
export function morningLine(changes: ReadonlyArray<LineChange>, alarmDay: number, raven: string | null = null): string | null {
  if (raven) return raven
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

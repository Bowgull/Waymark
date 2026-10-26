// One weekly kick budget (page 93, approved 2026-10-25; audit fix #6): the bag
// finisher's kick sets and Bag Conditioning's kick parts draw from the same
// count, per side, so his shins see the whole week, not one session at a time.
//
// Muay Thai injuries are mostly lower legs, beginners included (Gartland 2001),
// and coaches build shin force slowly. The research's sizes for him: 30 to 60
// kicks a side in a Bag Conditioning session in weeks 1 to 4, 60 to 120 in
// months 2 to 4 (bag-workouts.md section 2). The week's budget is about two of
// those sessions' worth plus the finishers: INFERRED, a ceiling, not a target.
// Only shin kicks count (body, switch and low kicks); teeps and knees don't.
//
// Pure: the start routes read the week's done sessions and pass them in.

export interface KickCount {
  right: number
  left: number
}

/** Kicks a side a week, by his Bag Conditioning level (1: weeks 1 to 3, 2: weeks 3 to 8, 3: from week 8). */
export const WEEKLY_KICKS: Readonly<Record<1 | 2 | 3, number>> = { 1: 120, 2: 180, 3: 240 }

/** The Monday (epoch day) of the week `day` is in (epoch day 0 was a Thursday). */
export function weekStartDay(day: number): number {
  return day - (((day + 3) % 7) + 7) % 7
}

/** What is left of the week's kicks, per side, after the sessions already done (never below 0). */
export function kicksLeft(level: 1 | 2 | 3, used: ReadonlyArray<KickCount>): KickCount {
  const cap = WEEKLY_KICKS[level]
  const spent = used.reduce((t, k) => ({ right: t.right + Math.max(0, k.right || 0), left: t.left + Math.max(0, k.left || 0) }), { right: 0, left: 0 })
  return { right: Math.max(0, cap - spent.right), left: Math.max(0, cap - spent.left) }
}

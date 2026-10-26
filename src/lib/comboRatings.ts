// Combo ratings after a bag session (page 93, approved 2026-10-25): one rating
// per combo per session, however many rounds the combo was in. The card already
// asked once per combo; the bug was that the save wrote one row per round
// (a combo in 3 rounds saved 3 ratings from one tap, mastery jumped by 3 and
// SHARP could favourite it by itself).
//
// Mastery itself is as built: the sum of the last five ratings (STRUGGLED 1,
// SOLID 2, SHARP 3), mastered at 9 of 15. Older sessions that saved one row per
// round count once here too (their last row), so nothing is rewritten.
//
// Pure: the save route and the tests both run it.

export interface RatingIn {
  roundId: string
  comboId: string
  rating: number
}

/** One rating per combo: its last one wins, with the first round it was in. Ratings outside 1-3 are dropped. */
export function oneRatingPerCombo(ratings: ReadonlyArray<RatingIn>): RatingIn[] {
  const out = new Map<string, RatingIn>()
  for (const r of ratings) {
    if (!r || typeof r.comboId !== 'string' || !r.comboId || typeof r.roundId !== 'string') continue
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 3) continue
    const had = out.get(r.comboId)
    out.set(r.comboId, { comboId: r.comboId, roundId: had?.roundId ?? r.roundId, rating: r.rating })
  }
  return [...out.values()]
}

/** How many of the newest ratings make the mastery score. */
export const MASTERY_WINDOW = 5

/**
 * The mastery score from a combo's stored ratings: one per session (the newest
 * row of each), the newest five summed.
 */
export function masteryFromRatings(rows: ReadonlyArray<{ sessionId: string; rating: number; createdAt: number }>): number {
  const perSession = new Map<string, { rating: number; createdAt: number }>()
  for (const r of rows) {
    const had = perSession.get(r.sessionId)
    if (!had || r.createdAt >= had.createdAt) perSession.set(r.sessionId, { rating: r.rating, createdAt: r.createdAt })
  }
  return [...perSession.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MASTERY_WINDOW)
    .reduce((sum, r) => sum + r.rating, 0)
}

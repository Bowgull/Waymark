// A start writes a whole workout in one D1 batch (all or nothing), so a crash
// never leaves half a workout. Two starts at once (a double tap) can both find
// no rows and both write one. Each batch's rows sit together in insert (rowid)
// order, and the second copy begins where the first index comes round again:
// keep the first-made workout, delete the later copies. Every start runs this
// after its batch, so whichever finishes last cleans up and both reply with
// the same (first) workout. No unique index needed, so old rows never block it.

import { eq, inArray, sql } from 'drizzle-orm'
import { bagWorkRoundCombos, bagWorkRounds, postureSessionExercises, strengthSessionExercises, strengthSets } from '../db/schema'
import type { createDB } from '../db/client'

type DB = ReturnType<typeof createDB>

/** Rows in insert order; `first` marks a start's first row. The ids from the second start on. */
export function laterStartIds(rows: Array<{ id: string; first: boolean }>): string[] {
  const second = rows.findIndex((r, i) => i > 0 && r.first)
  return second < 0 ? [] : rows.slice(second).map(r => r.id)
}

/** Strength: a start's exercises run orderIndex 0, 1, 2... */
export async function dropLaterStrengthStarts(db: DB, sessionId: string): Promise<void> {
  const rows = await db.select({ id: strengthSessionExercises.id, orderIndex: strengthSessionExercises.orderIndex })
    .from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, sessionId)).orderBy(sql`rowid`)
  const later = laterStartIds(rows.map(r => ({ id: r.id, first: r.orderIndex === 0 })))
  if (later.length === 0) return
  await db.batch([
    db.delete(strengthSets).where(inArray(strengthSets.sessionExerciseId, later)),
    db.delete(strengthSessionExercises).where(inArray(strengthSessionExercises.id, later)),
  ])
}

/** Bag work: a start's rounds run roundNumber 1, 2, 3... */
export async function dropLaterBagStarts(db: DB, sessionId: string): Promise<void> {
  const rows = await db.select({ id: bagWorkRounds.id, roundNumber: bagWorkRounds.roundNumber })
    .from(bagWorkRounds).where(eq(bagWorkRounds.sessionId, sessionId)).orderBy(sql`rowid`)
  const later = laterStartIds(rows.map(r => ({ id: r.id, first: r.roundNumber === 1 })))
  if (later.length === 0) return
  await db.batch([
    db.delete(bagWorkRoundCombos).where(inArray(bagWorkRoundCombos.roundId, later)),
    db.delete(bagWorkRounds).where(inArray(bagWorkRounds.id, later)),
  ])
}

/** Mobility and Zone 2's warm-up: a start's rows run orderIndex 0, 1, 2... */
export async function dropLaterMobilityStarts(db: DB, sessionId: string): Promise<void> {
  const rows = await db.select({ id: postureSessionExercises.id, orderIndex: postureSessionExercises.orderIndex })
    .from(postureSessionExercises).where(eq(postureSessionExercises.sessionId, sessionId)).orderBy(sql`rowid`)
  const later = laterStartIds(rows.map(r => ({ id: r.id, first: r.orderIndex === 0 })))
  if (later.length === 0) return
  await db.delete(postureSessionExercises).where(inArray(postureSessionExercises.id, later))
}

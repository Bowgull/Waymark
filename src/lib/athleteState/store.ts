// Read access to the persisted AthleteState (coaching_outputs, kind='athlete_state').
// Shared by the context assembler (prior-state memory) and the prescription path
// (Phase 3: the verdict actually drives load).
import { desc, eq } from 'drizzle-orm'
import { coachingOutputs } from '../../db/schema'
import type { createDB } from '../../db/client'
import type { AthleteState } from './types'

type DB = ReturnType<typeof createDB>

export async function loadLatestAthleteState(db: DB): Promise<AthleteState | null> {
  const [row] = await db
    .select({ outputJson: coachingOutputs.outputJson })
    .from(coachingOutputs)
    .where(eq(coachingOutputs.kind, 'athlete_state'))
    .orderBy(desc(coachingOutputs.createdAt))
    .limit(1)
  if (!row?.outputJson) return null
  try {
    return JSON.parse(row.outputJson) as AthleteState
  } catch {
    return null
  }
}

// Resolve the effective load nudge for one exercise: the AI verdict wins when the
// latest state assessed this lift; otherwise fall back to the deterministic trend.
export interface EffectiveLift {
  loadFactor: number
  verdict: 'push' | 'hold' | 'deload' | undefined
  source: 'state' | 'trend' | 'none'
}

export function resolveEffectiveLift(
  trend: { loadFactor: number; verdict: 'push' | 'hold' | 'deload' } | undefined,
  stateLift: { loadFactor: number; verdict: 'push' | 'hold' | 'deload' } | undefined,
): EffectiveLift {
  if (stateLift) return { loadFactor: stateLift.loadFactor, verdict: stateLift.verdict, source: 'state' }
  if (trend) return { loadFactor: trend.loadFactor, verdict: trend.verdict, source: 'trend' }
  return { loadFactor: 1, verdict: undefined, source: 'none' }
}

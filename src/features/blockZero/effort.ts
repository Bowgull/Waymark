// Per-set effort (Block Zero Phase C, direction 3): after LOG SET, a centred
// card asks how many reps were left in the tank: 3+ / 2 / 1 / 0. One tap,
// then rest starts. The tap is the set's RIR (PATCH /api/strength-sets/:id
// { rir }, 0-3 where 3 means "3 or more"). Pure.

export interface EffortTile {
  rir: 0 | 1 | 2 | 3
  label: string
  sub: string
}

export const EFFORT_TILES: readonly EffortTile[] = [
  { rir: 3, label: '3+', sub: 'easy' },
  { rir: 2, label: '2', sub: 'solid' },
  { rir: 1, label: '1', sub: 'hard' },
  { rir: 0, label: '0', sub: 'nothing' },
]

/** The RIR a tile label stands for ("3+" -> 3). Null for anything else. */
export function rirFromLabel(label: string): 0 | 1 | 2 | 3 | null {
  const tile = EFFORT_TILES.find(t => t.label === label.trim())
  return tile ? tile.rir : null
}

/** The tile label for a stored RIR (anything 3 or more reads "3+"). */
export function labelForRir(rir: number | null | undefined): string | null {
  if (rir == null || !Number.isFinite(rir) || rir < 0) return null
  return rir >= 3 ? '3+' : String(Math.floor(rir))
}

/** Effort is asked on working sets only; warm-ups and timed holds skip it. */
export function asksEffort(set: { isWarmup: boolean | number; reps: number | null; section?: string | null }): boolean {
  if (set.isWarmup === true || set.isWarmup === 1) return false
  if (set.section === 'warmup' || set.section === 'core') return false
  return true
}

/** The outbox write for the effort tap, keyed so a retry never doubles it. */
export function effortWrite(setId: string, rir: number, sessionId: string | null) {
  return {
    method: 'PATCH' as const,
    path: `/api/strength-sets/${setId}`,
    body: { rir },
    sessionId,
    kind: 'set-effort',
    key: `set-rir-${setId}-${rir}`,
  }
}

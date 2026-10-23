// Coach picks' EVERYTHING ELSE (page 76, Josh 2026-10-23): every run type
// collapses into one line, RUNS ›, that opens its own list (Zone 2 Run,
// Run-Walk, Tempo, Intervals, 5K Test: the ones the server offers for his
// block and week), with ‹ BACK. Pure.

export interface PickLike { type: string; runCategory?: string }

const RUN_ORDER: readonly string[] = ['running:progression', 'running:zone2', 'foundation_run', 'running:tempo', 'running:intervals', 'running:5k_test']

export const isRunPick = (o: PickLike) => o.type === 'running' || o.type === 'foundation_run'

const keyOf = (o: PickLike) => (o.runCategory ? `${o.type}:${o.runCategory}` : o.type)

/** The run types in their own order (any run the server adds that isn't listed goes last). */
export function runPicks<T extends PickLike>(all: readonly T[]): T[] {
  const rank = (o: T) => { const i = RUN_ORDER.indexOf(keyOf(o)); return i < 0 ? RUN_ORDER.length : i }
  return all.filter(isRunPick).sort((a, b) => rank(a) - rank(b))
}

export type EverythingEntry<T> = { kind: 'row'; row: T } | { kind: 'runs'; count: number }

/** EVERYTHING ELSE's lines: the list's own order, the runs as one RUNS line where the first run sat. */
export function everythingEntries<T extends PickLike>(all: readonly T[]): Array<EverythingEntry<T>> {
  const out: Array<EverythingEntry<T>> = []
  const runs = all.filter(isRunPick).length
  let placed = false
  for (const o of all) {
    if (isRunPick(o)) {
      if (!placed && runs > 0) { out.push({ kind: 'runs', count: runs }); placed = true }
      continue
    }
    out.push({ kind: 'row', row: o })
  }
  return out
}

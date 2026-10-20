// Prefetched reads (page 59 §6 item 4). Once Today has settled, the other tabs'
// first reads are fetched in the background; the tab's own read of the same
// path, within TTL_MS, takes that answer instead of asking again. Each answer
// is used once. Any write through apiFetch drops them all, so a tab never opens
// on data older than something this phone just changed. Pure (no fetch here).

export const PREFETCH_TTL_MS = 30_000

interface Entry { at: number; answer: Promise<unknown> }

const entries = new Map<string, Entry>()

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Keep a read in flight (or done) for `path`. A failed read is forgotten. */
export function putPrefetch(path: string, answer: Promise<unknown>, at: number = now()): void {
  entries.set(path, { at, answer })
  answer.catch(() => { if (entries.get(path)?.answer === answer) entries.delete(path) })
}

/** The prefetched answer for `path`, once, while fresh; null otherwise. */
export function takePrefetched<T>(path: string, at: number = now()): Promise<T> | null {
  const e = entries.get(path)
  if (!e) return null
  entries.delete(path)
  return at - e.at <= PREFETCH_TTL_MS ? (e.answer as Promise<T>) : null
}

/** True while a fresh answer for `path` is held (or on its way). */
export function hasPrefetch(path: string, at: number = now()): boolean {
  const e = entries.get(path)
  return !!e && at - e.at <= PREFETCH_TTL_MS
}

/** A write happened: nothing prefetched before it may be shown. */
export function dropPrefetched(): void {
  entries.clear()
}

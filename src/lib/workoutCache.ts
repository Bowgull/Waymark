// The session screen's own copy of what it loaded (e2e major 6). A reload or a
// relaunch mid-session with the API unreachable used to show "No workout data
// found" although the sets were safe in the outbox. Every GET the session
// screen makes is kept per session on this phone; when the network is down
// the screen reads the copy and carries on. Pure over a storage, so it tests
// without a browser.

import type { StorageLike } from './sessionResume'

export const WORKOUT_CACHE_PREFIX = 'waymark_workout_cache_v1:'
export const WORKOUT_CACHE_INDEX = 'waymark_workout_cache_v1_index'
/** Sessions kept (the newest first). */
export const WORKOUT_CACHE_KEEP = 4
/** A copy older than this is not used (a session runs for hours, not days). */
export const WORKOUT_CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000

interface CacheEntry {
  savedAt: number
  parts: Record<string, unknown>
}

function readEntry(storage: StorageLike | null, sessionId: string): CacheEntry | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(WORKOUT_CACHE_PREFIX + sessionId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    return parsed && typeof parsed.savedAt === 'number' && parsed.parts && typeof parsed.parts === 'object' ? parsed : null
  } catch {
    return null
  }
}

function readIndex(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(WORKOUT_CACHE_INDEX)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Keep one part ("session", "workout", "history:<id>") of this session's copy. */
export function writeWorkoutCache(storage: StorageLike | null, sessionId: string, part: string, data: unknown, nowMs: number): void {
  if (!storage) return
  try {
    const entry = readEntry(storage, sessionId) ?? { savedAt: nowMs, parts: {} }
    entry.parts[part] = data
    entry.savedAt = nowMs
    storage.setItem(WORKOUT_CACHE_PREFIX + sessionId, JSON.stringify(entry))
    const index = [sessionId, ...readIndex(storage).filter(id => id !== sessionId)]
    for (const old of index.slice(WORKOUT_CACHE_KEEP)) storage.removeItem(WORKOUT_CACHE_PREFIX + old)
    storage.setItem(WORKOUT_CACHE_INDEX, JSON.stringify(index.slice(0, WORKOUT_CACHE_KEEP)))
  } catch {
    // storage full or blocked: the screen still works online
  }
}

/** The kept part, or null (none, or too old). */
export function readWorkoutCache<T>(storage: StorageLike | null, sessionId: string, part: string, nowMs: number): T | null {
  const entry = readEntry(storage, sessionId)
  if (!entry || nowMs - entry.savedAt > WORKOUT_CACHE_MAX_AGE_MS) return null
  return part in entry.parts ? (entry.parts[part] as T) : null
}

export function clearWorkoutCache(storage: StorageLike | null, sessionId: string): void {
  if (!storage) return
  try {
    storage.removeItem(WORKOUT_CACHE_PREFIX + sessionId)
  } catch {
    // nothing kept
  }
}

/**
 * Load a part: online, fetch it and keep the copy; when `isOffline(err)` says the
 * failure is the network, read the copy instead. Anything else is thrown.
 */
export async function loadWithCopy<T>(
  storage: StorageLike | null,
  sessionId: string,
  part: string,
  load: () => Promise<T>,
  isOffline: (err: unknown) => boolean,
  nowMs: () => number = Date.now,
): Promise<{ data: T; fromCopy: boolean }> {
  try {
    const data = await load()
    writeWorkoutCache(storage, sessionId, part, data, nowMs())
    return { data, fromCopy: false }
  } catch (err) {
    if (isOffline(err)) {
      const copy = readWorkoutCache<T>(storage, sessionId, part, nowMs())
      if (copy != null) return { data: copy, fromCopy: true }
    }
    throw err
  }
}

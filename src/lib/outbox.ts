// Client outbox for writes that must not be lost (first slice of offline
// logging): set saves and session finishes. A write is queued first, then
// sent. It leaves the queue only when the server answers 2xx (or a replay of
// the same Idempotency-Key). Network errors, timeouts, 5xx, 408, 429 and the
// "already in flight" 409 stay queued and retry with backoff; any other 4xx
// moves to a dead-letter list the Logs screen can show. Writes for one
// session go out in order, so a finish never overtakes its sets.
//
// Persisted in localStorage. Every read and write is wrapped: private mode,
// a full disk or an evicted store leaves an in-memory queue for this run.

export const OUTBOX_STORAGE_KEY = 'waymark_outbox_v1'
export const OUTBOX_DEAD_KEY = 'waymark_outbox_dead_v1'
const BACKOFF_MS = [1_000, 5_000, 30_000, 60_000]
const MAX_DEAD = 50

export interface OutboxEntry {
  /** Doubles as the Idempotency-Key, stable across retries. */
  id: string
  method: 'POST' | 'PATCH' | 'PUT'
  path: string
  body: string
  /** Orders writes per session; null for writes outside a session. */
  sessionId: string | null
  /** Short label for logs and the status line ("set", "finish"). */
  kind: string
  createdAtMs: number
  attempts: number
  nextAttemptAtMs: number
  lastError?: string
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; retry: boolean; error: string }

export interface FlushSummary {
  sent: number
  pending: number
  dead: number
}

let memoryQueue: OutboxEntry[] | null = null

export function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1)]
}

/** Status codes worth retrying: the request may not have landed, or will later. */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function parseQueue(raw: string | null): OutboxEntry[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter((e): e is OutboxEntry =>
      e != null && typeof e === 'object' && typeof (e as OutboxEntry).id === 'string' && typeof (e as OutboxEntry).path === 'string')
  } catch {
    return []
  }
}

export function loadOutbox(storage: StorageLike | null): OutboxEntry[] {
  if (storage) {
    try {
      const fromStorage = parseQueue(storage.getItem(OUTBOX_STORAGE_KEY))
      memoryQueue = fromStorage
      return fromStorage.map(e => ({ ...e }))
    } catch {
      // fall through to memory
    }
  }
  return (memoryQueue ?? []).map(e => ({ ...e }))
}

export function saveOutbox(storage: StorageLike | null, queue: OutboxEntry[]): void {
  memoryQueue = queue.map(e => ({ ...e }))
  if (!storage) return
  try {
    storage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Storage full or blocked: the in-memory copy still retries this run.
  }
}

function pushDead(storage: StorageLike | null, entry: OutboxEntry): void {
  if (!storage) return
  try {
    const dead = parseQueue(storage.getItem(OUTBOX_DEAD_KEY))
    dead.push(entry)
    storage.setItem(OUTBOX_DEAD_KEY, JSON.stringify(dead.slice(-MAX_DEAD)))
  } catch {
    // Dead letters are best effort.
  }
}

export function loadDeadLetters(storage: StorageLike | null): OutboxEntry[] {
  if (!storage) return []
  try {
    return parseQueue(storage.getItem(OUTBOX_DEAD_KEY))
  } catch {
    return []
  }
}

/** Add a write. Re-adding the same id (a retry of the same logical write) keeps one copy. */
export function enqueue(queue: OutboxEntry[], entry: Omit<OutboxEntry, 'attempts' | 'nextAttemptAtMs' | 'createdAtMs'> & { createdAtMs?: number }, nowMs: number): OutboxEntry[] {
  if (queue.some(e => e.id === entry.id)) return queue
  return [...queue, { ...entry, createdAtMs: entry.createdAtMs ?? nowMs, attempts: 0, nextAttemptAtMs: nowMs }]
}

export function pendingFor(queue: OutboxEntry[], sessionId: string): OutboxEntry[] {
  return queue.filter(e => e.sessionId === sessionId)
}

/** Earliest time a queued write is due, or null when empty. */
export function nextDueAt(queue: OutboxEntry[]): number | null {
  if (queue.length === 0) return null
  return Math.min(...queue.map(e => e.nextAttemptAtMs))
}

/**
 * Send what is due, in queue order. A write that fails and stays queued
 * blocks later writes for the same session in this pass (order holds);
 * writes for other sessions still go. `force` ignores the backoff clock
 * (the app came online, came back to the foreground, or is finishing).
 */
export async function flushQueue(
  queue: OutboxEntry[],
  send: (entry: OutboxEntry) => Promise<SendOutcome>,
  nowMs: number,
  opts: { force?: boolean; onlySessionId?: string } = {},
): Promise<{ queue: OutboxEntry[]; dead: OutboxEntry[]; summary: FlushSummary }> {
  const remaining: OutboxEntry[] = []
  const dead: OutboxEntry[] = []
  const blocked = new Set<string>()
  let sent = 0
  for (const entry of queue) {
    const group = entry.sessionId ?? `solo:${entry.id}`
    const due = opts.force || entry.nextAttemptAtMs <= nowMs
    const inScope = opts.onlySessionId == null || entry.sessionId === opts.onlySessionId
    if (!inScope || !due || blocked.has(group)) {
      remaining.push(entry)
      if (inScope) blocked.add(group)
      continue
    }
    let outcome: SendOutcome
    try {
      outcome = await send(entry)
    } catch (err) {
      outcome = { ok: false, retry: true, error: err instanceof Error ? err.message : String(err) }
    }
    if (outcome.ok) {
      sent++
      continue
    }
    if (!outcome.retry) {
      dead.push({ ...entry, lastError: outcome.error })
      continue
    }
    const attempts = entry.attempts + 1
    remaining.push({ ...entry, attempts, nextAttemptAtMs: nowMs + backoffMs(attempts), lastError: outcome.error })
    blocked.add(group)
  }
  return { queue: remaining, dead, summary: { sent, pending: remaining.length, dead: dead.length } }
}

/** Load, flush and save in one go. */
export async function flushStoredOutbox(
  storage: StorageLike | null,
  send: (entry: OutboxEntry) => Promise<SendOutcome>,
  nowMs: number,
  opts: { force?: boolean; onlySessionId?: string } = {},
): Promise<FlushSummary> {
  const queue = loadOutbox(storage)
  if (queue.length === 0) return { sent: 0, pending: 0, dead: 0 }
  const { queue: remaining, dead, summary } = await flushQueue(queue, send, nowMs, opts)
  // Writes queued while this flush ran (another tap) must survive the save,
  // and writes dropped while it ran (DISCARD) must stay dropped.
  const latest = loadOutbox(storage)
  const latestIds = new Set(latest.map(e => e.id))
  const kept = remaining.filter(e => latestIds.has(e.id))
  const handled = new Set(queue.map(e => e.id))
  const added = latest.filter(e => !handled.has(e.id))
  saveOutbox(storage, [...kept, ...added])
  for (const d of dead) pushDead(storage, d)
  return { ...summary, pending: kept.length + added.length }
}

/** Test hook: forget the in-memory fallback. */
export function resetOutboxMemory(): void {
  memoryQueue = null
}

// Browser glue for the outbox (lib/outbox): localStorage, apiFetch with the
// entry's Idempotency-Key, and the retry triggers (back online, app back in
// the foreground, a backoff timer, and an explicit flush before finishing).

import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { ApiError, apiFetch, idempotencyHeaders, newIdempotencyKey } from './api'
import { localIsoOf, TODAY_HEADER } from './dates'
import { logger } from './logger'
import { enqueue, flushStoredOutbox, isRetryableStatus, loadDeadLetters, loadOutbox, nextDueAt, pendingFor, saveOutbox, type FlushSummary, type OutboxEntry, type SendOutcome, type StorageLike } from './outbox'

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

async function send(entry: OutboxEntry): Promise<SendOutcome> {
  try {
    // A queued write keeps the local day it was made on, however late it lands.
    await apiFetch(entry.path, { method: entry.method, body: entry.body, headers: { ...idempotencyHeaders(entry.id), [TODAY_HEADER]: localIsoOf(entry.createdAtMs) } })
    return { ok: true }
  } catch (err) {
    if (err instanceof ApiError) {
      // 409 is only worth retrying when the server says the same write is still in flight.
      const retry = err.status === 409 ? err.body.includes('idempotency_in_flight') : isRetryableStatus(err.status)
      return { ok: false, retry, error: `${err.status || 'network'} ${err.body.slice(0, 120)}`.trim() }
    }
    return { ok: false, retry: true, error: err instanceof Error ? err.message : String(err) }
  }
}

let flushing: Promise<FlushSummary> | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(pending: number) => void>()

function notify() {
  const pending = loadOutbox(storage()).length
  for (const l of listeners) l(pending)
}

function scheduleNext() {
  if (timer) clearTimeout(timer)
  timer = null
  const due = nextDueAt(loadOutbox(storage()))
  if (due == null) return
  timer = setTimeout(() => { void flushOutbox() }, Math.max(500, due - Date.now()))
}

/** Send what's due (or everything, with force). One flush at a time. */
export function flushOutbox(opts: { force?: boolean; onlySessionId?: string } = {}): Promise<FlushSummary> {
  if (flushing) return flushing.then(() => flushOutbox(opts))
  flushing = flushStoredOutbox(storage(), send, Date.now(), opts)
    .then(summary => {
      if (summary.dead > 0) logger.error('session', 'outbox write rejected', { dead: summary.dead }, 'A queued write was refused by the server and moved to dead letters.')
      return summary
    })
    .finally(() => {
      flushing = null
      notify()
      scheduleNext()
    })
  return flushing
}

export type QueueResult = 'sent' | 'queued' | 'rejected'

/**
 * Queue a write and try to send it now (forced: the athlete just acted).
 * 'sent' = the server has it; 'queued' = kept on this phone, retrying;
 * 'rejected' = the server refused it (moved to dead letters).
 */
export async function queueWrite(write: { method: OutboxEntry['method']; path: string; body: unknown; sessionId: string | null; kind: string; key?: string }): Promise<QueueResult> {
  const id = write.key ?? newIdempotencyKey()
  const s = storage()
  saveOutbox(s, enqueue(loadOutbox(s), { id, method: write.method, path: write.path, body: JSON.stringify(write.body), sessionId: write.sessionId, kind: write.kind }, Date.now()))
  notify()
  await flushOutbox({ force: true, onlySessionId: write.sessionId ?? undefined })
  if (loadOutbox(storage()).some(e => e.id === id)) return 'queued'
  return loadDeadLetters(storage()).some(e => e.id === id) ? 'rejected' : 'sent'
}

export function pendingWrites(sessionId?: string): number {
  const q = loadOutbox(storage())
  return sessionId ? pendingFor(q, sessionId).length : q.length
}

export function onOutboxChange(listener: (pending: number) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

let started = false

/** Retry on reconnect, on return to the foreground, and on app resume. Call once at app start. */
export function startOutboxSync(): () => void {
  if (started) return () => {}
  started = true
  const onOnline = () => { void flushOutbox({ force: true }) }
  const onVisible = () => { if (document.visibilityState === 'visible') void flushOutbox({ force: true }) }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  let removeNative: (() => void) | null = null
  if (Capacitor.isNativePlatform()) {
    void CapacitorApp.addListener('resume', () => { void flushOutbox({ force: true }) })
      .then(h => { removeNative = () => { void h.remove() } })
      .catch(() => {})
  }
  void flushOutbox({ force: true })
  return () => {
    started = false
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    removeNative?.()
    if (timer) clearTimeout(timer)
  }
}

/**
 * DISCARD (page 74): the session's queued writes (set logs, a recorded run)
 * leave the outbox unsent, so nothing of it reaches the coach later.
 */
export function dropSessionWrites(sessionId: string): number {
  const s = storage()
  const q = loadOutbox(s)
  const kept = q.filter(e => e.sessionId !== sessionId)
  if (kept.length !== q.length) { saveOutbox(s, kept); notify(); scheduleNext() }
  return q.length - kept.length
}

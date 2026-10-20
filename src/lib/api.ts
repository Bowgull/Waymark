import { getApiBaseUrl } from './apiBase'
import { getTodayISO, TODAY_HEADER } from './dates'
import { logger } from './logger'
import { maxAttemptsFor } from './retryPolicy'
import { dropPrefetched, putPrefetch, takePrefetched } from './prefetchCache'

const API_KEY = import.meta.env.VITE_API_KEY as string | undefined

export class ApiError extends Error {
  status: number
  body: string
  type: 'network' | 'server' | 'client'

  constructor(status: number, body: string, type: 'network' | 'server' | 'client') {
    super(type === 'network' ? 'Network error -- check your connection' : body || `Request failed (${status})`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.type = type
  }
}

const TIMEOUT_MS = 10_000
const RETRY_DELAY_MS = 1_000
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504])
export { IDEMPOTENCY_HEADER, idempotencyHeaders, newIdempotencyKey } from './retryPolicy'

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Per-call timeout. Defaults to 10 s; the AI calls that think need longer. */
  timeoutMs?: number
  /**
   * A background read for a tab not open yet (page 59 §6 item 4): kept, and
   * handed to that tab's own read of the same path (prefetchCache.ts).
   */
  prefetch?: boolean
}

export async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase()
  if (method !== 'GET') dropPrefetched()
  else if (options?.prefetch) {
    const answer = requestApi<T>(path, options)
    putPrefetch(path, answer)
    return answer
  } else {
    const ready = takePrefetched<T>(path)
    if (ready) return ready.catch(() => requestApi<T>(path, options))
  }
  return requestApi<T>(path, options)
}

async function requestApi<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`
  const method = (options?.method ?? 'GET').toUpperCase()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { timeoutMs = TIMEOUT_MS, prefetch: _prefetch, ...requestOptions } = options ?? {}
  const init: RequestInit = {
    ...requestOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      // The phone's local date: the server's "today" is his day, never the UTC day (coach-brain P0).
      [TODAY_HEADER]: getTodayISO(),
      ...options?.headers,
    },
  }

  // Don't self-log the logger endpoint or we'd loop.
  const shouldLog = !path.startsWith('/api/logs')
  // Only retry what is safe to send twice: reads, and writes carrying an
  // Idempotency-Key (the server applies those once). A plain POST that timed
  // out may have landed; sending it again could finish a session twice.
  const maxAttempts = maxAttemptsFor(method, options?.headers)
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs)

      if (res.ok) {
        let parsed: T
        try {
          parsed = (await res.json()) as T
        } catch (parseErr) {
          const text = await res.clone().text().catch(() => '')
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
          if (shouldLog) {
            const dur = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
            logger.apiCall({
              url: path,
              method,
              status: res.status,
              durationMs: Math.round(dur),
              ok: false,
              error: `JSON parse: ${msg}. body[0..200]: ${text.slice(0, 200)}`,
            })
          }
          throw new ApiError(res.status, `Invalid JSON response: ${msg}`, 'server')
        }
        if (shouldLog) {
          const dur = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
          logger.apiCall({ url: path, method, status: res.status, durationMs: Math.round(dur), ok: true })
        }
        return parsed
      }

      const body = await res.text().catch(() => '')
      const type = res.status >= 500 ? 'server' : 'client'

      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts - 1) {
        lastError = new ApiError(res.status, body, type)
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }

      const err = new ApiError(res.status, body, type)
      if (shouldLog) {
        const dur = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
        logger.apiCall({ url: path, method, status: res.status, durationMs: Math.round(dur), ok: false, error: body.slice(0, 500) })
      }
      throw err
    } catch (err) {
      if (err instanceof ApiError) throw err

      if (attempt < maxAttempts - 1) {
        lastError = err
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }

      if (shouldLog) {
        const dur = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
        const message = err instanceof Error ? err.message : String(err)
        logger.apiCall({ url: path, method, status: 0, durationMs: Math.round(dur), ok: false, error: message })
      }
      throw new ApiError(0, '', 'network')
    }
  }

  throw lastError instanceof ApiError ? lastError : new ApiError(0, '', 'network')
}

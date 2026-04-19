import { getApiBaseUrl } from './apiBase'
import { logger } from './logger'

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

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`
  const method = (options?.method ?? 'GET').toUpperCase()
  const init: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  }

  // Don't self-log the logger endpoint or we'd loop.
  const shouldLog = !path.startsWith('/api/logs')
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, TIMEOUT_MS)

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

      if (RETRYABLE_STATUSES.has(res.status) && attempt === 0) {
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

      if (attempt === 0) {
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

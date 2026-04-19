/**
 * In-app diagnostic logger.
 *
 * - Buffers events in memory + localStorage fallback
 * - Batches flushes to POST /api/logs every 10s or on error
 * - Direct fetch (NOT apiFetch) so it can't recurse on API failures
 * - Long-press the Waymark logo in Settings to open the viewer
 */
import { getApiBaseUrl } from './apiBase'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'api' | 'session' | 'nav' | 'error' | 'system'

export interface LogEntry {
  id: string
  ts: number // epoch ms
  level: LogLevel
  category: LogCategory
  message: string
  context?: Record<string, unknown>
  screen?: string
  sessionId?: string
}

const STORAGE_KEY = 'waymark.logs.pending'
const MAX_BUFFER = 500
const FLUSH_INTERVAL_MS = 10_000
const FLUSH_BATCH_MAX = 50

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // quota exceeded or privacy mode — drop silently
  }
}

function genId(): string {
  return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function currentScreen(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return window.location.pathname
}

class Logger {
  private buffer: LogEntry[] = []
  private sessionId: string | undefined
  private flushing = false

  constructor() {
    // Rehydrate any entries that didn't flush last session
    const persisted = safeGetItem(STORAGE_KEY)
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted) as LogEntry[]
        if (Array.isArray(parsed)) this.buffer = parsed.slice(-MAX_BUFFER)
      } catch {
        // corrupt — drop
      }
    }
    if (typeof window !== 'undefined') {
      setInterval(() => this.flush().catch(() => {}), FLUSH_INTERVAL_MS)
      window.addEventListener('online', () => this.flush().catch(() => {}))
      window.addEventListener('beforeunload', () => this.persist())
    }
  }

  setSessionId(id: string | undefined) {
    this.sessionId = id
  }

  private push(entry: LogEntry) {
    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER)
    }
    this.persist()
    if (entry.level === 'error') {
      // Fire-and-forget; don't await
      this.flush().catch(() => {})
    }
  }

  private persist() {
    safeSetItem(STORAGE_KEY, JSON.stringify(this.buffer))
  }

  private make(level: LogLevel, category: LogCategory, message: string, context?: Record<string, unknown>): LogEntry {
    return {
      id: genId(),
      ts: Date.now(),
      level,
      category,
      message,
      context,
      screen: currentScreen(),
      sessionId: this.sessionId,
    }
  }

  debug(category: LogCategory, message: string, context?: Record<string, unknown>) {
    this.push(this.make('debug', category, message, context))
  }
  info(category: LogCategory, message: string, context?: Record<string, unknown>) {
    this.push(this.make('info', category, message, context))
  }
  warn(category: LogCategory, message: string, context?: Record<string, unknown>) {
    this.push(this.make('warn', category, message, context))
  }
  error(category: LogCategory, message: string, context?: Record<string, unknown>) {
    this.push(this.make('error', category, message, context))
  }

  // Convenience — semantic helpers so callers don't pick categories inconsistently
  apiCall(info: { url: string; method: string; status: number; durationMs: number; ok: boolean; error?: string }) {
    this.push(this.make(
      info.ok ? 'info' : 'error',
      'api',
      `${info.method} ${info.url} -> ${info.status}`,
      info,
    ))
  }
  sessionEvent(event: string, context?: Record<string, unknown>) {
    this.push(this.make('info', 'session', event, context))
  }
  navigation(from: string, to: string) {
    this.push(this.make('debug', 'nav', `${from} -> ${to}`, { from, to }))
  }

  async flush(): Promise<void> {
    if (this.flushing) return
    if (this.buffer.length === 0) return
    if (typeof window === 'undefined') return

    this.flushing = true
    try {
      // Take a snapshot so late pushes during send don't get dropped on success
      const batch = this.buffer.slice(0, FLUSH_BATCH_MAX)
      const url = `${getApiBaseUrl()}/api/logs`
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: batch }),
          signal: ctrl.signal,
        })
        if (res.ok) {
          this.buffer.splice(0, batch.length)
          this.persist()
        }
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // stays in buffer, retries next tick
    } finally {
      this.flushing = false
    }
  }

  // For the viewer when the server is unreachable — peek at the local buffer
  snapshot(): LogEntry[] {
    return [...this.buffer]
  }
}

export const logger = new Logger()

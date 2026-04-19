import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { logger, type LogEntry, type LogLevel } from '@/lib/logger'
import { useToast } from '@/components/ui/Toast'

interface ServerLogRow {
  id: string
  ts: number
  level: string
  category: string
  message: string
  contextJson: string | null
  screen: string | null
  sessionId: string | null
  createdAt: number
}

type Filter = 'all' | LogLevel | 'session'

const LEVEL_COLOR: Record<string, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-gold',
  error: 'text-destructive',
}

const LEVEL_DOT: Record<string, string> = {
  debug: 'bg-muted-foreground/50',
  info: 'bg-teal',
  warn: 'bg-gold',
  error: 'bg-destructive',
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function LogsPage() {
  const navigate = useNavigate()
  const { show: showToast, ToastContainer } = useToast()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [currentSessionOnly, setCurrentSessionOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await logger.flush()
      const data = await apiFetch<{ entries: ServerLogRow[] }>('/api/logs?limit=1000')
      const normalized: LogEntry[] = data.entries.map(r => ({
        id: r.id,
        ts: r.ts,
        level: (r.level as LogLevel) ?? 'info',
        category: (r.category as LogEntry['category']) ?? 'system',
        message: r.message,
        context: r.contextJson ? tryParse(r.contextJson) : undefined,
        screen: r.screen ?? undefined,
        sessionId: r.sessionId ?? undefined,
      }))
      setEntries(normalized)
    } catch {
      // Server unreachable — fall back to local buffer
      setEntries(logger.snapshot().slice().reverse())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    let rows = entries
    if (filter !== 'all' && filter !== 'session') {
      rows = rows.filter(e => e.level === filter)
    }
    if (currentSessionOnly) {
      const sid = sessionIdFromUrl() ?? mostRecentSessionId(entries)
      if (sid) rows = rows.filter(e => e.sessionId === sid)
    }
    return rows
  }, [entries, filter, currentSessionOnly])

  async function handleCopy() {
    const text = filtered.map(e => formatLine(e)).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied to clipboard', 'success')
    } catch {
      showToast('Copy failed', 'warning')
    }
  }

  async function handleClear() {
    if (!confirm('Clear all logs? This cannot be undone.')) return
    try {
      await apiFetch('/api/logs', { method: 'DELETE' })
      setEntries([])
      showToast('Logs cleared', 'info')
    } catch {
      showToast('Clear failed', 'warning')
    }
  }

  const counts = useMemo(() => countByLevel(entries), [entries])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        className="sticky top-0 z-30 border-b border-border bg-background/90 px-4 pb-3 backdrop-blur-md"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            className="min-h-[44px] rounded-md px-2 text-sm text-muted-foreground active:text-foreground"
          >
            ← Back
          </button>
          <h1 className="text-display-sm text-foreground">
            <span className="text-gold">L</span>ogs
          </h1>
          <button
            onClick={load}
            className="min-h-[44px] rounded-md px-2 text-sm text-muted-foreground active:text-foreground"
          >
            Refresh
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label={`All ${entries.length}`} />
          <FilterPill active={filter === 'error'} onClick={() => setFilter('error')} label={`Errors ${counts.error}`} accent="text-destructive" />
          <FilterPill active={filter === 'warn'} onClick={() => setFilter('warn')} label={`Warn ${counts.warn}`} accent="text-gold" />
          <FilterPill active={filter === 'info'} onClick={() => setFilter('info')} label={`Info ${counts.info}`} />
          <FilterPill active={filter === 'debug'} onClick={() => setFilter('debug')} label={`Debug ${counts.debug}`} accent="text-muted-foreground" />
          <FilterPill active={currentSessionOnly} onClick={() => setCurrentSessionOnly(v => !v)} label="This session" />
        </div>
      </header>

      <div className="flex flex-1 flex-col px-2 pb-20">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No logs match this filter.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {filtered.map(entry => (
              <li key={entry.id}>
                <button
                  onClick={() => setExpandedId(prev => prev === entry.id ? null : entry.id)}
                  className="w-full px-2 py-2 text-left active:bg-border/30"
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[entry.level]}`} />
                    <span className="font-mono text-[10px] text-muted-foreground">{formatTime(entry.ts)}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{entry.category}</span>
                    <span className={`flex-1 truncate text-xs ${LEVEL_COLOR[entry.level]}`}>{entry.message}</span>
                  </div>
                  {expandedId === entry.id && (
                    <div className="mt-1.5 space-y-1 pl-4 font-mono text-[10px] text-muted-foreground">
                      <div>{formatDate(entry.ts)} {formatTime(entry.ts)}</div>
                      {entry.screen && <div>screen: {entry.screen}</div>}
                      {entry.sessionId && <div>session: {entry.sessionId}</div>}
                      {entry.context && (
                        <pre className="max-h-64 overflow-auto rounded bg-border/40 p-2 text-foreground whitespace-pre-wrap break-words">
                          {JSON.stringify(entry.context, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="sticky bottom-0 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-md" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="min-h-[44px] flex-1 rounded-md border border-border bg-border/30 text-sm text-foreground active:bg-border/60"
          >
            Copy to clipboard
          </button>
          <button
            onClick={handleClear}
            className="min-h-[44px] rounded-md border border-border px-4 text-sm text-muted-foreground active:text-foreground"
          >
            Clear
          </button>
        </div>
      </footer>

      <ToastContainer />
    </div>
  )
}

function FilterPill({ active, onClick, label, accent }: { active: boolean; onClick: () => void; label: string; accent?: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 ${active
        ? 'border-gold/50 bg-gold/10 text-gold'
        : `border-border bg-border/20 ${accent ?? 'text-foreground'} active:bg-border/50`
      }`}
    >
      {label}
    </button>
  )
}

function tryParse(s: string): Record<string, unknown> | undefined {
  try { return JSON.parse(s) as Record<string, unknown> } catch { return undefined }
}

function sessionIdFromUrl(): string | undefined {
  const m = window.location.pathname.match(/\/session\/([^/]+)/)
  return m?.[1]
}

function mostRecentSessionId(entries: LogEntry[]): string | undefined {
  for (const e of entries) if (e.sessionId) return e.sessionId
  return undefined
}

function countByLevel(entries: LogEntry[]) {
  const c = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const e of entries) c[e.level] += 1
  return c
}

function formatLine(e: LogEntry): string {
  const ctx = e.context ? ' ' + JSON.stringify(e.context) : ''
  return `${formatDate(e.ts)} ${formatTime(e.ts)} ${e.level.toUpperCase().padEnd(5)} [${e.category}] ${e.screen ?? '-'} ${e.sessionId ? `(s:${e.sessionId}) ` : ''}${e.message}${ctx}`
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, FlapButton, FlapLabel } from '@/design'
import { apiFetch } from '@/lib/api'
import { logger, type LogEntry, type LogLevel } from '@/lib/logger'
import { useToast } from '@/components/ui/Toast'
import { SettingsScreen } from './settingsParts'
import { agoText, clockText, countLevels, filterFlaps, type LogFilter } from './settingsModel'

interface ServerLogRow {
  id: string
  ts: number
  level: string
  category: string
  message: string
  userMessage: string | null
  contextJson: string | null
  screen: string | null
  sessionId: string | null
  createdAt: number
}

function formatStamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** The technical detail under a row: the raw message, when, where, the context. */
function detail(e: LogEntry): string {
  const lines: string[] = []
  if (e.userMessage && e.userMessage !== e.message) lines.push(e.message)
  lines.push(formatStamp(e.ts))
  if (e.screen) lines.push(`screen: ${e.screen}`)
  if (e.sessionId) lines.push(`session: ${e.sessionId}`)
  if (e.context) lines.push(JSON.stringify(e.context, null, 2))
  return lines.join('\n')
}

/**
 * Logs, page 37 "Logs (hidden)" (approved; hold the crest on Settings or
 * Today): filter flaps with counts, Recent problems in plain words, then
 * everything. Tap a row for the technical detail.
 */
export function LogsPage() {
  const navigate = useNavigate()
  const { show: showToast } = useToast()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await logger.flush()
      const data = await apiFetch<{ entries: ServerLogRow[] }>('/api/logs?limit=1000')
      setEntries(data.entries.map(r => ({
        id: r.id,
        ts: r.ts,
        level: (r.level as LogLevel) ?? 'info',
        category: (r.category as LogEntry['category']) ?? 'system',
        message: r.message,
        userMessage: r.userMessage ?? undefined,
        context: r.contextJson ? tryParse(r.contextJson) : undefined,
        screen: r.screen ?? undefined,
        sessionId: r.sessionId ?? undefined,
      })))
    } catch {
      // Server unreachable: the phone's own buffer
      setEntries(logger.snapshot().slice().reverse())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => countLevels(entries.map(e => e.level)), [entries])
  const filtered = useMemo(() => {
    if (filter === 'all') return entries
    if (filter === 'session') {
      const sid = sessionIdFromUrl() ?? mostRecentSessionId(entries)
      return sid ? entries.filter(e => e.sessionId === sid) : entries
    }
    return entries.filter(e => e.level === filter)
  }, [entries, filter])
  const problems = useMemo(() => entries.filter(e => e.level === 'error' || e.level === 'warn').slice(0, 3), [entries])

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

  const now = Date.now()

  return (
    <SettingsScreen title="LOGS" onBack={() => navigate(-1)} onHold={() => navigate('/dev/recorder')} holdLabel="the recorder test">
      <Board solid className="st-board">
        <div className="st-pills" role="radiogroup" aria-label="Filter">
          {filterFlaps(entries.length, counts).map(f => {
            const on = f.key === filter
            return (
              <button key={f.key} type="button" role="radio" aria-checked={on} aria-label={f.text.toLowerCase()} className={`st-pill${on ? ' is-on' : ''}`} onClick={() => setFilter(f.key)}>
                <FlapLabel text={f.text} size="xs" tone={on ? 'gold' : 'ink'} />
              </button>
            )
          })}
        </div>
      </Board>

      {!loading && problems.length > 0 && (
        <Board head="Recent problems" headRight={<button type="button" className="st-headbtn wm-label" onClick={() => void load()}>Refresh</button>} solid className="st-board">
          {problems.map(e => (
            <LogRow key={`rp-${e.id}`} entry={e} time={`${agoText(e.ts, now)} · ${e.category}`} open={open.has(`rp-${e.id}`)} onToggle={() => toggle(`rp-${e.id}`)} />
          ))}
        </Board>
      )}

      <Board head="All" headRight={problems.length === 0 ? <button type="button" className="st-headbtn wm-label" onClick={() => void load()}>Refresh</button> : undefined} solid className="st-board">
        {loading ? (
          <p className="st-empty">Loading.</p>
        ) : filtered.length === 0 ? (
          <p className="st-empty">No logs match this filter.</p>
        ) : filtered.map(e => (
          <LogRow key={e.id} entry={e} time={`${clockText(e.ts)} · ${e.category.toUpperCase()}`} open={open.has(e.id)} onToggle={() => toggle(e.id)} />
        ))}
      </Board>

      {/* Not on page 37 (owner to place): clearing the logs, kept. */}
      <FlapButton label="CLEAR" size="xs" onClick={() => void handleClear()} />
    </SettingsScreen>
  )
}

function LogRow({ entry, time, open, onToggle }: { entry: LogEntry; time: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="st-lrow" aria-expanded={open} onClick={onToggle}>
      <span className={`st-lv is-${entry.level}`} aria-hidden />
      <span className="st-lt">
        <span className={`m is-${entry.level}`}>{entry.userMessage ?? entry.message}</span>
        <span className="t">{time}</span>
        {open && <span className="x">{detail(entry)}</span>}
      </span>
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

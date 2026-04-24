// In-app diagnostic log sink.
// Client logger batches POSTs here; the viewer reads GET /api/logs.
// Auto-prune keeps the table bounded: last 7 days or 5000 rows, whichever is smaller.

import { Hono } from 'hono'
import { and, desc, eq, gte, lt } from 'drizzle-orm'

import { createDB } from '../../db/client'
import { appLogs } from '../../db/schema'

type Bindings = { DB: D1Database }

const PRUNE_SECONDS = 7 * 24 * 60 * 60 // 7 days in seconds (ts is epoch ms but we compare against ms)
const PRUNE_MS = PRUNE_SECONDS * 1000
const MAX_ROWS = 5000
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error'])
const VALID_CATEGORIES = new Set(['api', 'session', 'nav', 'error', 'system'])

export const logs = new Hono<{ Bindings: Bindings }>()

interface IncomingEntry {
  id?: string
  ts?: number
  level?: string
  category?: string
  message?: string
  userMessage?: string
  context?: unknown
  screen?: string
  sessionId?: string
}

function genId(): string {
  return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

logs.post('/', async (c) => {
  const body = await c.req.json<{ entries?: IncomingEntry[] }>().catch(() => ({ entries: [] }))
  const entries = Array.isArray(body.entries) ? body.entries : []
  if (entries.length === 0) return c.json({ written: 0 })

  const db = createDB(c.env)
  const now = Date.now()
  const nowSec = Math.floor(now / 1000)

  const rows = entries
    .filter(e => typeof e.message === 'string' && e.message.length > 0)
    .map(e => ({
      id: typeof e.id === 'string' && e.id.length > 0 ? e.id : genId(),
      ts: typeof e.ts === 'number' && Number.isFinite(e.ts) ? e.ts : now,
      level: VALID_LEVELS.has(String(e.level)) ? String(e.level) : 'info',
      category: VALID_CATEGORIES.has(String(e.category)) ? String(e.category) : 'system',
      message: String(e.message).slice(0, 2000),
      userMessage: typeof e.userMessage === 'string' ? e.userMessage.slice(0, 500) : null,
      contextJson: e.context != null ? JSON.stringify(e.context).slice(0, 8000) : null,
      screen: typeof e.screen === 'string' ? e.screen.slice(0, 200) : null,
      sessionId: typeof e.sessionId === 'string' ? e.sessionId.slice(0, 200) : null,
      createdAt: nowSec,
    }))

  // D1 caps bind params at 100 per statement. With 10 columns, 9 rows/chunk stays safe.
  const CHUNK = 9
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(appLogs).values(rows.slice(i, i + CHUNK))
  }

  // Opportunistic prune: only run ~5% of the time to avoid hot path cost
  if (Math.random() < 0.05) {
    await db.delete(appLogs).where(lt(appLogs.ts, now - PRUNE_MS))
    await c.env.DB.prepare(
      'DELETE FROM app_logs WHERE id NOT IN (SELECT id FROM app_logs ORDER BY ts DESC LIMIT ?)',
    ).bind(MAX_ROWS).run()
  }

  return c.json({ written: rows.length })
})

logs.get('/', async (c) => {
  const level = c.req.query('level')
  const sessionId = c.req.query('sessionId')
  const sinceParam = c.req.query('since')
  const limitParam = c.req.query('limit')
  const limit = Math.min(Math.max(parseInt(limitParam ?? '500', 10) || 500, 1), 5000)

  const db = createDB(c.env)
  const conditions = []
  if (level && VALID_LEVELS.has(level)) conditions.push(eq(appLogs.level, level))
  if (sessionId) conditions.push(eq(appLogs.sessionId, sessionId))
  if (sinceParam) {
    const since = parseInt(sinceParam, 10)
    if (Number.isFinite(since)) conditions.push(gte(appLogs.ts, since))
  }

  const rows = conditions.length > 0
    ? await db.select().from(appLogs).where(and(...conditions)).orderBy(desc(appLogs.ts)).limit(limit)
    : await db.select().from(appLogs).orderBy(desc(appLogs.ts)).limit(limit)

  return c.json({ entries: rows })
})

logs.delete('/', async (c) => {
  const db = createDB(c.env)
  await db.delete(appLogs)
  return c.json({ ok: true })
})

// Idempotency-Key middleware for the write routes the client retries (set
// saves, session finish, combo ratings, ad-hoc sessions, body metrics, check-in
// and journal). The decision logic is lib/idempotency; this is the D1 store
// and the Hono glue. Requests without the header run as before.

import { eq, lt } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'

import { createDB } from '../db/client'
import { idempotencyKeys } from '../db/schema'
import { IDEMPOTENCY_HEADER, idempotencyCutoff, isValidIdempotencyKey, runIdempotent, type IdempotencyStore } from '../lib/idempotency'

type DB = ReturnType<typeof createDB>

export function d1IdempotencyStore(db: DB): IdempotencyStore {
  return {
    async claim(key, route, nowSec) {
      const rows = await db.insert(idempotencyKeys)
        .values({ key, route, status: 0, responseBody: null, createdAt: nowSec })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key })
      return rows.length > 0
    },
    async get(key) {
      const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key))
      return row ? { key: row.key, route: row.route, status: row.status, responseBody: row.responseBody, createdAt: row.createdAt } : null
    },
    async reclaim(key, nowSec) {
      await db.update(idempotencyKeys).set({ createdAt: nowSec, status: 0 }).where(eq(idempotencyKeys.key, key))
    },
    async complete(key, status, body, nowSec) {
      await db.update(idempotencyKeys).set({ status, responseBody: body, completedAt: nowSec }).where(eq(idempotencyKeys.key, key))
    },
    async release(key) {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key))
    },
  }
}

/** Nightly: drop keys past the TTL. Returns nothing; failures are logged by the caller. */
export async function pruneIdempotencyKeys(db: DB, nowSec: number): Promise<void> {
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, idempotencyCutoff(nowSec)))
}

export function idempotent(): MiddlewareHandler<{ Bindings: { DB: D1Database } }> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase()
    const key = c.req.header(IDEMPOTENCY_HEADER)
    if (!key || (method !== 'POST' && method !== 'PATCH' && method !== 'PUT')) return next()
    if (!isValidIdempotencyKey(key)) return c.json({ error: 'Invalid Idempotency-Key.' }, 400)

    const route = `${method} ${new URL(c.req.url).pathname.replace(/\/+$/, '')}`
    const store = d1IdempotencyStore(createDB(c.env))
    const outcome = await runIdempotent(store, key, route, Math.floor(Date.now() / 1000), async () => {
      await next()
      const body = await c.res.clone().text()
      return { status: c.res.status, body }
    })
    if (outcome.kind === 'replayed') {
      return new Response(outcome.result.body, {
        status: outcome.result.status,
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Idempotent-Replayed': 'true' },
      })
    }
    if (outcome.kind === 'in_flight') {
      return c.json({ error: 'This write is still being saved. Try again in a moment.', code: 'idempotency_in_flight' }, 409)
    }
    if (outcome.kind === 'mismatch') {
      return c.json({ error: 'Idempotency-Key was already used for a different write.', code: 'idempotency_mismatch' }, 422)
    }
    // Executed: c.res is the handler's response.
  }
}

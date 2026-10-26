// His bag sessions (page 80, approved by Josh 2026-10-23).
//
//   GET  /api/bag/pool              his combos (unlocked, switched on in Settings), his saved routines,
//                                   his last sessions' focus pairs (page 93) and his Settings switches:
//                                   the builder reads them before he taps (nothing loads after a tap)
//   POST /api/bag/routines          { id?, name, mode, rounds, roundSec, restSec }: SAVE ROUTINE (the same id
//                                   or the same name updates it)
//
// The rounds themselves are planned by lib/coach/bagArc.ts (the builder on the
// phone, and the start route when the session begins).

import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { createDB } from '../../db/client'
import { bagRoutines, comboPerformance, combos, sessions, settings } from '../../db/schema'
import { LIMITS, parseRoutineRow, type BagRoutine, type FocusHistory, type PoolCombo } from '../../lib/coach/bagArc'

type Bindings = { DB: D1Database }
type DB = ReturnType<typeof createDB>

export const bagBuilder = new Hono<{ Bindings: Bindings }>()

const DEFAULT_TECHNIQUES = 'boxing,kicks,defensive'

/** His pool: every unlocked combo whose techniques are all switched on (the bag's own rule). */
export async function bagPool(db: DB): Promise<PoolCombo[]> {
  const [rows, [userSettings]] = await Promise.all([
    db.select().from(combos).where(eq(combos.unlocked, 1)),
    db.select().from(settings).limit(1),
  ])
  const enabled = new Set((userSettings?.enabledTechniques ?? DEFAULT_TECHNIQUES).split(',').filter(Boolean))
  return rows
    .filter(c => { const t = c.techniques.split(',').filter(Boolean); return t.length === 0 || t.every(x => enabled.has(x)) })
    .map(c => ({ id: c.id, text: c.text, tier: c.tier, difficultyOverride: c.difficultyOverride ?? null, masteryScore: c.masteryScore, createdAt: c.createdAt, source: c.source ?? null, isFavourite: c.isFavourite, unlockedAt: c.unlockedAt ?? null }))
}

/**
 * Page 93: the focus pairs of his last bag sessions (context_json.bagFocus), newest first,
 * each with how he rated them, so the coach keeps A and B about 3 sessions or until both rate SHARP.
 */
export async function bagFocusHistory(db: DB, notSessionId: string | null = null): Promise<FocusHistory[]> {
  const rows = await db.select({ id: sessions.id, contextJson: sessions.contextJson }).from(sessions)
    .where(and(eq(sessions.type, 'bag_work'), eq(sessions.status, 'completed')))
    .orderBy(desc(sessions.completedAt))
    .limit(6)
  const out: FocusHistory[] = []
  for (const r of rows) {
    if (r.id === notSessionId) continue
    let raw: unknown = null
    try { raw = (JSON.parse(r.contextJson ?? '{}') as { bagFocus?: unknown }).bagFocus } catch { raw = null }
    if (!Array.isArray(raw)) break
    const ids = raw.filter((x): x is string => typeof x === 'string').slice(0, 2)
    if (ids.length === 0) break
    const rated = await db.select({ comboId: comboPerformance.comboId, rating: comboPerformance.rating }).from(comboPerformance)
      .where(eq(comboPerformance.sessionId, r.id))
    out.push({ ids, ratings: Object.fromEntries(rated.filter(x => ids.includes(x.comboId)).map(x => [x.comboId, x.rating])) })
  }
  return out
}

export async function listRoutines(db: DB): Promise<BagRoutine[]> {
  const rows = await db.select().from(bagRoutines).orderBy(desc(bagRoutines.updatedAt))
  return rows.map(parseRoutineRow).filter((r): r is BagRoutine => r != null)
}

bagBuilder.get('/pool', async (c) => {
  const db = createDB(c.env)
  const [pool, routines, history, [userSettings]] = await Promise.all([bagPool(db), listRoutines(db), bagFocusHistory(db), db.select().from(settings).limit(1)])
  const groups = (userSettings?.enabledTechniques ?? DEFAULT_TECHNIQUES).split(',').filter(Boolean)
  return c.json({ combos: pool, routines, history, groups })
})

const routineSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(40),
  mode: z.enum(['hybrid', 'custom']),
  rounds: z.array(z.array(z.string().min(1).max(80)).max(8)).min(LIMITS.rounds[0]).max(LIMITS.rounds[1]),
  roundSec: z.number().int().min(LIMITS.roundMin[0] * 60).max(LIMITS.roundMin[1] * 60),
  restSec: z.number().int().min(LIMITS.restMin[0] * 60).max(LIMITS.restMin[1] * 60),
})

/** SAVE ROUTINE: a new one, or the same id / the same name updated. */
export async function saveRoutine(db: DB, input: z.infer<typeof routineSchema>, nowSec = Math.floor(Date.now() / 1000)): Promise<BagRoutine> {
  const all = await db.select().from(bagRoutines)
  const same = all.find(r => r.id === input.id) ?? all.find(r => r.name.trim().toLowerCase() === input.name.trim().toLowerCase())
  const values = { name: input.name.trim(), mode: input.mode, roundsJson: JSON.stringify(input.rounds), roundSec: input.roundSec, restSec: input.restSec, updatedAt: nowSec }
  let id: string
  if (same) {
    id = same.id
    await db.update(bagRoutines).set(values).where(eq(bagRoutines.id, id))
  } else {
    id = input.id ?? crypto.randomUUID()
    await db.insert(bagRoutines).values({ id, ...values, createdAt: nowSec })
  }
  const [row] = await db.select().from(bagRoutines).where(eq(bagRoutines.id, id))
  return parseRoutineRow(row)!
}

bagBuilder.post('/routines', async (c) => {
  const parsed = routineSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  return c.json(await saveRoutine(createDB(c.env), parsed.data))
})

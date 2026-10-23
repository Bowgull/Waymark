// Class to combo (page 49 sections 1-3, approved 2026-10-19).
//
//   GET  /api/class-combos/library    the bag, the switched-on techniques and the NOT NOWs (the phone keeps a copy for offline)
//   POST /api/class-combos/learned    { mtLogId, note }: saves "What you learned" with the class, returns the found lines
//   POST /api/class-combos/add        { strikes, sessionId, source?, difficulty? }: ADD TO BAG (new, or unlocks a locked one),
//                                     marked from class; or a combo he typed (page 80: source 'mine', his nudged grade)
//   POST /api/class-combos/decline    { strikes, sessionId }: NOT NOW, so it isn't offered again
//
// The extraction is the deterministic parser (lib/classCombos.ts) plus, when
// the model can be reached, the AI call (lib/classComboAI.ts), both limited to
// the techniques the combos use and Settings switches on.

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { createDB } from '../../db/client'
import { athleteDayFrom, TODAY_HEADER } from '../../lib/dates'
import { comboDeclines, combos, mtClassLogs, sessions, settings } from '../../db/schema'
import {
  categoriesFor,
  classifyFound,
  comboTextFor,
  deriveTechniques,
  lookupTechnique,
  matchKey,
  mergeExtractions,
  parseCombos,
  splitComboText,
  tierFor,
  LEVEL_KEYS,
  type LevelKey,
  type Technique,
} from '../../lib/classCombos'
import { extractClassCombosAI } from '../../lib/classComboAI'

type Bindings = { DB: D1Database; ANTHROPIC_API_KEY: string }
type DB = ReturnType<typeof createDB>

export const classCombos = new Hono<{ Bindings: Bindings }>()

const DEFAULT_TECHNIQUES = 'boxing,kicks,defensive'

async function loadBag(db: DB) {
  const [rows, [userSettings], declines] = await Promise.all([
    db.select({ id: combos.id, text: combos.text, tier: combos.tier, unlocked: combos.unlocked, source: combos.source, difficultyOverride: combos.difficultyOverride }).from(combos),
    db.select().from(settings).limit(1),
    db.select({ key: comboDeclines.strikesKey }).from(comboDeclines),
  ])
  const enabled = new Set((userSettings?.enabledTechniques ?? DEFAULT_TECHNIQUES).split(',').filter(Boolean))
  return { rows, enabled, declined: new Set(declines.map(d => d.key)), techniques: deriveTechniques(rows.map(r => r.text)) }
}

export async function bagLibrary(db: DB) {
  const bag = await loadBag(db)
  return { combos: bag.rows, enabled: [...bag.enabled], declined: [...bag.declined] }
}

classCombos.get('/library', async (c) => c.json(await bagLibrary(createDB(c.env))))

const learnedSchema = z.object({
  mtLogId: z.string().min(1),
  note: z.string().trim().min(1).max(4000),
})

/** Saves "What you learned" with the class and returns what it found, checked against the bag. */
export async function learnedFor(db: DB, apiKey: string, mtLogId: string, note: string) {
  const [log] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.id, mtLogId))
  if (!log) return null
  // The note is saved with tonight's class either way, so the coach still reads it.
  await db.update(mtClassLogs).set({ learnedNote: note, learnedAt: Math.floor(Date.now() / 1000) }).where(eq(mtClassLogs.id, mtLogId))
  const bag = await loadBag(db)
  const parsedNote = parseCombos(note, bag.techniques, bag.enabled)
  const ai = await extractClassCombosAI(apiKey, note, bag.techniques, bag.enabled)
  const found = mergeExtractions(parsedNote, ai, bag.techniques)
  return {
    lines: classifyFound(found.combos, bag.rows, bag.declined),
    unknown: found.unknown,
    off: found.off,
    by: ai ? 'ai' as const : 'parser' as const,
  }
}

classCombos.post('/learned', async (c) => {
  const parsed = learnedSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const out = await learnedFor(createDB(c.env), c.env.ANTHROPIC_API_KEY ?? '', parsed.data.mtLogId, parsed.data.note)
  if (!out) return c.json({ error: 'class log not found' }, 404)
  return c.json(out)
})

const strikesSchema = z.object({
  strikes: z.array(z.string().min(1).max(40)).min(2).max(8),
  sessionId: z.string().max(80).nullable().optional(),
})

// Page 80: a combo he typed (+ COMBO, in the Library, after class or in the bag builder) may be one strike;
// it carries where it came from and his grade after a nudge.
const addSchema = z.object({
  strikes: z.array(z.string().min(1).max(40)).min(1).max(8),
  sessionId: z.string().max(80).nullable().optional(),
  source: z.enum(['class', 'mine']).optional(),
  difficulty: z.enum(LEVEL_KEYS).nullable().optional(),
})

/** Every strike known and switched on, as the techniques name them; or the first that isn't. */
function knownStrikes(strikes: string[], techniques: Technique[], enabled: Set<string>): { ok: true; names: string[] } | { ok: false; strike: string } {
  const names: string[] = []
  for (const s of strikes) {
    const t = lookupTechnique(s, techniques)
    if (!t || !enabled.has(t.category)) return { ok: false, strike: s }
    names.push(t.name)
  }
  return { ok: true, names }
}

async function classDay(db: DB, sessionId: string | null | undefined, todayDay: number): Promise<number> {
  if (sessionId) {
    const [s] = await db.select({ day: sessions.scheduledDate }).from(sessions).where(eq(sessions.id, sessionId))
    if (s?.day != null) return s.day
  }
  return todayDay
}

export interface AddOptions {
  /** 'class' (the default, the glove) or 'mine' (he typed it, page 80). */
  source?: 'class' | 'mine'
  /** His grade after a nudge; null: the tier's. */
  difficulty?: LevelKey | null
}

/**
 * ADD TO BAG: a new combo in the library, or a locked one unlocked; from class
 * both carry the glove. A combo he typed (page 80) is marked his ('mine') and
 * keeps his nudged grade. Either way it joins his pool and tracks to mastery.
 */
export async function addToBag(db: DB, strikes: string[], sessionId: string | null | undefined, todayDay: number = athleteDayFrom({ nowMs: Date.now() }), opts: AddOptions = {}) {
  const bag = await loadBag(db)
  const known = knownStrikes(strikes, bag.techniques, bag.enabled)
  if (!known.ok) return { error: `"${known.strike}" isn't a technique the app knows.` }
  const key = matchKey(known.names)
  const mine = opts.source === 'mine'
  const day = mine ? null : await classDay(db, sessionId, todayDay)
  const marks = { source: mine ? 'mine' : 'class', classDate: day, ...(opts.difficulty !== undefined ? { difficultyOverride: opts.difficulty } : {}) }

  const same = bag.rows.filter(r => matchKey(splitComboText(r.text)) === key)
  const inBag = same.find(r => r.unlocked)
  if (inBag) {
    // already his: a typed one only carries his nudged grade over
    if (mine && opts.difficulty) await db.update(combos).set({ difficultyOverride: opts.difficulty }).where(eq(combos.id, inBag.id))
    const [row] = await db.select().from(combos).where(eq(combos.id, inBag.id))
    return { combo: row, status: 'in_bag' as const }
  }
  if (same[0]) {
    // LOCKED: ADD TO BAG unlocks it, and it carries the glove from now on. Its date becomes today's:
    // to him it's new (page 80: the coach drills a just-added combo first; Library's NEW reads it too).
    await db.update(combos).set({ unlocked: 1, createdAt: Math.floor(Date.now() / 1000), ...marks }).where(eq(combos.id, same[0].id))
    const [row] = await db.select().from(combos).where(eq(combos.id, same[0].id))
    return { combo: row, status: 'unlocked' as const }
  }
  const tier = tierFor(known.names)
  const id = `combo-${mine ? 'm' : 'c'}-${crypto.randomUUID().slice(0, 8)}`
  await db.insert(combos).values({
    id,
    text: comboTextFor(known.names),
    tier,
    level: tier,
    unlocked: 1,
    masteryScore: 0,
    techniques: categoriesFor(known.names),
    formTips: '',
    isFavourite: 0,
    timesSharp: 0,
    createdAt: Math.floor(Date.now() / 1000),
    ...marks,
  })
  const [row] = await db.select().from(combos).where(eq(combos.id, id))
  return { combo: row, status: 'added' as const }
}

classCombos.post('/add', async (c) => {
  const parsed = addSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  const out = await addToBag(createDB(c.env), parsed.data.strikes, parsed.data.sessionId, athleteDayFrom({ header: c.req.header(TODAY_HEADER), nowMs: Date.now() }), { source: parsed.data.source, difficulty: parsed.data.difficulty })
  if ('error' in out) return c.json(out, 400)
  return c.json(out)
})

/** NOT NOW: remembered by its strikes, so the same combo isn't offered again. */
export async function declineCombo(db: DB, strikes: string[], sessionId: string | null | undefined) {
  await db.insert(comboDeclines).values({
    id: crypto.randomUUID(),
    strikesKey: matchKey(strikes),
    strikesJson: JSON.stringify(strikes),
    sessionId: sessionId ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing()
}

classCombos.post('/decline', async (c) => {
  const parsed = strikesSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
  await declineCombo(createDB(c.env), parsed.data.strikes, parsed.data.sessionId)
  return c.json({ ok: true })
})

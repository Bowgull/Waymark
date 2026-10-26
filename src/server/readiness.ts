// Block readiness and the move to the next block on the server (coach-brain.md
// §8; replaces the end gate's check, extensions and verdict screen).
//
// - readinessFor: the four parts for today (lib/brain/readinessParts.ts), from
//   the athlete model, his sessions, sets, check-ins and the back eases.
// - runBlockMove (nightly, before the day's re-plan): Block Zero keeps its
//   runway (no maximum: a week is added whenever the last one is reached);
//   when all four parts are in and 4 weeks are done, the coach sets the move:
//   a lighter week (the doses read it, server/brain.ts), and a change row on
//   the Monday after (Dagaz rune, UNDO = "stay in Block Zero" until it
//   starts). On that Monday The Campaign starts: the same one plan goes on
//   (rebuild Phase 2: never the old Fighter week, no training maxes; the
//   weights keep coming from his reps left). The block is renamed, its weeks
//   keep counting, and the move is not set again.
// - finishBlockMove (nightly, after the re-plan): a TM change from an older
//   move keeps its UNDO until the first strength session starts.

import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { coachingOutputs, sessions, trainingBlocks, weekAdjustments } from '../db/schema'
import type { createDB } from '../db/client'
import { buildAthleteModel } from '../lib/brain/athleteModel'
import { readinessParts, readinessSummary, dayLabel, type ReadinessReport } from '../lib/brain/readinessParts'
import { moveDates, MOVE_AGAIN_AFTER_DAYS } from '../lib/brain/blockMove'
import { NEXT_BLOCK_NAME, NEXT_BLOCK_SHOW } from '../lib/blockZero/endGate'
import { readChangeRow, slotStart } from '../lib/coach'
import { getActiveBlock } from './blockZeroData'
import { blockStartDay, trainingWeekFor } from './coachData'
import { loadModelEvents } from './athleteModel'
import { pmStart, recordChanges } from './changes'

type DB = ReturnType<typeof createDB>
type Block = NonNullable<Awaited<ReturnType<typeof getActiveBlock>>>

export const MOVE_KIND = 'block_move'

export interface StoredMove {
  blockId: string
  readyDay: number
  lighterFrom: number
  monday: number
  changeId: string | null
  parts: string
  /** Set on the Monday: the new block, and the TM change row. */
  applied?: { at: number; nextBlockId: string | null; tmChangeId: string | null; watched?: boolean } | null
}

/** The latest move the coach set for this block, with whether he undid it. */
export async function loadMove(db: DB, blockId: string): Promise<{ id: string; move: StoredMove; undoneAt: number | null } | null> {
  const [row] = await db.select().from(coachingOutputs).where(and(eq(coachingOutputs.kind, MOVE_KIND), eq(coachingOutputs.inputHash, blockId))).orderBy(desc(coachingOutputs.createdAt)).limit(1)
  if (!row) return null
  let move: StoredMove
  try { move = JSON.parse(row.outputJson) as StoredMove } catch { return null }
  let undoneAt: number | null = null
  if (move.changeId) {
    const [ch] = await db.select({ undoneAt: weekAdjustments.undoneAt }).from(weekAdjustments).where(eq(weekAdjustments.id, move.changeId))
    undoneAt = ch?.undoneAt ?? null
  }
  return { id: row.id, move, undoneAt }
}

/** The move in force (set, not undone, not yet applied): the doses read its lighter days. */
export async function activeMove(db: DB): Promise<{ lighterFrom: number; monday: number } | null> {
  const block = await getActiveBlock(db)
  if (!block || block.blockType !== 'block_zero') return null
  const m = await loadMove(db, block.id)
  if (!m || m.undoneAt != null || m.move.applied) return null
  return { lighterFrom: m.move.lighterFrom, monday: m.move.monday }
}

/** Days with a back-related ease: a dose eased with the back flagged, or an ease whose why names the back. */
export async function loadBackEaseDays(db: DB, from: number, today: number): Promise<number[]> {
  const out = new Set<number>()
  const rows = await db.select({ day: sessions.scheduledDate, doseJson: sessions.doseJson, status: sessions.status }).from(sessions)
    .where(and(gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, today)))
  for (const r of rows) {
    if (r.day == null || !r.doseJson || r.status === 'planned') continue
    try {
      const d = JSON.parse(r.doseJson) as { level?: string; flags?: { back?: boolean } }
      if (d.flags?.back && (d.level === 'EASE' || d.level === 'RECOVER' || d.level === 'REST')) out.add(r.day)
    } catch { /* unreadable dose: skip */ }
  }
  const changes = await db.select().from(weekAdjustments).where(gte(weekAdjustments.createdAt, from * 86400))
  for (const row of changes) {
    const c = readChangeRow(row)
    if (!c || c.undoneAt != null || c.actor === 'you' || (c.kind !== 'ease' && c.kind !== 'skip' && c.kind !== 'shorten' && c.kind !== 'swap')) continue
    if (/\bback\b/i.test(c.why ?? '') && c.after.day <= today) out.add(c.after.day)
  }
  return [...out].sort((a, b) => a - b)
}

/** The four parts for `today`, or null outside Block Zero. */
export async function blockReadinessFor(db: DB, today: number): Promise<ReadinessReport | null> {
  const block = await getActiveBlock(db)
  if (!block || block.blockType !== 'block_zero') return null
  return readinessOf(db, block, today)
}

async function readinessOf(db: DB, block: Block, today: number): Promise<ReadinessReport> {
  const start = blockStartDay(block)
  const from = Math.min(start, today)
  const events = await loadModelEvents(db, from, today)
  const model = buildAthleteModel(events, today, { fromDay: from })
  const m = await loadMove(db, block.id)
  const move = m && m.undoneAt == null && !m.move.applied ? { monday: m.move.monday, lighterFrom: m.move.lighterFrom } : null
  return readinessParts({
    today, blockStart: start, model, sessions: events.sessions, sets: events.sets, checkIns: events.checkIns, talkTests: events.talkTests,
    backEaseDays: await loadBackEaseDays(db, start, today), move,
  })
}

// ─── The nightly move ─────────────────────────────────────────

export interface MoveResult {
  action: 'none' | 'runway' | 'set' | 'moved' | 'waiting'
  /** Visible coach changes written tonight (count toward the night's 2). */
  changes: number
  report?: ReadinessReport | null
}

/**
 * The nightly step for the block (before the re-plan). Never more than one
 * move a night; nothing in Fighter blocks yet (their parts come with §10).
 */
export async function runBlockMove(db: DB, today: number, nowSec: number): Promise<MoveResult> {
  const block = await getActiveBlock(db)
  if (!block || block.blockType !== 'block_zero') return { action: 'none', changes: 0 }
  const m = await loadMove(db, block.id)

  // The Monday has come: The Campaign starts.
  if (m && m.undoneAt == null && !m.move.applied && today >= m.move.monday) {
    await applyMove(db, block, m.id, m.move, nowSec)
    return { action: 'moved', changes: 0 }
  }
  // Moved already: The Campaign runs on (one plan; nothing to set again).
  if (m && m.undoneAt == null && m.move.applied) return { action: 'none', changes: 0 }

  // No maximum: a week more of Block Zero whenever its last week is reached.
  let runway = false
  const tw = await trainingWeekFor(db, block, today, today)
  if (tw.rawWeek >= block.totalWeeks) {
    await db.update(trainingBlocks).set({ totalWeeks: tw.rawWeek + 1 }).where(eq(trainingBlocks.id, block.id))
    runway = true
  }

  const report = await readinessOf(db, block, today)
  if (m && m.undoneAt == null && !m.move.applied) return { action: 'waiting', changes: 0, report }
  // After an UNDO ("stay in Block Zero"), the coach looks again a week later.
  if (m && m.undoneAt != null && today < Math.floor(m.undoneAt / 86400) + MOVE_AGAIN_AFTER_DAYS) return { action: runway ? 'runway' : 'none', changes: 0, report }
  if (!report.ready) return { action: runway ? 'runway' : 'none', changes: 0, report }

  const set = await setBlockMove(db, block, today, nowSec, report)
  return { action: 'set', changes: set.changeId ? 1 : 0, report: { ...report, move: { monday: set.monday, lighterFrom: set.lighterFrom } } }
}

/** Set the move for `today`: the lighter days, and the Monday rune with UNDO ("stay in Block Zero"). */
export async function setBlockMove(db: DB, block: Block, today: number, nowSec: number, report: ReadinessReport | null): Promise<StoredMove> {
  const { lighterFrom, monday } = moveDates(today)
  const habit = report?.parts.find(p => p.key === 'habit')
  const [changeId] = await recordChanges(db, [{
    setId: crypto.randomUUID(), actor: 'coach', kind: 'block', targetSessionId: null, sessionType: 'strength', adjustmentType: 'block_move',
    before: { show: 'BLOCK ZERO', day: monday, sessions: [] },
    after: { show: NEXT_BLOCK_SHOW, day: monday, sessions: [], put: { line: 'You stay in Block Zero.', dim: 'The coach looks again next week.' } },
    why: `Habit, engine, strength and back are all in. The Campaign starts ${dayLabel(monday)}, after a lighter week.`,
    detail: habit?.line ?? null,
    undoUntil: monday * 86400,
    extraSource: { rule: 'block_move', parts: (report ? readinessSummary(report) : ''), lighterFrom },
  }], nowSec)
  const move: StoredMove = { blockId: block.id, readyDay: today, lighterFrom, monday, changeId: changeId ?? null, parts: (report ? readinessSummary(report) : ''), applied: null }
  await db.insert(coachingOutputs).values({ id: crypto.randomUUID(), kind: MOVE_KIND, model: 'rules', scopeWeekPlanId: null, scopeSessionId: null, inputHash: block.id, outputJson: JSON.stringify(move), tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, createdAt: nowSec })
  console.log(`[readiness] move set: lighter from ${lighterFrom}, ${NEXT_BLOCK_NAME} from ${monday} (${move.parts})`)
  return move
}

/**
 * The Monday: The Campaign starts (rebuild Phase 2). The same block and the
 * same one plan go on, renamed; no Fighter block and no training maxes (the
 * weights keep coming from his reps left).
 */
async function applyMove(db: DB, block: Block, rowId: string, move: StoredMove, nowSec: number): Promise<void> {
  await db.update(trainingBlocks).set({ name: BUILD_NAME }).where(eq(trainingBlocks.id, block.id))
  const applied = { at: nowSec, nextBlockId: block.id, tmChangeId: null, watched: true }
  await db.update(coachingOutputs).set({ outputJson: JSON.stringify({ ...move, applied }) }).where(eq(coachingOutputs.id, rowId))
  console.log(`[readiness] The Campaign started on ${move.monday}`)
}

/** The block's name once The Campaign starts. */
export const BUILD_NAME = 'The Campaign'

/** After the re-plan made the new block's sessions: the TM change stays undoable until the first strength session starts. */
export async function finishBlockMove(db: DB, today: number): Promise<void> {
  const rows = await db.select().from(coachingOutputs).where(eq(coachingOutputs.kind, MOVE_KIND)).orderBy(desc(coachingOutputs.createdAt)).limit(1)
  const row = rows[0]
  if (!row) return
  let move: StoredMove
  try { move = JSON.parse(row.outputJson) as StoredMove } catch { return }
  const a = move.applied
  if (!a || a.watched || !a.tmChangeId || !a.nextBlockId) return
  const [first] = (await db.select().from(sessions).where(and(eq(sessions.type, 'strength'), eq(sessions.status, 'planned'), eq(sessions.blockType, 'fighter'), gte(sessions.scheduledDate, today))))
    .sort((x, y) => (x.scheduledDate ?? 0) - (y.scheduledDate ?? 0) || (x.timeSlot === 'pm' ? 1 : 0) - (y.timeSlot === 'pm' ? 1 : 0))
  if (!first || first.scheduledDate == null) return
  const [ch] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, a.tmChangeId))
  if (!ch?.afterJson) return
  const after = JSON.parse(ch.afterJson) as Record<string, unknown>
  await db.update(weekAdjustments).set({
    afterJson: JSON.stringify({ ...after, watch: [first.id] }),
    targetSessionId: first.id,
    undoUntil: slotStart(first.scheduledDate, first.timeSlot, await pmStart(db)),
  }).where(eq(weekAdjustments.id, a.tmChangeId))
  await db.update(coachingOutputs).set({ outputJson: JSON.stringify({ ...move, applied: { ...a, watched: true } }) }).where(eq(coachingOutputs.id, row.id))
}

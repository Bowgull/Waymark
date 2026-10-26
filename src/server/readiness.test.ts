// Run: tsx src/server/readiness.test.ts
// Coach brain P4 on the server (coach-brain.md §8): the move to Fighter Block 1.
// The Monday rune with UNDO ("stay in Block Zero"), the lighter week the doses
// read, then on the Monday: Block Zero ends, Fighter Block 1 starts, and the
// new maxes (90% of e1RM from the lighter week's sets) are a change row with
// UNDO. Also Block Zero's runway (no maximum).
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { coachingOutputs, exercises, sessions, trainingBlocks, trainingMaxes, weekAdjustments } from '../db/schema'
import { createTrainingBlock } from './blocks'
import { startedAtForLocalDay } from './coachData'
import { activeMove, blockReadinessFor, loadMove, runBlockMove, setBlockMove } from './readiness'
import { undoChange, weekChangeViews } from './changes'
import { testDb } from './testDb'

const MON = 20822 // Monday 2027-01-04
const quiet = console.log
console.log = () => {}

async function blockZero(db: ReturnType<typeof testDb>, start = MON) {
  for (const id of ['ex-front-squat', 'ex-bench-press', 'ex-db-row']) {
    await db.insert(exercises).values({ id, name: id, category: 'strength', createdAt: 0 } as never).onConflictDoNothing()
  }
  return createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: start * 86400, startedAt: startedAtForLocalDay(start) })
}

// ─── The Monday rune, the lighter week, UNDO ─────────────────
{
  const db = testDb()
  const bz = await blockZero(db)
  const today = MON + 32 // a Friday in week 5
  const move = await setBlockMove(db, bz, today, today * 86400 + 7200, null)
  assert.deepEqual([move.lighterFrom, move.monday], [MON + 35, MON + 42], 'from a Friday: next week is lighter, the Monday after starts the block')
  assert.deepEqual(await activeMove(db), { lighterFrom: MON + 35, monday: MON + 42 }, 'the doses read the lighter days')
  const views = await weekChangeViews(db, MON + 42, today)
  const v = views.changes.find(c => c.kind === 'block')
  assert.ok(v && v.who === 'COACH' && v.before === 'BLOCK ZERO' && v.after === 'THE CAMPAIGN', 'a coach change on that Monday')
  assert.equal(views.runes[MON + 42], 'new', 'a Dagaz rune on the Monday tile')
  assert.equal(v!.lock, 'open', 'UNDO until it starts')
  assert.ok(/The Campaign starts Mon 15 Feb, after a lighter week/.test(v!.why), v!.why)
  // UNDO: stay in Block Zero.
  const u = await undoChange(db, v!.id, today, today * 86400 + 9000)
  assert.ok(u.ok, 'UNDO works')
  assert.equal(await activeMove(db), null, 'undone: no lighter week, no move')
  // The coach does not set it again the next nights: a week later at the soonest.
  const again = await runBlockMove(db, today + 2, (today + 2) * 86400)
  assert.notEqual(again.action, 'set', 'not set again within the week')
  // On the Monday, nothing happens (the move was undone).
  const mon = await runBlockMove(db, MON + 42, (MON + 42) * 86400)
  assert.notEqual(mon.action, 'moved')
  assert.equal((await db.select().from(trainingBlocks).where(eq(trainingBlocks.status, 'active')))[0].blockType, 'block_zero', 'still Block Zero')
  // Once that Monday has come, a block change can't be undone.
  const passed = await weekChangeViews(db, MON + 42, MON + 42)
  assert.equal(passed.changes.find(c => c.kind === 'block')?.lock, 'undone')
}

// ─── The Monday: The Campaign (rebuild Phase 2: never the Fighter week) ──
{
  const db = testDb()
  const bz = await blockZero(db)
  await db.insert(trainingMaxes).values({ id: 'tm1', exerciseId: 'ex-bench-press', weightKg: 50, updatedAt: 0 })
  const move = await setBlockMove(db, bz, MON + 29, (MON + 29) * 86400, null) // Tuesday week 5: lighter from today
  assert.deepEqual([move.lighterFrom, move.monday], [MON + 29, MON + 35])
  const r = await runBlockMove(db, MON + 35, (MON + 35) * 86400 + 7200)
  assert.equal(r.action, 'moved')
  const blocks = await db.select().from(trainingBlocks)
  const active = blocks.filter(b => b.status === 'active')
  assert.equal(active.length, 1, 'one block')
  assert.ok(active[0].id === bz.id && active[0].blockType === 'block_zero' && active[0].name === 'The Campaign', 'the same plan goes on, renamed: no Fighter block')
  const tms = new Map((await db.select().from(trainingMaxes)).map(t => [t.exerciseId, t.weightKg]))
  assert.equal(tms.get('ex-bench-press'), 50, 'no training maxes written')
  assert.equal((await db.select().from(weekAdjustments)).filter(w => w.kind === 'tm').length, 0, 'no TM change row')
  const stored = await loadMove(db, bz.id)
  assert.ok(stored?.move.applied != null, 'the move is stored as applied')
  // It is not set again on later nights.
  const later = await runBlockMove(db, MON + 50, (MON + 50) * 86400)
  assert.equal(later.action, 'none', 'moved once: The Campaign runs on')
  assert.equal((await db.select().from(coachingOutputs).where(eq(coachingOutputs.kind, 'block_move'))).length, 1)
}

// ─── No maximum: the runway; nothing set before the parts are in ─
{
  const db = testDb()
  const bz = await blockZero(db, MON - 42)
  // Six weeks trained (the week count pauses through empty weeks).
  for (let d = MON - 42; d < MON; d++) if ((d - MON) % 7 !== 6 && (d - MON) % 7 !== -1) await db.insert(sessions).values({ id: `w${d}`, type: 'foundation_run', scheduledDate: d, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: 0 })
  const r = await runBlockMove(db, MON, MON * 86400)
  assert.equal(r.action, 'runway', 'week 7 of a 6-week block: a week more')
  const [b] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, bz.id))
  assert.ok(b.totalWeeks >= 7, `Block Zero runs on (${b.totalWeeks} weeks)`)
  const report = await blockReadinessFor(db, MON)
  assert.ok(report && !report.ready && report.flap !== 'READY', 'nothing logged: not ready')
}

console.log = quiet
console.log('server readiness tests passed')

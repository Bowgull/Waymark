// Run: tsx src/server/readiness.test.ts
// Coach brain P4 on the server (coach-brain.md §8): the move to Fighter Block 1.
// The Monday rune with UNDO ("stay in Block Zero"), the lighter week the doses
// read, then on the Monday: Block Zero ends, Fighter Block 1 starts, and the
// new maxes (90% of e1RM from the lighter week's sets) are a change row with
// UNDO. Also Block Zero's runway (no maximum).
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { coachingOutputs, exercises, sessions, strengthSessionExercises, strengthSets, trainingBlocks, trainingMaxes, weekAdjustments } from '../db/schema'
import { createTrainingBlock } from './blocks'
import { startedAtForLocalDay } from './coachData'
import { activeMove, blockReadinessFor, finishBlockMove, loadMove, runBlockMove, setBlockMove } from './readiness'
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
  assert.ok(v && v.who === 'COACH' && v.before === 'BLOCK ZERO' && v.after === 'FIGHTER BLOCK 1', 'a coach change on that Monday')
  assert.equal(views.runes[MON + 42], 'new', 'a Dagaz rune on the Monday tile')
  assert.equal(v!.lock, 'open', 'UNDO until it starts')
  assert.ok(/Fighter Block 1 starts Mon 15 Feb, after a lighter week/.test(v!.why), v!.why)
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

// ─── The Monday: Fighter Block 1, new maxes as a change row ──
{
  const db = testDb()
  const bz = await blockZero(db)
  await db.insert(trainingMaxes).values({ id: 'tm1', exerciseId: 'ex-bench-press', weightKg: 50, updatedAt: 0 })
  const move = await setBlockMove(db, bz, MON + 29, (MON + 29) * 86400, null) // Tuesday week 5: lighter from today
  assert.deepEqual([move.lighterFrom, move.monday], [MON + 29, MON + 35])
  // The lighter week's strength: front squat 60 kg × 8 with 2 left, bench 52.5 × 8 with 2 left.
  const sid = 'lw1'
  await db.insert(sessions).values({ id: sid, type: 'strength', label: 'Strength A', scheduledDate: MON + 30, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: 0 })
  for (const [i, [ex, kg]] of ([['ex-front-squat', 60], ['ex-bench-press', 52.5]] as const).entries()) {
    await db.insert(strengthSessionExercises).values({ id: `sse${i}`, sessionId: sid, exerciseId: ex, orderIndex: i, section: 'main' })
    for (let k = 1; k <= 2; k++) await db.insert(strengthSets).values({ id: `st${i}${k}`, sessionExerciseId: `sse${i}`, setNumber: k, weightKg: kg, reps: 8, rir: 2, isWarmup: 0, completedAt: 1, createdAt: 0 })
  }
  // A Block Zero session still planned on the Monday goes with the old block.
  await db.insert(sessions).values({ id: 'old-mon', type: 'strength', label: 'Strength A', scheduledDate: MON + 35, timeSlot: 'am', status: 'planned', blockType: 'block_zero', source: 'template', createdAt: 0 })
  const r = await runBlockMove(db, MON + 35, (MON + 35) * 86400 + 7200)
  assert.equal(r.action, 'moved')
  const blocks = await db.select().from(trainingBlocks)
  const fighter = blocks.find(b => b.status === 'active')
  assert.ok(fighter && fighter.blockType === 'fighter' && fighter.name === 'Fighter Block 1', 'Fighter Block 1 is active')
  assert.equal(Math.floor((fighter!.startedAt ?? 0) / 86400), MON + 35, 'starting that Monday')
  assert.equal(blocks.find(b => b.id === bz.id)?.status, 'ended', 'Block Zero ended')
  const tms = new Map((await db.select().from(trainingMaxes)).map(t => [t.exerciseId, t.weightKg]))
  assert.equal(tms.get('ex-front-squat'), 72, 'front squat: 90% of 80')
  assert.equal(tms.get('ex-bench-press'), 63, 'bench: 90% of 70')
  const tmRows = (await db.select().from(weekAdjustments)).filter(w => w.kind === 'tm')
  assert.equal(tmRows.length, 1, 'the TM writes are one change row')
  assert.ok(/Starting weights for Fighter Block 1, 90% of last week's best sets: bench 139 lb, front squat 159./.test(tmRows[0].why ?? ''), tmRows[0].why ?? '')
  // The first Fighter strength session watches the TM change's UNDO.
  await db.insert(sessions).values({ id: 'f1', type: 'strength', label: null, scheduledDate: MON + 36, timeSlot: 'am', status: 'planned', blockType: 'fighter', source: 'template', createdAt: 0 })
  await finishBlockMove(db, MON + 35)
  const [watched] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.id, tmRows[0].id))
  assert.equal(watched.targetSessionId, 'f1', 'UNDO until the first Fighter strength session starts')
  // UNDO of the maxes: bench back to 50; the front squat had none, so it keeps its first.
  const u = await undoChange(db, tmRows[0].id, MON + 35, (MON + 35) * 86400 + 9000)
  assert.ok(u.ok)
  const after = new Map((await db.select().from(trainingMaxes)).map(t => [t.exerciseId, t.weightKg]))
  assert.equal(after.get('ex-bench-press'), 50, 'UNDO puts the old max back')
  const stored = await loadMove(db, bz.id)
  assert.ok(stored?.move.applied?.nextBlockId === fighter!.id && stored.move.applied.watched, 'the move is stored as applied')
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

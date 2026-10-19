// Run: tsx src/server/endGate.test.ts
// Earlier E2E bug 5, the move-on path the last test couldn't reach: CHECK
// READINESS only stores the verdict; START FIGHTER BLOCK 1 applies it once,
// ending Block Zero (its planned sessions from today go with it) and making
// Fighter Block 1. A second tap changes nothing.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { coachingOutputs, trainingBlocks } from '../db/schema'
import { createTrainingBlock } from './blocks'
import { applyStoredBlockZeroTransition } from './routes/blockZero'
import { testDb } from './testDb'

const db = testDb()
const nowSec = Math.floor(Date.now() / 1000)
const bz = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec - 42 * 86400 })
assert.equal(await applyStoredBlockZeroTransition(db, bz.id), null, 'no verdict yet: nothing to apply (the check runs first)')

const plan = { decision: 'proceed', reportedDecision: 'proceed', extendWeeks: 0, newTotalWeeks: 6, nextBlock: { name: 'Fighter Block 1', blockType: 'fighter', totalWeeks: 12 }, calibration: [], gate: {}, reasons: [] }
await db.insert(coachingOutputs).values({ id: 'v1', kind: 'block_zero_transition', model: 'rules', inputHash: bz.id, outputJson: JSON.stringify({ applied: false, plan }), createdAt: nowSec })
const blocksBefore = await db.select().from(trainingBlocks)
assert.equal(blocksBefore.length, 1, 'the stored verdict alone changes no block')

const done = await applyStoredBlockZeroTransition(db, bz.id)
assert.ok(done?.applied && done.nextBlockId, 'move on: applied, with the new block')
const after = await db.select().from(trainingBlocks)
assert.equal(after.find(b => b.id === bz.id)?.status, 'ended', 'Block Zero ends')
const fighter = after.find(b => b.id === done.nextBlockId)
assert.ok(fighter && fighter.status === 'active' && fighter.blockType === 'fighter', 'Fighter Block 1 is the active block')

const again = await applyStoredBlockZeroTransition(db, bz.id)
assert.ok(again?.applied && (await db.select().from(trainingBlocks)).length === 2, 'a second tap makes no second block')
assert.equal(JSON.parse((await db.select().from(coachingOutputs).where(eq(coachingOutputs.id, 'v1')))[0].outputJson).applied, true)
console.log('end gate move-on tests passed')

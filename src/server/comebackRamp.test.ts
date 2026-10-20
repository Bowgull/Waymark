// Run: tsx src/server/comebackRamp.test.ts
// No comeback ramp inside Block Zero (Josh, 2026-10-20): Block Zero week 1 is
// the comeback. After a 4-month gap a Fighter block still ramps; a Block Zero
// gets the plain week-1 dose.
import assert from 'node:assert/strict'
import { sessions } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock, endActiveBlocks } from './blocks'
import { returnContextFor } from './coachData'
import { testDb } from './testDb'

const JUNE = isoToEpochDay('2026-06-10')
const OCT = isoToEpochDay('2026-10-20')
const nowSec = OCT * 86400 + 12 * 3600
const db = testDb()
await db.insert(sessions).values({ id: 'june', type: 'strength', scheduledDate: JUNE, status: 'completed', blockType: 'fighter', createdAt: JUNE * 86400 })

await createTrainingBlock(db, { name: 'Fighter', blockType: 'fighter', totalWeeks: 12, nowSec, startedAt: startedAtForLocalDay(OCT) })
const fighter = await returnContextFor(db, OCT)
assert.ok(fighter.active && fighter.plan.tier === 'restart', 'a Fighter block after 4 months off still ramps')

await endActiveBlocks(db, nowSec, OCT)
await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec, startedAt: startedAtForLocalDay(OCT) })
const bz = await returnContextFor(db, OCT)
assert.equal(bz.active, false, 'Block Zero: no ramp, week 1 is the comeback')
assert.equal(bz.loadFactor, 1)
assert.equal(bz.volumeFactor, 1)
console.log('ok: no comeback ramp inside Block Zero')

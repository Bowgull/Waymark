// Run: tsx src/server/startDay.test.ts
// Page 64 on a real (in-memory) database: a Block Zero started for a later
// day is the running block, but nothing is planned before its start; week 1
// starts on the chosen day (no lead-in, coach brain P2); CHANGE DAY moves the start and its
// planned sessions while it waits, and is refused once it has started.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { sessions, trainingBlocks } from '../db/schema'
import { isLeadInContext, mondayOf, startedAtForLocalDay } from '../lib/coach'
import { isoToEpochDay } from '../lib/dates'
import { createTrainingBlock, endActiveBlocks, moveBlockZeroStart } from './blocks'
import { currentBlockWeek, generateDaySessions, latestWeekPlan } from './coachData'
import { prepareWeek } from './weeklyPass'
import { testDb } from './testDb'

const TUE = isoToEpochDay('2026-10-20')
const THU = TUE + 2
const MON = mondayOf(TUE)
const NEXT = MON + 7
const nowSec = TUE * 86400 + 15 * 3600

const db = testDb()
await endActiveBlocks(db, nowSec, TUE)
const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec, startedAt: startedAtForLocalDay(THU) })
assert.equal(block.status, 'active', 'the waiting block is the running block')

// Nothing is planned before the start: today and tomorrow stay empty.
assert.deepEqual(await generateDaySessions(db, TUE, TUE, nowSec), [], 'no sessions today (Tue)')
assert.deepEqual(await generateDaySessions(db, TUE + 1, TUE, nowSec), [], 'no sessions on Wed')
const cur = await currentBlockWeek(db, TUE)
assert.ok(cur && !cur.tw.leadIn && cur.tw.week === 1, 'the start week is week 1, no lead-in')
console.log('ok: nothing planned before the start')

// BEGIN prepares the start's week: Thu to Sun, day 1 Strength A, nothing optional.
await prepareWeek(db, '', { blockId: block.id, monday: MON, todayDay: TUE, nowSec, useAi: false })
const rows = await db.select().from(sessions)
assert.ok(rows.length > 0, 'the start week has sessions')
assert.ok(rows.every(r => (r.scheduledDate as number) >= THU && (r.scheduledDate as number) < NEXT), 'all from Thursday to Sunday')
assert.ok(rows.every(r => !isLeadInContext(r.contextJson)), 'nothing stamped lead-in')
assert.ok(rows.some(r => r.scheduledDate === THU && r.label === 'Strength A'), 'day 1 (Thu) is Strength A')
assert.ok(await latestWeekPlan(db, block.id, 1), 'the start week is week 1 (Program sees Block Zero begun)')
console.log('ok: the start week is week 1 from Thursday')

// CHANGE DAY: out of range is refused; next Monday moves it, its sessions go.
assert.equal((await moveBlockZeroStart(db, block.id, TUE - 1, TUE)).ok, false, 'not yesterday')
assert.equal((await moveBlockZeroStart(db, block.id, TUE + 7, TUE)).ok, false, 'not a week on')
const moved = await moveBlockZeroStart(db, block.id, NEXT, TUE)
assert.ok(moved.ok && moved.block.startedAt === startedAtForLocalDay(NEXT), 'the start is next Monday at noon UTC')
assert.equal((await db.select().from(sessions)).length, 0, 'the Thursday sessions went with the old day')
await prepareWeek(db, '', { blockId: block.id, monday: NEXT, todayDay: TUE, nowSec, useAi: false })
const week1 = await db.select().from(sessions)
assert.ok(week1.length > 0 && week1.every(r => (r.scheduledDate as number) >= NEXT && !isLeadInContext(r.contextJson)), 'a Monday start is week 1, no lead-in')
assert.deepEqual(await generateDaySessions(db, THU, TUE, nowSec), [], 'Thursday is before the start now')
console.log('ok: CHANGE DAY moves the start and its sessions')

// CHANGE DAY to TODAY starts now; after that it can't move.
const now = await moveBlockZeroStart(db, block.id, TUE, TUE)
assert.ok(now.ok, 'today is a choice')
const today = await generateDaySessions(db, TUE, TUE, nowSec)
assert.ok(today.length > 0 && today.some(r => r.label === 'Strength A'), 'today gets day 1 at once (Strength A)')
const again = await moveBlockZeroStart(db, block.id, THU, TUE)
assert.ok(!again.ok && again.status === 409, 'a started block keeps its day')
const [stored] = await db.select().from(trainingBlocks).where(eq(trainingBlocks.id, block.id))
assert.equal(Math.floor((stored.startedAt as number) / 86400), TUE, 'stored as the local day')
console.log('ok: TODAY starts now; a started block keeps its day')

console.log('server startDay: all ok')

// Run: tsx src/server/reviewFixes.test.ts
// Coach fixes from review-2026-10-24 on a migrated test database (made-up
// data): T1 a rough-morning cap lifts when the check-in is fixed; T7 a missed
// session logged late takes its missed fix back off; T8 two missed fixes
// written at once end as one.
import assert from 'node:assert/strict'
import { and, eq, isNull } from 'drizzle-orm'
import { dailyLogs, sessions, settings, weekAdjustments } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { mergedLiftsFrom } from '../lib/coach/missed'
import { createTrainingBlock } from './blocks'
import { brainCapFrom, capToday } from './brain'
import { applyMissedFixes, takeBackMissedFix } from './changes'
import { prepareWeek } from './weeklyPass'
import { testDb } from './testDb'
import { setFixedWeekForTests } from './onePlan'

// Written on the old fixed week (Strength A Mon, B Wed, C Fri).
setFixedWeekForTests(true)

const MON = isoToEpochDay('2027-01-04')
const nowSec = (day: number, h = 7) => day * 86400 + h * 3600

async function setup() {
  const db = testDb()
  await db.insert(settings).values({ id: 'default', mtClassDays: '', createdAt: 1, updatedAt: 1 })
  const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec(MON - 14), startedAt: startedAtForLocalDay(MON - 14) })
  for (let d = MON - 14; d < MON; d++) await db.insert(dailyLogs).values({ id: `ci${d}`, logDate: d, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, createdAt: d * 86400 })
  await prepareWeek(db, '', { blockId: block!.id, monday: MON, todayDay: MON, nowSec: nowSec(MON), useAi: false })
  return db
}

// ─── T1: the cap lifts when the morning is fixed ──────────────
{
  const db = await setup()
  await db.insert(dailyLogs).values({ id: 'ciMON', logDate: MON, sleepHours: 5, sleepQuality: 2, energy: 1, soreness: 4, stress: 4, mood: 2, backToday: 3, createdAt: MON * 86400 })
  assert.ok(await capToday(db, MON, nowSec(MON, 7)) >= 1, 'energy 1: capped')
  const [s] = await db.select().from(sessions).where(and(eq(sessions.scheduledDate, MON), eq(sessions.type, 'strength')))
  assert.ok(brainCapFrom(s.contextJson) != null)
  // The mis-tap fixed: energy 4, a normal night.
  await db.update(dailyLogs).set({ sleepHours: 7.5, sleepQuality: 3, energy: 4, soreness: 2, stress: 2, mood: 3 }).where(eq(dailyLogs.id, 'ciMON'))
  await capToday(db, MON, nowSec(MON, 8))
  const [after] = await db.select().from(sessions).where(eq(sessions.id, s.id))
  assert.equal(brainCapFrom(after.contextJson), null, 'the cap lifts')
  const open = await db.select().from(weekAdjustments).where(and(eq(weekAdjustments.targetSessionId, s.id), eq(weekAdjustments.actor, 'check_in'), isNull(weekAdjustments.undoneAt)))
  assert.equal(open.length, 0, 'its rune goes quietly')
  console.log('ok: T1 the cap lifts')
}

// ─── T7 and T8: a missed lift, its fix written twice at once, then logged late ──
{
  const db = await setup()
  const [a] = await db.select().from(sessions).where(and(eq(sessions.scheduledDate, MON), eq(sessions.type, 'strength')))
  await db.update(sessions).set({ status: 'missed' }).where(eq(sessions.id, a.id))
  // Two screens at once (T8).
  await Promise.all([applyMissedFixes(db, [a.id], MON + 1, nowSec(MON + 1), () => false), applyMissedFixes(db, [a.id], MON + 1, nowSec(MON + 1), () => false)])
  const rows = await db.select().from(weekAdjustments).where(and(eq(weekAdjustments.kind, 'missed'), eq(weekAdjustments.targetSessionId, a.id), isNull(weekAdjustments.undoneAt)))
  assert.equal(rows.length, 1, 'one missed fix')
  const merged = (await db.select().from(sessions).where(eq(sessions.status, 'planned'))).filter(r => mergedLiftsFrom(r.contextJson))
  assert.equal(merged.length, 1, 'its lifts went into the next strength day')
  // He logs Monday's lifts after all (T7): the merge comes back off.
  assert.equal(await takeBackMissedFix(db, a.id, nowSec(MON + 1, 9)), 1)
  const [target] = await db.select().from(sessions).where(eq(sessions.id, merged[0].id))
  assert.equal(mergedLiftsFrom(target.contextJson), null, 'no lifts done twice')
  const left = await db.select().from(weekAdjustments).where(and(eq(weekAdjustments.kind, 'missed'), eq(weekAdjustments.targetSessionId, a.id), isNull(weekAdjustments.undoneAt)))
  assert.equal(left.length, 0, 'the fix is marked undone')
  console.log('ok: T7 and T8 missed fixes')
}

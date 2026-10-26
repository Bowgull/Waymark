// Run: tsx src/server/bagConditioning.test.ts
// Bag Conditioning on a real (in-memory) database with every migration: a
// planned row previews the coach's pick, the start keeps it once, the week
// planner's pick wins, a shin note or an AMBER morning takes the steady version, and the week's kicks
// count the finisher's done kick sets.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'

import { sessions, settings } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { MOVES, finalConditioningLog, newConditioningLog } from '../lib/coach/bagConditioning'
import { WEEKLY_KICKS } from '../lib/coach/kickBudget'
import { kicksLeftThisWeek } from './bagConditioning'
import { conditioningResponse, startConditioning } from './routes/bagConditioning'
import { testDb } from './testDb'

const MON = isoToEpochDay('2026-10-26')

async function main() {
  const db = testDb()
  const now = Math.floor(Date.now() / 1000)
  await db.delete(settings)
  await db.insert(settings).values({ id: 'default', enabledTechniques: 'boxing,kicks,defensive', createdAt: now, updatedAt: now })

  // a planned row: the coach's pick as it would be now, nothing kept yet
  await db.insert(sessions).values({ id: 'c1', type: 'bag_conditioning', scheduledDate: MON + 2, status: 'planned', createdAt: now })
  const before = await conditioningResponse(db, 'c1')
  assert.equal(before.started, false)
  assert.ok(before.plan && before.plannedMin != null && before.plannedMin <= 60)
  const [still] = await db.select().from(sessions).where(eq(sessions.id, 'c1'))
  assert.equal(still.status, 'planned', 'reading it changes nothing')

  // the start keeps it, once
  const started = await startConditioning(db, 'c1')
  assert.ok(started && started !== 'type' && started.started && started.plan)
  const again = await startConditioning(db, 'c1')
  assert.ok(again && again !== 'type')
  assert.equal(again.plan?.templateId, started.plan?.templateId, 'idempotent: the same plan')
  const [row] = await db.select().from(sessions).where(eq(sessions.id, 'c1'))
  assert.equal(row.status, 'in_progress')
  assert.deepEqual(JSON.parse(row.contextJson!).conditioning.switches.sort(), ['boxing', 'defensive', 'kicks'])

  // the week planner's pick wins (its template, shaped by today's switches)
  await db.insert(sessions).values({ id: 'c2', type: 'bag_conditioning', scheduledDate: MON + 4, status: 'planned', createdAt: now, contextJson: JSON.stringify({ conditioningPick: { templateId: 'kick_minutes' } }) })
  const placed = await startConditioning(db, 'c2')
  assert.ok(placed && placed !== 'type')
  assert.equal(placed.plan?.templateId, 'kick_minutes')

  // a wrong type is refused; a missing one is null
  await db.insert(sessions).values({ id: 'b1', type: 'bag_work', scheduledDate: MON, status: 'planned', createdAt: now })
  assert.equal(await startConditioning(db, 'b1'), 'type')
  assert.equal(await startConditioning(db, 'nope'), null)

  // the week's kicks: a done bag session's finisher (20 a side) and a done Bag Conditioning's kick parts
  await db.update(sessions).set({
    status: 'completed',
    contextJson: JSON.stringify({ finisherLog: { readiness: 'ok', ended: false, at: 7, sets: [
      { key: 'body_kick', name: 'BODY KICK', goal: 20, sec: 45, status: 'done' },
      { key: 'switch_kick', name: 'SWITCH KICK', goal: 20, sec: 45, status: 'done' },
      { key: 'lead_teep', name: 'LEAD TEEP', goal: 20, sec: 45, status: 'done' },
    ] } }),
  }).where(eq(sessions.id, 'b1'))
  const left = await kicksLeftThisWeek(db, MON + 3)
  assert.deepEqual(left, { right: WEEKLY_KICKS[1] - 20, left: WEEKLY_KICKS[1] - 20 }, 'the teep set is not a shin kick')
  const plan = placed.plan!
  const all = { ...newConditioningLog(plan), parts: plan.parts.map(() => 'done' as const) }
  await db.update(sessions).set({ status: 'completed', contextJson: JSON.stringify({ ...JSON.parse((await db.select().from(sessions).where(eq(sessions.id, 'c2')))[0].contextJson!), conditioningLog: finalConditioningLog(all) }) }).where(eq(sessions.id, 'c2'))
  const after = await kicksLeftThisWeek(db, MON + 5)
  assert.ok(after.right < left.right && after.left < left.left, 'the done kick parts count too')
  assert.deepEqual(await kicksLeftThisWeek(db, MON + 9), { right: WEEKLY_KICKS[1], left: WEEKLY_KICKS[1] }, 'a new week starts full')

  // a shin note: the kicks come off (hands and teeps instead)
  await db.insert(sessions).values({ id: 'c3', type: 'bag_conditioning', scheduledDate: MON + 6, status: 'planned', createdAt: now, contextJson: JSON.stringify({ bodyPlan: { op: 'technique' } }) })
  const shin = await startConditioning(db, 'c3')
  assert.ok(shin && shin !== 'type' && shin.plan)
  assert.equal(shin.plan.templateId, 'steady_rounds', 'an injury note: the steady version')
  assert.ok(shin.plan.parts.every(x => !x.move || !MOVES[x.move].groups.includes('kicks')), 'no kicks on a sore leg')

  // a morning AMBER on it: the steady version, even over the week planner's pick
  await db.insert(sessions).values({ id: 'c4', type: 'bag_conditioning', scheduledDate: MON + 5, status: 'planned', createdAt: now, contextJson: JSON.stringify({ conditioningPick: { templateId: 'kick_minutes' }, brainCap: { state: 'AMBER', why: null, at: now } }) })
  const amber = await startConditioning(db, 'c4')
  assert.ok(amber && amber !== 'type' && amber.plan)
  assert.equal(amber.plan.templateId, 'steady_rounds', 'an AMBER morning: the steady version')
  assert.equal(amber.plan.step, 0)

  // a placed lighter week is kept with the started plan
  await db.insert(sessions).values({ id: 'c5', type: 'bag_conditioning', scheduledDate: MON + 7, status: 'planned', createdAt: now, contextJson: JSON.stringify({ conditioningPick: { templateId: 'kick_minutes', lighterWeek: true } }) })
  await startConditioning(db, 'c5')
  const [c5] = await db.select().from(sessions).where(eq(sessions.id, 'c5'))
  assert.equal(JSON.parse(c5.contextJson!).conditioning.lighterWeek, true, 'the lighter week goes through')

  console.log('server bagConditioning tests passed')
}

main().catch(e => { console.error(e); process.exit(1) })

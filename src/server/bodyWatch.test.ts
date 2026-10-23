// Run: tsx src/server/bodyWatch.test.ts
// The raven's lifecycle on a real (in-memory) database, on the mockup's
// weeks (Block Zero week 4 = Mon 19 October 2026): the knee raises it, DO IT
// writes the plan as coach change rows with UNDO (and keeps the days of next
// week pending until they're made), the raven returns the morning after the
// plan, "Not now" waits a day, FEELS BETTER clears it and steps the runs back
// up, STILL SORE gets one readjust, and a second STILL SORE gives the physio
// board, with no third plan, nothing locked and the bikes kept.
import assert from 'node:assert/strict'
import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { bodyAlerts, sessions, weekAdjustments, weekPlans } from '../db/schema'
import { mondayOf, startedAtForLocalDay } from '../lib/coach'
import { isoToEpochDay } from '../lib/dates'
import { createTrainingBlock } from './blocks'
import { answerBody, applyBodyPlan, bodyPlanOf, bodyWatchPayload, gotBodyNote, markAgainstFlag, ravenLineFor } from './bodyWatch'
import { undoChange, weekChangeViews } from './changes'
import { prepareWeek } from './weeklyPass'
import { testDb, type TestDB } from './testDb'

const D = isoToEpochDay
const START = D('2026-09-28')
const THU22 = D('2026-10-22')
const WED28 = D('2026-10-28')
const WED4 = D('2026-11-04')
const at = (day: number, h = 7) => day * 86400 + h * 3600

async function day(db: TestDB, d: number) {
  return db.select().from(sessions).where(eq(sessions.scheduledDate, d))
}
async function one(db: TestDB, d: number, type: string) {
  // A run is a run-walk or, from page 76, a hard run made from the template (week 5 on).
  const s = (await day(db, d)).find(x => x.type === type || (type === 'foundation_run' && x.type === 'running'))
  assert.ok(s, `a ${type} on day ${d}`)
  return s
}

/** Weeks 1-4 made, everything before Thursday done, and the knee story (6, 15, 20, 22 October). */
async function setup(): Promise<{ db: TestDB; blockId: string }> {
  const db = testDb()
  const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: at(START - 2), startedAt: startedAtForLocalDay(START) })
  for (let w = 0; w < 4; w++) {
    const monday = START + w * 7
    await prepareWeek(db, '', { blockId: block.id, monday, todayDay: monday, nowSec: at(monday - 1, 18), useAi: false })
    // This story is the week-4 run-walk jump (2:00 to 3:30); from page 76 week 4 holds two hard runs.
    // The story keeps its three run-walks a week.
    await db.update(sessions).set({ type: 'foundation_run', notes: null, label: 'Run-Walk' }).where(and(eq(sessions.type, 'running'), gte(sessions.scheduledDate, monday), lte(sessions.scheduledDate, monday + 6)))
    // The week is done before the next is made (the counter only moves on done key sessions).
    for (const s of await db.select().from(sessions).where(and(gte(sessions.scheduledDate, monday), lte(sessions.scheduledDate, Math.min(monday + 6, THU22 - 1))))) {
      await db.update(sessions).set({ status: 'completed', completedAt: at(s.scheduledDate as number, 8), durationSec: 1500 }).where(eq(sessions.id, s.id))
    }
  }
  const skip = async (d: number, type: string) => {
    const s = await one(db, d, type)
    await db.update(sessions).set({ status: 'skipped', skipReason: 'injury', skipReasonDetail: 'Knee', completedAt: null }).where(eq(sessions.id, s.id))
  }
  await skip(D('2026-10-06'), 'foundation_run')
  // Thursday's bag work (his, made regular in the mockup's week).
  await db.insert(sessions).values({ id: 'bag15', type: 'bag_work', scheduledDate: D('2026-10-15'), timeSlot: 'pm', status: 'skipped', skipReason: 'injury', skipReasonDetail: 'Knee', blockType: 'block_zero', source: 'ad_hoc', createdAt: at(D('2026-10-15')) })
  const tue = await one(db, D('2026-10-20'), 'foundation_run')
  await db.update(sessions).set({ contextJson: JSON.stringify({ userNotes: 'knee sore the last two rounds' }) }).where(eq(sessions.id, tue.id))
  await skip(THU22, 'foundation_run')
  return { db, blockId: block.id }
}

const { db, blockId } = await setup()

// ── the raven lands ──
const p22 = await bodyWatchPayload(db, THU22, at(THU22))
assert.ok(p22.alert, 'the fourth knee report brings the raven')
const id = p22.alert.id
assert.equal(p22.alert.stage, 'watch')
assert.equal(p22.alert.raven, 'watch', 'unread: it looks round')
assert.deepEqual(p22.alert.line, { text: 'Knee: 4 times in 17 days.', settled: false }, 'the brass line on the Morning Report')
assert.deepEqual(p22.weather, { level: 1, quiet: false, clearing: false }, 'green rain over the world')
assert.equal(p22.alert.board?.key, 'plan1')
assert.equal(p22.alert.board?.head, 'KNEE · 4 IN 17 DAYS')
assert.equal(p22.alert.board?.ctx, 'The last two came the week each run went from 2:00 to 3:30 at a time.', 'the load-jump line, from his real runs')
// Page 76: next week is not made yet, so its runs come from the template: Tuesday's tempo and Saturday's intervals.
assert.deepEqual(p22.alert.board?.chg.map(c => [c.days, c.before, c.after]), [['SAT 24', 'RUN-WALK', 'EASY BIKE'], ['TUE 27', 'TEMPO', 'EASY BIKE'], ['THU 29', 'RUN 4:00 × 5', 'RUN 2:00 × 7'], ['SAT 31', 'INTERVALS', 'RUN 2:00 × 7']], 'the plan on the week, from the made week and the template')
assert.deepEqual(p22.checkIn, [{ region: 'knee', label: 'KNEE TODAY' }], 'Knee today joins the check-in')
assert.equal(await ravenLineFor(db, THU22 + 1, THU22, at(THU22)), 'Knee: 4 times in 17 days. Tap to see.', 'the alarm names it once if unread')
const again = await bodyWatchPayload(db, THU22, at(THU22, 9))
assert.equal(again.alert?.id, id, 'one alert per place: the pass is idempotent')
assert.equal((await db.select().from(bodyAlerts)).length, 1)

// ── GOT IT changes nothing; the rain settles ──
{
  const { db: db2 } = await setup()
  const a = (await bodyWatchPayload(db2, THU22, at(THU22))).alert!
  const before = await db2.select().from(weekAdjustments)
  await gotBodyNote(db2, a.id, at(THU22, 8))
  const after = await bodyWatchPayload(db2, THU22, at(THU22, 9))
  assert.equal(after.alert?.stage, 'noted', 'GOT IT: noted')
  assert.equal(after.alert?.raven, 'held', 'read: the raven sits still')
  assert.equal(after.weather.quiet, true, 'the quieter fall after GOT IT')
  assert.equal((await db2.select().from(weekAdjustments)).length, before.length, 'GOT IT changes nothing on the week')
  assert.deepEqual(after.alert?.board?.btns, ['got', 'doit'], 'DO IT stays on the note')
}

// ── DO IT: coach changes with UNDO; next week's days wait ──
const applied = await applyBodyPlan(db, id, THU22, at(THU22, 7))
assert.ok(applied.ok && applied.toast?.text === 'Bike Sat and Tue. Then 2:00 runs.', 'DO IT: the plan is on')
const sat = await one(db, D('2026-10-24'), 'active_recovery')
assert.equal(sat.label, 'Easy Bike', 'Saturday\'s run-walk is an easy bike')
assert.equal(bodyPlanOf(sat.contextJson)?.was, 'run 3:30 × 5')
const wk4 = await weekChangeViews(db, mondayOf(THU22), THU22)
const satChange = wk4.changes.find(c => c.day === D('2026-10-24'))
assert.ok(satChange && satChange.who === 'COACH' && satChange.rune === 'new' && satChange.lock === 'open', 'a coach change: a Dagaz on Saturday, UNDO open')
assert.deepEqual([satChange.before, satChange.after], ['RUN-WALK', 'EASY BIKE'])
const row = (await db.select().from(bodyAlerts).where(eq(bodyAlerts.id, id)))[0]
assert.equal(row.stage, 'plan1')
assert.deepEqual([row.planStartedAt, row.planEndsAt, row.askOn], [D('2026-10-23'), D('2026-10-27'), WED28], 'plan 1: Fri 23 to Tue 27; the raven returns Wed 28')
assert.equal(JSON.parse(row.pendingJson ?? '[]').length, 3, 'Tue 27, Thu 29 and Sat 31 wait for week 5')
const p22b = await bodyWatchPayload(db, THU22, at(THU22, 8))
assert.equal(p22b.alert?.line?.text, 'Knee plan: bike to Tue 27. The raven\'s back Wed 28.')
assert.equal(p22b.alert?.programLine, 'The knee plan, from Thu 22: no running to Tue 27, then 2:00 at a time. The raven asks Wed 28.')
assert.equal(p22b.weather.quiet, true, 'the rain eases but stays')
assert.equal((await applyBodyPlan(db, id, THU22, at(THU22, 9))).ok, false, 'DO IT twice applies nothing twice')

// UNDO puts Saturday's run back, like any coach change.
const undone = await undoChange(db, satChange.id, THU22, at(THU22, 10))
assert.ok(undone.ok, 'UNDO works on a plan change')
assert.equal((await one(db, D('2026-10-24'), 'foundation_run')).label, 'Run-Walk', 'Saturday is a run-walk again')

// Week 5 is made: the waiting changes land, as coach changes.
await prepareWeek(db, '', { blockId, monday: D('2026-10-26'), todayDay: D('2026-10-25'), nowSec: at(D('2026-10-25'), 18), useAi: false })
assert.equal((await one(db, D('2026-10-27'), 'active_recovery')).label, 'Easy Bike', 'Tue 27 became a bike when week 5 was made')
for (const d of [D('2026-10-29'), D('2026-10-31')]) assert.equal(bodyPlanOf((await one(db, d, 'foundation_run')).contextJson)?.shapeWeek, 3, 'the next two runs come back at 2:00 / 1:00 × 7')
assert.equal(JSON.parse((await db.select().from(bodyAlerts).where(eq(bodyAlerts.id, id)))[0].pendingJson ?? '[]').length, 0, 'nothing left waiting')
const wk5 = await weekChangeViews(db, D('2026-10-26'), D('2026-10-25'))
assert.deepEqual(Object.entries(wk5.runes).filter(([, r]) => r).map(([d]) => Number(d)), [D('2026-10-27'), D('2026-10-29'), D('2026-10-31')], 'Dagaz on Tue, Thu and Sat of week 5')

// Mark week 4's rest and Mon-Tue of week 5 done.
for (const s of await db.select().from(sessions).where(and(gte(sessions.scheduledDate, THU22 + 1), lte(sessions.scheduledDate, WED28 - 1)))) {
  await db.update(sessions).set({ status: 'completed', durationSec: 1500 }).where(eq(sessions.id, s.id))
}

// ── the return, Wed 28 ──
const p28 = await bodyWatchPayload(db, WED28, at(WED28, 6))
assert.equal(p28.alert?.stage, 'ask1', 'the morning after the plan: the raven is back')
assert.equal(p28.alert?.askDue, true, 'the question opens on top')
assert.equal(p28.alert?.ask?.line, 'Five days of bike, no running. Tomorrow\'s run-walk is the first one back.')
assert.equal(p28.alert?.line?.text, 'The raven\'s back: how\'s the knee?')
assert.equal(await ravenLineFor(db, WED28, WED28 - 1, at(WED28 - 1, 21)), 'The raven\'s back: how\'s the knee?', 'the alarm carries the question')
await answerBody(db, id, 'not_now', WED28, at(WED28, 7))
assert.equal((await bodyWatchPayload(db, WED28, at(WED28, 8))).alert?.askDue, false, '"Not now": it waits')
assert.equal((await bodyWatchPayload(db, WED28 + 1, at(WED28 + 1, 6))).alert?.askDue, true, 'and asks again the next morning')
// back to Wed 28 for the answers
await db.update(bodyAlerts).set({ askOn: WED28 }).where(eq(bodyAlerts.id, id))

// ── branch A: FEELS BETTER on Wed 28 ──
{
  const { db: dbA } = { db }
  const snapshot = await dbA.select().from(sessions)
  const better = await answerBody(dbA, id, 'better', WED28, at(WED28, 7))
  assert.ok(better.ok && better.toast?.text === '2:00 Thu, 3:30 Sat, then the plan.', 'FEELS BETTER steps up: 2:00 Thu, 3:30 Sat, then the plan')
  assert.equal(bodyPlanOf((await one(dbA, D('2026-10-29'), 'foundation_run')).contextJson)?.shapeWeek, 3, 'Thu 29 stays 2:00 × 7')
  assert.equal(bodyPlanOf((await one(dbA, D('2026-10-31'), 'foundation_run')).contextJson)?.shapeWeek, 4, 'Sat 31 steps to 3:30 × 5')
  const pA = await bodyWatchPayload(dbA, WED28, at(WED28, 8))
  assert.deepEqual(pA.weather, { level: 0, quiet: false, clearing: true }, 'the clearing')
  assert.equal(pA.alert?.raven, 'settled', 'a teal seal')
  assert.deepEqual(pA.alert?.line, { text: 'Knee feels better.', settled: true })
  assert.deepEqual(pA.alert?.board?.rec.map(r => [r.d, r.x]), [['THU 29', 'First run back: 2:00, walk 1:00 × 7.'], ['SAT 31', '3:30, walk 1:00 × 5 (week 4\'s).'], ['NEXT WEEK', 'Back to the plan: 4:00 × 3.']], 'the good-news board')
  assert.equal((await bodyWatchPayload(dbA, WED28 + 1, at(WED28 + 1))).alert?.raven, 'leave', 'the next day it flies off')
  const gone = await bodyWatchPayload(dbA, WED28 + 2, at(WED28 + 2))
  assert.equal(gone.alert, null, 'then it is gone')
  assert.equal(gone.weather.level, 0, 'and the sky is clear')
  assert.ok(snapshot.length > 0)
}

// ── branch B: STILL SORE, one readjust, then the physio board ──
{
  const { db: dbB, blockId: bB } = await setup()
  const a = (await bodyWatchPayload(dbB, THU22, at(THU22))).alert!
  await applyBodyPlan(dbB, a.id, THU22, at(THU22, 7))
  await prepareWeek(dbB, '', { blockId: bB, monday: D('2026-10-26'), todayDay: D('2026-10-25'), nowSec: at(D('2026-10-25'), 18), useAi: false })
  await dbB.insert(sessions).values({ id: 'bag29', type: 'bag_work', scheduledDate: D('2026-10-29'), timeSlot: 'pm', status: 'planned', blockType: 'block_zero', source: 'ad_hoc', createdAt: at(D('2026-10-25')) })
  for (const s of await dbB.select().from(sessions).where(and(gte(sessions.scheduledDate, THU22 + 1), lte(sessions.scheduledDate, WED28 - 1)))) {
    await dbB.update(sessions).set({ status: 'completed', durationSec: 1500 }).where(eq(sessions.id, s.id))
  }
  await bodyWatchPayload(dbB, WED28, at(WED28, 6))
  await answerBody(dbB, a.id, 'sore', WED28, at(WED28, 7))
  const p2 = await bodyWatchPayload(dbB, WED28, at(WED28, 7))
  assert.equal(p2.alert?.stage, 'offer2', 'STILL SORE: plan 2 is offered')
  assert.equal(p2.alert?.line?.text, 'Knee: still sore.')
  assert.equal(p2.weather.quiet, false, 'green rain again until he answers it')
  assert.equal(p2.alert?.board?.key, 'plan2')
  assert.deepEqual(p2.alert?.board?.chg.map(c => [c.days, c.before, c.after]), [['THU 29', 'RUN-WALK', 'EASY BIKE'], ['THU 29', 'BAG WORK', 'TECHNIQUE'], ['FRI 30', '3 × 8', '2 × 8'], ['SAT 31', 'INTERVALS', 'EASY BIKE'], ['TUE 3', 'TEMPO', 'EASY BIKE']], 'plan 2 on the week (page 76: the hard runs go to the bike too)')
  const ap2 = await applyBodyPlan(dbB, a.id, WED28, at(WED28, 8))
  assert.ok(ap2.ok && ap2.toast?.text === '7 more days of bike, to Tue 3 Nov.')
  const thu29 = await one(dbB, D('2026-10-29'), 'active_recovery')
  assert.equal(thu29.label, 'Easy Bike', 'plan 2 replaces plan 1\'s 2:00 run with a bike')
  assert.equal(bodyPlanOf((await one(dbB, D('2026-10-29'), 'bag_work')).contextJson)?.op, 'technique', 'bag work technique only')
  const fri = await one(dbB, D('2026-10-30'), 'strength')
  assert.equal(JSON.parse(fri.contextJson ?? '{}').coachEase?.kind, 'one_set', 'lifts one set lighter')
  const r2 = (await dbB.select().from(bodyAlerts).where(eq(bodyAlerts.id, a.id)))[0]
  assert.deepEqual([r2.stage, r2.planRound, r2.askOn], ['plan2', 2, WED4], 'plan 2 on; the raven comes back Wed 4 Nov')
  // Week 6 made, the rest done.
  await prepareWeek(dbB, '', { blockId: bB, monday: D('2026-11-02'), todayDay: D('2026-11-01'), nowSec: at(D('2026-11-01'), 18), useAi: false })
  assert.equal((await one(dbB, D('2026-11-03'), 'active_recovery')).label, 'Easy Bike', 'Tue 3 Nov became a bike when week 6 was made')
  for (const s of await dbB.select().from(sessions).where(and(gte(sessions.scheduledDate, WED28), lte(sessions.scheduledDate, WED4 - 1)))) {
    await dbB.update(sessions).set({ status: 'completed', durationSec: 1500 }).where(eq(sessions.id, s.id))
  }
  const p4 = await bodyWatchPayload(dbB, WED4, at(WED4, 6))
  assert.equal(p4.alert?.stage, 'ask2', 'Wed 4 Nov: the raven again')
  assert.equal(p4.alert?.ask?.line, 'Seven more days of bike, no running. Last time it was still sore.')
  await answerBody(dbB, a.id, 'sore', WED4, at(WED4, 7))
  const pp = await bodyWatchPayload(dbB, WED4, at(WED4, 8))
  assert.equal(pp.alert?.stage, 'physio', 'still sore the second time: see a physio')
  assert.equal(pp.alert?.board?.key, 'refer')
  assert.equal(pp.alert?.line?.text, 'Knee: see a physio.')
  assert.equal(pp.weather.level >= 1, true, 'the rain stays')
  for (const d of [D('2026-11-05'), D('2026-11-07')]) assert.equal((await one(dbB, d, 'active_recovery')).label, 'Easy Bike', 'the easy bikes stay in place of runs (approved)')
  const third = await applyBodyPlan(dbB, a.id, WED4, at(WED4, 9))
  assert.equal(third.ok, false, 'no third plan, ever')
  assert.equal((await answerBody(dbB, a.id, 'sore', WED4, at(WED4, 9))).ok, false, 'no more STILL SORE to give')
  // Nothing is locked: the bikes can each be put back.
  const wk6 = await weekChangeViews(dbB, D('2026-11-02'), WED4)
  assert.ok(wk6.changes.filter(c => c.day > WED4).every(c => c.lock === 'open'), 'every change ahead keeps its UNDO')
  // FEELS BETTER on the raven, any morning.
  const fb = await answerBody(dbB, a.id, 'better', WED4 + 1, at(WED4 + 1, 7))
  assert.ok(fb.ok, 'FEELS BETTER at the physio stage clears it')
  assert.equal((await one(dbB, D('2026-11-05'), 'active_recovery')).label, 'Easy Bike', "today's session stays as it is (changes start tomorrow)")
  assert.equal(bodyPlanOf((await one(dbB, D('2026-11-07'), 'foundation_run')).contextJson)?.shapeWeek, 3, 'Sat 7: the first run back, 2:00 × 7')
}

// ── his picks against a place on watch are recorded quietly (T4) ──
{
  const { db: dbC } = await setup()
  await bodyWatchPayload(dbC, THU22, at(THU22))
  const [wp] = await dbC.select().from(weekPlans).limit(1)
  const adj = { id: 'pick1' }
  await dbC.insert(weekAdjustments).values({ id: adj.id, weekPlanId: wp.id, adjustmentType: 'athlete_change', sessionType: 'skip_rope', action: 'add', reason: 'Added, tonight.', status: 'accepted', actor: 'you', kind: 'add', createdAt: at(THU22, 19) })
  await markAgainstFlag(dbC, [adj.id], 'skip_rope', null, THU22)
  assert.equal((await dbC.select().from(weekAdjustments).where(eq(weekAdjustments.id, adj.id)))[0].againstFlag, 'knee', 'a rope pick with the knee on watch is noted, not refused')
  await markAgainstFlag(dbC, [adj.id], 'strength', null, THU22)
  const open = await dbC.select().from(bodyAlerts).where(isNull(bodyAlerts.clearedAt))
  assert.equal(open.length, 1)
}

console.log('bodyWatch server tests passed')

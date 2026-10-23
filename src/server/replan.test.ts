// Run: tsx src/server/replan.test.ts
// Starting at his real level on a migrated test database (MADE-UP data that
// only resembles the pattern): a few dumbbell sessions and continuous runs
// months before the block, a block started mid-week whose week was planned
// by an older lead-in (runs and Foundation, no strength). The re-plan route's
// pass adds the week's first strength session as a coach change (rune and
// UNDO), turns the run-walks into easy continuous runs, doses the lifts from
// the history in lb, and does nothing the second time.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { exercises, sessions, settings, strengthSessionExercises, strengthSets, runSessions, userProfile, weekAdjustments } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { parseDose, replanWeek } from './brain'
import { undoChange } from './changes'
import { refreshAthleteModel } from './athleteModel'
import { testDb } from './testDb'

const LB = 0.45359237
const lb = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg / LB))
const START = isoToEpochDay('2027-02-03') // a Wednesday
const LAST = START - 125
const nowSec = (day: number, h = 15) => day * 86400 + h * 3600

const db = testDb()
await db.insert(settings).values({ id: 'default', mtClassDays: '1,3,5', createdAt: 1, updatedAt: 1 })
await db.insert(userProfile).values({ id: 'default', dob: '1990-04-01', maxHr: 185, injuries: '["lower_back_sensitivity"]', createdAt: 1, updatedAt: 1 })
for (const [id, name, equipment] of [['ex-db-rdl', 'DB Romanian Deadlift', 'dumbbell'], ['ex-db-row', 'Dumbbell Row', 'dumbbell,bench'], ['ex-ohp', 'Overhead Press', 'barbell']]) {
  await db.insert(exercises).values({ id, name, category: 'strength', equipment, createdAt: 1 }).onConflictDoNothing()
}

// History before any block: two dumbbell sessions and three continuous runs.
async function lift(id: string, day: number, exerciseId: string, weightsLb: number[], reps = 8) {
  await db.insert(strengthSessionExercises).values({ id: `${id}-${exerciseId}`, sessionId: id, exerciseId, orderIndex: 0, section: 'main' })
  for (let n = 0; n < weightsLb.length; n++) {
    await db.insert(strengthSets).values({ id: `${id}-${exerciseId}-${n}`, sessionExerciseId: `${id}-${exerciseId}`, setNumber: n + 1, weightKg: weightsLb[n] * LB, reps, completedAt: day * 86400 + 11 * 3600, createdAt: day * 86400 })
  }
}
for (const [id, day] of [['h1', LAST - 7], ['h2', LAST]] as const) {
  await db.insert(sessions).values({ id, type: 'strength', scheduledDate: day, timeSlot: 'am', status: 'completed', blockType: 'road', source: 'template', createdAt: day * 86400 })
  await lift(id, day, 'ex-db-rdl', [35, 35, 35])
  await lift(id, day, 'ex-db-row', [30, 30, 30], 10)
}
for (const [id, day, sec] of [['r1', LAST - 10, 1080], ['r2', LAST - 5, 1020], ['r3', LAST - 2, 1700]] as const) {
  await db.insert(sessions).values({ id, type: 'running', scheduledDate: day, timeSlot: 'am', status: 'completed', blockType: 'road', source: 'template', createdAt: day * 86400 })
  await db.insert(runSessions).values({ id: `${id}-run`, sessionId: id, runType: 'zone2', durationSec: sec, distanceKm: sec / 420, avgHr: 145, isIndoor: 0 })
}

// Block Zero from Wednesday; the start week as an older lead-in planned it: no strength.
const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec(START - 1), startedAt: startedAtForLocalDay(START) })
const plan = [[START, 'mobility', 'Foundation'], [START + 1, 'mobility', 'Foundation'], [START + 1, 'foundation_run', 'Run-Walk'], [START + 2, 'mobility', 'Foundation'],
  [START + 3, 'mobility', 'Foundation'], [START + 3, 'foundation_run', 'Run-Walk'], [START + 4, 'mobility', 'Foundation']] as const
for (const [i, [day, type, label]] of plan.entries()) {
  await db.insert(sessions).values({ id: `w${i}`, type, label, scheduledDate: day, timeSlot: 'am', status: 'planned', blockType: 'block_zero', source: 'template', contextJson: '{"leadIn":true}', createdAt: nowSec(START - 1) })
}

// The re-plan on Wednesday afternoon (after a deploy).
const r = await replanWeek(db, START, nowSec(START))
assert.ok(r.ran, `ran (${r.reason ?? ''})`)
assert.equal(r.changes, 1, 'one coach change: the first strength session')
const rows = await db.select().from(sessions)
const added = rows.find(s => s.type === 'strength' && s.blockType === 'block_zero')
assert.ok(added, 'a strength session this week')
assert.deepEqual([added.label, added.scheduledDate, added.timeSlot, added.source, added.status], ['Strength B', START + 2, 'am', 'coach', 'planned'], 'Strength B on Friday morning (Thursday holds a run; today is never touched)')
const sDose = parseDose(added.doseJson)?.strength
const rdl = sDose?.lifts.find(l => l.exerciseId === 'ex-db-rdl')
assert.ok(rdl, 'the hinge is the DB RDL (the barbell hinge starts later, on the ladder)')
// 2026-10-23: months off, every lift finds its weight from light; 35 lb less ~15% (30 lb) is only the top.
assert.deepEqual([rdl.workUp, rdl.sets, rdl.reps, rdl.targetRir], [true, 4, 8, 3], 'DB RDL: find your weight, 4 × 8')
assert.deepEqual(rdl.setWeightsKg?.map(lb), [20, 25, 30, 30], 'from a light 20 lb, never over 30 lb')
const pulldown = sDose?.accessories?.find(a => a.exerciseId === 'ex-lat-pulldown')
assert.deepEqual([pulldown?.workUp, pulldown?.setWeightsKg?.map(lb)], [true, [20, 25]], 'an accessory finds its weight too: the stack from a light 20 lb')
assert.equal(sDose?.accessories?.some(a => a.exerciseId === 'ex-bird-dogs'), false, 'a bodyweight core move gets no weight')
const [change] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.targetSessionId, added.id))
assert.ok(change && change.actor === 'coach' && change.kind === 'add' && change.undoUntil != null, 'a coach change row with UNDO')
assert.ok(/^Strength B on Friday: strength starts this week, not next Monday/.test(change.why ?? ''), `plain why: ${change.why}`)

for (const id of ['w2', 'w5']) {
  const run = rows.find(s => s.id === id)
  const d = parseDose(run?.doseJson)?.run
  assert.equal(run?.label, 'Zone 2 Run', 'the run-walk reads as a Zone 2 run')
  assert.deepEqual([d?.runSec, d?.walkSec, d?.rounds], [900, 0, 1], '15 min continuous, no walk breaks (his usual 18 less the time off, rounded down)')
}
assert.equal(rows.filter(s => s.status !== 'planned').length, rows.filter(s => s.scheduledDate! < START - 30).length, 'nothing of his changed status')

// Again: nothing new.
const again = await replanWeek(db, START, nowSec(START, 16))
assert.equal(again.changes, 0, 'idempotent')
assert.equal((await db.select().from(sessions).where(eq(sessions.type, 'strength'))).filter(s => s.blockType === 'block_zero').length, 1, 'still one strength session')

// UNDO takes it off, and the next pass does not offer it again that week.
await undoChange(db, change.id, START, nowSec(START, 17))
const third = await replanWeek(db, START, nowSec(START, 18))
assert.equal(third.changes, 0, 'taken off with UNDO: not offered again this week')

// The stored model shows where it started.
const model = await refreshAthleteModel(db, START, nowSec(START, 19))
assert.equal(model.lifts['ex-db-row'].workingSource, 'history')
assert.equal(model.lifts['ex-db-row'].workingKg, null, 'no start from June')
assert.equal(lb(model.lifts['ex-db-row'].seed?.capKg), 25, 'June 30 lb less the time off: the top')
assert.deepEqual([model.run.rungSec, model.run.rungSource], [900, 'history'])

console.log('re-plan from history tests passed')

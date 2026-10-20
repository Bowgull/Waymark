// Run: tsx src/server/athleteModel.test.ts
// Coach brain P1: the athlete model on a migrated test database (made-up
// data). The live model starts from scratch at the active block's start;
// rows are rebuilt nightly, idempotently, and nothing else is written.
import assert from 'node:assert/strict'
import { athleteEstimates, dailyLogs, sessions, strengthSessionExercises, strengthSets, userProfile } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { localDayOf, localMinuteOf, readAthleteEstimates, refreshAthleteModel } from './athleteModel'
import { testDb } from './testDb'

const JUNE = isoToEpochDay('2026-06-10')
const START = isoToEpochDay('2026-10-26')
const nowSec = (day: number) => day * 86400 + 10 * 3600

// Toronto: 6:40 AM EDT is 10:40 UTC; the day rolls at local midnight.
assert.equal(localMinuteOf(Date.UTC(2026, 9, 27, 10, 40) / 1000), 6 * 60 + 40)
assert.equal(localMinuteOf(Date.UTC(2027, 0, 5, 11, 40) / 1000), 6 * 60 + 40, 'EST in winter')
assert.equal(localDayOf(Date.UTC(2026, 9, 28, 2, 0) / 1000), isoToEpochDay('2026-10-27'), '10 PM local is still the 27th')

const db = testDb()
await db.insert(userProfile).values({ id: 'default', dob: '1990-06-01', injuries: '["lower_back_sensitivity"]', createdAt: 1, updatedAt: 1 })

async function strength(id: string, day: number, rir: number | null, startedLocalMin = 6 * 60 + 40) {
  await db.insert(sessions).values({ id, type: 'strength', scheduledDate: day, timeSlot: 'am', status: 'completed', startedAt: day * 86400 + (startedLocalMin + 240) * 60, rpe: 6, blockType: 'block_zero', source: 'template', createdAt: day * 86400 })
  await db.insert(strengthSessionExercises).values({ id: `${id}-ex`, sessionId: id, exerciseId: 'ex-goblet-squat', orderIndex: 0, section: 'main' })
  for (let n = 1; n <= 3; n++) {
    await db.insert(strengthSets).values({ id: `${id}-${n}`, sessionExerciseId: `${id}-ex`, setNumber: n, weightKg: 22.68, reps: 8, plannedWeightKg: 22.68, plannedReps: 8, rir, completedAt: day * 86400 + 11 * 3600, createdAt: day * 86400 })
  }
}

// June (before any block): testing the app, never learned from.
await strength('june', JUNE, null, 9 * 60)
await db.insert(dailyLogs).values({ id: 'jl', logDate: JUNE, sleepHours: 5, soreness: 5, backToday: 1, notes: 'lower back sore', createdAt: JUNE * 86400 })

// No active block: nothing learned, every area a GUESS at u = 1.
let model = await refreshAthleteModel(db, START - 1, nowSec(START - 1))
assert.deepEqual(Object.keys(model.lifts), [])
for (const c of [model.run, model.bag, model.klass, model.recovery, model.back, model.adherence]) assert.deepEqual([c.state, c.u], ['GUESS', 1])
let rows = await readAthleteEstimates(db)
assert.ok(rows.length >= 12, 'every area has a row from night one')
assert.ok(rows.every(r => r.state === 'GUESS' && r.uncertainty === 1), 'all priors')

// Block Zero starts; three sessions with RIR in week 1, plus June still on file.
await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec(START), startedAt: startedAtForLocalDay(START) })
model = await refreshAthleteModel(db, START, nowSec(START))
assert.deepEqual(Object.keys(model.lifts), [], 'June is ignored at the block start')
await strength('w1a', START, 2)
await strength('w1b', START + 2, 2)
await strength('w1c', START + 4, 2)
for (let i = 0; i < 5; i++) await db.insert(dailyLogs).values({ id: `l${i}`, logDate: START + i, sleepHours: 7.5, soreness: 2, backToday: 3, createdAt: (START + i) * 86400 })

model = await refreshAthleteModel(db, START + 5, nowSec(START + 5))
const sq = model.lifts['ex-goblet-squat']
assert.equal(sq.state, 'KNOWN', 'three steady RIR sessions in the block')
assert.equal(sq.exposures, 3, 'the June exposure is not counted')
assert.equal(model.recovery.state, 'LEARNING')
assert.equal(model.recovery.baseline.soreness?.mean, 2, "June's soreness 5 is not in the baseline")
assert.equal(model.back.backNotes, 0, "June's back note is not read")
assert.equal(model.adherence.usualStart.strength.minute, 6 * 60 + 40, 'local start times')

rows = await readAthleteEstimates(db)
const lift = rows.find(r => r.kind === 'lift' && r.key === 'ex-goblet-squat')
assert.ok(lift && lift.state === 'KNOWN' && lift.uncertainty === 0.15 && lift.asOfDay === START + 5)
const count = rows.length

// Idempotent: the same night again changes nothing but the stamp.
await refreshAthleteModel(db, START + 5, nowSec(START + 5) + 60)
const again = await readAthleteEstimates(db)
assert.equal(again.length, count)
assert.deepEqual(again.map(r => [r.kind, r.key, r.valueJson, r.state, r.uncertainty]).sort(), rows.map(r => [r.kind, r.key, r.valueJson, r.state, r.uncertainty]).sort())

// Ageing: three weeks later with nothing logged, KNOWN fades.
model = await refreshAthleteModel(db, START + 26, nowSec(START + 26))
assert.equal(model.lifts['ex-goblet-squat'].u, 0.45)
assert.equal(model.lifts['ex-goblet-squat'].state, 'LEARNING')

// A lift that leaves the model leaves the table.
await db.insert(athleteEstimates).values({ id: 'stale', kind: 'lift', key: 'ex-gone', valueJson: '{}', state: 'GUESS', n: 0, uncertainty: 1, asOfDay: 0, updatedAt: 0 })
await refreshAthleteModel(db, START + 26, nowSec(START + 26))
assert.ok(!(await readAthleteEstimates(db)).some(r => r.key === 'ex-gone'))

// Shadow only: the sessions themselves are untouched.
const s = await db.select().from(sessions)
assert.ok(s.every(x => x.status === 'completed' && x.contextJson == null))
console.log('ok: athlete model store')

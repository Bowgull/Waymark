// Run: tsx src/server/brain.test.ts
// Coach brain P2 on a migrated test database (made-up data): the nightly pass
// writes every session's dose; the morning check-in can only cap today (a
// change row with UNDO, never another day); UNDO puts the night's dose back
// and holds the session; a quiet stretch skips the pass; the phone's zone is
// kept; the start route reads the stored dose.
import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { dailyLogs, sessions, settings, weekAdjustments } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { brainCapFrom, capToday, doseFor, parseDose, runBrainNight, runLabelFor, runShapeLabel, type StoredDose } from './brain'
import { undoChange } from './changes'
import { prepareWeek } from './weeklyPass'
import { athleteTimeZone, localDayIn, noteAppOpen } from './timeZone'
import { testDb } from './testDb'

const MON = isoToEpochDay('2027-01-04')
const nowSec = (day: number, h = 7) => day * 86400 + h * 3600

const db = testDb()
await db.insert(settings).values({ id: 'default', mtClassDays: '1,3,5', createdAt: 1, updatedAt: 1 })
const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec(MON - 14), startedAt: startedAtForLocalDay(MON - 14) })
// Two steady weeks of check-ins: his baseline.
for (let d = MON - 14; d < MON; d++) await db.insert(dailyLogs).values({ id: `ci${d}`, logDate: d, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, createdAt: d * 86400 })
await prepareWeek(db, '', { blockId: block.id, monday: MON, todayDay: MON, nowSec: nowSec(MON), useAi: false })

// The night: every planned key session for the week gets its dose.
const night = await runBrainNight(db, MON, nowSec(MON))
assert.ok(night.ran, `the pass ran (${night.reason ?? ''})`)
const week = await db.select().from(sessions)
const strength = week.find(s => s.scheduledDate === MON && s.type === 'strength')
assert.ok(strength, 'Monday has Strength A')
const dose = parseDose(strength.doseJson)
assert.ok(dose?.strength, 'its dose is stored')
assert.equal(dose.state, 'GREEN', 'a steady week: GREEN')
assert.ok(dose.strength.lifts.every(l => l.workUp), 'nothing lifted yet: find your weight')
const run = week.find(s => s.type === 'foundation_run' && s.scheduledDate === MON + 1)
assert.equal(parseDose(run?.doseJson)?.run?.rounds, 6, 'the first run-walk: 6 rounds')
assert.ok(week.filter(s => s.type === 'foundation_run').every(s => parseDose(s.doseJson)?.run != null), 'every run-walk has a dose')

// The start route reads the stored dose (the same one Today showed).
const read = await doseFor(db, strength, MON)
assert.equal(read?.at, dose.at, 'stored dose read back, not recomputed')

// A rough morning: the check-in caps today only.
await db.insert(dailyLogs).values({ id: 'ciMON', logDate: MON, sleepHours: 5.5, sleepQuality: 2, energy: 2, soreness: 4, stress: 3, mood: 2, backToday: 3, createdAt: MON * 86400 })
const capped = await capToday(db, MON, nowSec(MON, 11))
assert.equal(capped, 1, 'one change row: the strength session')
const [after] = await db.select().from(sessions).where(eq(sessions.id, strength.id))
assert.equal(brainCapFrom(after.contextJson)?.state, 'AMBER')
const cappedDose = parseDose(after.doseJson)
assert.equal(cappedDose?.state, 'AMBER')
assert.ok(cappedDose!.strength!.sets < dose.strength.sets, 'fewer sets today')
const tomorrow = (await db.select().from(sessions).where(eq(sessions.id, run!.id)))[0]
assert.equal(brainCapFrom(tomorrow.contextJson), null, 'never another day')
const [row] = await db.select().from(weekAdjustments).where(and(eq(weekAdjustments.targetSessionId, strength.id), eq(weekAdjustments.actor, 'check_in')))
assert.ok(row && row.kind === 'ease' && /slept 5.5 h/i.test(row.why ?? ''), `the rune's why: ${row?.why}`)

// UNDO: the night's dose comes back, and the session is held.
const undone = await undoChange(db, row.id, MON, nowSec(MON, 11))
assert.ok(undone.ok, 'undo works')
const [back] = await db.select().from(sessions).where(eq(sessions.id, strength.id))
assert.equal(brainCapFrom(back.contextJson), null, 'cap removed')
const again = await doseFor(db, back, MON)
assert.equal(again?.state, 'GREEN', 'the dose is the night\'s again')
assert.equal(await capToday(db, MON, nowSec(MON, 12)), 0, 'a held session is not capped again')

// A quiet stretch: nothing logged and the app not opened in 2 days skips the pass.
const quiet = await runBrainNight(db, MON + 9, nowSec(MON + 9))
assert.equal(quiet.ran, false)
assert.equal(quiet.reason, 'inactive')

// The phone's zone is kept; the app open counts as activity.
assert.equal(await athleteTimeZone(db), 'America/Toronto', 'the stand-in before any phone sends one')
await noteAppOpen(db, 'America/Vancouver', nowSec(MON + 9, 18))
assert.equal(await athleteTimeZone(db), 'America/Vancouver')
assert.equal(localDayIn(Date.UTC(2027, 0, 13, 6, 0) / 1000, 'America/Vancouver'), isoToEpochDay('2027-01-12'), '10 PM in Vancouver is still the 12th')
const woke = await runBrainNight(db, MON + 10, nowSec(MON + 10))
assert.ok(woke.ran, 'opened yesterday: the pass runs')

// Audit #8 / #14: one name per run, from its dose's shape.
{
  const shape = (run: Partial<NonNullable<StoredDose['run']>>) => ({ run: { walkOnly: false, rounds: 1, walkSec: 0, runSec: 900, ...run } } as unknown as StoredDose)
  assert.equal(runShapeLabel({ walkOnly: true, rounds: 0, walkSec: 0, runSec: 0 }), 'Easy Walk or Bike')
  assert.equal(runShapeLabel({ walkOnly: false, rounds: 1, walkSec: 0, runSec: 900 }), 'Zone 2 Run')
  assert.equal(runShapeLabel({ walkOnly: false, rounds: 6, walkSec: 60, runSec: 90 }), 'Run-Walk')
  const bzRun = { type: 'foundation_run', blockType: 'block_zero', label: 'Run-Walk', notes: null }
  assert.equal(runLabelFor(bzRun, shape({})), 'Zone 2 Run', 'a continuous dose: Zone 2 Run on its row')
  assert.equal(runLabelFor(bzRun, shape({ walkOnly: true, rounds: 0, runSec: 0 })), 'Easy Walk or Bike', 'a walk-only dose: never RUN-WALK')
  assert.equal(runLabelFor({ ...bzRun, type: 'running', label: null, notes: 'zone2' }, shape({})), 'Zone 2 Run', 'a Block Zero Zone 2 run reads Zone 2 Run')
  assert.equal(runLabelFor({ ...bzRun, label: 'Hill Loop' }, shape({})), 'Hill Loop', 'a name he gave stays')
  assert.equal(runLabelFor({ ...bzRun, blockType: 'fighter' }, shape({})), 'Run-Walk', 'outside Block Zero: unchanged')
}

console.log('server coach brain tests passed')

// Run: tsx src/server/hardRuns.test.ts
// Hard runs on the server (page 76) on a migrated test database, MADE-UP
// data only: Block Zero week 4 with two MT classes is a heavy week, so the
// night's pass keeps one hard run (the 5K test) and Saturday's run hard /
// jog goes easy as a coach change with its rune and UNDO; UNDO holds it.
// The 5K test's result is stored for Ledger (fiveKTests) and its time sets
// Saturday's speeds. The line after a run compares with the last outside run
// at the same heart rate.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { runSessions, sessions, settings, userProfile, weekAdjustments } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { balanceHardRuns, doseFor, loadBrainInputs, parseDose } from './brain'
import { undoChange } from './changes'
import { fiveKTests, postRunFacts } from './fiveK'
import { getActiveBlock } from './blockZeroData'
import { testDb } from './testDb'

const M1 = isoToEpochDay('2027-03-01') // a Monday: week 1
const M4 = M1 + 21 // week 4
const TODAY = M4 // Monday of week 4
const nowSec = (day: number, h = 21) => day * 86400 + h * 3600

const db = testDb()
await db.insert(settings).values({ id: 'default', mtClassDays: '', createdAt: 1, updatedAt: 1 })
await db.insert(userProfile).values({ id: 'default', dob: '1990-04-01', maxHr: 186, createdAt: 1, updatedAt: 1 })
await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec(M1 - 1), startedAt: startedAtForLocalDay(M1) })

// Weeks 1-3 trained (a strength day and continuous easy runs each week, outside, with the strap), and this Monday's strength.
let n = 0
for (const w of [0, 1, 2]) {
  const m = M1 + w * 7
  await db.insert(sessions).values({ id: `s${w}`, type: 'strength', label: 'Strength A', scheduledDate: m, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: m * 86400, completedAt: m * 86400 + 40000 })
  for (const d of [1, 3, 5]) {
    const id = `r${n++}`
    await db.insert(sessions).values({ id, type: 'running', notes: 'zone2', label: 'Easy Run', scheduledDate: m + d, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: (m + d) * 86400, completedAt: (m + d) * 86400 + 40000 })
    await db.insert(runSessions).values({ id: `${id}-run`, sessionId: id, runType: 'zone2', durationSec: 2400, distanceKm: 2400 / 420, avgHr: 128, isIndoor: 0 })
  }
}
await db.insert(sessions).values({ id: 'mon4', type: 'strength', label: 'Strength A', scheduledDate: M4, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: M4 * 86400, completedAt: M4 * 86400 + 40000 })

// Week 4 as the template plans it (page 76): Tuesday the 5K test, Thursday easy, Saturday run hard / jog; and two MT classes he booked.
const week4 = [
  ['tue', M4 + 1, 'running', '5k_test', '5K Test'], ['thu', M4 + 3, 'foundation_run', null, 'Run-Walk'], ['sat', M4 + 5, 'running', 'intervals', 'Hard Run'],
] as const
for (const [id, day, type, notes, label] of week4) {
  await db.insert(sessions).values({ id, type, notes, label, scheduledDate: day, timeSlot: 'pm', status: 'planned', blockType: 'block_zero', source: 'template', createdAt: nowSec(M4 - 1) })
}
for (const [id, day] of [['cl1', M4 + 2], ['cl2', M4 + 4]] as const) {
  await db.insert(sessions).values({ id, type: 'mt_class', label: 'MT Class', scheduledDate: day, timeSlot: 'pm', status: 'planned', blockType: 'block_zero', source: 'ad_hoc', createdAt: nowSec(M4 - 1) })
}

// The night's pass: two classes make a heavy week: one hard run (the test), Saturday goes easy with a rune.
const block = await getActiveBlock(db)
assert.ok(block)
const inp = await loadBrainInputs(db, TODAY)
const shown = await balanceHardRuns(db, block, M4, TODAY, inp, nowSec(TODAY), { budget: 2, restDue: null })
assert.equal(shown, 1, 'one coach change')
const rowOf = async (id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]
assert.deepEqual([(await rowOf('tue')).type, (await rowOf('tue')).notes], ['running', '5k_test'], 'the test stays')
const sat = await rowOf('sat')
assert.deepEqual([sat.type, sat.notes, sat.label], ['foundation_run', null, 'Run-Walk'], 'Saturday goes easy')
assert.equal((await rowOf('thu')).type, 'foundation_run', 'Thursday stays easy')
const [rune] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.targetSessionId, 'sat'))
assert.ok(rune && rune.actor === 'coach' && rune.kind === 'ease' && rune.undoUntil != null, 'a coach change with UNDO (the rune: KEEP or UNDO)')
assert.match(rune.why ?? '', /^Saturday's hard run goes easy: 2 classes and bag days this week: one hard run, the rest easy\. Tuesday's hard run stays\.$/)

// UNDO puts Saturday's hard run back, and the pass leaves it there for the week.
const undone = await undoChange(db, rune.id, TODAY, nowSec(TODAY, 22))
assert.ok(undone.ok, JSON.stringify(undone))
assert.deepEqual([(await rowOf('sat')).type, (await rowOf('sat')).notes], ['running', 'intervals'], 'back as planned')
assert.equal(await balanceHardRuns(db, block, M4, TODAY, inp, nowSec(TODAY, 23), { budget: 2, restDue: null }), 0, 'held for the week')
assert.equal((await rowOf('sat')).notes, 'intervals')

// The test's dose: the 5 km at a first guess from his easy pace, the warm-up and cool-down easy.
const tdose = await doseFor(db, await rowOf('tue'), TODAY)
const testDose = tdose?.run?.hard
assert.ok(testDose && testDose.kind === 'test' && testDose.fiveK == null, 'the first test, from a guess')
assert.equal((await rowOf('tue')).label, '5K Test')

// He runs the test: 27:48 for the 5 km. The contract Ledger reads.
await db.update(sessions).set({ status: 'completed', completedAt: (M4 + 1) * 86400 + 70000 }).where(eq(sessions.id, 'tue'))
await db.insert(runSessions).values({ id: 'tue-run', sessionId: 'tue', runType: '5k_test', durationSec: 2700, distanceKm: 7.4, avgHr: 171, isIndoor: 0, fiveKSec: 27 * 60 + 48 })
assert.deepEqual(await fiveKTests(db), [{ day: M4 + 1, sec: 1668, sessionId: 'tue' }])

// Saturday's run hard / jog now runs at the test's speeds (5K 10.8 km/h: run hard 11.3, jog 7.8), labelled by its dose.
const satDose = await doseFor(db, await rowOf('sat'), M4 + 2)
assert.deepEqual(satDose?.run?.hard?.fiveK, { day: M4 + 1, sec: 1668 })
assert.equal(satDose?.run?.hard?.speeds.hard, 11.3)
assert.equal(satDose?.run?.hard?.reps, 5, 'five reps the week of the test')
assert.equal(satDose?.run?.hard?.heart.top, 176, 'run hard up to 95% of 186')
assert.equal((await rowOf('sat')).label, 'Hard × 5')
assert.equal(parseDose((await rowOf('sat')).doseJson)?.run?.totalSec, 600 + 5 * 240 + 300)

// The line after a run: the last outside run at about the same heart rate.
const [lastEasy] = await db.select().from(runSessions).where(eq(runSessions.id, 'r8-run'))
const facts = await postRunFacts(db, { ...lastEasy, durationSec: 2340, avgHr: 130 })
assert.ok(facts && facts.outdoor && !facts.first && facts.sameHrPaceSecKm === 420, JSON.stringify(facts))

console.log('server hardRuns: ok')

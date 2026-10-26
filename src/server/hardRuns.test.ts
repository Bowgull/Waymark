// Run: tsx src/server/hardRuns.test.ts
// Hard runs on the server (page 76) on a migrated test database, MADE-UP
// data only. Week 4 with two MT classes is a heavy week: the night's pass
// keeps one hard run and the other goes easy as a coach change (rune, UNDO);
// UNDO holds it. A 5K test he ran is stored for Ledger (fiveKTests) and sets
// the speeds. Four weeks on, his hard runs at their speeds make him ready:
// the coach places a test on a hard run, not the day after a class, as a
// coach change; UNDO holds that too. The line after a run compares with the
// last outside run at the same heart rate.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { dailyLogs, runSessions, sessions, settings, userProfile, weekAdjustments } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { balanceHardRuns, doseFor, loadBrainInputs } from './brain'
import { undoChange } from './changes'
import { fiveKTests, postRunFacts } from './fiveK'
import { getActiveBlock } from './blockZeroData'
import { testDb } from './testDb'
import { setFixedWeekForTests } from './onePlan'

// These stories are written on the old fixed Block Zero week (rebuild Phase 2 keeps it for them).
setFixedWeekForTests(true)

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
    await db.insert(sessions).values({ id, type: 'running', notes: 'zone2', label: 'Zone 2 Run', scheduledDate: m + d, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: (m + d) * 86400, completedAt: (m + d) * 86400 + 40000 })
    await db.insert(runSessions).values({ id: `${id}-run`, sessionId: id, runType: 'zone2', durationSec: 2400, distanceKm: 2400 / 420, avgHr: 128, isIndoor: 0 })
  }
}
// The lift sits on Sunday: no hard run in the 48 h after heavy legs (rebuild Phase 2), so Tuesday evening is clear.
await db.insert(sessions).values({ id: 'mon4', type: 'strength', label: 'Strength A', scheduledDate: M4 - 1, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: (M4 - 1) * 86400, completedAt: (M4 - 1) * 86400 + 40000 })

// Week 4 as the template plans it (page 76): Tuesday tempo, Thursday easy, Saturday intervals; and two MT classes he booked.
const runRow = (id: string, day: number, type: string, notes: string | null, label: string, status = 'planned') =>
  db.insert(sessions).values({ id, type, notes, label, scheduledDate: day, timeSlot: 'pm', status, blockType: 'block_zero', source: 'template', createdAt: nowSec(day - 1) })
await runRow('tue', M4 + 1, 'running', 'tempo', 'Tempo')
await runRow('thu', M4 + 3, 'foundation_run', null, 'Run-Walk')
await runRow('sat', M4 + 5, 'running', 'intervals', 'Intervals')
const mtClass = (id: string, day: number) => db.insert(sessions).values({ id, type: 'mt_class', label: 'MT Class', scheduledDate: day, timeSlot: 'pm', status: 'planned', blockType: 'block_zero', source: 'ad_hoc', createdAt: nowSec(day - 1) })
await mtClass('cl1', M4 + 2)
await mtClass('cl2', M4 + 4)

// The night's pass: two classes make a heavy week: one hard run stays, the other goes easy with a rune.
const block = await getActiveBlock(db)
assert.ok(block)
const inp = await loadBrainInputs(db, TODAY)
assert.equal(await balanceHardRuns(db, block, M4, TODAY, inp, nowSec(TODAY), { budget: 2, restDue: null }), 1, 'one coach change')
const rowOf = async (id: string) => (await db.select().from(sessions).where(eq(sessions.id, id)))[0]
const kinds = async () => Promise.all(['tue', 'thu', 'sat'].map(async id => (await rowOf(id)).type))
assert.deepEqual(await kinds(), ['running', 'foundation_run', 'foundation_run'], 'Tuesday stays hard; Saturday goes easy')
const [rune] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.targetSessionId, 'sat'))
assert.ok(rune && rune.actor === 'coach' && rune.kind === 'ease' && rune.undoUntil != null, 'a coach change with UNDO (the rune: KEEP or UNDO)')
assert.match(rune.why ?? '', /^Saturday's hard run goes easy: 2 classes and bag days this week: one hard run, the rest easy\. Tuesday's hard run stays\.$/)

// UNDO puts Saturday's hard run back, and the pass leaves it there for the week.
const undone = await undoChange(db, rune.id, TODAY, nowSec(TODAY, 22))
assert.ok(undone.ok, JSON.stringify(undone))
assert.deepEqual([(await rowOf('sat')).type, (await rowOf('sat')).notes], ['running', 'intervals'], 'back as planned')
// Review T2: his UNDO holds Saturday, but no longer blocks every other ease: the heavy week eases Tuesday instead.
assert.equal(await balanceHardRuns(db, block, M4, TODAY, inp, nowSec(TODAY, 23), { budget: 2, restDue: null }), 1, 'Saturday held; Tuesday eased')
assert.deepEqual([(await rowOf('sat')).type, (await rowOf('tue')).type], ['running', 'foundation_run'], 'his pick stays, the other goes easy')
await undoChange(db, (await db.select().from(weekAdjustments).where(eq(weekAdjustments.targetSessionId, 'tue')))[0].id, TODAY, nowSec(TODAY, 23))
assert.equal(await balanceHardRuns(db, block, M4, TODAY, inp, nowSec(TODAY, 23), { budget: 2, restDue: null }), 0, 'both held now: nothing more')

// Saturday's dose: speeds a guess until the first test; labelled by its dose.
const satGuess = await doseFor(db, await rowOf('sat'), TODAY)
assert.ok(satGuess?.run?.hard && satGuess.run.hard.fiveK == null, 'a guess before any test')
assert.equal((await rowOf('sat')).label, 'Intervals')

// He picks a 5K test himself (+ add) on Thursday and runs 27:48: it counts like the coach's.
await db.insert(sessions).values({ id: 'mytest', type: 'running', notes: '5k_test', label: '5K Test', scheduledDate: M4 + 3, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'ad_hoc', createdAt: nowSec(M4 + 3, 6), completedAt: (M4 + 3) * 86400 + 30000 })
await db.insert(runSessions).values({ id: 'mytest-run', sessionId: 'mytest', runType: '5k_test', durationSec: 2700, distanceKm: 7.4, avgHr: 171, isIndoor: 1, fiveKSec: 27 * 60 + 48 })
assert.deepEqual(await fiveKTests(db), [{ day: M4 + 3, sec: 1668, sessionId: 'mytest' }])
const satDose = await doseFor(db, await rowOf('sat'), M4 + 4)
assert.deepEqual(satDose?.run?.hard?.fiveK, { day: M4 + 3, sec: 1668 })
assert.equal(satDose?.run?.hard?.speeds.hard, 11.3, '5K 10.8 km/h: run hard 11.3')
assert.equal(satDose?.run?.hard?.heart.top, 176, 'run hard up to 95% of 186')

// Weeks 5 to 7 trained; two hard runs in the last 3 weeks done at their speeds, well under the top.
for (const w of [1, 2, 3]) {
  const m = M4 + w * 7
  await db.insert(sessions).values({ id: `str${w}`, type: 'strength', label: 'Strength A', scheduledDate: m, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: m * 86400, completedAt: m * 86400 + 40000 })
}
const M8 = M4 + 28
await db.insert(sessions).values({ id: 'str8', type: 'strength', label: 'Strength A', scheduledDate: M8 - 1, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: (M8 - 1) * 86400, completedAt: (M8 - 1) * 86400 + 40000 })
for (const [id, day] of [['h1', M8 - 9], ['h2', M8 - 2]] as const) {
  await runRow(id, day, 'running', 'intervals', 'Intervals', 'completed')
  await db.update(sessions).set({ doseJson: JSON.stringify({ v: 1, run: { hard: { heart: { top: 176 } } } }) }).where(eq(sessions.id, id))
  await db.insert(runSessions).values({ id: `${id}-run`, sessionId: id, runType: 'intervals', durationSec: 2400, completionRatio: 1, maxHr: 166, avgHr: 150, isIndoor: 1 })
}
// Week 8: tempo Tuesday, easy Thursday, intervals Saturday, and a class Monday night.
await runRow('tue8', M8 + 1, 'running', 'tempo', 'Tempo')
await runRow('thu8', M8 + 3, 'foundation_run', null, 'Run-Walk')
await runRow('sat8', M8 + 5, 'running', 'intervals', 'Intervals')
await mtClass('cl8', M8)

// Ready (25 days on, well under the top): the coach places the test, not the day after the class.
const inp8 = await loadBrainInputs(db, M8)
assert.equal(await balanceHardRuns(db, block, M8, M8, inp8, nowSec(M8), { budget: 2, restDue: null }), 1, 'one coach change: the test')
const test8 = (await db.select().from(sessions).where(eq(sessions.notes, '5k_test'))).find(r => r.scheduledDate != null && r.scheduledDate >= M8)
assert.ok(test8 && test8.scheduledDate !== M8 + 1, `the test is not on Tuesday, after Monday's class (${test8?.id})`)
const [testRune] = await db.select().from(weekAdjustments).where(eq(weekAdjustments.targetSessionId, test8!.id))
assert.match(testRune?.why ?? '', / is a 5K test\. Your hard runs sit easily at their speeds/)
assert.equal((await db.select().from(sessions).where(eq(sessions.notes, '5k_test'))).filter(r => (r.scheduledDate ?? 0) >= M8).length, 1, 'one test, in a hard run\'s place')
// UNDO: the hard run is back and no test is placed again this week.
assert.ok((await undoChange(db, testRune.id, M8, nowSec(M8, 22))).ok)
assert.equal(await balanceHardRuns(db, block, M8, M8, inp8, nowSec(M8, 23), { budget: 2, restDue: null }), 0, 'his UNDO holds')
assert.equal((await db.select().from(sessions).where(eq(sessions.notes, '5k_test'))).filter(r => (r.scheduledDate ?? 0) >= M8).length, 0)

// The line after a run: the last outside run at about the same heart rate.
const [lastEasy] = await db.select().from(runSessions).where(eq(runSessions.id, 'r8-run'))
const facts = await postRunFacts(db, { ...lastEasy, durationSec: 2340, avgHr: 130 })
assert.ok(facts && facts.outdoor && !facts.first && facts.sameHrPaceSecKm === 420, JSON.stringify(facts))

// Rebuild Phase 8: away, per his note, the rules keep the run but make it easy (no hard run while away).
const satHard = await doseFor(db, (await db.select().from(sessions).where(eq(sessions.id, 'sat8')))[0], M8 + 4)
assert.ok(satHard?.run?.hard, 'at home: Saturday is the hard run')
await db.insert(dailyLogs).values({ id: 'away8', logDate: M8 + 4, notes: 'Away for work till Sun, hotel gym only.', createdAt: (M8 + 4) * 86400 })
const satAway = await doseFor(db, (await db.select().from(sessions).where(eq(sessions.id, 'sat8')))[0], M8 + 4)
assert.ok(satAway?.run && !satAway.run.hard, 'away: an easy run, the hard one waits')
assert.ok(satAway.why.some(w => /Away, per your note/.test(w)), satAway.why.join(' | '))

console.log('server hardRuns: ok')

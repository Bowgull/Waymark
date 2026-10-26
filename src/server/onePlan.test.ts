// Run: tsx src/server/onePlan.test.ts
// The one plan on the server (rebuild Phase 2): the week is built once and
// stored on its week plan; class days changed mid-week (on every weekday)
// re-shape the rest of this week and next quietly, with every rule kept,
// done days untouched and no session doubled.
import assert from 'node:assert/strict'
import { and, eq, gte, lte } from 'drizzle-orm'
import { sessions, settings, weekAdjustments, weekPlans } from '../db/schema'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { blockDayPlan, generateDaySessions, insertDayEntries } from './coachData'
import { reshapeForClassDays } from './brain'
import { FIXED_KEY, parseShape, reshapeWeek } from './onePlan'
import { loadPlanSessions } from './bodyWatch'
import { testDb } from './testDb'

const MON = 20822 // Monday 2027-01-04
const at = (day: number, h = 7) => day * 86400 + h * 3600
const dow = (d: number) => new Date(d * 86400000).getUTCDay()
const H = { am: 8, pm: 18 } as const

async function fresh(classDays: string) {
  const db = testDb()
  await db.insert(settings).values({ id: 'default', mtClassDays: classDays, createdAt: 0, updatedAt: 0 }).onConflictDoUpdate({ target: settings.id, set: { mtClassDays: classDays } })
  const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: at(MON - 1), startedAt: startedAtForLocalDay(MON) })
  return { db, block: block! }
}

async function weekRows(db: ReturnType<typeof testDb>, monday: number) {
  return (await db.select().from(sessions).where(and(gte(sessions.scheduledDate, monday), lte(sessions.scheduledDate, monday + 6)))).filter(r => r.status !== 'skipped')
}

function broken(rows: Awaited<ReturnType<typeof weekRows>>): string[] {
  const out: string[] = []
  const t = (r: (typeof rows)[number]) => (r.scheduledDate as number) * 24 + H[r.timeSlot === 'pm' ? 'pm' : 'am']
  for (const l of rows.filter(r => r.type === 'strength')) {
    for (const r of rows.filter(x => x.type === 'running' && ['tempo', 'intervals', '5k_test'].includes(x.notes ?? ''))) { const h = t(r) - t(l); if (h > 0 && h < 48) out.push('hard run within 48 h of a lift') }
    for (const c of rows.filter(x => x.type === 'mt_class')) { const h = t(c) - t(l); if (h >= 0 && h < 24) out.push('lift before a class') }
  }
  const seen = new Set<string>()
  for (const r of rows) {
    const k = `${r.scheduledDate}|${r.type}|${r.label}|${r.timeSlot}`
    if (seen.has(k)) out.push(`doubled ${k}`)
    seen.add(k)
  }
  return out
}

// The week is built once and stored: each day's sessions come from it.
{
  const { db } = await fresh('2,4')
  for (let d = MON; d <= MON + 6; d++) await generateDaySessions(db, d, MON, at(MON - 1))
  const [plan] = await db.select().from(weekPlans)
  const shape = parseShape(plan.shapeJson)
  assert.ok(shape && shape.step === 4 && shape.monday === MON, 'week 1 is 4 days, stored on its plan')
  const rows = await weekRows(db, MON)
  assert.equal(new Set(rows.filter(r => r.type !== 'mobility').map(r => r.scheduledDate)).size, shape.entries.filter(e => e.type !== 'mobility').reduce((s, e) => s.add(e.dow), new Set<number>()).size, 'the days made are the stored week')
  assert.equal(rows.filter(r => r.type === 'strength').length, 2, 'two lifts')
  assert.ok(rows.filter(r => r.type === 'mt_class').every(r => [2, 4].includes(dow(r.scheduledDate as number))), 'classes only on Settings days')
  assert.equal(rows.filter(r => r.type === 'mobility').length, 7, 'Foundation every day')
  assert.deepEqual(broken(rows), [])
  // Two screens making the same day at once (review T8): the day ends with one set.
  await generateDaySessions(db, MON + 2, MON, at(MON))
  assert.equal((await weekRows(db, MON)).length, rows.length, 'a day made twice keeps one copy of each session')
  console.log('ok: the stored week')
}

// Class days changed on each weekday: the night after, the rest of this week and next re-shape.
for (let change = MON; change <= MON + 5; change++) {
  const { db, block } = await fresh('2,4')
  for (let d = MON; d <= MON + 13; d++) await generateDaySessions(db, d, MON, at(MON - 1))
  // Everything before the change is done.
  for (const r of await db.select().from(sessions).where(lte(sessions.scheduledDate, change))) await db.update(sessions).set({ status: 'completed' }).where(eq(sessions.id, r.id))
  const done = (await db.select().from(sessions).where(eq(sessions.status, 'completed'))).map(r => r.id).sort()
  await db.update(settings).set({ mtClassDays: '1,3' })
  // The settings cascade (as built) takes planned classes off the dropped days; the night does the rest.
  for (const r of await db.select().from(sessions).where(and(eq(sessions.type, 'mt_class'), eq(sessions.status, 'planned')))) if (![1, 3].includes(dow(r.scheduledDate as number))) await db.delete(sessions).where(eq(sessions.id, r.id))
  const night = change + 1
  assert.ok(await reshapeForClassDays(db, block, night, at(night, 2)) >= 1, `changed ${dow(change)}: re-shaped`)
  assert.deepEqual((await db.select().from(sessions).where(eq(sessions.status, 'completed'))).map(r => r.id).sort(), done, 'done sessions untouched')
  for (const m of [MON, MON + 7]) {
    const rows = await weekRows(db, m)
    const later = rows.filter(r => (r.scheduledDate as number) >= night)
    assert.ok(later.filter(r => r.type === 'mt_class').every(r => [1, 3].includes(dow(r.scheduledDate as number))), `changed ${dow(change)}: week ${m === MON ? 1 : 2} classes only on the new days`)
    assert.deepEqual(broken(rows), [], `changed ${dow(change)}, week ${m === MON ? 1 : 2}: ${broken(rows).join('; ')}`)
    assert.equal(rows.filter(r => r.type === 'strength').length, 2, `changed ${dow(change)}: still 2 lifts in week ${m === MON ? 1 : 2}`)
    assert.ok(later.filter(r => r.type === 'mobility').length === Math.max(0, m + 7 - Math.max(m, night)), 'Foundation once a day')
  }
  assert.equal(parseShape((await db.select().from(weekPlans)).find(p => parseShape(p.shapeJson)?.monday === MON + 7)?.shapeJson)?.classKey.startsWith('1:'), true, `changed ${dow(change)}: next week built from the new days`)
  assert.equal((await db.select().from(weekAdjustments)).length, 0, 'quiet: no change rows, no rune')
  // A second night changes nothing.
  assert.equal(await reshapeForClassDays(db, block, night + 1, at(night + 1, 2)), 0, 'once')
}
console.log('ok: class days changed on every weekday')

// A week made before the one plan (template rows, no stored week): it keeps the old template
// with the fixed key, so the old rules keep its classes and hard runs (review H3).
{
  const { db, block } = await fresh('2,4')
  const [plan] = await db.select().from(weekPlans)
  const old = { source: 'template', weekPlanId: plan?.id ?? null, createdAt: 0 }
  await db.insert(sessions).values([
    { id: 'old-mon', type: 'strength', label: 'Strength A', scheduledDate: MON, status: 'completed', ...old },
    { id: 'old-tue', type: 'mt_class', label: 'Muay Thai', scheduledDate: MON + 1, status: 'planned', ...old },
    { id: 'old-thu', type: 'running', label: 'Tempo', notes: 'tempo', scheduledDate: MON + 3, status: 'planned', ...old },
  ])
  await db.update(weekPlans).set({ shapeJson: null })
  await loadPlanSessions(db, MON + 1, MON + 13, MON + 1, null)
  for (let d = MON + 1; d <= MON + 6; d++) await generateDaySessions(db, d, MON + 1, at(MON + 1))
  const shape = parseShape((await db.select().from(weekPlans)).find(p => parseShape(p.shapeJson)?.monday === MON)?.shapeJson)
  assert.equal(shape?.classKey, FIXED_KEY, 'the live week keeps the old rules (no class target, no hard-run cap)')
  assert.ok(shape && shape.entries.every(e => e.dow !== 1 || e.type !== 'strength' || e.label === 'Strength A'), 'the old template, day by day')
  const rows = await weekRows(db, MON)
  for (const id of ['old-tue', 'old-thu']) assert.equal(rows.find(r => r.id === id)?.status, 'planned', `${id} stays`)
  void block
  console.log('ok: a week made before the one plan keeps its template')
}

// Previews and a missed session's fix never store a week's shape (review H4).
{
  const { db, block } = await fresh('2,4')
  await blockDayPlan(db, block, MON + 7, 2, at(MON + 2), { store: false })
  await loadPlanSessions(db, MON, MON + 13, MON, null)
  assert.ok((await db.select().from(weekPlans)).every(p => p.shapeJson == null), 'a preview keeps nothing')
  await generateDaySessions(db, MON, MON, at(MON))
  assert.equal((await db.select().from(weekPlans)).filter(p => p.shapeJson != null).length, 1, 'making a day stores its week')
  console.log('ok: previews store no shape')
}

// Two inserts racing for one day (review M1): whichever finishes last, the day ends with one set.
{
  const { db, block } = await fresh('2,4')
  const plan = await blockDayPlan(db, block, MON, 1, at(MON))
  const o = (nowSec: number) => ({ weekPlanId: plan.weekPlanId, strengthWeek: 1, nowSec })
  const one = await weekRows(db, MON).then(r => r.length)
  // The later clock lands first and dedupes alone; the earlier clock lands second: its copies are the keepers.
  await insertDayEntries(db, block, MON, plan.entries, o(at(MON, 9)))
  await insertDayEntries(db, block, MON, plan.entries, o(at(MON, 8)))
  assert.equal((await weekRows(db, MON)).length, one + plan.entries.length, 'one copy each after an out-of-order race')
  // Both at once.
  await Promise.all([insertDayEntries(db, block, MON, plan.entries, o(at(MON, 10))), insertDayEntries(db, block, MON, plan.entries, o(at(MON, 10)))])
  assert.equal((await weekRows(db, MON)).length, one + plan.entries.length, 'one copy each after a simultaneous race')
  console.log('ok: racing inserts keep one set')
}

// A re-shape never moves a session the coach changed (review M2): merged lifts, a cap, an ease.
{
  const { db, block } = await fresh('2,4')
  for (let d = MON; d <= MON + 6; d++) await generateDaySessions(db, d, MON, at(MON - 1))
  const later = (await weekRows(db, MON)).filter(r => (r.scheduledDate as number) >= MON + 2 && r.type !== 'mobility')
  const marks = [{ mergedLifts: ['x'] }, { brainCap: { state: 'AMBER', why: null, at: 0 } }, { coachEase: { why: 'x' } }]
  const marked = later.slice(0, marks.length)
  for (const [i, r] of marked.entries()) await db.update(sessions).set({ contextJson: JSON.stringify(marks[i]) }).where(eq(sessions.id, r.id))
  const [plan] = await db.select().from(weekPlans)
  const { removed } = await reshapeWeek(db, { blockId: block.id, blockStart: MON, monday: MON, week: 1, planId: plan.id, nowSec: at(MON + 1) }, MON + 2, new Set())
  assert.ok(marked.length > 0 && marked.every(r => !removed.includes(r.id)), 'coach-changed sessions stay')
  console.log('ok: a re-shape keeps coach-changed sessions')
}

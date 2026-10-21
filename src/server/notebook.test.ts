// Run: tsx src/server/notebook.test.ts
// The coach's notebook (item 1), short states (8), partial check-ins (7) and
// the corrective retry (6) on a migrated test database with made-up data and
// a stubbed Anthropic endpoint (no network). The notebook sits near the top of
// the packet; the AI only proposes; code keeps the sound lesson and refuses a
// verdict on him and a lesson with a number; support adds evidence; the record
// is rebuilt from its evidence and retires on its own. Starts empty.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { coachDecisions, coachLessonEvidence, coachLessons, dailyLogs, sessions, settings } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { mockMessage, notebookAi, packetFromRequest, sycophantAi, type MockAi } from '../lib/brain/mockAi'
import type { DecisionPacket } from '../lib/brain/decision'
import { createTrainingBlock } from './blocks'
import { runBrainNight } from './brain'
import { loadEvidenceIndex, rebuildNotebook } from './notebook'
import { prepareWeek } from './weeklyPass'
import { testDb } from './testDb'

const MON = isoToEpochDay('2027-01-04')
const nowSec = (day: number, h = 7) => day * 86400 + h * 3600
const KEY = 'test-key-not-real'

const db = testDb()
await db.insert(settings).values({ id: 'default', mtClassDays: '1,3,5', createdAt: 1, updatedAt: 1 })
const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec(MON - 14), startedAt: startedAtForLocalDay(MON - 14) })
for (let d = MON - 14; d < MON; d++) {
  const note = d === MON - 10 ? 'Woke up sick with a cold' : d === MON - 1 ? 'Back stiff this morning after the hinge day' : null
  await db.insert(dailyLogs).values({ id: `ci${d}`, logDate: d, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, notes: note, createdAt: d * 86400 })
}
await prepareWeek(db, '', { blockId: block.id, monday: MON - 14, todayDay: MON - 14, nowSec: nowSec(MON - 14), useAi: false })
await prepareWeek(db, '', { blockId: block.id, monday: MON - 7, todayDay: MON - 7, nowSec: nowSec(MON - 7), useAi: false })
await prepareWeek(db, '', { blockId: block.id, monday: MON, todayDay: MON, nowSec: nowSec(MON), useAi: false })
// He did the first two weeks' strength sessions.
for (const s of await db.select().from(sessions)) if (s.scheduledDate != null && s.scheduledDate < MON && s.type === 'strength') await db.update(sessions).set({ status: 'completed', rpe: 6, durationSec: 3000 }).where(eq(sessions.id, s.id))

const bodies: string[] = []
let answer: MockAi = notebookAi
const realFetch = globalThis.fetch
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  bodies.push(String(init?.body))
  const req = packetFromRequest(String(init?.body))
  assert.ok(req)
  return new Response(JSON.stringify(mockMessage(answer(req.packet, req.retry))), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch
const quiet = console.log
console.log = () => {}
const packetOf = (body: string) => packetFromRequest(body)!.packet as DecisionPacket

try {
  // ─── It starts empty ─────────────────────────────────────────
  assert.equal((await db.select().from(coachLessons)).length, 0)
  const index = await loadEvidenceIndex(db, MON)
  assert.ok([...index.keys()].every(k => index.get(k)!.day >= MON - 14), 'evidence starts at the block start')
  assert.ok(index.has(`ci:2027-01-03`) && index.has('n:ci:2027-01-03'), 'check-ins and his notes, with stable ids')

  // ─── Night 1: proposals checked by code ──────────────────────
  await runBrainNight(db, MON, nowSec(MON), { apiKey: KEY })
  assert.equal(bodies.length, 1)
  const req = JSON.parse(bodies[0]) as { messages: Array<{ content: string }>; output_config: { format: { schema: { required: string[] } } } }
  const content = req.messages[0].content
  assert.ok(content.indexOf('"notebook"') > 0 && content.indexOf('"notebook"') < content.indexOf('"facts"'), 'the notebook sits near the top, before the facts')
  assert.ok(req.output_config.format.schema.required.includes('notebook'), 'the strict schema carries the notebook proposals')
  const p1 = packetOf(bodies[0])
  assert.deepEqual(p1.notebook, [], 'empty at first')
  assert.ok((p1.evidence ?? []).some(l => l.startsWith('ci:2027-01-03 | 2027-01-03 | check-in:')), 'citable evidence, one line each')
  assert.ok(p1.notes.some(n => n.ev === 'n:ci:2027-01-03'), 'notes carry their evidence id')
  assert.equal(p1.state.confidence, 'full', "the night reads yesterday's full check-in")
  // 8: the sick note from 10 days ago is history, marked so.
  const sickNote = p1.notes.find(n => /sick/.test(n.text))
  assert.match(sickNote?.ended ?? '', /^sick ended 2026-12-27$/)
  assert.ok((p1.temp ?? []).every(t => !t.active), 'no short state is active tonight')

  const lessons = await db.select().from(coachLessons)
  assert.equal(lessons.length, 1, 'only the sound lesson is kept')
  assert.equal(lessons[0].claim, 'Back feels stiffer the morning after hinge sessions.')
  assert.equal(lessons[0].status, 'candidate')
  assert.equal(lessons[0].source, 'seen')
  assert.equal(lessons[0].supportCount, 3)
  assert.equal((await db.select().from(coachLessonEvidence)).length, 3, 'tied to its 3 evidence rows')
  const [d1] = await db.select().from(coachDecisions).where(eq(coachDecisions.day, MON))
  const nb = JSON.parse(d1.notebookJson ?? '{}') as { refused: Array<{ why: string }>; accepted: unknown[] }
  assert.equal(nb.accepted.length, 1)
  assert.ok(nb.refused.some(r => /verdict/.test(r.why)), 'a verdict on him is refused')
  assert.ok(nb.refused.some(r => /number/.test(r.why)), 'a lesson with a number is refused')

  // ─── Night 2: the AI sees it in the fixed line format and supports it ─
  await db.insert(dailyLogs).values({ id: 'ciMON', logDate: MON, sleepHours: 7.5, sleepQuality: null, energy: null, soreness: null, stress: null, mood: null, backToday: null, createdAt: nowSec(MON, 6) })
  await runBrainNight(db, MON + 1, nowSec(MON + 1), { apiKey: KEY })
  const p2 = packetOf(bodies[1])
  assert.match(p2.notebook?.[0] ?? '', /^L1 \| response \| seen \| candidate \| 3 days \| last \d{4}-\d{2}-\d{2} \| Back feels stiffer the morning after hinge sessions\.$/)
  assert.equal(p2.state.confidence, 'partial', 'a one-item check-in yesterday: a partial read (7)')
  const links = await db.select().from(coachLessonEvidence)
  assert.ok(links.length > 3, `support adds evidence: ${links.length} rows`)
  assert.equal((await db.select().from(coachLessons)).length, 1, 'no claim was edited or duplicated')

  // ─── The record is rebuilt from evidence; without new support it retires ─
  const later = await rebuildNotebook(db, MON + 200, nowSec(MON + 200))
  assert.equal(later[0].status, 'retired')
  assert.equal(later[0].retiredReason, 'not re-confirmed in 12 weeks')

  // ─── 6: the one retry carries each violation with its fix, and the refused answer ─
  await db.insert(dailyLogs).values({ id: 'ciMON1', logDate: MON + 1, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, notes: 'I feel amazing, push me', createdAt: nowSec(MON + 1, 6) })
  answer = sycophantAi
  const before = bodies.length
  await runBrainNight(db, MON + 2, nowSec(MON + 2), { apiKey: KEY })
  assert.equal(bodies.length - before, 2, 'one retry')
  const retry = (JSON.parse(bodies[bodies.length - 1]) as { messages: Array<{ content: string }> }).messages[0].content
  assert.ok(/refused your last answer/.test(retry))
  assert.ok(/-> a tweak is -1 or 0/.test(retry), 'the tweak fix is named')
  assert.ok(/-> remove 225 lb/.test(retry) || /-> no exclamation marks/.test(retry), 'the made-up number or the filler is named')
  assert.ok(/Your refused answer: \{/.test(retry), 'the refused answer is there to repair')

  // ─── 8: a sick note yesterday makes tonight RED; it ends on its own ─
  await db.insert(dailyLogs).values({ id: 'ciMON2', logDate: MON + 2, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, notes: 'Feeling sick, fever', createdAt: nowSec(MON + 2, 6) })
  answer = notebookAi
  await runBrainNight(db, MON + 3, nowSec(MON + 3), { apiKey: KEY })
  const p3 = packetOf(bodies[bodies.length - 1])
  assert.equal(p3.state.state, 'RED', 'sick: recover or rest')
  assert.ok((p3.temp ?? []).some(t => t.kind === 'sick' && t.active && t.until === '2027-01-08'))
} finally {
  globalThis.fetch = realFetch
  console.log = quiet
}

console.log('server notebook tests passed')

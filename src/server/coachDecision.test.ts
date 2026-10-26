// Run: tsx src/server/coachDecision.test.ts
// Coach brain P3 on a migrated test database (made-up data, no network: the
// Anthropic endpoint is a stub). The nightly pass sends one decision call
// (claude-opus-5-5, adaptive thinking, medium effort, strict JSON schema,
// cached playbook, refusal fallback) that carries the last 14 days of his
// notes and Waybook; a careful answer with a fact wins and its why fills the
// dose; the morning check-in keeps it; a retried night calls nothing and
// changes nothing; a "push me" answer is refused twice and the rules' pick
// stands; a rejected request, a timeout, a quiet day and the daily spend cap
// all leave the rules' pick without (another) call.
import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { coachDecisions, dailyLogs, journalEntries, sessions, settings, weekAdjustments } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { carefulAi, mockMessage, packetFromRequest, sycophantAi, travelAi, type MockAi } from '../lib/brain/mockAi'
import { createTrainingBlock } from './blocks'
import { capToday, parseDose, runBrainNight } from './brain'
import { prepareWeek } from './weeklyPass'
import { testDb } from './testDb'
import { setFixedWeekForTests } from './onePlan'

// These stories are written on the old fixed Block Zero week (rebuild Phase 2 keeps it for them).
setFixedWeekForTests(true)

const MON = isoToEpochDay('2027-01-04')
const nowSec = (day: number, h = 7) => day * 86400 + h * 3600
const KEY = 'test-key-not-real'

const db = testDb()
await db.insert(settings).values({ id: 'default', mtClassDays: '1,3,5', createdAt: 1, updatedAt: 1 })
const block = await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: nowSec(MON - 14), startedAt: startedAtForLocalDay(MON - 14) })
for (let d = MON - 14; d < MON; d++) {
  await db.insert(dailyLogs).values({ id: `ci${d}`, logDate: d, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, notes: d === MON - 1 ? 'Drove 6 hours yesterday, legs stiff from the car' : null, createdAt: d * 86400 })
}
await db.insert(journalEntries).values({ id: 'j1', date: MON - 2, type: 'daily', content: 'Big work deadline Friday, sleeping badly.', createdAt: (MON - 2) * 86400 })
await db.insert(journalEntries).values({ id: 'j-old', date: MON - 20, type: 'daily', content: 'An old entry outside the window.', createdAt: (MON - 20) * 86400 })
await prepareWeek(db, '', { blockId: block.id, monday: MON, todayDay: MON, nowSec: nowSec(MON), useAi: false })

// The Anthropic stub.
const bodies: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = []
let answer: MockAi | 'reject' | 'timeout' = carefulAi
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  assert.ok(url.startsWith('https://api.anthropic.com/'), `only the Anthropic API: ${url}`)
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  bodies.push({ body, headers: init?.headers as Record<string, string> })
  if (answer === 'reject') return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"output_config.format: unsupported"}}', { status: 400 })
  if (answer === 'timeout') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e }
  const req = packetFromRequest(String(init?.body))
  assert.ok(req, 'the decision request carries the packet')
  return new Response(JSON.stringify(mockMessage(answer(req.packet, req.retry))), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch
const quiet = console.log
console.log = () => {}

try {
  // ─── Night 1: a careful answer from his note ─────────────────
  const n1 = await runBrainNight(db, MON, nowSec(MON), { apiKey: KEY })
  assert.ok(n1.ran)
  assert.equal(bodies.length, 1, 'one call')
  const req = bodies[0].body as { model: string; system: Array<{ text: string; cache_control?: { type: string } }>; thinking: { type: string }; output_config: { effort: string; format: { type: string; schema: { additionalProperties: boolean } } }; fallbacks: string; messages: Array<{ content: string }>; max_tokens: number }
  assert.equal(req.model, 'claude-opus-5-5')
  assert.equal(req.system[0].cache_control?.type, 'ephemeral', 'the playbook is a cached prefix')
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(req.system[0].text), 'no dates in the cached prefix')
  assert.equal(req.thinking.type, 'adaptive')
  assert.equal(req.output_config.effort, 'medium')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.equal(req.output_config.format.schema.additionalProperties, false, 'strict schema')
  assert.equal(req.fallbacks, 'default')
  assert.equal(bodies[0].headers['anthropic-beta'], 'server-side-fallback-2026-07-01')
  const content = req.messages[0].content
  assert.ok(content.includes('Drove 6 hours yesterday'), 'his check-in note reaches the AI')
  assert.ok(content.includes('Big work deadline Friday'), 'his Waybook reaches the AI')
  assert.ok(!content.includes('An old entry'), 'only the last 14 days')
  assert.ok(!content.includes(KEY), 'no key in the packet')

  const [d1] = await db.select().from(coachDecisions).where(eq(coachDecisions.day, MON))
  assert.equal(d1.source, 'ai', 'more careful with a fact cited: the AI')
  assert.equal(d1.model, 'claude-opus-5-5')
  assert.ok(d1.costUsd > 0 && d1.inputTokens === 9000, 'tokens and cost kept for the cap')
  const strength = (await db.select().from(sessions).where(and(eq(sessions.scheduledDate, MON), eq(sessions.type, 'strength'))))[0]
  const dose = parseDose(strength.doseJson)!
  const rulesPick = (JSON.parse(d1.candidatesJson) as Array<{ id: string; level: string; rules: boolean; sessionId: string }>).find(c => c.sessionId === strength.id && c.rules)!
  assert.equal(dose.decision?.from, 'ai')
  assert.notEqual(dose.level, rulesPick.level, `a level under the rules' ${rulesPick.level}: ${dose.level}`)
  assert.deepEqual(dose.why, ['Strength A is easier today: your note.'], 'the AI\'s why fills the existing why slot')

  // The morning check-in (a steady one) keeps the night's call.
  await db.insert(dailyLogs).values({ id: 'ciMON', logDate: MON, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, createdAt: nowSec(MON, 6) })
  await capToday(db, MON, nowSec(MON, 6))
  const kept = parseDose((await db.select().from(sessions).where(eq(sessions.id, strength.id)))[0].doseJson)!
  assert.equal(kept.level, dose.level, 'the morning keeps the AI\'s ease')
  assert.deepEqual(kept.why, dose.why)

  // A retried night: no second call, no second set of changes.
  const changesBefore = (await db.select().from(weekAdjustments)).length
  const again = await runBrainNight(db, MON, nowSec(MON, 8), { apiKey: KEY })
  assert.equal(bodies.length, 1, 'no second call')
  assert.equal((await db.select().from(weekAdjustments)).length, changesBefore, 'no second set of changes')
  assert.equal(parseDose((await db.select().from(sessions).where(eq(sessions.id, strength.id)))[0].doseJson)?.level, dose.level, 'the same pick')
  assert.equal(again.decision, n1.decision)

  // ─── Night 2: "push me": refused twice, the rules' pick ───────
  await db.insert(dailyLogs).values({ id: 'ciMON1', logDate: MON + 1, sleepHours: 8, sleepQuality: 4, energy: 4, soreness: 2, stress: 2, mood: 4, backToday: 2, notes: 'I feel amazing, push me', createdAt: nowSec(MON + 1, 6) })
  answer = sycophantAi
  const callsBefore = bodies.length
  await runBrainNight(db, MON + 2, nowSec(MON + 2), { apiKey: KEY })
  assert.equal(bodies.length - callsBefore, 2, 'one retry with the errors')
  assert.ok((bodies[bodies.length - 1].body as { messages: Array<{ content: string }> }).messages[0].content.includes('refused your last answer'), 'the retry says why')
  const [d2] = await db.select().from(coachDecisions).where(eq(coachDecisions.day, MON + 2))
  assert.equal(d2.source, 'fallback')
  const errors = JSON.parse(d2.verifyErrorsJson ?? '[]') as string[]
  assert.ok(errors.some(e => e.includes('outside')) && errors.some(e => e.includes('unknown candidate')), 'out-of-range tweaks, then an unknown id')
  for (const s of await db.select().from(sessions).where(eq(sessions.scheduledDate, MON + 2))) {
    const d = parseDose(s.doseJson)
    if (!d) continue
    assert.equal(d.decision?.from ?? 'rules', 'rules', `${s.type}: the rules' pick stands`)
    assert.ok(!d.why.some(w => /amazing|225/.test(w)), 'none of its words reach the screen')
  }

  // ─── Night 3: the request is rejected (a parameter the API won't take): offline, rules ─
  await db.insert(dailyLogs).values({ id: 'ciMON2', logDate: MON + 2, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, createdAt: nowSec(MON + 2, 6) })
  answer = 'reject'
  await runBrainNight(db, MON + 3, nowSec(MON + 3), { apiKey: KEY })
  assert.equal((await db.select().from(coachDecisions).where(eq(coachDecisions.day, MON + 3)))[0].source, 'offline')

  // ─── Night 4: a timeout: offline, rules ──────────────────────
  await db.insert(dailyLogs).values({ id: 'ciMON3', logDate: MON + 3, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, createdAt: nowSec(MON + 3, 6) })
  answer = 'timeout'
  await runBrainNight(db, MON + 4, nowSec(MON + 4), { apiKey: KEY })
  assert.equal((await db.select().from(coachDecisions).where(eq(coachDecisions.day, MON + 4)))[0].source, 'offline')

  // ─── Night 5: nothing new from him yesterday: rules, no call ──
  answer = carefulAi
  const beforeQuiet = bodies.length
  await runBrainNight(db, MON + 5, nowSec(MON + 5), { apiKey: KEY })
  assert.equal(bodies.length, beforeQuiet, 'no call on a day with nothing new')
  assert.equal((await db.select().from(coachDecisions).where(eq(coachDecisions.day, MON + 5)))[0].source, 'quiet')

  // ─── Night 6: over the daily spend cap: rules, no call ───────
  await db.insert(dailyLogs).values({ id: 'ciMON5', logDate: MON + 5, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, notes: 'Away for work till Sunday, hotel gym only', createdAt: nowSec(MON + 5, 6) })
  await db.insert(coachDecisions).values({ id: 'spent', day: MON + 99, decidedAt: nowSec(MON + 6) - 3600, trigger: 'test', inputHash: 'x', factsJson: '{}', candidatesJson: '[]', rulesPickJson: '{}', finalJson: '{}', source: 'ai', calls: 1, costUsd: 1.5 })
  const beforeCap = bodies.length
  await runBrainNight(db, MON + 6, nowSec(MON + 6), { apiKey: KEY })
  assert.equal(bodies.length, beforeCap, 'no call over the cap')
  assert.equal((await db.select().from(coachDecisions).where(eq(coachDecisions.day, MON + 6)))[0].source, 'capped')

  // ─── Night 7: under the cap again; a travel note takes sessions off, each a rune with the AI's why ─
  await db.delete(coachDecisions).where(eq(coachDecisions.id, 'spent'))
  await db.insert(dailyLogs).values({ id: 'ciMON6', logDate: MON + 6, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, createdAt: nowSec(MON + 6, 6) })
  answer = travelAi
  const night7 = await runBrainNight(db, MON + 7, nowSec(MON + 7), { apiKey: KEY })
  assert.ok(night7.changes <= 2, 'at most 2 changes a night')
  const rests = (await db.select().from(weekAdjustments)).filter(r => r.actor === 'coach' && /away, per your note/.test(r.why ?? ''))
  assert.ok(rests.length >= 1 && rests.length <= 2, `the note is read: ${rests.length} sessions off, each a change with UNDO`)
} finally {
  globalThis.fetch = realFetch
  console.log = quiet
}

console.log('server coach brain P3 tests passed')

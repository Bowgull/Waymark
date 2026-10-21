// Run: tsx src/server/classContent.test.ts
// Class content (coach-brain §14, Josh 2026-10-20: "I'll never be able to
// decide what I get taught"). The coach never says what to do in class or
// which kind of class to take; a class is a fixed 60-minute session of hard
// work. Where a class night needs easing (a flagged injury, a bad check-in,
// an applied ease), the coach may only suggest skipping or moving it.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { sessions } from '../db/schema'
import { CLASS_MINUTES, easeFor, estimatedMinutes, isHard, isLegInterference, typicalRpe, } from '../lib/coach'
import { planFor, type PlanSession } from '../lib/coach/bodyWatch'
import { injuryActionFor } from '../lib/coach/injury'
import { evaluateClassRequest } from '../lib/blockZero/muayThai'
import { easeSession } from '../lib/blockZero/autoEase'
import { serializeBlockZeroContext } from '../lib/blockZero/aiContext'
import { isoToEpochDay } from '../lib/dates'
import { migratedSqlite } from './replay/db'
import { d1Shim } from './replay/d1Shim'
import { installClock, uninstallClock } from './replay/clock'

const CONTENT = /techni|sit out|hard rounds|sparring|clinch|pads|go light|light and controlled/i
const MON = isoToEpochDay('2026-10-26')

// ─── A class is a fixed hour of hard work, whatever its label ───
for (const label of ['MT Technique', 'MT Class', 'Fundamentals', null]) {
  const c = { type: 'mt_class', label, notes: null, estimatedMin: null }
  assert.equal(isHard(c), true, `${label ?? 'no label'}: hard`)
  assert.equal(isLegInterference(c), true, `${label ?? 'no label'}: heavy legs stay 24 h away`)
  assert.equal(typicalRpe(c), 7, `${label ?? 'no label'}: RPE 7`)
  assert.equal(estimatedMinutes(c, 'block_zero', 1), CLASS_MINUTES, `${label ?? 'no label'}: 60 min`)
}
assert.equal(CLASS_MINUTES, 60)
console.log('ok: every class counts as 60 min of hard work')

// ─── No rule eases a class, or suggests a kind of class ─────────
const eased = easeSession({ type: 'mt_class', label: 'MT Class', timeSlot: 'pm', estimatedMin: 60 }, { readinessEase: true })
assert.match(eased.reason ?? '', /skip the class or move it/)
assert.doesNotMatch(eased.reason ?? '', CONTENT)
const knee = { region: 'knee', since: MON, reason: 'Knee flagged on Mon.' }
assert.equal(injuryActionFor('mt_class', knee).action, 'skip_or_move')
assert.doesNotMatch(injuryActionFor('mt_class', knee).note ?? '', CONTENT)
assert.equal(easeFor({ id: 'c', type: 'mt_class', label: 'MT Class', notes: null, epochDay: MON, timeSlot: 'pm', status: 'planned' }, { blockType: 'block_zero', weekNumber: 3 }), null, 'a rebalance never makes a class "easier"')
const cap = evaluateClassRequest({ weeksSinceFirstClass: 0, classesThisWeek: 2 })
assert.ok(!cap.allowed && !CONTENT.test(cap.reason), 'only the weekly cap can say no, and it names no kind of class')
console.log('ok: no rule eases a class or picks a kind of class')

// ─── The raven: a sore knee takes the class off, never "technique only" ───
const ps = (day: number, type: string, label: string | null, slot: 'am' | 'pm' = 'am'): PlanSession => ({ id: `${type}-${day}`, day, type, label, notes: null, timeSlot: slot, status: 'planned', week: 4, blockZero: true, plan: null })
const plan2 = planFor('knee', 2, MON, [ps(MON + 1, 'mt_class', 'MT Class', 'pm'), ps(MON + 2, 'bag_work', null, 'pm'), ps(MON + 3, 'foundation_run', 'Run-Walk')])
assert.equal(plan2.changes.find(c => c.type === 'mt_class')?.op.kind, 'reset', 'the class comes off (Reset)')
assert.equal(plan2.changes.find(c => c.type === 'bag_work')?.op.kind, 'technique', 'his own bag work can go technique-only')
console.log('ok: the raven skips a class, never tells him how to do it')

// ─── The AI context names no class types ───────────────────────
const ctxText = serializeBlockZeroContext({
  weekNumber: 2, totalWeeks: 6, readiness: null, load: null, lifts: [], backScores: [], backTrend: null, run: null, hrCeilingBpm: null,
  mt: { weeksSinceFirstClass: 0, classesThisWeek: 1, profileCap: null },
})
const mtLine = ctxText.split('\n').find(l => l.startsWith('Muay thai:')) ?? ''
assert.ok(mtLine && !/Allowed|technique|pads|clinch|sparring/i.test(mtLine), `the AI's class line: ${mtLine}`)
console.log('ok: the AI is never told which classes are allowed')

// ─── On the real app ───────────────────────────────────────────
installClock(Date.UTC(2026, 9, 28, 22, 0))
try {
  const app = (await import('./app')).default
  const sqlite = migratedSqlite(':memory:')
  const env = { DB: d1Shim(sqlite), WAYMARK_API_KEY: 'k', ANTHROPIC_API_KEY: '' }
  const db = drizzle(env.DB as unknown as D1Database, { schema })
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.fetch(new Request(`http://local${path}`, { method, headers: { Authorization: 'Bearer k', 'content-type': 'application/json', 'X-Waymark-Today': '2026-10-28' }, body: body === undefined ? undefined : JSON.stringify(body) }), env as never, ctx as never)
    return { status: res.status, json: await res.json() as Record<string, unknown> }
  }
  const block = await call('POST', '/api/blocks/block-zero', { today: '2026-10-26' })
  await call('POST', '/api/weeks/generate', { blockId: block.json.id, startDate: '2026-10-26', today: '2026-10-26' })
  // A class added tonight keeps his label (or none): never a forced "MT Technique".
  const added = await call('POST', '/api/sessions/insert-ad-hoc', { type: 'mt_class', timeSlot: 'pm', date: '2026-10-28', today: '2026-10-28' })
  assert.equal(added.status, 200)
  assert.equal(added.json.label, null, 'no label forced on a class he adds')
  // An injury skip earlier in the week flags the knee: the class start says skip or move, nothing else.
  const [skipRow] = await db.select().from(sessions).where(eq(sessions.scheduledDate, isoToEpochDay('2026-10-27')))
  assert.ok(skipRow, 'Tuesday has a planned session to skip')
  await call('PATCH', `/api/sessions/${skipRow.id}`, { status: 'skipped', skipReason: 'injury', skipReasonDetail: 'Knee', today: '2026-10-27' })
  const started = await call('POST', `/api/sessions/${added.json.id as string}/start-mt-class`)
  assert.equal(started.status, 200)
  assert.equal(started.json.plannedMin, 60, 'a class is planned as an hour')
  const coach = started.json.coach as { note?: string; classType?: string } | undefined
  assert.match(coach?.note ?? '', /skip the class or move it/, 'a flagged knee: his call to skip or move')
  assert.equal(coach?.classType, undefined, 'no class type set by the coach')
  assert.doesNotMatch(coach?.note ?? '', CONTENT)
  // Logging what the class was is never refused, whatever it was.
  const log = started.json.mtLog as { id: string }
  const patched = await call('PATCH', `/api/mt-class-logs/${log.id}`, { classType: 'sparring', durationMin: 90 })
  assert.equal(patched.status, 200, 'a sparring class logs like any other (the old ramp refused it)')
  assert.equal(patched.json.classType, 'sparring')
  assert.equal(patched.json.durationMin, 60, 'every class logs as an hour, whatever an old client sends')
  const done = await call('POST', `/api/sessions/${added.json.id as string}/complete`, { rpe: 8 })
  assert.equal(done.json.durationSec, 3600, 'a finished class counts 60 min for load, not the screen time')
} finally {
  uninstallClock()
}
console.log('ok: the app never prescribes class content')

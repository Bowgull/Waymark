// Run: tsx src/server/tbStrength.test.ts
// Page 99 on the real app and a scratch database (made-up data): two lead-in
// sessions each for A and B, then the third reads wave week 1 at 75% of each
// lift's max, and B's press is his pick on the day, each press with its own max.
import assert from 'node:assert/strict'
import { createDB } from '../db/client'
import { sessions, settings, strengthSessionExercises, strengthSets, userProfile } from '../db/schema'
import { isoToEpochDay, TODAY_HEADER } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { migratedSqlite } from './replay/db'
import { d1Shim } from './replay/d1Shim'
import { installClock, uninstallClock } from './replay/clock'

const LB = 0.45359237
const lb = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg / LB))
const START = isoToEpochDay('2026-11-02') // a Monday
const NOW = START + 14
const ISO = '2026-11-16'

installClock(Date.UTC(2026, 10, 16, 6, 0))
try {
  const app = (await import('./app')).default
  const env = { DB: d1Shim(migratedSqlite(':memory:')), WAYMARK_API_KEY: 'k', ANTHROPIC_API_KEY: '' }
  const db = createDB(env as never)
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }
  const call = async <T>(method: string, path: string, body?: unknown, status = 200): Promise<T> => {
    const res = await app.fetch(new Request(`http://local${path}`, {
      method, headers: { Authorization: 'Bearer k', [TODAY_HEADER]: ISO, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env as never, ctx as never)
    assert.equal(res.status, status, `${method} ${path}: ${res.status}`)
    return res.json() as Promise<T>
  }
  await db.insert(settings).values({ id: 'default', mtClassDays: '', createdAt: 1, updatedAt: 1 }).onConflictDoNothing()
  await db.insert(userProfile).values({ id: 'default', dob: '1990-04-01', createdAt: 1, updatedAt: 1 }).onConflictDoNothing()
  await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: START * 86400 + 3600, startedAt: startedAtForLocalDay(START) })

  // The lead-in, logged: the top set of 5 with 2 left on each lift.
  const done = async (id: string, label: string, day: number, lifts: Array<[string, number]>) => {
    await db.insert(sessions).values({ id, type: 'strength', label, scheduledDate: day, timeSlot: 'am', status: 'completed', blockType: 'block_zero', source: 'template', createdAt: day * 86400, completedAt: day * 86400 + 3600 })
    for (const [i, [exerciseId, topLb]] of lifts.entries()) {
      await db.insert(strengthSessionExercises).values({ id: `${id}-${exerciseId}`, sessionId: id, exerciseId, orderIndex: i, section: 'main' })
      for (const [k, w] of [topLb - 20, topLb - 10, topLb].entries()) {
        await db.insert(strengthSets).values({ id: `${id}-${exerciseId}-${k}`, sessionExerciseId: `${id}-${exerciseId}`, setNumber: k + 1, weightKg: w * LB, reps: 5, rir: k === 2 ? 2 : 3, plannedWeightKg: w * LB, plannedReps: 5, completedAt: day * 86400 + 3000, createdAt: day * 86400 })
      }
    }
  }
  const A_LIFTS: Array<[string, number]> = [['ex-front-squat', 115], ['ex-bench-press', 115], ['ex-bent-over-row', 105]]
  const B_LIFTS: Array<[string, number]> = [['ex-rdl', 135], ['ex-landmine-press', 45]]
  await done('a1', 'Strength A', START, A_LIFTS)
  await done('b1', 'Strength B', START + 3, B_LIFTS)
  await done('a2', 'Strength A', START + 7, A_LIFTS)
  await done('b2', 'Strength B', START + 10, B_LIFTS)
  for (const [id, label, day] of [['a3', 'Strength A', NOW], ['b3', 'Strength B', NOW + 3]] as const) {
    await db.insert(sessions).values({ id, type: 'strength', label, scheduledDate: day, timeSlot: 'am', status: 'planned', blockType: 'block_zero', blockWeek: 3, source: 'template', createdAt: NOW * 86400 })
  }

  type Pre = { exercises: Array<{ exerciseId: string; prescription: { prescribedWeightKg: number | null; setsReps: string } }>; brain?: { tb?: { leadIn: boolean; waveWeek: number | null; pct: number | null; press?: { pick: string; kg: { landmine: number | null; overhead: number | null } } | null } } }
  const a3 = await call<Pre>('GET', '/api/sessions/a3/strength-preview')
  assert.deepEqual([a3.brain?.tb?.leadIn, a3.brain?.tb?.waveWeek, a3.brain?.tb?.pct], [false, 1, 0.75], 'the third A: wave week 1, 75%')
  const at = (p: Pre, id: string) => p.exercises.find(e => e.exerciseId === id)
  // 115 x 5 with 2 left: e1RM 141.8, max 127.6 lb, 75% = 95.7 → 95 lb on the bar.
  const squat = at(a3, 'ex-front-squat')
  assert.equal(squat?.prescription.setsReps, '3×5')
  assert.equal(lb(squat?.prescription.prescribedWeightKg), 95, `front squat 3×5 at 75% of its max: ${lb(squat?.prescription.prescribedWeightKg)} lb`)

  const b3 = await call<Pre>('GET', '/api/sessions/b3/strength-preview')
  assert.equal(b3.brain?.tb?.press?.pick, 'landmine', 'the landmine press until he picks')
  assert.ok(b3.brain?.tb?.press?.kg.landmine != null && b3.brain.tb.press.kg.overhead == null, 'the landmine has a max; overhead finds its weight')
  assert.ok(at(b3, 'ex-landmine-press'), 'B has the landmine press')
  assert.ok(at(b3, 'ex-rdl'), 'B wave sessions 1-2: the RDL')

  // He picks overhead: the press turns to it, finding its weight in sets of 5.
  await call('POST', '/api/sessions/b3/press', { press: 'overhead' })
  const b3o = await call<Pre>('GET', '/api/sessions/b3/strength-preview')
  assert.equal(b3o.brain?.tb?.press?.pick, 'overhead')
  const ohp = at(b3o, 'ex-ohp')
  assert.ok(ohp && !at(b3o, 'ex-landmine-press'), 'the overhead press replaces the landmine press')
  assert.match(ohp?.prescription.setsReps ?? '', /×5$/, 'it finds its weight in sets of 5')
  await call('POST', '/api/sessions/b3/press', { press: 'sideways' }, 400)
  await call('POST', '/api/sessions/a2/press', { press: 'landmine' }, 409)
  console.log('TB strength tests passed')
} finally {
  uninstallClock()
}

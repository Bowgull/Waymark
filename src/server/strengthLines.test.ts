// Run: tsx src/server/strengthLines.test.ts
// One weight per lift, on the real app and a scratch database (MADE-UP data
// that only resembles the pattern): months off after a June of dumbbell rows,
// April placeholder maxes still on file. Josh, 2026-10-23: every lift starts
// light ("find your weight"); his old weights are only the top. The preview,
// the session's planned sets, the exercise history and the workout after start
// agree; a loadable lift is never "BW"; 0 is never saved as a weight.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createDB } from '../db/client'
import { sessions, settings, strengthSessionExercises, strengthSets, userProfile } from '../db/schema'
import { isoToEpochDay, TODAY_HEADER } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { liftLoad, type WorkoutExercise } from '../features/dayboard/rowState'
import { createTrainingBlock } from './blocks'
import { migratedSqlite } from './replay/db'
import { d1Shim } from './replay/d1Shim'
import { installClock, uninstallClock } from './replay/clock'

const LB = 0.45359237
const lb = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg / LB))
const JUNE = isoToEpochDay('2026-06-10')
const START = isoToEpochDay('2026-10-26') // a Monday
const ISO = '2026-10-26'

installClock(Date.UTC(2026, 9, 26, 15, 0))
try {
  const app = (await import('./app')).default
  const env = { DB: d1Shim(migratedSqlite(':memory:')), WAYMARK_API_KEY: 'k', ANTHROPIC_API_KEY: '' }
  const db = createDB(env as never)
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await app.fetch(new Request(`http://local${path}`, {
      method, headers: { Authorization: 'Bearer k', [TODAY_HEADER]: ISO, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env as never, ctx as never)
    assert.equal(res.status, 200, `${method} ${path}: ${res.status}`)
    return res.json() as Promise<T>
  }

  await db.insert(settings).values({ id: 'default', mtClassDays: '', createdAt: 1, updatedAt: 1 }).onConflictDoNothing()
  await db.insert(userProfile).values({ id: 'default', dob: '1990-04-01', createdAt: 1, updatedAt: 1 }).onConflictDoNothing()
  // June, before the block: dumbbell rows at 30 lb.
  await db.insert(sessions).values({ id: 'june', type: 'strength', scheduledDate: JUNE, timeSlot: 'am', status: 'completed', blockType: 'road', source: 'template', createdAt: JUNE * 86400, completedAt: JUNE * 86400 + 3600 })
  await db.insert(strengthSessionExercises).values({ id: 'june-row', sessionId: 'june', exerciseId: 'ex-db-row', orderIndex: 0, section: 'accessory' })
  for (let n = 1; n <= 3; n++) {
    await db.insert(strengthSets).values({ id: `june-row-${n}`, sessionExerciseId: 'june-row', setNumber: n, weightKg: 30 * LB, reps: 10, plannedWeightKg: 30 * LB, plannedReps: 10, completedAt: JUNE * 86400 + 3000, createdAt: JUNE * 86400 })
  }
  await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: START * 86400 + 3600, startedAt: startedAtForLocalDay(START) })
  await db.insert(sessions).values({ id: 'sa', type: 'strength', label: 'Strength A', scheduledDate: START, timeSlot: 'am', status: 'planned', blockType: 'block_zero', blockWeek: 1, source: 'template', createdAt: START * 86400 })

  type Ex = WorkoutExercise & { prescription: { prescribedWeightKg: number | null; fromWeightKg?: number | null; setsReps: string } }
  const preview = await call<{ exercises: Ex[] }>('GET', '/api/sessions/sa/strength-preview')
  const by = (exs: Ex[], id: string) => exs.find(e => e.exerciseId === id) as Ex
  // Goblet squat (rebuild Phase 4, page 93's Strength A): find your weight in 10 lb dumbbell rungs.
  const goblet = by(preview.exercises, 'ex-goblet-squat')
  assert.equal(liftLoad(goblet), '20→50', `Goblet squat 4×8 · 20→50 lb: ${liftLoad(goblet)}`)
  // Dumbbell row (a main lift now): light, and never over the old 30 lb less the time off (25 lb).
  const row = by(preview.exercises, 'ex-db-row')
  assert.equal(lb(row.prescription.fromWeightKg), 20, `the row starts light: ${liftLoad(row)}`)
  assert.ok((lb(row.prescription.prescribedWeightKg) ?? 0) <= 25, `never over 25 lb: ${liftLoad(row)}`)
  // The landmine press: the bar only to start, "each" is not on the press line (page 93).
  const press = by(preview.exercises, 'ex-landmine-press')
  assert.deepEqual([liftLoad(press), press.prescription.setsReps], ['bar only', '3×8'], 'landmine · 3×8 · bar only')
  // Hammer curls (the arm block): a weight, not BW.
  assert.equal(liftLoad(by(preview.exercises, 'ex-hammer-curl')), '10→15', 'hammer curls from a light 10 lb')
  for (const e of preview.exercises.filter(x => x.section !== 'warmup')) {
    if (liftLoad(e) === 'BW') assert.ok(/bodyweight|^$|band|wall|bar|ab wheel|sliders/.test(e.equipment ?? ''), `BW only on a bodyweight move: ${e.exerciseId} (${e.equipment})`)
    assert.notEqual(liftLoad(e), 'find your weight', `every loadable lift has a light start: ${e.exerciseId}`)
  }

  // The history: June is before the block. No "Try 35 lb?" from it, and the session does not carry it.
  const hist = await call<{ lastSession: { beforeBlock?: boolean } | null; suggestion: unknown }>('GET', '/api/exercises/ex-db-row/history?section=accessory')
  assert.equal(hist.lastSession?.beforeBlock, true)
  assert.equal(hist.suggestion, null, 'no progression from June')

  // Start: the planned sets are the preview's weights; the coach's decisions stay on the workout (item 29).
  await call('POST', '/api/sessions/sa/start-strength')
  const workout = await call<{ exercises: Array<Ex & { sets: Array<{ id: string; isWarmup: number; plannedWeightKg: number | null }> }>; brain?: { lifts?: unknown[] } }>('GET', '/api/sessions/sa/workout')
  assert.ok(workout.brain?.lifts?.length, 'the brain notes are still there after start')
  const wRow = by(workout.exercises, 'ex-db-row') as Ex & { sets: Array<{ id: string; isWarmup: number; plannedWeightKg: number | null }> }
  assert.deepEqual(wRow.sets.filter(s => !s.isWarmup).map(s => lb(s.plannedWeightKg)), [20, 25, 25, 25], 'the session pre-fills the same ladder')
  assert.equal(liftLoad(wRow), liftLoad(row), 'the started row line: the same words')
  const preview2 = await call<{ brain?: unknown }>('GET', '/api/sessions/sa/strength-preview')
  assert.ok(preview2.brain, 'the started session\'s lines keep the brain')

  // 0 is never saved as a weight.
  const pull = by(workout.exercises, 'ex-hammer-curl') as Ex & { sets: Array<{ id: string }> }
  await call('PATCH', `/api/strength-sets/${pull.sets[0].id}`, { weightKg: 0, reps: 10, completedAt: START * 86400 + 16 * 3600 })
  const [saved] = await db.select().from(strengthSets).where(eq(strengthSets.id, pull.sets[0].id))
  assert.equal(saved.weightKg, null, 'a 0 is stored as no weight')

  // Rebuild Phase 4: the ladder keeps going. A rung after the last bench set, once (a retry adds nothing).
  const benchW = by(workout.exercises, 'ex-goblet-squat') as Ex & { sets: Array<{ id: string; isWarmup: number; setNumber: number }> }
  const lastBench = benchW.sets[benchW.sets.length - 1]
  const rung = await call<{ id: string; setNumber: number; plannedWeightKg: number }>('POST', `/api/strength-sets/${lastBench.id}/rung`, { id: 'rung-1', weightKg: 80 * LB })
  assert.deepEqual([rung.setNumber, lb(rung.plannedWeightKg)], [lastBench.setNumber + 1, 80], 'one more set at the next rung')
  await call('POST', `/api/strength-sets/${lastBench.id}/rung`, { id: 'rung-1', weightKg: 80 * LB })
  const benchSets = (await db.select().from(strengthSets)).filter(x => x.sessionExerciseId === saved.sessionExerciseId || x.id.startsWith('rung-'))
  assert.equal(benchSets.filter(x => x.id === 'rung-1').length, 1, 'the same id twice: one set')
  console.log('strength lines tests passed')
} finally {
  uninstallClock()
}

// Run: tsx src/server/startOnce.test.ts
// A double tap on ENTER, on the real app and a scratch database (MADE-UP data):
// two starts at once make one workout, the first-made one, and both answer
// with it. Run, rope, recovery and class starts answer 200 twice, one row each.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createDB } from '../db/client'
import { activeRecoverySessions, bagWorkRoundCombos, bagWorkRounds, mtClassLogs, runSessions, sessions, settings, skipRopeSessions, strengthSessionExercises, strengthSets, userProfile } from '../db/schema'
import { isoToEpochDay, TODAY_HEADER } from '../lib/dates'
import { startedAtForLocalDay } from '../lib/coach'
import { createTrainingBlock } from './blocks'
import { laterStartIds } from './startOnce'
import { migratedSqlite } from './replay/db'
import { d1Shim } from './replay/d1Shim'
import { installClock, uninstallClock } from './replay/clock'

// The pure part: the second start begins where the first index comes round again.
assert.deepEqual(laterStartIds([]), [])
assert.deepEqual(laterStartIds([{ id: 'a', first: true }, { id: 'b', first: false }]), [])
assert.deepEqual(laterStartIds([{ id: 'a', first: true }, { id: 'b', first: false }, { id: 'c', first: true }, { id: 'd', first: false }]), ['c', 'd'])
assert.deepEqual(laterStartIds([{ id: 'a', first: true }, { id: 'c', first: true }, { id: 'e', first: true }]), ['c', 'e'])

const START = isoToEpochDay('2026-10-26') // a Monday
const ISO = '2026-10-26'

installClock(Date.UTC(2026, 9, 26, 15, 0))
try {
  const app = (await import('./app')).default
  const env = { DB: d1Shim(migratedSqlite(':memory:')), WAYMARK_API_KEY: 'k', ANTHROPIC_API_KEY: '' }
  const db = createDB(env as never)
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }
  const post = async (path: string) => {
    const res = await app.fetch(new Request(`http://local${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer k', [TODAY_HEADER]: ISO },
    }), env as never, ctx as never)
    assert.equal(res.status, 200, `POST ${path}: ${res.status} ${res.status === 200 ? '' : await res.clone().text()}`)
    return res.json() as Promise<Record<string, unknown>>
  }
  const twice = (path: string) => Promise.all([post(path), post(path)])

  await db.insert(settings).values({ id: 'default', mtClassDays: '', createdAt: 1, updatedAt: 1 }).onConflictDoNothing()
  await db.insert(userProfile).values({ id: 'default', dob: '1990-04-01', createdAt: 1, updatedAt: 1 }).onConflictDoNothing()
  await createTrainingBlock(db, { name: 'Block Zero', blockType: 'block_zero', totalWeeks: 6, nowSec: START * 86400 + 3600, startedAt: startedAtForLocalDay(START) })
  const at = { scheduledDate: START, timeSlot: 'am' as const, status: 'planned', blockType: 'block_zero', blockWeek: 1, source: 'template', createdAt: START * 86400 }
  await db.insert(sessions).values([
    { id: 'st', type: 'strength', label: 'Strength A', ...at },
    { id: 'bw', type: 'bag_work', ...at, timeSlot: 'pm' },
    { id: 'rn', type: 'running', notes: 'zone2', ...at },
    { id: 'sk', type: 'skip_rope', ...at },
    { id: 'rc', type: 'active_recovery', ...at },
    { id: 'mt', type: 'mt_class', ...at, timeSlot: 'pm' },
  ])

  // Strength: one workout, and both taps see the same exercises and sets.
  const [s1, s2] = await twice('/api/sessions/st/start-strength')
  const exRows = await db.select().from(strengthSessionExercises).where(eq(strengthSessionExercises.sessionId, 'st'))
  const orders = exRows.map(r => r.orderIndex)
  assert.ok(exRows.length > 0, 'the workout was made')
  assert.equal(new Set(orders).size, orders.length, `one exercise per slot: ${orders.join(',')}`)
  const ids = (w: Record<string, unknown>) => (w.exercises as Array<{ id: string; sets: Array<{ id: string }> }>).flatMap(e => [e.id, ...e.sets.map(x => x.id)])
  assert.deepEqual(ids(s1), ids(s2), 'both taps answer with the same workout')
  const setRows = (await db.select().from(strengthSets)).filter(x => exRows.some(e => e.id === x.sessionExerciseId))
  assert.equal(setRows.length, ids(s1).length - exRows.length, 'no orphan sets left behind')
  // A later start keeps serving that workout.
  assert.deepEqual(ids(await post('/api/sessions/st/start-strength')), ids(s1))

  // Bag work: one set of rounds.
  const [b1, b2] = await twice('/api/sessions/bw/start-bag-work')
  const rounds = await db.select().from(bagWorkRounds).where(eq(bagWorkRounds.sessionId, 'bw'))
  assert.ok(rounds.length > 0, 'the rounds were made')
  assert.equal(new Set(rounds.map(r => r.roundNumber)).size, rounds.length, 'one row per round')
  const roundIds = (w: Record<string, unknown>) => (w.rounds as Array<{ id: string }>).map(r => r.id)
  assert.deepEqual(roundIds(b1), roundIds(b2), 'both taps answer with the same rounds')
  const combosLeft = (await db.select().from(bagWorkRoundCombos)).filter(x => !rounds.some(r => r.id === x.roundId))
  assert.equal(combosLeft.length, 0, 'no orphan round combos')

  // One-row starts: both taps answer 200 with the one row.
  const one = async (path: string, table: typeof runSessions | typeof skipRopeSessions | typeof activeRecoverySessions | typeof mtClassLogs, id: string, key: string) => {
    const [a, b] = await twice(path)
    assert.equal((await db.select().from(table).where(eq(table.sessionId, id))).length, 1, `${path}: one row`)
    assert.equal((a[key] as { id: string }).id, (b[key] as { id: string }).id, `${path}: the same row twice`)
  }
  await one('/api/sessions/rn/start-run', runSessions, 'rn', 'runSession')
  await one('/api/sessions/sk/start-skip-rope', skipRopeSessions, 'sk', 'skipSession')
  await one('/api/sessions/rc/start-recovery', activeRecoverySessions, 'rc', 'recoverySession')
  await one('/api/sessions/mt/start-mt-class', mtClassLogs, 'mt', 'mtLog')
  console.log('start once tests passed')
} finally {
  uninstallClock()
}

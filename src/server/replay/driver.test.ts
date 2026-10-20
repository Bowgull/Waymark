// Run: tsx src/server/replay/driver.test.ts
// The replay driver on a made-up athlete (in-memory database, no real data):
// the real app starts each session and the real nightly job runs at 10:00
// UTC; AI calls are counted and answered offline; two runs give the same
// doses; the clock and fetch are put back afterwards.
import assert from 'node:assert/strict'
import { migratedSqlite } from './db'
import { runReplay } from './driver'
import { SIM_START, STEADY } from '../../lib/coach/replay/scenarios'
import type { ReplayScript } from '../../lib/coach/replay/types'

const script: ReplayScript = {
  name: 'driver-smoke',
  fromDay: SIM_START,
  toDay: SIM_START + 8,
  tzOffsetMin: -300,
  startBlock: { type: 'block_zero', day: SIM_START },
  days: Array.from({ length: 9 }, (_, i) => ({
    day: SIM_START + i,
    actions: i === 6 ? [] : [
      { kind: 'checkin' as const, at: 6 * 60 + 15, log: STEADY },
      { kind: 'planned' as const, at: 6 * 60 + 40, rpe: { default: 5, strength: 6, mobility: 3 }, lifts: { rir: 2 }, skipTypes: ['mobility'] },
    ],
  })),
}

const realFetch = globalThis.fetch
const realDate = Date
async function once() {
  const sqlite = migratedSqlite(':memory:')
  const r = await runReplay(sqlite, script)
  const aiRows = (sqlite.prepare(`SELECT count(*) AS n FROM coaching_outputs WHERE kind IN ('reactive_replan','weekly_plan','athlete_state','session_review')`).get() as { n: number }).n
  sqlite.close()
  return { r, aiRows }
}

const { r, aiRows } = await once()
assert.deepEqual(r.errors, [], 'every request succeeds')
assert.equal(globalThis.fetch, realFetch, 'fetch is put back')
assert.equal(globalThis.Date, realDate, 'the clock is put back')
assert.equal(r.days.length, 9, 'one record per day')
assert.equal(r.days[6].active, false, 'a day with nothing done is inactive')

const strength = r.doses.filter(d => d.type === 'strength')
const runs = r.doses.filter(d => d.type === 'foundation_run')
assert.deepEqual(strength.map(d => d.label), ['Strength A', 'Strength B', 'Strength C', 'Strength A'], 'Mon/Wed/Fri strength, then next Monday')
assert.equal(runs.length, 4, 'Tue/Thu/Sat run-walks, then next Tuesday')
assert.equal(strength[0].volumeRatio, 1, 'week 1, nothing to ease: the plain dose')
assert.equal(runs[0].volumeRatio, 1, 'the first run-walk is week 1\'s shape')
assert.equal(runs[0].prescribedRunSec, 6 * 60, '6 x 1:00 running')
assert.ok(runs[0].hrCeilingBpm != null, 'the run carries its HR ceiling')

assert.ok(r.aiCalls.length > 0, 'AI callers try (counted)')
assert.ok(r.aiCalls.every(a => a.caller !== 'unknown'), 'each call is named')
assert.equal(aiRows, 0, 'no AI answer is stored: every call was offline')
assert.ok(r.sessions.some(s => s.status === 'completed' && s.type === 'strength'), 'sessions finish')

const again = await once()
const shape = (x: typeof r) => x.doses.map(d => [d.day, d.type, d.label, d.prescribedMainSets, d.prescribedRunSec, d.loads.map(l => l.weightKg)])
assert.deepEqual(shape(again.r), shape(r), 'a replay is deterministic')
console.log('ok: the replay driver runs the real app on a scratch database')

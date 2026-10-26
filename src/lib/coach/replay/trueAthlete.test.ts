// Run: tsx src/lib/coach/replay/trueAthlete.test.ts
// The 24-week simulator's true athlete and weekly table (rebuild Phase 1), on made-up numbers.
import assert from 'node:assert/strict'
import { TrueAthlete, repsPossible } from './trueAthlete'
import { rir2Weight, reportHard, weeklyReport } from './metrics'
import type { ReplayResult } from './types'

const START = 20822 // a Monday

// Reps from an 8-rep max: 8 at the 8RM, more when lighter, fewer when heavier.
assert.ok(Math.abs(repsPossible(50, 50) - 8) < 1e-9)
assert.ok(repsPossible(50, 40) > 12 && repsPossible(50, 60) < 4)
assert.ok(Math.abs(repsPossible(50, rir2Weight(50)) - 10) < 1e-9, 'the RIR-2 weight leaves 2 reps at 8')
console.log('ok: reps from an 8-rep max')

// Strength rises with each session and fades after 14 days off; a light set reads 3+, a heavy one is short.
const a = new TrueAthlete(START)
const before = a.true8('ex-bench-press', START)
const light = a.set({ exerciseId: 'ex-bench-press', weightKg: 20, reps: 8, setNumber: 1, day: START })
assert.equal(light.rir, 3)
assert.ok(a.true8('ex-bench-press', START + 1) > before, 'a session makes him stronger')
const heavy = a.set({ exerciseId: 'ex-bench-press', weightKg: 80, reps: 8, setNumber: 1, day: START + 2 })
assert.equal(heavy.rir, 0)
assert.ok(heavy.reps < 8)
assert.ok(a.true8('ex-bench-press', START + 40) < a.true8('ex-bench-press', START + 10), 'time off fades it')
console.log('ok: strength')

// The 5K improves with easy km and hard runs, and the report reads each week's value as it was.
const b = new TrueAthlete(START)
for (let w = 0; w < 6; w++) for (const d of [1, 3, 5]) b.run({ day: START + w * 7 + d, type: 'foundation_run', notes: null, targetDurSec: 2400, runWalk: null, z2CeilingBpm: 150, walkOnly: false })
const wk1 = b.fiveKOn(START), wk6 = b.fiveKOn(START + 35)
assert.equal(wk1, 1800)
assert.ok(wk6 < wk1)
assert.equal(b.fiveKOn(START), 1800, 'an earlier week reads as it was')
assert.ok(b.misses(START, 'mobility') === false)
console.log('ok: the 5K')

// The weekly table: hard days, rest, breaks.
assert.equal(reportHard({ type: 'running', notes: 'tempo', contextJson: null }), true)
assert.equal(reportHard({ type: 'foundation_run', notes: null, contextJson: null }), false)
assert.equal(reportHard({ type: 'bag_conditioning', notes: null, contextJson: '{"plan":{"hard":true}}' }), true)
const s = (id: string, day: number, type: string, extra: Partial<ReplayResult['sessions'][number]> = {}) => ({ id, day, type, label: null, slot: 'am', status: 'completed', source: 'template', contextJson: null, rpe: null, durationSec: null, blockType: 'block_zero', notes: null, ...extra })
const r: ReplayResult = {
  name: 't', fromDay: START, toDay: START + 6, days: [], doses: [], changes: [], aiCalls: [], errors: [],
  sessions: [s('1', START, 'strength', { label: 'Strength A' }), s('2', START + 1, 'running', { notes: 'tempo' }), s('3', START + 2, 'mt_class', { slot: 'pm' }), s('4', START + 4, 'bag_work')],
}
const [row] = weeklyReport(r)
assert.equal(row.trainingDays, 4)
assert.equal(row.hardDays, 4)
assert.equal(row.longestHardStreak, 3)
assert.equal(row.restDays, 3)
assert.equal(row.bag, 1)
assert.ok(row.breaks.some(x => x.includes('24 h after heavy legs')))
assert.ok(row.breaks.some(x => x.includes('3 hard days in a row')))
console.log('ok: the weekly table')

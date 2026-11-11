// Run: tsx src/lib/brain/tbWave.test.ts
// Page 99: Tactical Barbell in Block Zero, from logged sets only. Made-up data.
import assert from 'node:assert/strict'
import type { ModelSet } from './types'
import { e1rmKg, pressPickFrom, tbMaxKg, tbPct, tbPlanFor, tbSetsReps } from './tbWave'

const LB = 0.45359237
let n = 0
const set = (sessionId: string, day: number, exerciseId: string, lb: number, reps: number, rir: number | null, plannedReps: number | null = 5): ModelSet => ({
  sessionId, day, exerciseId, section: 'main', setNumber: ++n, weightKg: lb * LB, reps, plannedWeightKg: lb * LB, plannedReps, rir, isWarmup: false, logged: true, equipment: 'barbell',
})
const D = 20768

// The wave: 75 / 80 / 90, twice; 3x5, 3x5, 3x3.
assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(tbPct), [0.75, 0.8, 0.9, 0.75, 0.8, 0.9, 0.75])
assert.deepEqual(tbSetsReps(3), { sets: 3, reps: 3 })
assert.deepEqual(tbSetsReps(2), { sets: 3, reps: 5 })

// Nothing done: A is in the lead-in, B's hinge is the RDL.
const none = new Set<string>()
assert.equal(tbPlanFor('A', [], none, D).leadIn, true)
assert.equal(tbPlanFor('B', [], none, D).hinge.exerciseId, 'ex-rdl')

// Two A sessions: the lead-in is done, the next A is wave week 1 at 75%.
const sets: ModelSet[] = [
  set('a1', D, 'ex-front-squat', 95, 5, 3), set('a1', D, 'ex-front-squat', 115, 5, 2),
  set('a2', D + 7, 'ex-front-squat', 125, 5, 2),
]
const done = new Set(['a1', 'a2'])
assert.equal(tbPlanFor('A', sets, done, D + 7).leadIn, true, 'the second session is still the lead-in')
const w1 = tbPlanFor('A', sets, done, D + 14)
assert.deepEqual([w1.leadIn, w1.waveWeek, w1.pct, w1.sets, w1.reps], [false, 1, 0.75, 3, 5], 'third A: wave week 1')
// The max: 90% of the best e1RM in the lead-in (125 lb x 5 with 2 left: 125 x (1 + 7/30)).
const tm = tbMaxKg('A', 'ex-front-squat', sets, done, D + 14)
assert.ok(tm != null && Math.abs(tm - 0.9 * e1rmKg(125 * LB, 5, 2)) < 0.01, `TM ${tm}`)
assert.equal(Math.round((tm as number) / LB), 139, 'about 139 lb')
// A lift never done finds its weight.
assert.equal(tbMaxKg('A', 'ex-bench-press', sets, done, D + 14), null)
// A planned but undone session doesn't count.
assert.equal(tbPlanFor('A', sets, new Set(['a1']), D + 14).leadIn, true, 'only completed sessions count')

// A full wave of six: every 90% set clean adds 10 lb (lower body); a short 90% set holds it.
const wave = (ok: boolean): ModelSet[] => {
  const out = [...sets]
  for (let k = 0; k < 6; k++) {
    const id = `w${k}`
    const heavy = k === 2 || k === 5
    out.push(set(id, D + 14 + k * 7, 'ex-front-squat', 120, heavy && !ok && k === 5 ? 2 : heavy ? 3 : 5, 2, heavy ? 3 : 5))
  }
  return out
}
const doneW = new Set([...done, 'w0', 'w1', 'w2', 'w3', 'w4', 'w5'])
const after = D + 14 + 6 * 7
assert.equal(tbPlanFor('A', wave(true), doneW, after).waveWeek, 1, 'after six: week 1 again')
assert.equal(Math.round(((tbMaxKg('A', 'ex-front-squat', wave(true), doneW, after) as number) - (tm as number)) / LB), 10, 'clean 90% sets: +10 lb')
assert.equal(tbMaxKg('A', 'ex-front-squat', wave(false), doneW, after), tm, 'a short 90% set: the max holds')

// B's hinge: RDL for the first two wave sessions, the block pull for the next two, then the deadlift.
const bSets = [0, 1, 2, 3, 4].map(k => set(`b${k}`, D + k * 7, k < 4 ? 'ex-rdl' : 'ex-block-pull', 100, 5, 2))
const bDone = new Set(bSets.map(x => x.sessionId))
assert.equal(tbPlanFor('B', bSets.slice(0, 2), bDone, D + 14).hinge.exerciseId, 'ex-rdl')
assert.equal(tbPlanFor('B', bSets.slice(0, 4), bDone, D + 28).hinge.exerciseId, 'ex-block-pull', 'wave sessions 3-4: block pull')
assert.equal(tbPlanFor('B', bSets.slice(0, 5), bDone, D + 35).hinge.exerciseId, 'ex-block-pull')
const six = [...bSets, set('b5', D + 35, 'ex-block-pull', 100, 5, 2)]
assert.equal(tbPlanFor('B', six, new Set([...bDone, 'b5']), D + 42).hinge.exerciseId, 'ex-deadlift', 'then the deadlift')
// The block pull joined after the lead-in: its first session sets its max.
assert.ok(tbMaxKg('B', 'ex-block-pull', bSets, bDone, D + 35) != null, 'the block pull has a max from its first session')

// The press pick lives on the session; the landmine until he picks.
assert.equal(pressPickFrom(null), 'landmine')
assert.equal(pressPickFrom('{"press":"overhead"}'), 'overhead')
assert.equal(pressPickFrom('{bad'), 'landmine')

console.log('tbWave tests passed')

// Run: tsx src/lib/brain/blockMove.test.ts
// Coach brain P4: the move to the next block (coach-brain.md §8): the dates,
// the lighter week (volume down, intensity held) and the starting maxes.
import assert from 'node:assert/strict'
import { e1rmsFromSets, inLighter, lighterBag, lighterRun, lighterStrength, moveDates, startingMaxes, LIGHTER_WHY } from './blockMove'
import type { BagDose, LiftDose, RunDose, StrengthDose } from './doses'

const MON = 20822 // Monday 2027-01-04

// ─── Dates: 5-7 lighter days, then a Monday ──────────────────
{
  assert.deepEqual(moveDates(MON), { lighterFrom: MON, monday: MON + 7 }, 'Monday: 7 lighter days')
  assert.deepEqual(moveDates(MON + 1), { lighterFrom: MON + 1, monday: MON + 7 }, 'Tuesday: 6')
  assert.deepEqual(moveDates(MON + 2), { lighterFrom: MON + 2, monday: MON + 7 }, 'Wednesday: 5')
  assert.deepEqual(moveDates(MON + 3), { lighterFrom: MON + 7, monday: MON + 14 }, 'Thursday: the next calendar week is the lighter one')
  assert.deepEqual(moveDates(MON + 6), { lighterFrom: MON + 7, monday: MON + 14 }, 'Sunday: the same')
  for (let d = MON; d < MON + 7; d++) {
    const m = moveDates(d)
    assert.ok(m.monday - m.lighterFrom >= 5 && m.monday - m.lighterFrom <= 7 && (m.monday - MON) % 7 === 0, `${d}: 5-7 lighter days before a Monday`)
  }
  assert.ok(inLighter(MON + 6, { lighterFrom: MON + 1, monday: MON + 7 }) && !inLighter(MON + 7, { lighterFrom: MON + 1, monday: MON + 7 }) && !inLighter(MON, null))
}

// ─── The lighter week: volume −30-50%, intensity held ────────
{
  const lift = (over: Partial<LiftDose>): LiftDose => ({ exerciseId: 'ex-front-squat', label: 'Front Squat', slot: null, sets: 4, reps: 8, targetRir: 2, weightKg: 45, workUp: false, change: 'hold', fromKg: 45, level: 'HOLD', u: 0.15, state: 'KNOWN', note: null, why: null, ...over })
  const d: StrengthDose = { kind: 'strength', level: 'PROGRESS', lifts: [lift({}), lift({ exerciseId: 'ex-bench-press', sets: 3, weightKg: 47.5, change: 'increase', fromKg: 45, level: 'PROGRESS' })], accessorySets: null, holdSets: 7, sets: 7, why: [] }
  const l = lighterStrength(d)
  assert.deepEqual(l.lifts.map(x => x.sets), [2, 2], '4 → 2 and 3 → 2 sets')
  assert.ok(l.sets / d.sets >= 0.5 && l.sets / d.sets <= 0.7, `volume down 30-50%: ${l.sets} of ${d.sets}`)
  assert.equal(l.lifts[0].weightKg, 45, 'the weight held')
  assert.equal(l.lifts[1].weightKg, 45, 'no new step in the lighter week')
  assert.equal(l.level, 'HOLD')
  assert.equal(l.why[0], LIGHTER_WHY)
  const run: RunDose = { kind: 'run', level: 'PROGRESS', rungSec: 240, runSec: 240, walkSec: 60, rounds: 6, warmupSec: 300, totalSec: 1800, walkOnly: false, holdRunSec: 1440, runTotalSec: 1440, hrCeilingBpm: 150, talkTestDue: false, capped: false, why: [] }
  const lr = lighterRun(run)
  assert.equal(lr.runSec, 240, 'the same run pieces')
  assert.ok(lr.rounds === 4 && lr.runTotalSec === 960, `6 → 4 rounds (${lr.rounds})`)
  assert.ok(lr.totalSec < run.totalSec)
  const bag: BagDose = { kind: 'bag', level: 'PROGRESS', rounds: 6, holdRounds: 6, finishers: true, why: [] }
  const lb = lighterBag(bag)
  assert.ok(lb.rounds === 4 && !lb.finishers, 'bag: 6 → 4 rounds, no finishers')
}

// ─── Starting maxes: ≤90% of e1RM ────────────────────────────
{
  const sets = e1rmsFromSets([
    { exerciseId: 'ex-front-squat', weightKg: 60, reps: 8, rir: 2 },
    { exerciseId: 'ex-front-squat', weightKg: 55, reps: 8, rir: 3 },
    { exerciseId: 'ex-bench-press', weightKg: 50, reps: 5, rir: null },
    { exerciseId: 'ex-db-row', weightKg: 30, reps: 8, rir: 2 },
  ])
  assert.equal(sets.get('ex-front-squat'), 80, '8 + 2 reps left: Epley on 10')
  const maxes = startingMaxes(sets, new Map([['ex-ohp', 40], ['ex-front-squat', 100]]))
  const by = new Map(maxes.map(m => [m.exerciseId, m]))
  assert.equal(by.get('ex-front-squat')?.kg, 72, 'the lighter week\'s sets win over the model: 90% of 80')
  assert.equal(by.get('ex-ohp')?.kg, 36, 'the model fills a lift the week did not touch')
  assert.ok(!by.has('ex-db-row'), 'only lifts the Fighter templates load')
  for (const m of maxes) assert.ok(m.kg <= m.e1rmKg * 0.9 + 1e-9, `${m.exerciseId}: ${m.kg} ≤ 90% of ${m.e1rmKg}`)
}

console.log('block move tests passed')

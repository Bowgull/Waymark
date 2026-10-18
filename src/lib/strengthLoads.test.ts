import assert from 'node:assert/strict'
import { kgToLbs, lbsToKg } from './units'
import { accessoryLoadKg, accessoryProgression, loadEquipment, snapForChangeKg, snapIncreaseKg, snapLoadKg, warmupRamp } from './strengthLoads'

const lb = (kg: number) => kgToLbs(kg)

// Equipment kinds from library strings.
assert.equal(loadEquipment('barbell,bench'), 'barbell')
assert.equal(loadEquipment('trap_bar'), 'barbell')
assert.equal(loadEquipment('dumbbell,bench'), 'dumbbell')
assert.equal(loadEquipment('bodyweight,dumbbell'), 'dumbbell')
assert.equal(loadEquipment('cable,band'), 'machine')
assert.equal(loadEquipment('bodyweight'), 'none')
assert.equal(loadEquipment(null), 'none')

// Plate snapping, pounds: 44 kg (97 lb) loads as 95; never under the bar.
assert.equal(lb(snapLoadKg(44, 'barbell')), 95, '97 lb snaps to 95')
assert.equal(lb(snapLoadKg(10, 'barbell')), 45, 'below the bar is the bar')
assert.equal(lb(snapLoadKg(lbsToKg(98), 'barbell')), 100)
assert.equal(lb(snapLoadKg(lbsToKg(97), 'barbell', { direction: 'up' })), 100)
assert.equal(lb(snapLoadKg(lbsToKg(99), 'barbell', { direction: 'down' })), 95)
// Dumbbells in 5 lb steps; kg plates 2.5 total, dumbbells 2 kg.
assert.equal(lb(snapLoadKg(lbsToKg(27), 'dumbbell')), 25)
assert.equal(snapLoadKg(41, 'barbell', { unit: 'kg' }), 40)
assert.equal(snapLoadKg(41.4, 'barbell', { unit: 'kg' }), 42.5)
assert.equal(snapLoadKg(13, 'dumbbell', { unit: 'kg' }), 14)
assert.equal(snapLoadKg(0, 'barbell'), 0, 'no load stays no load')
assert.equal(snapLoadKg(33.3, 'none'), 33.3, 'unloaded equipment passes through')

// Increase lands on the next loadable step even when the % step is smaller than a plate pair.
{
  const from = lbsToKg(95)
  const ruleSays = from * 1.025 // +2.5% upper body ≈ 97 lb
  assert.equal(lb(snapIncreaseKg(from, ruleSays, 'barbell')), 100, '2.5% on 95 lb becomes 100 lb')
  assert.equal(lb(snapForChangeKg(ruleSays, 'barbell', 'increase', from)), 100)
  assert.equal(lb(snapForChangeKg(lbsToKg(97), 'barbell', 'hold', from)), 95, 'hold snaps nearest')
  assert.equal(lb(snapForChangeKg(lbsToKg(91), 'barbell', 'decrease', from)), 90, 'decrease snaps down')
  assert.equal(snapIncreaseKg(40, 41, 'barbell', 'kg'), 42.5, 'kg plates: 40 -> 42.5')
  assert.equal(lb(snapIncreaseKg(lbsToKg(30), lbsToKg(31), 'dumbbell')), 35, 'dumbbell one step up')
}

// Warm-up ramp: bar/~45% x5, ~65% x3, ~80% x2, all below the work set, rising.
{
  const ramp = warmupRamp(lbsToKg(185), 'barbell')
  assert.deepEqual(ramp.map(r => [lb(r.weightKg), r.reps]), [[80, 5], [120, 3], [145, 2]])
  for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i].weightKg > ramp[i - 1].weightKg, 'ramp rises')
  // Light bar loads: just the empty bar. Bar-only work: nothing.
  assert.deepEqual(warmupRamp(lbsToKg(60), 'barbell').map(r => [lb(r.weightKg), r.reps]), [[45, 5]])
  assert.deepEqual(warmupRamp(lbsToKg(45), 'barbell'), [])
  // Moderate bar load: the 45% step is the bar, duplicates drop.
  const mid = warmupRamp(lbsToKg(95), 'barbell').map(r => lb(r.weightKg))
  assert.deepEqual(mid, [45, 60, 75])
  // Dumbbells: none when light, one set when moderate, two when heavier.
  assert.deepEqual(warmupRamp(lbsToKg(15), 'dumbbell'), [])
  assert.deepEqual(warmupRamp(lbsToKg(30), 'dumbbell').map(r => [lb(r.weightKg), r.reps]), [[15, 5]])
  assert.deepEqual(warmupRamp(lbsToKg(50), 'dumbbell').map(r => [lb(r.weightKg), r.reps]), [[25, 5], [35, 3]])
  assert.deepEqual(warmupRamp(null, 'barbell'), [])
  assert.deepEqual(warmupRamp(60, 'none'), [])
}

// Accessories: never 100% of TM; core gets no load.
assert.equal(accessoryLoadKg(50, 'accessory'), 30)
assert.equal(accessoryLoadKg(50, 'core'), null)
assert.equal(accessoryLoadKg(null, 'accessory'), null)

// Accessory progression.
{
  const opts = { incrementKg: 2.27, equipment: 'dumbbell' as const }
  const w = lbsToKg(30)
  const hit = [1, 2].map(() => ({ weightKg: w, reps: 10, plannedReps: 10 }))
  const up = accessoryProgression(hit, 2, opts)!
  assert.equal(up.type, 'weight_increase', '2 of 2 planned sets at target: increase (Block Zero 2-set weeks progress)')
  assert.equal(lb(up.suggestedWeightKg!), 35, 'increase snapped to the next dumbbell')

  // 8, 8, 8 on a 10-rep target is a miss, not "all sets hit 8".
  const missed = [1, 2, 3].map(() => ({ weightKg: w, reps: 8, plannedReps: 10 }))
  const r = accessoryProgression(missed, 3, opts)!
  assert.equal(r.type, 'rep_increase', 'no increase after missed reps')
  assert.equal(r.suggestedWeightKg, w)

  // Planned 3 sets, only 2 logged: no increase.
  assert.equal(accessoryProgression(hit, 3, opts)!.type, 'rep_increase')
  // Reps hit but past target effort (RIR 0-1) or flagged too heavy: hold.
  assert.equal(accessoryProgression(hit.map(s => ({ ...s, rir: 1 })), 2, opts)!.type, 'hold_current')
  assert.equal(accessoryProgression(hit.map(s => ({ ...s, loadFeedback: 'too_heavy' })), 2, opts)!.type, 'hold_current')
  assert.equal(accessoryProgression(hit.map(s => ({ ...s, rir: 2 })), 2, opts)!.type, 'weight_increase')
  assert.equal(accessoryProgression([], 2, opts), null)
}

console.log('strengthLoads tests passed')

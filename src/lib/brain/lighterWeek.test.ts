// Run: tsx src/lib/brain/lighterWeek.test.ts
// A lighter week his body triggers (rebuild Phase 8; strength.md #10), on
// made-up data: strain (eased lifts or hard ratings) AND rough mornings in
// the week before; never in the plan's first 3 weeks, never two within 3
// weeks; the doses keep their weights with fewer sets and say why.
import assert from 'node:assert/strict'
import { strained, triggeredLighter, weekStrain, TRIGGERED_WHY, type LighterWeekIn } from './lighterWeek'
import { lighterStrength } from './blockMove'
import type { LiftEstimate, LiftExposure, ModelCheckIn, ModelSession } from './types'
import type { StrengthDose } from './doses'

const MON = 20822 // Monday 2027-01-04
const START = MON - 35 // the plan started 5 weeks before
const ci = (day: number, v: Partial<ModelCheckIn> = {}): ModelCheckIn => ({ day, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, ...v })
const steady = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ci(from + i))
const rough = (day: number) => ci(day, { sleepHours: 4.5, energy: 2, soreness: 4 })
const exp = (day: number, over: Partial<LiftExposure> = {}): LiftExposure => ({ day, topKg: 40, plannedKg: 40, lastRir: 2, lowered: false, incomplete: false, raised: false, ...over } as LiftExposure)
const lift = (id: string, recent: LiftExposure[]) => ({ exerciseId: id, recent } as unknown as LiftEstimate)
const sess = (day: number, rpe: number): ModelSession => ({ id: `s${day}`, type: 'strength', status: 'completed', day, slot: 'am', startMin: 400, durationSec: 2700, rpe, skipReason: null, source: 'template', blockType: 'block_zero', notes: null })

const base = (over: Partial<LighterWeekIn> = {}): LighterWeekIn => ({ checkIns: steady(START, MON + 7), sessions: [], model: { lifts: {} }, planStart: START, ...over })

// Two eased lifts last week and two rough mornings: this week is lighter.
const eased = { lifts: { a: lift('ex-goblet-squat', [exp(MON - 6, { lastRir: 1 })]), b: lift('ex-bench-press', [exp(MON - 4, { lowered: true })]) } }
const roughWeek = [...steady(START, MON - 7), ...[MON - 7, MON - 6, MON - 5, MON - 4, MON - 3, MON - 2, MON - 1].map(d => (d === MON - 5 || d === MON - 3 ? rough(d) : ci(d))), ...steady(MON, MON + 7)]
const w = weekStrain(base({ model: eased, checkIns: roughWeek }), MON)
assert.deepEqual([w.easedLifts, w.roughMornings], [2, 2], JSON.stringify(w))
assert.equal(triggeredLighter(base({ model: eased, checkIns: roughWeek }), MON + 3), true, 'strain and rough mornings: a lighter week, the whole week')

// Strain alone, or rough mornings alone: no lighter week.
assert.equal(triggeredLighter(base({ model: eased }), MON), false, 'eased lifts on good mornings: no')
assert.equal(triggeredLighter(base({ checkIns: roughWeek }), MON), false, 'rough mornings, lifts fine: no')

// Ratings count as strain: two sessions he rated 9.
assert.equal(strained(base({ checkIns: roughWeek, sessions: [sess(MON - 6, 9), sess(MON - 2, 9.5)] }), MON), true, 'two sessions rated 9+: strain')

// Never in the plan's first 3 weeks.
assert.equal(triggeredLighter(base({ model: eased, checkIns: roughWeek, planStart: MON - 14 }), MON), false, 'two weeks in: too early')

// Never two within 3 weeks: the week before also showed strain, so this one isn't another.
const twoRough = [...steady(START, MON - 14), ...Array.from({ length: 14 }, (_, i) => (i % 3 === 0 ? rough(MON - 14 + i) : ci(MON - 14 + i))), ...steady(MON, MON + 7)]
const twoEased = { lifts: { a: lift('ex-goblet-squat', [exp(MON - 13, { lastRir: 1 }), exp(MON - 6, { lastRir: 1 })]), b: lift('ex-bench-press', [exp(MON - 11, { incomplete: true }), exp(MON - 4, { lowered: true })]) } }
assert.equal(strained(base({ model: twoEased, checkIns: twoRough }), MON - 7), true)
assert.equal(triggeredLighter(base({ model: twoEased, checkIns: twoRough }), MON), false, 'last week was the lighter one: not again')

// The dose: same weights, fewer sets, its own why.
const dose = { kind: 'strength', level: 'HOLD', sets: 6, accessorySets: null, why: [], lifts: [
  { exerciseId: 'ex-goblet-squat', label: 'Goblet Squat', slot: 'squat', sets: 3, reps: 8, targetRir: 2, weightKg: 22.5, workUp: false, change: 'hold', fromKg: 22.5, level: 'HOLD', u: 0.2, state: 'KNOWN', note: null, why: null },
  { exerciseId: 'ex-bench-press', label: 'Bench Press', slot: null, sets: 3, reps: 8, targetRir: 2, weightKg: 32.5, workUp: false, change: 'increase', fromKg: 30, level: 'PROGRESS', u: 0.2, state: 'KNOWN', note: null, why: null },
] } as unknown as StrengthDose
const light = lighterStrength(dose, TRIGGERED_WHY)
assert.deepEqual(light.lifts.map(l => [l.sets, l.weightKg, l.level]), [[2, 22.5, 'HOLD'], [2, 30, 'HOLD']], 'fewer sets, weights held, no new step')
assert.equal(light.why[0], TRIGGERED_WHY)
// One ease only: a weight trimmed for time away goes back to its base; the fewer sets are the ease.
const trimmed = { ...dose, lifts: [{ ...dose.lifts[0], weightKg: 21, change: 'decrease', fromKg: 22.5 }] } as StrengthDose
assert.equal(lighterStrength(trimmed, TRIGGERED_WHY, { oneEase: true }).lifts[0].weightKg, 22.5)

console.log('lighterWeek tests passed')

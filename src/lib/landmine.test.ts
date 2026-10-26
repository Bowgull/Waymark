// Run: tsx src/lib/landmine.test.ts
// Rebuild Phases 4-5 on made-up data: the landmine's double progression and
// power rule, its learning stages, the coach's press pick with its one plain
// line, the chin-up ladder (reps only), the reps-only moves, and page 93's
// plan lines (PRESS behind a tap, LM PUNCH "3×4 each · bar only", one ARMS line).
import assert from 'node:assert/strict'
import { LANDMINE_STEP_KG, POWER_CAP_KG, landmineHistory, landminePower, landmineStage, landmineStrength, type LandmineLast } from './landmine'
import { CHIN_LADDER, PRESS_HEAVY_WHY, PRESS_LIGHT_WHY, PRESS_REBUILD_WHY, PRESS_VARIETY_WHY, chinUpDose, choosePress, repsDose } from './brain/progression'
import { buildAthleteModel } from './brain/athleteModel'
import { strengthDose, type DoseCtx } from './brain/doses'
import { planLines } from '../features/plan/planLines'
import type { ModelEvents } from './brain/types'

const LB = 0.45359237
const lb = (kg: number | null | undefined) => (kg == null ? null : Math.round(kg / LB * 2) / 2)
const MON = 20822
const L = (o: Partial<LandmineLast>): LandmineLast => ({ day: MON - 7, kg: 0, reps: 8, plannedReps: 8, allReps: true, lastRir: 2, minRir: 2, ...o })
function events(over: Partial<ModelEvents> = {}): ModelEvents {
  return {
    profile: { dob: '1985-01-01', maxHr: null, backSensitive: false },
    sessions: [], sets: [], runs: [], talkTests: [], bag: [], checkIns: [], notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [], ...over,
  }
}

// ─── Strength moves: reps first, then a plate ────────────────
{
  assert.deepEqual([lb(landmineStrength('Press', 8, null, null, true).kg), landmineStrength('Press', 8, null, null, true).change], [0, 'start'], 'the bar only to start')
  const reps = landmineStrength('Press', 8, L({ lastRir: 2, minRir: 2 }), null, true)
  assert.deepEqual([lb(reps.kg), reps.reps], [0, 10], 'every rep in at 2 left: 10 a side')
  const plate = landmineStrength('Press', 8, L({ kg: 10 * LB, reps: 12, plannedReps: 12 }), null, true)
  assert.deepEqual([lb(plate.kg), plate.reps, plate.change], [12.5, 8, 'increase'], '12 a side: a plate on, back to 8')
  const easy = landmineStrength('Press', 8, L({ kg: 10 * LB, lastRir: 3, minRir: 3 }), null, true)
  assert.deepEqual([lb(easy.kg), easy.reps], [12.5, 8], 'every set 3+: the plate at once')
  assert.equal(landmineStrength('Press', 8, L({ kg: 10 * LB, lastRir: 3, minRir: 3 }), null, false).change, 'hold', 'one step a week, a rough day: no plate')
  const hard = L({ kg: 10 * LB, lastRir: 1 })
  assert.equal(landmineStrength('Press', 8, hard, null, true).change, 'hold', 'one hard session: hold')
  assert.deepEqual([lb(landmineStrength('Press', 8, hard, hard, true).kg), landmineStrength('Press', 8, hard, hard, true).change], [7.5, 'decrease'], 'two hard sessions: a plate off')
  assert.equal(lb(LANDMINE_STEP_KG), 2.5)
}

// ─── The power move: slow first, fast later, a plate rarely ──
{
  assert.ok(/Slow and crisp/.test(landminePower('Punch', 4, 1, null, null, true).note), 'stage 1: slow')
  assert.ok(/Fast now/.test(landminePower('Punch', 4, 3, null, null, true).note), 'stage 3: fast')
  const crisp = L({ reps: 4, plannedReps: 4, minRir: 2 })
  assert.equal(landminePower('Punch', 4, 3, crisp, null, true).change, 'hold', 'one crisp session: not yet')
  assert.equal(lb(landminePower('Punch', 4, 3, crisp, crisp, true).kg), 2.5, 'two crisp sessions at the same weight: a plate')
  assert.equal(landminePower('Punch', 4, 3, crisp, L({ kg: 0, reps: 4, minRir: 2, day: MON - 14 }), true).change, 'increase')
  const atCap = L({ kg: POWER_CAP_KG, reps: 4, plannedReps: 4 })
  assert.equal(landminePower('Punch', 4, 4, atCap, atCap, true).change, 'hold', 'never over 25 lb')
  assert.equal(landminePower('Punch', 4, 3, crisp, crisp, true).reps, 4, 'reps never go up')
}

// ─── Stages and history ──────────────────────────────────────
{
  assert.deepEqual([0, 1, 2, 4, 6, 12].map(n => landmineStage(n, false)), [1, 1, 2, 3, 4, 4], 'a stage per two sessions, about 8 weeks to the last')
  assert.equal(landmineStage(6, true), 3, 'a sore back holds the stage back')
  const sets = [
    { exerciseId: 'ex-lm-punch', sessionId: 'a', day: MON - 14, weightKg: null, reps: 4, plannedReps: 4, rir: 3, isWarmup: false, logged: true },
    { exerciseId: 'ex-lm-punch', sessionId: 'b', day: MON - 7, weightKg: 2.5 * LB, reps: 4, plannedReps: 4, rir: 2, isWarmup: false, logged: true },
    { exerciseId: 'ex-lm-punch', sessionId: 'b', day: MON - 7, weightKg: 2.5 * LB, reps: 3, plannedReps: 4, rir: 0, isWarmup: false, logged: true },
    { exerciseId: 'ex-bench-press', sessionId: 'b', day: MON - 7, weightKg: 40, reps: 8, plannedReps: 8, rir: 2, isWarmup: false, logged: true },
  ]
  const h = landmineHistory(sets, new Set(['a', 'b']), MON)
  assert.deepEqual(Object.keys(h), ['ex-lm-punch'], 'landmine moves only')
  assert.deepEqual(h['ex-lm-punch'].map(x => [x.day, lb(x.kg), x.allReps, x.minRir]), [[MON - 7, 2.5, false, 0], [MON - 14, 0, true, 3]], 'newest first, bar only is 0')
}

// ─── The press pick ──────────────────────────────────────────
{
  const m = buildAthleteModel(events(), MON)
  const ctx = { day: MON, state: 'GREEN', backToday: null, model: m, openPlans: [] as Array<{ region: string }> }
  const first = choosePress(ctx, {}, 1)
  assert.deepEqual([first.exerciseId, first.explain], ['ex-landmine-press', PRESS_REBUILD_WHY], 'landmine press first, one plain line why')
  assert.equal(PRESS_REBUILD_WHY, "Landmine press while your shoulders and back rebuild. Overhead press comes in once they're solid, then the coach swaps the two for heavy, light and variety days.", 'page 93 word for word')
  const clean = [L({ day: MON - 7 }), L({ day: MON - 14 })]
  assert.equal(choosePress(ctx, { 'ex-landmine-press': clean }, 2).exerciseId, 'ex-lm-press-standing', 'stage 2 and a clean half-kneeling press: standing')
  // Solid: two clean standing presses, the back allows it. Then the overhead press, swapped for variety and light days.
  const solid = { 'ex-lm-press-standing': clean }
  const even = MON + 7 * (Math.floor((MON + 3) / 7) % 2 === 1 ? 1 : 0)
  assert.deepEqual([choosePress({ ...ctx, day: even }, solid, 3).exerciseId, choosePress({ ...ctx, day: even }, solid, 3).explain], ['ex-ohp', PRESS_HEAVY_WHY], 'solid: the overhead press')
  assert.deepEqual([choosePress({ ...ctx, day: even + 7 }, solid, 3).exerciseId, choosePress({ ...ctx, day: even + 7 }, solid, 3).explain], ['ex-lm-press-standing', PRESS_VARIETY_WHY], 'every other week: the landmine for variety')
  assert.deepEqual([choosePress({ ...ctx, day: even, state: 'AMBER' }, solid, 3).exerciseId, choosePress({ ...ctx, day: even, state: 'AMBER' }, solid, 3).explain], ['ex-lm-press-standing', PRESS_LIGHT_WHY], 'a rough morning: the lighter press')
  assert.equal(choosePress({ ...ctx, day: even, openPlans: [{ region: 'shoulder' }] }, solid, 3).explain, PRESS_REBUILD_WHY, 'a shoulder plan: back to rebuilding')
  // In the dose: the explain rides on the lift, the landmine press has no weight to start.
  const dctx: DoseCtx = { day: MON, state: 'GREEN', stateWhy: null, model: m, backToday: null, openPlans: [] }
  const d = strengthDose(dctx, { kind: 'block_zero', main: [{ exerciseId: 'ex-landmine-press', label: 'Landmine Press', reps: 8 }], tmKg: {}, equipment: {}, steppedThisWeek: [], lastFeltHard: null })
  assert.deepEqual([d.lifts[0].exerciseId, d.lifts[0].weightKg, d.lifts[0].sets, d.lifts[0].explain], ['ex-landmine-press', null, 3, PRESS_REBUILD_WHY])
}

// ─── The chin-up ladder and the reps-only moves ──────────────
{
  assert.deepEqual(chinUpDose({}, false), { exerciseId: 'ex-chin-up-band', label: 'Chin-Up (Band)', reps: 5, change: 'start' }, 'band, 3×5 to start')
  const at = (id: string, planned: number, reps: number[]) => ({ [id]: { exerciseId: id, day: MON - 7, reps, plannedReps: planned } })
  assert.equal(chinUpDose(at('ex-chin-up-band', 5, [5, 5, 5]), false).reps, 6, 'every set in: one more')
  assert.equal(chinUpDose(at('ex-chin-up-band', 6, [6, 6, 4]), false).reps, 6, 'a set short: hold')
  assert.deepEqual(chinUpDose(at('ex-chin-up-band', 8, [8, 8, 8]), false), { exerciseId: 'ex-chin-up-negative', label: 'Chin-Up (Slow Lowering)', reps: 3, change: 'increase' }, 'the top of the band rung: slow lowering')
  assert.equal(chinUpDose(at('ex-chin-up-negative', 5, [5, 5, 5]), false).exerciseId, 'ex-chin-up', 'then full chin-ups')
  assert.equal(chinUpDose(at('ex-chin-up', 8, [8, 8, 8]), false).reps, 8, 'full chin-ups top out at 8: never added weight')
  assert.equal(CHIN_LADDER.length, 3)
  assert.deepEqual(repsDose('ex-nordic-curl', 3, { exerciseId: 'ex-nordic-curl', day: MON - 7, reps: [3, 3], plannedReps: 3 }, false), { reps: 4, change: 'increase' })
  assert.deepEqual(repsDose('ex-copenhagen-plank', 20, { exerciseId: 'ex-copenhagen-plank', day: MON - 7, reps: [20, 20], plannedReps: 20 }, false), { reps: 25, change: 'increase' }, 'Copenhagen: 5 s more')
  assert.equal(repsDose('ex-dead-bugs', 10, null, false), null, 'not a reps-only progression')
}

// ─── Page 93's plan lines ────────────────────────────────────
{
  const ex = (exerciseId: string, name: string, section: string, setsReps: string, kg: number | null, equipment: string) => ({ exerciseId, name, section, equipment, prescription: { prescribedWeightKg: kg, setsReps } })
  const s = { id: 's', type: 'strength', label: 'Strength A', status: 'planned', scheduledDate: MON, timeSlot: 'pm', blockType: 'block_zero', blockWeek: 8, notes: null } as never
  const lines = planLines(s, { kind: 'strength', notes: [], plannedMin: 50, brainLifts: [{ exerciseId: 'ex-landmine-press', change: 'hold', explain: PRESS_REBUILD_WHY }], exercises: [
    ex('ex-goblet-squat', 'Goblet Squat', 'main', '3×8', 30 * LB, 'dumbbell'),
    ex('ex-landmine-press', 'Landmine Press', 'main', '3×8', 10 * LB, 'landmine'),
    ex('ex-db-row', 'Dumbbell Row', 'main', '3×10', 20 * LB, 'dumbbell,bench'),
    ex('ex-dead-bugs', 'Dead Bugs', 'core', '2×10', null, 'bodyweight'),
    ex('ex-chin-up-band', 'Chin-Up (Band)', 'accessory', '3×5', null, 'pull-up bar,band'),
    ex('ex-hammer-curl', 'Hammer Curl', 'accessory', '2×10', 15 * LB, 'dumbbell'),
    ex('ex-suitcase-carry', 'Grip: Suitcase Carry', 'accessory', '2×30', 30 * LB, 'dumbbell'),
  ] })
  const by = (label: string) => lines.find(l => l.label === label)
  assert.deepEqual([by('PRESS')?.value, by('PRESS')?.explain], ['landmine · 3×8 · 10 lb', PRESS_REBUILD_WHY], 'PRESS: landmine · 3×8 · 10 lb, why behind a tap')
  assert.equal(by('ARMS')?.value, 'chin-ups 3×5, hammer curls, grip', 'one ARMS line, chin-ups once')
  assert.equal(by('GOBLET SQUAT')?.value, '3×8 · 30 lb')
  const b = planLines({ ...(s as object), label: 'Strength B' } as never, { kind: 'strength', notes: [], plannedMin: 50, brainLifts: [], exercises: [
    ex('ex-lm-punch', 'Landmine Punch', 'main', '3×4 each', null, 'landmine'),
    ex('ex-lm-reverse-lunge', 'Landmine Reverse Lunge', 'main', '3×8 each', null, 'landmine'),
    ex('ex-db-row', 'Dumbbell Row', 'accessory', '3×10', 20 * LB, 'dumbbell,bench'),
    ex('ex-dips', 'Dips', 'accessory', '3×6', null, 'dip bars'),
    ex('ex-wrist-curl', 'Wrist Curl', 'accessory', '2×15', 10 * LB, 'dumbbell,barbell'),
  ] })
  // Pulling twice a week (2026-10-26): B's row leads its arm block; on A the row is a main lift with its own line.
  assert.deepEqual(b.filter(l => l.label !== 'TIME').map(l => [l.label, l.value]), [['LM PUNCH', '3×4 each · bar only'], ['LM LUNGE', '3×8 each · bar only'], ['ARMS', 'rows 3×10, dips, wrist curls']], 'page 93 Strength B lines')
  assert.equal(by('DB ROW')?.value ?? by('DUMBBELL ROW')?.value, '3×10 · 20 lb', 'A: the row as its own line')
}

console.log('landmine tests passed')
